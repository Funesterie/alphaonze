function shouldDisableServiceWorker() {
  const host = String(globalThis.location?.hostname || '').trim().toLowerCase();
  const isLocalHost = host === '127.0.0.1' || host === 'localhost';
  const isPublicA11Host = [
    '178.105.86.89',
    'alphaonze.funesterie.pro',
    'a11.funesterie.me',
    'a11.funesterie.pro',
    'api.funesterie.pro',
    'funesterie.me',
    'www.funesterie.me',
    'k44.funesterie.me',
    'kaen44.funesterie.me',
    'kaen44.funesterie.pro',
    'vivy.funesterie.me',
    'vivy.funesterie.pro',
  ].includes(host);
  const hasTauriBridge = typeof (globalThis as any).__TAURI_INTERNALS__ !== 'undefined';
  const userAgent = String(globalThis.navigator?.userAgent || '').toLowerCase();
  const isTauriUserAgent = userAgent.includes('tauri');
  return isLocalHost || isPublicA11Host || hasTauriBridge || isTauriUserAgent;
}

async function disableExistingServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
  } catch {
    // ignore cleanup errors on local/desktop
  }

  if (!('caches' in globalThis)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('a11-') || key.startsWith('workbox'))
        .map((key) => caches.delete(key).catch(() => false))
    );
  } catch {
    // ignore cache cleanup errors on local/desktop
  }
}

export function registerA11ServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return;
  if (shouldDisableServiceWorker()) {
    void disableExistingServiceWorkers();
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update().catch(() => undefined))
      .catch((error) => {
        console.warn("[A11][PWA] Service worker registration failed:", error);
      });
  });
}
