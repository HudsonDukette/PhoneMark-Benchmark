console.log('PhoneMark: App loading...');

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://qgcuydtodbcmvqmfiigx.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_FgYCUlwoR42lHfcQB-HGvQ_4cpC4NmJ";
const VERSION = "1.0";
const ACTIVE_DEVICE_KEY = "phonemark.activeDevice";
const SOUND_ENABLED_KEY = "phonemark.soundEnabled";
const HISTORY_KEY = "phonemark.runHistory";
const PENDING_RESULTS_KEY = "phonemark.pendingResults";
const SCORE_FIELDS = ["overall_score", "cpu_score", "gpu_score", "hybrid_score"];
const SCREEN_IDS = new Set(["home", "running", "results", "account", "scores"]);

function storageGet(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

let db;
let device;
let latest = null;
let currentSession = null;
let currentProfile = null;
let deviceConfigs = [];
let activeDeviceConfig = null;
let scoreRows = [];
let scoresRequestId = 0;
let sessionRequestId = 0;
let clickAudioContext;
let soundEnabled = storageGet(SOUND_ENABLED_KEY) !== "off";
let currentRun = null;
let editingDeviceId = null;
let syncingPendingResults = false;

const $ = id => document.getElementById(id);
const fmt = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const roundOne = value => Number(value || 0).toFixed(1);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[char]));
const normalizeUsername = value => String(value || "").trim().toLowerCase();
const validUsername = value => /^[a-z0-9_.-]{3,30}$/.test(value);
const initialFor = value => (String(value || "P").trim()[0] || "P").toUpperCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function show(id, updateHistory = true) {
  document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
  const target = $(id);
  if (!target) return;
  target.classList.add("active");
  if (id !== "scores") scoresRequestId++;
  if (updateHistory && location.hash !== `#${id}`) {
    const method = id === "running" ? "replaceState" : "pushState";
    history[method]({ screen: id }, "", `#${id}`);
  }
  scrollTo(0, 0);
  if (id === "scores") loadScores();
  if (id === "account") renderAccount();
}

function restoreScreenFromHash() {
  let id = location.hash.slice(1);
  const transientScreenWithoutState = (id === "running" && !currentRun) || (id === "results" && !latest);
  if (!SCREEN_IDS.has(id) || transientScreenWithoutState) {
    id = "home";
    history.replaceState({ screen: id }, "", `#${id}`);
  }
  show(id, false);
}

function updateSoundControl() {
  const button = $("soundBtn");
  const icon = $("soundIcon");
  if (!button) return;
  button.setAttribute("aria-pressed", String(soundEnabled));
  button.setAttribute("aria-label", soundEnabled ? "Turn sounds off" : "Turn sounds on");
  if (icon) icon.textContent = soundEnabled ? "◒" : "◌";
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  storageSet(SOUND_ENABLED_KEY, soundEnabled ? "on" : "off");
  updateSoundControl();
}

function playButtonClick() {
  if (!soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    clickAudioContext ||= new AudioContext();
    const context = clickAudioContext;
    const play = () => {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(620, now);
      oscillator.frequency.exponentialRampToValueAtTime(470, now + 0.065);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.022, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.08);
    };
    if (context.state === "suspended") context.resume().then(play).catch(() => {});
    else play();
  } catch {}
}

function cancellationError() {
  const error = new Error("Benchmark cancelled");
  error.cancelled = true;
  return error;
}

function readRunHistory() {
  try {
    const value = JSON.parse(storageGet(HISTORY_KEY, "[]"));
    return Array.isArray(value)
      ? value.filter(entry => entry
        && typeof entry === "object"
        && Number.isFinite(Number(entry.overall))
        && Number.isFinite(Number(entry.cpu))
        && Number.isFinite(Number(entry.gpu))
        && Number.isFinite(Number(entry.hybrid))
        && Number.isFinite(new Date(entry.createdAt).getTime()))
      : [];
  } catch {
    return [];
  }
}

function createRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveLocalRun() {
  if (!latest) return;
  const id = latest.localId || createRunId();
  latest.localId = id;
  const entry = {
    id,
    createdAt: new Date().toISOString(),
    name: latest.name,
    cpu_model: latest.cpu_model,
    gpu_model: latest.gpu_model,
    overall: latest.overall,
    cpu: latest.cpu.score,
    gpu: latest.gpu.score,
    hybrid: latest.hybrid.score,
    duration: latest.duration
  };
  const history = [entry, ...readRunHistory()].slice(0, 8);
  storageSet(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

function readPendingResults() {
  try {
    const value = JSON.parse(storageGet(PENDING_RESULTS_KEY, "[]"));
    return Array.isArray(value)
      ? value.filter(entry => entry && typeof entry === "object" && entry.row && typeof entry.row === "object" && entry.id)
      : [];
  } catch {
    return [];
  }
}

function writePendingResults(entries) {
  storageSet(PENDING_RESULTS_KEY, JSON.stringify(entries.slice(0, 20)));
}

function queuePendingResult(row) {
  const runId = row?.metadata?.clientRunId || createRunId();
  const pending = readPendingResults().filter(entry => entry.row?.metadata?.clientRunId !== runId);
  pending.unshift({ id: runId, queuedAt: new Date().toISOString(), attempts: 0, nextAttemptAt: 0, row });
  writePendingResults(pending);
}

function removePendingResult(row) {
  const runId = row?.metadata?.clientRunId;
  if (!runId) return;
  writePendingResults(readPendingResults().filter(entry => entry.row?.metadata?.clientRunId !== runId));
}

function renderHistory() {
  const list = $("historyList");
  if (!list) return;
  const history = readRunHistory();
  if (!history.length) {
    list.innerHTML = `<p class="empty-state">Your recent runs will appear here.</p>`;
    return;
  }
  list.innerHTML = history.map((entry, index) => {
    const previous = history[index + 1];
    const delta = previous && Number.isFinite(Number(previous.overall)) ? Number(entry.overall) - Number(previous.overall) : null;
    const deltaLabel = delta == null ? "First saved run" : `${delta >= 0 ? "+" : ""}${fmt(delta)} vs previous`;
    const date = new Date(entry.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<article class="history-row"><div><strong>${fmt(entry.overall)}</strong><small>${esc(entry.name || "Automatic detection")} · ${esc(date)}</small></div><div><b class="history-delta ${delta != null && delta < 0 ? "down" : ""}">${esc(deltaLabel)}</b><small>CPU ${fmt(entry.cpu)} · GPU ${fmt(entry.gpu)} · Hybrid ${fmt(entry.hybrid)}</small></div></article>`;
  }).join("");
}

function clearHistory() {
  if (readRunHistory().length && !window.confirm("Clear all local benchmark history?")) return;
  storageRemove(HISTORY_KEY);
  renderHistory();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

function registerOfflineShell() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then(() => console.log("PhoneMark: offline shell ready"))
      .catch(error => console.warn("PhoneMark: offline shell unavailable", error));
  }, { once: true });
}

async function copyResult() {
  if (!latest) return;
  const text = `PhoneMark score: ${fmt(latest.overall)} | CPU ${fmt(latest.cpu.score)} | GPU ${fmt(latest.gpu.score)} | Hybrid ${fmt(latest.hybrid.score)} | ${latest.cpu_model} / ${latest.gpu_model}`;
  try {
    await copyText(text);
    $("savedStatus").textContent = "Copied";
  } catch {
    $("savedStatus").textContent = "Copy unavailable";
  }
}

function setStatus(id, message = "", tone = "") {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.className = `form-status${tone ? ` ${tone}` : ""}`;
}

function setAvatar(element, profile) {
  if (!element) return;
  element.className = "avatar avatar-large";
  if (profile?.avatar_url) {
    element.innerHTML = `<img src="${esc(profile.avatar_url)}" alt="${esc(profile.username || "Profile picture")}">`;
  } else {
    element.textContent = initialFor(profile?.username);
  }
}

function avatarMarkup(profile) {
  return profile?.avatar_url
    ? `<span class="avatar avatar-small"><img src="${esc(profile.avatar_url)}" alt=""></span>`
    : `<span class="avatar avatar-small">${esc(initialFor(profile?.username))}</span>`;
}

function updateHeader() {
  const accountButton = $("accountBtn");
  if (!accountButton) return;
  accountButton.innerHTML = currentProfile
    ? `${avatarMarkup(currentProfile)}<span>${esc(currentProfile.username)}</span>`
    : "Sign in";
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
    const match = ua.match(/Android[^;)]*;\s*(?:wv;\s*)?(?:[^;]+;\s*)?([^;)]+?)(?:\s+Build\/[^;)]+)?[;)]/i);
    name = match?.[1]?.trim() || "Android device";
    confidence = match ? 72 : 40;
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
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (context) {
      const extension = context.getExtension("WEBGL_debug_renderer_info");
      gpu = extension
        ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : context.getParameter(context.RENDERER);
    }
  } catch {}

  const cores = navigator.hardwareConcurrency || null;
  const webgpu = !!navigator.gpu;
  device = {
    name,
    confidence,
    os,
    browser: /Chrome/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : /Firefox/i.test(ua) ? "Firefox" : "Browser",
    cores,
    memory: navigator.deviceMemory || null,
    gpu,
    webgpu,
    width: screen.width,
    height: screen.height,
    dpr: devicePixelRatio || 1,
    cpu_model: `Automatic CPU (${cores || "unknown"} cores)`,
    gpu_model: gpu
  };

  updateDeviceDisplay();
  return device;
}

function updateDeviceDisplay() {
  if (!device) return;
  const selected = activeDeviceConfig;
  $("deviceName").textContent = selected?.name || device.name;
  $("deviceMeta").textContent = selected
    ? `${selected.cpu_model} · ${selected.gpu_model}`
    : `${device.os} · ${device.browser} · ${device.cores || "?"} CPU cores · ${device.webgpu ? "WebGPU" : "WebGL"}`;
}

function renderDevicePicker() {
  const select = $("activeDeviceSelect");
  if (!select) return;
  const current = activeDeviceConfig?.id || "";
  select.innerHTML = `<option value="">Automatic detection</option>${deviceConfigs.map(config => `<option value="${esc(config.id)}">${esc(config.name)} · ${esc(config.cpu_model)}</option>`).join("")}`;
  select.value = current;
  select.disabled = !currentSession && deviceConfigs.length === 0;
  updateDeviceDisplay();
}

async function loadProfile(user, isCurrent = () => true) {
  if (!db || !user) return null;
  try {
    const { data, error } = await db.from("profiles")
      .select("id,username,contact_email,avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (!isCurrent()) return null;
    if (!error && data) return data;
  } catch {}
  if (!isCurrent()) return null;
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    username: metadata.username || user.email?.split("@")[0] || "Player",
    contact_email: metadata.contact_email || "",
    avatar_url: ""
  };
}

async function loadDeviceConfigs(userId, isCurrent = () => true) {
  if (!db || !userId) return { configs: [], active: null };
  try {
    const { data } = await db.from("device_configs")
      .select("id,name,cpu_model,gpu_model,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (!isCurrent()) return null;
    const configs = data || [];
    const storedId = storageGet(ACTIVE_DEVICE_KEY);
    const active = configs.find(config => config.id === storedId) || null;
    return { configs, active };
  } catch {
    return { configs: [], active: null };
  }
}

async function applySession(session) {
  const requestId = ++sessionRequestId;
  currentSession = session;
  const isCurrent = () => requestId === sessionRequestId;
  let profile = null;
  let configs = [];
  let active = null;
  if (session?.user) {
    profile = await loadProfile(session.user, isCurrent);
    if (!isCurrent()) return;
    const loaded = await loadDeviceConfigs(session.user.id, isCurrent);
    if (!isCurrent() || !loaded) return;
    ({ configs, active } = loaded);
  }
  if (!isCurrent()) return;
  currentProfile = profile;
  deviceConfigs = configs;
  activeDeviceConfig = active;
  renderDevicePicker();
  updateHeader();
  renderAccount();
}

function renderAccount() {
  const authPanel = $("authPanel");
  const profilePanel = $("profilePanel");
  if (!authPanel || !profilePanel) return;
  authPanel.classList.toggle("hidden", !!currentProfile);
  profilePanel.classList.toggle("hidden", !currentProfile);
  if (!currentProfile) return;
  setAvatar($("profileAvatar"), currentProfile);
  $("profileUsername").textContent = currentProfile.username;
  $("profileEmail").textContent = currentProfile.contact_email || "No contact email added";
  renderDeviceList();
}

function switchAuthMode(mode) {
  const login = mode === "login";
  $("loginForm").classList.toggle("hidden", !login);
  $("signupForm").classList.toggle("hidden", login);
  $("showLoginBtn").classList.toggle("active", login);
  $("showSignupBtn").classList.toggle("active", !login);
  setStatus("accountStatus");
}

async function signIn(event) {
  event.preventDefault();
  if (!db) return setStatus("accountStatus", "Supabase is not configured.", "error");
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!validEmail(email)) return setStatus("accountStatus", "Enter a valid email address.", "error");
  if (password.length < 8) return setStatus("accountStatus", "Password must be at least 8 characters.", "error");
  setStatus("accountStatus", "Signing in…");
  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) return setStatus("accountStatus", error.message, "error");
    await applySession(data.session);
    setStatus("accountStatus", "Signed in.", "success");
  } catch (error) {
    setStatus("accountStatus", error.message || "Sign in failed. Check your connection and try again.", "error");
  }
}

async function signUp(event) {
  event.preventDefault();
  if (!db) return setStatus("accountStatus", "Supabase is not configured.", "error");
  const username = normalizeUsername($("signupUsername").value);
  const password = $("signupPassword").value;
  const email = $("signupEmail").value.trim();
  const avatarFile = $("signupAvatar").files[0];
  if (!validUsername(username)) return setStatus("accountStatus", "Use 3–30 letters, numbers, dots, dashes, or underscores.", "error");
  if (!validEmail(email)) return setStatus("accountStatus", "Enter a valid email address.", "error");
  if (password.length < 8) return setStatus("accountStatus", "Password must be at least 8 characters.", "error");
  setStatus("accountStatus", "Creating account…");
  try {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });
    if (error) return setStatus("accountStatus", error.message, "error");
    if (!data.session) {
      switchAuthMode("login");
      return setStatus("accountStatus", "Account created! Check your email for a confirmation link, then sign in here.", "success");
    }
    await applySession(data.session);
    const avatarSaved = !avatarFile || await uploadAvatarFile(avatarFile, false);
    setStatus("accountStatus", avatarSaved ? "Account created." : "Account created, but the profile picture could not be uploaded.", avatarSaved ? "success" : "warning");
  } catch (error) {
    setStatus("accountStatus", error.message || "Account creation failed. Check your connection and try again.", "error");
  }
}

async function signOut() {
  try {
    if (db) await db.auth.signOut();
  } catch (error) {
    console.warn("PhoneMark: Sign out request failed; clearing local session", error);
  }
  await applySession(null);
  show("home");
}

async function uploadAvatarFile(file, notify = true) {
  if (!db || !currentSession?.user || !file) return false;
  if (!file.type.startsWith("image/")) {
    if (notify) setStatus("accountStatus", "Choose an image file.", "error");
    return false;
  }
  if (file.size > 2 * 1024 * 1024) {
    if (notify) setStatus("accountStatus", "Profile pictures must be 2 MB or smaller.", "error");
    return false;
  }
  const userId = currentSession.user.id;
  const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/avatar-${Date.now()}.${extension}`;
  try {
    const { error: uploadError } = await db.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) throw uploadError;
    const { data } = db.storage.from("avatars").getPublicUrl(path);
    const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
    const { error: updateError } = await db.from("profiles").update({ avatar_url: avatarUrl }).eq("id", userId);
    if (updateError) throw updateError;
    if (currentSession?.user?.id !== userId) return false;
    currentProfile = { ...currentProfile, avatar_url: avatarUrl };
    updateHeader();
    renderAccount();
    if (notify) setStatus("accountStatus", "Profile picture updated.", "success");
    return true;
  } catch (error) {
    if (notify) setStatus("accountStatus", error.message || "Profile picture upload failed.", "error");
    return false;
  }
}

async function handleAvatarUpload(event) {
  event.preventDefault();
  await uploadAvatarFile($("avatarFile").files[0]);
}

function renderDeviceList() {
  const list = $("deviceList");
  if (!list) return;
  if (!deviceConfigs.length) {
    list.innerHTML = `<p class="empty-state">No saved devices yet. Add a CPU and GPU to get exact comparisons.</p>`;
    return;
  }
  list.innerHTML = deviceConfigs.map(config => `
    <div class="saved-device ${activeDeviceConfig?.id === config.id ? "selected" : ""}">
      <div><strong>${esc(config.name)}</strong><small>${esc(config.cpu_model)} · ${esc(config.gpu_model)}</small></div>
      <div class="saved-device-actions"><button class="text-button" data-select-device="${esc(config.id)}" type="button">${activeDeviceConfig?.id === config.id ? "Selected" : "Use"}</button><button class="text-button" data-edit-device="${esc(config.id)}" type="button">Edit</button><button class="text-button danger" data-delete-device="${esc(config.id)}" type="button">Delete</button></div>
    </div>`).join("");
}

function resetDeviceForm() {
  editingDeviceId = null;
  $("deviceForm").reset();
  $("saveDeviceBtn").innerHTML = "SAVE DEVICE <b>+</b>";
  $("cancelEditBtn").classList.add("hidden");
}

function editDevice(id) {
  const config = deviceConfigs.find(item => item.id === id);
  if (!config) return;
  editingDeviceId = id;
  $("deviceConfigName").value = config.name;
  $("deviceCpuModel").value = config.cpu_model;
  $("deviceGpuModel").value = config.gpu_model;
  $("saveDeviceBtn").innerHTML = "UPDATE DEVICE <b>✓</b>";
  $("cancelEditBtn").classList.remove("hidden");
  $("deviceConfigName").focus();
}

async function saveDeviceConfig(event) {
  event.preventDefault();
  if (!db || !currentSession?.user) {
    show("account");
    return setStatus("accountStatus", "Sign in before saving a device configuration.", "warning");
  }
  const userId = currentSession.user.id;
  const editId = editingDeviceId;
  const payload = {
    user_id: userId,
    name: $("deviceConfigName").value.trim(),
    cpu_model: $("deviceCpuModel").value.trim(),
    gpu_model: $("deviceGpuModel").value.trim()
  };
  if (!payload.name || !payload.cpu_model || !payload.gpu_model) return setStatus("accountStatus", "Device name, CPU model, and GPU model are required.", "error");
  setStatus("accountStatus", editId ? "Updating device…" : "Saving device…");
  try {
    const request = editId
      ? db.from("device_configs").update(payload).eq("id", editId).eq("user_id", userId).select("id,name,cpu_model,gpu_model,created_at").single()
      : db.from("device_configs").insert(payload).select("id,name,cpu_model,gpu_model,created_at").single();
    const { data, error } = await request;
    if (error) return setStatus("accountStatus", error.message, "error");
    if (!data?.id || currentSession?.user?.id !== userId) return;
    deviceConfigs = editId ? deviceConfigs.map(config => config.id === data.id ? data : config) : [...deviceConfigs, data];
    activeDeviceConfig = data;
    storageSet(ACTIVE_DEVICE_KEY, data.id);
    resetDeviceForm();
    renderDevicePicker();
    renderDeviceList();
    setStatus("accountStatus", "Device saved and selected for the next run.", "success");
  } catch (error) {
    setStatus("accountStatus", error.message || "Could not save this device.", "error");
  }
}

function selectDevice(id) {
  activeDeviceConfig = deviceConfigs.find(config => config.id === id) || null;
  if (activeDeviceConfig) storageSet(ACTIVE_DEVICE_KEY, activeDeviceConfig.id);
  else storageRemove(ACTIVE_DEVICE_KEY);
  renderDevicePicker();
  renderDeviceList();
}

async function deleteDevice(id) {
  if (!db || !currentSession?.user || !id) return;
  if (!window.confirm("Delete this saved device configuration?")) return;
  const userId = currentSession.user.id;
  try {
    const { error } = await db.from("device_configs").delete().eq("id", id).eq("user_id", userId);
    if (error) return setStatus("accountStatus", error.message, "error");
    if (currentSession?.user?.id !== userId) return;
    deviceConfigs = deviceConfigs.filter(config => config.id !== id);
    if (activeDeviceConfig?.id === id) selectDevice("");
    if (editingDeviceId === id) resetDeviceForm();
    else renderDeviceList();
    setStatus("accountStatus", "Device removed.", "success");
  } catch (error) {
    setStatus("accountStatus", error.message || "Could not delete this device.", "error");
  }
}

function setProgress(progress, label, detail) {
  $("runPercent").textContent = `${Math.round(progress)}%`;
  $("progressBar").style.width = `${progress}%`;
  $("testLabel").textContent = label;
  $("testDetail").textContent = detail;
}

function workerRun(ms, run = currentRun) {
  return new Promise((resolve, reject) => {
    if (run?.cancelled) return reject(cancellationError());
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "classic" });
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      run?.cancelCallbacks.delete(cancel);
      worker.terminate();
    };
    const finish = callback => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const cancel = () => finish(() => reject(cancellationError()));
    const timeout = setTimeout(() => finish(() => reject(new Error("CPU timeout"))), ms + 3000);
    run?.cancelCallbacks.add(cancel);
    worker.onmessage = event => finish(() => resolve(event.data));
    worker.onerror = error => finish(() => reject(new Error(`CPU worker failed: ${error.message || "unknown error"}`)));
    worker.postMessage({ duration: ms });
  });
}

async function cpuTest(ms = 8000, workers = Math.max(1, Math.min(Number(device.cores) || 2, 8))) {
  setProgress(15, "CPU TEST", "Running parallel compute workers");
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: workers }, () => workerRun(ms)));
  const operations = results.reduce((total, result) => total + result.ops, 0);
  const seconds = (performance.now() - started) / 1000;
  const opsPerSecond = operations / seconds;
  const score = Math.max(1, Math.round(Math.sqrt(opsPerSecond) * 180));
  $("liveCpu").textContent = fmt(score);
  return { score, opsSec: opsPerSecond };
}

