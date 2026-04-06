// Avatar UI: écoute les événements de conversation + expose une petite API
// pour synchroniser le GIF avec l'audio TTS.

declare global {
  interface Window {
    A11AvatarUI?: {
      playGifWhileAudio: (
        audio: HTMLAudioElement,
        gifSrc: string,
        durationMs?: number
      ) => void;
    };
  }
}

export function mountA11AvatarUI() {
  // Prevent duplicate mounts (HMR / React StrictMode can call effects twice)
  if (typeof window !== 'undefined' && (window as any).A11AvatarUI) {
    console.log('[A11AvatarUI] already mounted - skipping');
    return;
  }

  // Wait for avatar elements to be present (handles timing/HMR during dev)
  const waitForEls = async (timeout = 2000, interval = 50) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const gif = document.querySelector<HTMLImageElement>('#a11-avatar-gif') || document.querySelector<HTMLImageElement>('#a11-avatar');
      const idle = document.querySelector<HTMLImageElement>('#a11-avatar-idle') || document.querySelector<HTMLImageElement>('#a11-avatar');
      if (gif || idle) return { gif, idle };
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, interval));
    }
    return { gif: null, idle: null };
  };

  (async () => {
    const { gif, idle } = await waitForEls(2000, 50);
    if (!gif && !idle) {
      console.warn('[A11AvatarUI] #a11-avatar introuvable (after wait)');
      return;
    }

    let gifImg = gif as HTMLImageElement | null;
    const idleImg = idle as HTMLImageElement | null;

    // --- PATCH OPACITY ---
    function showIdle() {
      if (idleImg) idleImg.style.opacity = '1';
      if (gifImg) gifImg.style.opacity = '0';
      console.log('[A11Avatar] showIdle()');
    }
    function showTalking() {
      if (idleImg) idleImg.style.opacity = '0';
      if (gifImg) gifImg.style.opacity = '1';
      console.log('[A11Avatar] showTalking()');
    }
    // État initial : idle devant
    showIdle();
    (window as any).A11Avatar = { showIdle, showTalking };

    // Listen to global speech events to toggle avatar image
    const onSpeechStart = showTalking;
    const onSpeechEnd = showIdle;

    window.addEventListener('a11:speechstart', onSpeechStart);
    window.addEventListener('a11:speechend', onSpeechEnd);

    // Expose a cleanup function for HMR
    (window as any).A11AvatarUI._cleanup = () => {
      try { window.removeEventListener('a11:speechstart', onSpeechStart); } catch {};
      try { window.removeEventListener('a11:speechend', onSpeechEnd); } catch {};
    };
  })();
}

// À placer dans apps/web/src/lib/avatar-ui.ts ou dans un useEffect global
if (typeof window !== 'undefined') {
  const idle = document.getElementById("a11-avatar-idle");
  const gif  = document.getElementById("a11-avatar-gif");
  if (idle && gif) {
    function showIdle()  { idle.style.opacity = "1"; gif.style.opacity = "0"; }
    function showTalking() { idle.style.opacity = "0"; gif.style.opacity = "1"; }
    window.A11Avatar = { showIdle, showTalking };
  }
}
