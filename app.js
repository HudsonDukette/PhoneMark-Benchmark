import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://qgcuydtodbcmvqmfiigx.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_FgYCUlwoR42lHfcQB-HGvQ_4cpC4NmJ";
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const VERSION = "1.0";

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString();

let device, latest = null;

function show(id) {
  document.querySelectorAll(".screen").forEach(x => x.classList.remove("active"));
  $(id).classList.add("active");
  scrollTo(0, 0);
}

function detect() {
  const ua = navigator.userAgent || "";
  let name = "Unknown device";
  let confidence = 25;
  let os = "Unknown";

  if (/iPhone/i.test(ua)) {
    name = "Apple iPhone";
    os = "iOS";
    confidence = 80;
  } else if (/iPad/i.test(ua)) {
    name = "Apple iPad";
    os = "iPadOS";
    confidence = 80;
  } else if (/Android/i.test(ua)) {
    os = "Android";
    const m = ua.match(/Android[^;)]*;\s*(?:wv;\s*)?(?:[^;]+;\s*)?([^;)]+?)(?:\s+Build\/[^;)]+)?[;)]/i);
    name = m?.[1]?.trim() || "Android device";
    confidence = m ? 72 : 40;
  } else if (/Mac OS X/i.test(ua)) {
    name = "Mac";
    os = "macOS";
    confidence = 90;
  } else if (/Windows/i.test(ua)) {
    name = "Windows PC";
    os = "Windows";
    confidence = 90;
  }

  let gpu = "Unavailable";
  try {
    const c = document.createElement("canvas");
    const g = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (g) {
      const ext = g.getExtension("WEBGL_debug_renderer_info");
      gpu = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
    }
  } catch {}

  const webgpu = !!navigator.gpu;

  device = {
    name,
    confidence,
    os,
    browser: /Chrome/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : /Firefox/i.test(ua) ? "Firefox" : "Browser",
    cores: navigator.hardwareConcurrency || null,
    memory: navigator.deviceMemory || null,
    gpu,
    webgpu,
    width: screen.width,
    height: screen.height,
    dpr: devicePixelRatio || 1
  };

  $("deviceName").textContent = name;
  $("deviceMeta").textContent = `${os} · ${device.browser} · ${device.cores || "?"} CPU cores · ${webgpu ? "WebGPU" : "WebGL"}`;
  return device;
}

function setProgress(p, label, detail) {
  $("runPercent").textContent = `${Math.round(p)}%`;
  $("progressBar").style.width = `${p}%`;
  $("testLabel").textContent = label;
  $("testDetail").textContent = detail;
}

function workerRun(ms) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./worker.js", import.meta.url), { type: "classic" });
    const t = setTimeout(() => {
      w.terminate();
      reject(new Error("CPU timeout"));
    }, ms + 3000);
    w.onmessage = e => {
      clearTimeout(t);
      w.terminate();
      resolve(e.data);
    };
  });
}

async function cpuTest(ms = 8000, workers = Math.min(device.cores || 2, 8)) {
  setProgress(15, "CPU TEST", "Running parallel compute workers");
  const t = performance.now();
  const jobs = Array.from({ length: workers }, () => workerRun(ms));
  const r = await Promise.all(jobs);
  const ops = r.reduce((a, b) => a + b.ops, 0);
  const sec = (performance.now() - t) / 1000;
  const opsSec = ops / sec;
  const score = Math.max(1, Math.round(Math.sqrt(opsSec) * 180));
  $("liveCpu").textContent = fmt(score);
  return { score, opsSec };
}

function renderer() {
  const c = document.createElement("canvas");
  c.width = Math.min(720, Math.max(360, innerWidth * devicePixelRatio));
  c.height = Math.min(1280, Math.max(640, innerHeight * devicePixelRatio));
  c.style.position = "fixed";
  c.style.left = "-9999px";
  document.body.appendChild(c);
  const gl = c.getContext("webgl", { antialias: false, powerPreference: "high-performance" });
  return { c, gl };
}