function gpuTest(ms = 9000, hybrid = false, run = currentRun) {
  return new Promise((resolve, reject) => {
    if (run?.cancelled) return reject(cancellationError());
    setProgress(hybrid ? 72 : 40, hybrid ? "HYBRID TEST" : "GPU TEST", hybrid ? "CPU + GPU simultaneous load" : "Rendering sustained 3D workload");
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(720, Math.max(360, innerWidth * devicePixelRatio));
    canvas.height = Math.min(1280, Math.max(640, innerHeight * devicePixelRatio));
    canvas.style.position = "fixed";
    canvas.style.left = "-9999px";
    document.body.appendChild(canvas);
    const gl = canvas.getContext("webgl", { antialias: false, powerPreference: "high-performance" });
    if (!gl) {
      canvas.remove();
      resolve({ score: 1, avg: 0, low: 0 });
      return;
    }
    let frameId = 0;
    let settled = false;
    let cancel;
    const cleanup = () => {
      if (frameId) cancelAnimationFrame(frameId);
      run?.cancelCallbacks.delete(cancel);
      canvas.remove();
    };
    const finish = callback => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    cancel = () => finish(() => reject(cancellationError()));
    run?.cancelCallbacks.add(cancel);
    const vertexSource = `precision mediump float;attribute vec2 p;uniform float t;void main(){float a=t*.7+length(p)*2.;float s=sin(a),q=cos(a);gl_Position=vec4(p.x*q-p.y*s,p.x*s+p.y*q,0,1);}`;
    const fragmentSource = `precision mediump float;uniform float t;void main(){vec2 q=gl_FragCoord.xy/vec2(${canvas.width.toFixed(1)},${canvas.height.toFixed(1)});float v=0.;for(int i=0;i<12;i++){q=abs(q*2.-1.);v+=sin(q.x*8.+t)+cos(q.y*7.-t);}gl_FragColor=vec4(.2+.2*sin(v),.7+.25*cos(v),.45+.2*sin(v*1.7),1.);}`;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("PhoneMark: WebGL shader link failed", gl.getProgramInfoLog(program));
      finish(() => resolve({ score: 1, avg: 0, low: 0 }));
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const data = new Float32Array(4000);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    const timeLocation = gl.getUniformLocation(program, "t");
    let frames = 0;
    const started = performance.now();
    let last = started;
    const frameTimes = [];
    function frame(now) {
      if (run?.cancelled) return cancel();
      const delta = now - last;
      last = now;
      if (delta > 0) frameTimes.push(delta);
      frames++;
      gl.uniform1f(timeLocation, (now - started) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 2000);
      if (now - started < ms) {
        frameId = requestAnimationFrame(frame);
        return;
      }
      const avg = frames / ((now - started) / 1000);
      const sorted = frameTimes.slice().sort((a, b) => b - a);
      const lowFrame = sorted[Math.floor(sorted.length * 0.01)];
      const low = lowFrame ? 1000 / lowFrame : avg;
      const score = Math.max(1, Math.round(avg * 115));
      finish(() => resolve({ score, avg, low }));
    }
    frameId = requestAnimationFrame(frame);
  });
}

