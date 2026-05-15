const A11_CACHE = "a11-pwa-v4";
const A11_PUBLIC_HOSTS_WITHOUT_SW = new Set([
  "178.105.86.89",
  "alphaonze.funesterie.pro",
  "a11.funesterie.pro",
  "api.funesterie.pro",
  "funesterie.me",
  "www.funesterie.me",
  "k44.funesterie.me",
  "kaen44.funesterie.me",
  "kaen44.funesterie.pro",
  "vivy.funesterie.me",
  "vivy.funesterie.pro",
]);
const A11_STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png"
];

function shouldSelfDisable() {
  try {
    return A11_PUBLIC_HOSTS_WITHOUT_SW.has(new URL(self.location.href).hostname);
  } catch {
    return false;
  }
}

async function deleteA11Caches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith("a11-") || key.startsWith("workbox"))
      .map((key) => caches.delete(key))
  );
}

self.addEventListener("install", (event) => {
  if (shouldSelfDisable()) {
    event.waitUntil(deleteA11Caches());
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(A11_CACHE).then((cache) => cache.addAll(A11_STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  if (shouldSelfDisable()) {
    event.waitUntil(
      deleteA11Caches()
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll({ type: "window" }))
        .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))
    );
    return;
  }
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== A11_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (shouldSelfDisable()) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/")) return;

  const isNavigation = request.mode === "navigate";

  if (isNavigation) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(async () => {
        return caches.match(request) || caches.match("/index.html") || Response.error();
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          void caches.open(A11_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (isNavigation) {
          return caches.match("/") || Response.error();
        }
        return Response.error();
      })
  );
});
