const CACHE_NAME = "phonemark-shell-v1";

function cacheResponse(request, response) {
  if (!response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
  return response;
}

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => cacheResponse("/", response))
        .catch(() => caches.match("/").then(response => response || new Response(
          "PhoneMark is offline. Reconnect once to load the benchmark shell.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        )))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached =>
      fetch(request)
        .then(response => cacheResponse(request, response))
        .catch(() => cached || new Response("PhoneMark asset unavailable offline.", { status: 503 }))
    )
  );
});