function cancelRun() {
  const run = currentRun;
  if (!run) return;
  run.cancelled = true;
  [...run.cancelCallbacks].forEach(cancel => cancel());
  run.cancelCallbacks.clear();
  currentRun = null;
  $("cancelBtn").disabled = true;
  show("home");
}

async function run() {
  if (currentRun) return;
  const runState = { cancelled: false, cancelCallbacks: new Set() };
  currentRun = runState;
  $("cancelBtn").disabled = false;
  show("running");
  $("liveCpu").textContent = $("liveGpu").textContent = $("liveHybrid").textContent = "—";
  const started = performance.now();
  try {
    const cpu = await cpuTest(6500);
    const gpu = await gpuTest(7500);
    $("liveGpu").textContent = fmt(gpu.score);
    const hybridCpu = workerRun(6500);
    const hybridGpu = gpuTest(6500, true);
    const [cpuWork, hybridGraphics] = await Promise.all([hybridCpu, hybridGpu]);
    const hybridScore = Math.round((Math.sqrt(cpuWork.ops / 6.5) * 105 + hybridGraphics.score * 1.05) / 2);
    $("liveHybrid").textContent = fmt(hybridScore);
    setProgress(100, "COMPLETE", "Finalizing score");
    const overall = Math.round(cpu.score * 0.35 + gpu.score * 0.45 + hybridScore * 0.20);
    const benchmarkDevice = {
      name: activeDeviceConfig?.name || device.name,
      cpu_model: activeDeviceConfig?.cpu_model || device.cpu_model,
      gpu_model: activeDeviceConfig?.gpu_model || device.gpu_model,
      device_config_id: activeDeviceConfig?.id || null
    };
    latest = {
      localId: createRunId(),
      cpu,
      gpu,
      hybrid: { score: hybridScore, avg: hybridGraphics.avg },
      overall,
      duration: Math.round(performance.now() - started),
      ...benchmarkDevice
    };
    renderResults();
    await persistAndCompare();
  } catch (error) {
    if (!error.cancelled) {
      console.error(error);
      alert("The benchmark failed. Try again with other tabs closed.");
      show("home");
    }
  } finally {
    runState.cancelCallbacks.clear();
    if (currentRun === runState) {
      currentRun = null;
      $("cancelBtn").disabled = true;
    }
  }
}

