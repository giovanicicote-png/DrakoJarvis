// Cache do aplicativo (permite abrir a interface mesmo sem rede).
// Pedidos ao backend (outro domínio) nunca passam pelo cache.
const CACHE = "drako-v2";
const FILES = [
  "./",
  "./index.html",
  "./css/drako.css",
  "./js/config.js",
  "./js/app.js",
  "./js/visual.js",
  "./js/voice.js",
  "./js/brain.js",
  "./js/phrases.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-180.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Rede primeiro (para receber atualizações); cache quando estiver offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html"))),
  );
});