function gpuTest(ms = 9000, hybrid = false) {
  return new Promise(resolve => {
    setProgress(hybrid ? 72 : 40, hybrid ? "HYBRID TEST" : "GPU TEST", hybrid ? "CPU + GPU simultaneous load" : "Rendering sustained 3D workload");
    const { c, gl } = renderer();
    if (!gl) {
      c.remove();
      resolve({ score: 1, avg: 0, low: 0 });
      return;
    }

    const vs = `attribute vec2 p;uniform float t;void main(){float a=t*.7+length(p)*2.;float s=sin(a),q=cos(a);gl_Position=vec4(p.x*q-p.y*s,p.x*s+p.y*q,0,1);}`;
    const fs = `precision mediump float;uniform float t;void main(){vec2 q=gl_FragCoord.xy/vec2(${c.width.toFixed(1)},${c.height.toFixed(1)});float v=0.;for(int i=0;i<12;i++){q=abs(q*2.-1.);v+=sin(q.x*8.+t)+cos(q.y*7.-t);}gl_FragColor=vec4(.2+.2*sin(v),.7+.25*cos(v),.45+.2*sin(v*1.7),1.);}`;

    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    gl.useProgram(p);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const data = new Float32Array(4000);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    const loc = gl.getAttribLocation(p, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const timeLoc = gl.getUniformLocation(p, "t");
    let frames = 0, start = performance.now(), times = [], last = start;

    function frame(now) {
      const dt = now - last;
      last = now;
      if (dt > 0) times.push(dt);
      frames++;
      gl.uniform1f(timeLoc, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 2000);
      if (now - start < ms) {
        requestAnimationFrame(frame);
      } else {
        const avg = frames / ((now - start) / 1000);
        const sorted = times.slice().sort((a, b) => b - a);
        const low = sorted[Math.floor(sorted.length * 0.01)] ? 1000 / sorted[Math.floor(sorted.length * 0.01)] : avg;
        const score = Math.max(1, Math.round(avg * 115));
        c.remove();
        resolve({ score, avg, low });
      }
    }
    requestAnimationFrame(frame);
  });
}

async function run() {
  show("running");
  $("liveCpu").textContent = $("liveGpu").textContent = $("liveHybrid").textContent = "—";
  const start = performance.now();
  try {
    const cpu = await cpuTest(6500);
    setProgress(38, "GPU TEST", "Rendering sustained 3D workload");
    const gpu = await gpuTest(7500);
    $("liveGpu").textContent = fmt(gpu.score);
    const hybridCpu = workerRun(6500);
    const hybridGpu = gpuTest(6500, true);
    const [cw, hg] = await Promise.all([hybridCpu, hybridGpu]);
    const hybridScore = Math.round((Math.sqrt(cw.ops / 6.5) * 105 + hg.score * 1.05) / 2);
    $("liveHybrid").textContent = fmt(hybridScore);
    setProgress(100, "COMPLETE", "Finalizing score");
    const overall = Math.round(cpu.score * 0.35 + gpu.score * 0.45 + hybridScore * 0.20);
    latest = {
      cpu,
      gpu,
      hybrid: { score: hybridScore, avg: hg.avg },
      overall,
      duration: Math.round(performance.now() - start)
    };
    renderResults();
    await saveResult();
  } catch (e) {
    console.error(e);
    alert("The benchmark failed. Try again with other tabs closed.");
    show("home");
  }
}

function renderResults() {
  show("results");
  $("overallScore").textContent = fmt(latest.overall);
  $("cpuScore").textContent = fmt(latest.cpu.score);
  $("gpuScore").textContent = fmt(latest.gpu.score);
  $("hybridScore").textContent = fmt(latest.hybrid.score);
  $("cpuMetric").textContent = `${fmt(latest.cpu.opsSec)} ops/s`;
  $("gpuMetric").textContent = `${latest.gpu.avg.toFixed(1)} FPS avg`;
  $("hybridMetric").textContent = `${latest.hybrid.avg.toFixed(1)} FPS + CPU`;
  $("details").innerHTML = `<div><span>Device</span><b>${esc(device.name)}</b></div><div><span>Renderer</span><b>${esc(device.gpu).slice(0, 55)}</b></div><div><span>CPU cores</span><b>${device.cores || "Unknown"}</b></div><div><span>WebGPU</span><b>${device.webgpu ? "Available" : "Unavailable"}</b></div><div><span>Duration</span><b>${(latest.duration / 1000).toFixed(1)}s</b></div>`;
}

async function saveResult() {
  const row = {
    benchmark_version: VERSION,
    device_name: device.name,
    device_confidence: device.confidence,
    os: device.os,
    browser: device.browser,
    cpu_cores: device.cores,
    device_memory_gb: device.memory,
    gpu_renderer: device.gpu,
    webgpu_available: device.webgpu,
    webgl_version: "WebGL",
    screen_width: device.width,
    screen_height: device.height,
    device_pixel_ratio: device.dpr,
    cpu_score: latest.cpu.score,
    gpu_score: latest.gpu.score,
    hybrid_score: latest.hybrid.score,
    overall_score: latest.overall,
    cpu_ops_per_sec: latest.cpu.opsSec,
    gpu_avg_fps: latest.gpu.avg,
    gpu_1pct_low: latest.gpu.low,
    hybrid_avg_fps: latest.hybrid.avg,
    duration_ms: latest.duration,
    metadata: { userAgent: navigator.userAgent }
  };
  const { error } = await db.from("benchmark_results").insert(row);
  $("savedStatus").textContent = error ? "Not saved" : "Saved";
  if (error) console.error(error);
  const { count } = await db.from("benchmark_results").select("*", { count: "exact", head: true }).gt("overall_score", latest.overall);
  $("percentile").textContent = count == null ? "Score saved to PhoneMark" : `Top ${Math.max(1, Math.round((count + 1) / Math.max(1, (count + 1)) * 100))}% — leaderboard ranking coming soon`;
}

async function leaderboard() {
  show("leaderboard");
  $("leaderboardList").innerHTML = "Loading results…";
  const { data, error } = await db.from("benchmark_results").select("device_name,overall_score,cpu_score,gpu_score,created_at").order("overall_score", { ascending: false }).limit(50);
  if (error) {
    $("leaderboardList").textContent = "Could not load leaderboard.";
    return;
  }
  $("leaderboardList").innerHTML = data.length ? data.map((r, i) => `<div class="row"><span class="rank">#${i + 1}</span><div><strong>${esc(r.device_name)}</strong><small>CPU ${fmt(r.cpu_score)} · GPU ${fmt(r.gpu_score)}</small></div><b>${fmt(r.overall_score)}</b></div>`).join("") : "No benchmark results yet.";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

$("startBtn").onclick = run;
$("againBtn").onclick = run;
$("leaderboardBtn").onclick = leaderboard;
$("backBtn").onclick = () => show("home");
$("shareBtn").onclick = async () => {
  const text = `I scored ${fmt(latest.overall)} on PhoneMark!`;
  try {
    await navigator.share({ title: "PhoneMark result", text, url: location.href });
  } catch {
    await navigator.clipboard?.writeText(text + " " + location.href);
    $("savedStatus").textContent = "Copied";
  }
};

detect();