function renderResults() {
  show("results");
  $("overallScore").textContent = fmt(latest.overall);
  $("cpuScore").textContent = fmt(latest.cpu.score);
  $("gpuScore").textContent = fmt(latest.gpu.score);
  $("hybridScore").textContent = fmt(latest.hybrid.score);
  $("cpuMetric").textContent = `${fmt(latest.cpu.opsSec)} ops/s`;
  $("gpuMetric").textContent = `${roundOne(latest.gpu.avg)} FPS avg`;
  $("hybridMetric").textContent = `${roundOne(latest.hybrid.avg)} FPS + CPU`;
  $("details").innerHTML = `<div><span>Device</span><b>${esc(latest.name)}</b></div><div><span>CPU label</span><b>${esc(latest.cpu_model)}</b></div><div><span>GPU label</span><b>${esc(latest.gpu_model).slice(0, 70)}</b></div><div><span>Browser / cores</span><b>${esc(device.browser)} · ${device.cores || "Unknown"}</b></div><div><span>WebGPU</span><b>${device.webgpu ? "Available" : "Unavailable"}</b></div><div><span>Duration</span><b>${(latest.duration / 1000).toFixed(1)}s</b></div>`;
  renderHistory();
}

function emptyAverage(label) {
  return { average: null, count: 0, label };
}

