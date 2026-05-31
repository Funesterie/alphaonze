function shouldDisableServiceWorker() {
  const protocol = String(globalThis.location?.protocol || '').trim().toLowerCase();
  const host = String(globalThis.location?.hostname || '').trim().toLowerCase();
  const isLocalHost = host === '127.0.0.1' || host === 'localhost';
  const isVscodeWebviewHost = host.endsWith('.vscode-webview.net') || protocol === 'vscode-webview:';
  const isPublicA11Host = [
    '178.105.86.89',
    'a11.funesterie.me',
    'funesterie.me',
    'www.funesterie.me',
    'k44.funesterie.me',
    'kaen44.funesterie.me',
    'vivy.funesterie.me',
  ].includes(host);
  const w = globalThis as typeof globalThis & {
    acquireVsCodeApi?: unknown;
    chrome?: { webview?: unknown };
  };
  const hasTauriBridge = typeof (globalThis as any).__TAURI_INTERNALS__ !== 'undefined';
  const userAgent = String(globalThis.navigator?.userAgent || '').toLowerCase();
  const isTauriUserAgent = userAgent.includes('tauri');
  const hasVscodeBridge = typeof w.acquireVsCodeApi === 'function';
  const hasWebView2Bridge = typeof w.chrome?.webview !== 'undefined';
  const isElectronShell = userAgent.includes(' electron/') || userAgent.includes(' vscode/');
  return isLocalHost
    || isPublicA11Host
    || isVscodeWebviewHost
    || hasVscodeBridge
    || hasWebView2Bridge
    || hasTauriBridge
    || isTauriUserAgent
    || isElectronShell;
}

function canRegisterServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  if (!globalThis.isSecureContext) return false;
  if (document.prerendering || document.visibilityState === 'prerender') return false;
  return document.defaultView === globalThis;
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
  if (!canRegisterServiceWorker()) return;
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
