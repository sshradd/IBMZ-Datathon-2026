/* Uri Watch service worker.
   App shell and map: cached so the console opens with no signal.
   Forecast, plan and roster API reads: network first, last good copy when offline.
   The live event stream and every write go straight to the network (writes queue in the page). */
const VERSION = "uw-v2";
const TILES = "uw-tiles-v1";
const TILE_HOST = /^server\.arcgisonline\.com$/;
const TILE_CAP = 800;
const SHELL = ["/", "/teams/", "/resources/", "/more/", "/tx-counties.json", "/manifest.webmanifest", "/icon.svg"];
const CACHEABLE_API = [/^\/api\/ops\/(plan|state|sitrep)/, /^\/api\/(state|counties|scenarios|models)/, /^\/api\/live\//];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Map tiles: show the saved copy at once and refresh it, so places you have looked at still draw with no signal.
  if (req.method === "GET" && TILE_HOST.test(url.hostname)) {
    e.respondWith(
      caches.open(TILES).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req)
            .then((res) => {
              if (res.ok || res.type === "opaque") {
                c.put(req, res.clone());
                c.keys().then((ks) => ks.length > TILE_CAP && c.delete(ks[0]));
              }
              return res;
            })
            .catch(() => hit || Response.error());
          return hit || net;
        }),
      ),
    );
    return;
  }
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname === "/api/events") return;

  if (url.pathname.startsWith("/api/")) {
    if (!CACHEABLE_API.some((re) => re.test(url.pathname))) return;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (hit) => hit || new Response(JSON.stringify({ detail: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } }),
          ),
        ),
    );
    return;
  }

  // Built assets never change under the same name: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages and everything else: show the cached copy now, refresh it in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