async function loadComparisonAverages(cpuModel, gpuModel, excludeId = null) {
  if (!db) return { cpu: emptyAverage("CPU"), gpu: emptyAverage("GPU"), hybrid: emptyAverage("HYBRID") };
  const { data, error } = await db.rpc("benchmark_averages", { p_cpu_model: cpuModel, p_gpu_model: gpuModel, p_exclude_id: excludeId });
  const row = Array.isArray(data) ? data[0] : data;
  if (!error && row) {
    return {
      cpu: { average: row.cpu_average, count: Number(row.cpu_count || 0), label: "CPU" },
      gpu: { average: row.gpu_average, count: Number(row.gpu_count || 0), label: "GPU" },
      hybrid: { average: row.hybrid_average, count: Number(row.hybrid_count || 0), label: "HYBRID" }
    };
  }
  if (error && [401, 403, 404].includes(Number(error.status))) {
    return { cpu: emptyAverage("CPU"), gpu: emptyAverage("GPU"), hybrid: emptyAverage("HYBRID") };
  }
  const query = (scoreField, modelField, model, extraField = null, extraModel = null) => {
    let request = db.from("benchmark_results").select(scoreField).eq(modelField, model);
    if (extraField) request = request.eq(extraField, extraModel);
    if (excludeId) request = request.neq("id", excludeId);
    return request;
  };
  const [cpuResult, gpuResult, hybridResult] = await Promise.all([
    query("cpu_score", "cpu_model", cpuModel),
    query("gpu_score", "gpu_model", gpuModel),
    query("hybrid_score", "cpu_model", cpuModel, "gpu_model", gpuModel)
  ]);
  if (cpuResult.error || gpuResult.error || hybridResult.error) {
    return { cpu: emptyAverage("CPU"), gpu: emptyAverage("GPU"), hybrid: emptyAverage("HYBRID") };
  }
  const average = (result, label) => {
    const values = (result.data || []).map(rowValue => Number(rowValue[label === "CPU" ? "cpu_score" : label === "GPU" ? "gpu_score" : "hybrid_score"])).filter(Number.isFinite);
    return { average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, count: values.length, label };
  };
  return { cpu: average(cpuResult, "CPU"), gpu: average(gpuResult, "GPU"), hybrid: average(hybridResult, "HYBRID") };
}

function renderComparison(comparison) {
  const metric = (value, scoreId, metaId, currentScore) => {
    $(scoreId).textContent = value.average == null ? "No matches" : fmt(value.average);
    if (!value.count) {
      $(metaId).textContent = `No matching ${value.label.toLowerCase()} scores yet`;
      return;
    }
    const delta = value.average ? ((currentScore - value.average) / value.average) * 100 : 0;
    const direction = delta >= 0 ? "above" : "below";
    $(metaId).textContent = `${value.count} match${value.count === 1 ? "" : "es"} · ${Math.abs(delta).toFixed(1)}% ${direction} average`;
  };
  metric(comparison.cpu, "cpuAverage", "cpuAverageMeta", latest.cpu.score);
  metric(comparison.gpu, "gpuAverage", "gpuAverageMeta", latest.gpu.score);
  metric(comparison.hybrid, "hybridAverage", "hybridAverageMeta", latest.hybrid.score);
  $("comparisonLabels").textContent = `${latest.cpu_model} · ${latest.gpu_model}`;
}

function buildResultRow() {
  return {
    user_id: currentSession?.user?.id || null,
    username: currentProfile?.username || "Guest",
    device_config_id: latest.device_config_id,
    device_name: latest.name,
    cpu_model: latest.cpu_model,
    gpu_model: latest.gpu_model,
    benchmark_version: VERSION,
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
    metadata: { userAgent: navigator.userAgent, clientRunId: latest.localId }
  };
}

function legacyRowFrom(row) {
  return {
    benchmark_version: row.benchmark_version,
    device_name: row.device_name,
    device_confidence: row.device_confidence,
    os: row.os,
    browser: row.browser,
    cpu_cores: row.cpu_cores,
    device_memory_gb: row.device_memory_gb,
    gpu_renderer: row.gpu_renderer,
    webgpu_available: row.webgpu_available,
    webgl_version: row.webgl_version,
    screen_width: row.screen_width,
    screen_height: row.screen_height,
    device_pixel_ratio: row.device_pixel_ratio,
    cpu_score: row.cpu_score,
    gpu_score: row.gpu_score,
    hybrid_score: row.hybrid_score,
    overall_score: row.overall_score,
    cpu_ops_per_sec: row.cpu_ops_per_sec,
    gpu_avg_fps: row.gpu_avg_fps,
    gpu_1pct_low: row.gpu_1pct_low,
    hybrid_avg_fps: row.hybrid_avg_fps,
    duration_ms: row.duration_ms,
    metadata: row.metadata
  };
}

