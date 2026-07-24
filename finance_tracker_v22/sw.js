/* Finance Tracker service worker.
   Strategy: NETWORK-FIRST for app files so fresh deploys always win; the cache
   is only a fallback when the device is offline. This deliberately avoids the
   "stuck on an old version" problem — the network copy is preferred whenever
   it's reachable, and successful responses refresh the cache in the background.

   Bump CACHE_VERSION on any release that changes the offline shell. */
const CACHE_VERSION = "ft-v40";
const CORE = [
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // never cache POSTs (AI calls, etc.)
  const url = new URL(req.url);

  // Never intercept the serverless API — always hit the network.
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/.netlify/")) return;

  // Network-first: try the network, fall back to cache when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        // cache same-origin successes so they're available offline next time
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match("./index.html"))
      )
  );
});