async function insertBenchmarkRow(row) {
  if (!db) return { saved: false, error: new Error("Supabase is unavailable") };
  try {
    let { data, error } = await db.from("benchmark_results").insert(row).select("id").maybeSingle();
    if (error) {
      console.warn("PhoneMark: Full schema insert failed, trying legacy:", error.message);
      const legacyInsert = await db.from("benchmark_results").insert(legacyRowFrom(row)).select("id").maybeSingle();
      data = legacyInsert.data;
      error = legacyInsert.error;
    }
    if (error) console.error("PhoneMark: Could not save benchmark:", error);
    return { saved: !error, data, error };
  } catch (error) {
    console.error("PhoneMark: Could not save benchmark:", error);
    return { saved: false, error };
  }
}

async function syncPendingResults() {
  if (syncingPendingResults || !db || !navigator.onLine) return;
  const pending = readPendingResults();
  const now = Date.now();
  const ready = pending.filter(entry => !entry.nextAttemptAt || entry.nextAttemptAt <= now);
  if (!ready.length) return;
  syncingPendingResults = true;
  const readyIds = new Set(ready.map(entry => entry.id));
  const deferred = pending.filter(entry => !readyIds.has(entry.id));
  const remaining = [];
  try {
    for (const entry of ready) {
      const result = await insertBenchmarkRow(entry.row);
      if (!result.saved) {
        const attempts = Number(entry.attempts || 0) + 1;
        remaining.push({
          ...entry,
          attempts,
          nextAttemptAt: Date.now() + Math.min(60 * 60 * 1000, 5000 * 2 ** Math.min(attempts, 8))
        });
        continue;
      }
      if (latest?.localId === entry.row?.metadata?.clientRunId) {
        latest.result_id = result.data?.id || null;
        $("savedStatus").textContent = "Saved";
        $("retrySaveBtn").classList.add("hidden");
        $("percentile").textContent = "Saved and ready for comparison";
      }
    }
  } finally {
    writePendingResults([...remaining, ...deferred]);
    syncingPendingResults = false;
  }
}

async function persistAndCompare(recordHistory = true) {
  if (recordHistory) saveLocalRun();
  const row = buildResultRow();
  const result = await insertBenchmarkRow(row);
  const saved = result.saved;
  if (saved) {
    latest.result_id = result.data?.id || null;
    removePendingResult(row);
  } else {
    queuePendingResult(row);
  }
  $("savedStatus").textContent = saved
    ? "Saved"
    : navigator.onLine ? "Saved locally · retrying" : "Offline · queued to sync";
  $("retrySaveBtn").classList.toggle("hidden", saved);
  if (!saved) $("percentile").textContent = "Stored locally and will retry automatically when online";
  let comparison = { cpu: emptyAverage("CPU"), gpu: emptyAverage("GPU"), hybrid: emptyAverage("HYBRID") };
  try {
    comparison = await loadComparisonAverages(latest.cpu_model, latest.gpu_model, latest.result_id);
  } catch (error) {
    console.warn("PhoneMark: Comparison unavailable", error);
  }
  renderComparison(comparison);
  if (saved && comparison.cpu.count + comparison.gpu.count + comparison.hybrid.count > 0) {
    $("percentile").textContent = "Compared with matching CPU, GPU, and hybrid results";
  }
}

async function loadScores() {
  const list = $("scoresList");
  if (!list) return;
  const requestId = ++scoresRequestId;
  const isCurrent = () => requestId === scoresRequestId;
  if (!db) {
    if (!isCurrent()) return;
    list.innerHTML = `<p class="empty-state">Scores are unavailable until Supabase is configured.</p>`;
    return;
  }
  const metric = SCORE_FIELDS.includes($("scoreMetric")?.value) ? $("scoreMetric").value : "overall_score";
  setStatus("scoresStatus");
  list.innerHTML = `<p class="loading">Loading scores…</p>`;
  try {
    let { data, error } = await db.from("benchmark_results")
      .select("id,username,device_name,cpu_model,gpu_model,cpu_score,gpu_score,hybrid_score,overall_score,created_at")
      .order(metric, { ascending: false })
      .limit(200);
    if (!isCurrent()) return;
    if (error) {
      console.warn("PhoneMark: Full schema query failed, trying legacy:", error.message);
      const legacy = await db.from("benchmark_results")
        .select("device_name,cpu_score,gpu_score,hybrid_score,overall_score,created_at")
        .order(metric, { ascending: false })
        .limit(200);
      if (!isCurrent()) return;
      if (legacy.error) {
        console.warn("PhoneMark: Legacy query also failed:", legacy.message);
        setStatus("scoresStatus", "", "");
        scoreRows = [];
        populateScoreFilters([]);
        renderScores();
        return;
      }
      data = (legacy.data || []).map(row => ({ ...row, username: "Guest", cpu_model: "Unknown CPU", gpu_model: "Unknown GPU" }));
      error = null;
    }
    if (!isCurrent()) return;
    if (error) {
      setStatus("scoresStatus", "", "");
      scoreRows = [];
      populateScoreFilters([]);
      renderScores();
      return;
    }
    scoreRows = data || [];
    populateScoreFilters(scoreRows);
    renderScores();
  } catch (error) {
    if (!isCurrent()) return;
    setStatus("scoresStatus", error.message || "Scores could not be loaded.", "error");
    list.innerHTML = `<p class="empty-state">Could not load scores. Check your connection and try again.</p>`;
  }
}

function populateScoreFilters(rows) {
  const currentCpu = $("scoreCpuFilter").value;
  const currentGpu = $("scoreGpuFilter").value;
  const cpus = [...new Set(rows.map(row => row.cpu_model).filter(Boolean))].sort();
  const gpus = [...new Set(rows.map(row => row.gpu_model).filter(Boolean))].sort();
  $("scoreCpuFilter").innerHTML = `<option value="">All CPUs</option>${cpus.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
  $("scoreGpuFilter").innerHTML = `<option value="">All GPUs</option>${gpus.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
  $("scoreCpuFilter").value = cpus.includes(currentCpu) ? currentCpu : "";
  $("scoreGpuFilter").value = gpus.includes(currentGpu) ? currentGpu : "";
}

function renderScores() {
  const metric = $("scoreMetric").value;
  const cpuFilter = $("scoreCpuFilter").value;
  const gpuFilter = $("scoreGpuFilter").value;
  const rows = scoreRows
    .filter(row => (!cpuFilter || row.cpu_model === cpuFilter) && (!gpuFilter || row.gpu_model === gpuFilter))
    .sort((a, b) => Number(b[metric] || 0) - Number(a[metric] || 0));
  if (!rows.length) {
    $("scoresList").innerHTML = `<p class="empty-state">No scores yet. Run a benchmark to get started!</p>`;
    return;
  }
  const metricLabel = { overall_score: "Overall", cpu_score: "CPU", gpu_score: "GPU", hybrid_score: "Hybrid" }[metric];
  $("scoresList").innerHTML = `<div class="score-summary">Top ${esc(metricLabel)} scores · ${rows.length} result${rows.length === 1 ? "" : "s"}</div>${rows.map((row, index) => `
    <article class="score-row"><span class="score-rank">#${index + 1}</span><div class="score-person"><strong>${esc(row.username || "Guest")}</strong><small>${esc(row.device_name || "Automatic detection")}</small><small>${esc(row.cpu_model || "Unknown CPU")} · ${esc(row.gpu_model || "Unknown GPU")}</small></div><div class="score-value"><b>${fmt(row[metric])}</b><small>CPU ${fmt(row.cpu_score)} · GPU ${fmt(row.gpu_score)} · Hybrid ${fmt(row.hybrid_score)}</small></div></article>`).join("")}`;
}

function wireEvents() {
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (target && !target.disabled && target.getAttribute("aria-disabled") !== "true") playButtonClick();
  }, true);
  $("brandLink").addEventListener("click", event => { event.preventDefault(); show("home"); });
  $("scoresBtn").addEventListener("click", () => show("scores"));
  $("soundBtn").addEventListener("click", toggleSound);
  $("accountBtn").addEventListener("click", () => show("account"));
  $("manageDevicesBtn").addEventListener("click", () => show("account"));
  $("accountBackBtn").addEventListener("click", () => show("home"));
  $("scoresBackBtn").addEventListener("click", () => show("home"));
  $("startBtn").addEventListener("click", run);
  $("againBtn").addEventListener("click", run);
  $("cancelBtn").addEventListener("click", cancelRun);
  $("showLoginBtn").addEventListener("click", () => switchAuthMode("login"));
  $("showSignupBtn").addEventListener("click", () => switchAuthMode("signup"));
  $("loginForm").addEventListener("submit", signIn);
  $("signupForm").addEventListener("submit", signUp);
  $("signOutBtn").addEventListener("click", signOut);
  $("avatarForm").addEventListener("submit", handleAvatarUpload);
  $("deviceForm").addEventListener("submit", saveDeviceConfig);
  $("activeDeviceSelect").addEventListener("change", event => selectDevice(event.target.value));
  $("cancelEditBtn").addEventListener("click", resetDeviceForm);
  $("deviceList").addEventListener("click", event => {
    const selectId = event.target.dataset.selectDevice;
    const editId = event.target.dataset.editDevice;
    const deleteId = event.target.dataset.deleteDevice;
    if (selectId) selectDevice(selectId);
    if (editId) editDevice(editId);
    if (deleteId) deleteDevice(deleteId);
  });
  $("clearHistoryBtn").addEventListener("click", clearHistory);
  $("retrySaveBtn").addEventListener("click", () => persistAndCompare(false));
  $("copyBtn").addEventListener("click", copyResult);
  $("scoreMetric").addEventListener("change", renderScores);
  $("scoreCpuFilter").addEventListener("change", renderScores);
  $("scoreGpuFilter").addEventListener("change", renderScores);
  $("shareBtn").addEventListener("click", async () => {
    const text = `I scored ${fmt(latest.overall)} on PhoneMark!`;
    try {
      if (!navigator.share) throw new Error("Share unavailable");
      await navigator.share({ title: "PhoneMark result", text, url: location.href });
    } catch (error) {
      if (error?.name === "AbortError") return;
      try {
        await copyText(`${text} ${location.href}`);
        $("savedStatus").textContent = "Copied";
      } catch {
        $("savedStatus").textContent = "Share unavailable";
      }
    }
  });
  window.addEventListener("online", syncPendingResults);
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && currentRun) cancelRun();
  });
  window.addEventListener("popstate", restoreScreenFromHash);
  window.addEventListener("hashchange", restoreScreenFromHash);
}

async function initApp() {
  console.log("PhoneMark: Initializing app...");
  registerOfflineShell();
  detect();
  updateSoundControl();
  renderDevicePicker();
  wireEvents();
  restoreScreenFromHash();
  if (!window.supabase?.createClient) {
    console.error("PhoneMark: Supabase not available on window object");
    return;
  }
  try {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log("PhoneMark: Supabase client initialized");
    const { data } = await db.auth.getSession();
    await applySession(data.session);
    void syncPendingResults();
    db.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        applySession(session).catch(error => console.error("PhoneMark: Failed to apply auth state:", error));
      }, 0);
    });
  } catch (error) {
    console.error("PhoneMark: Failed to initialize Supabase:", error);
  }
}

document.addEventListener("DOMContentLoaded", initApp);
