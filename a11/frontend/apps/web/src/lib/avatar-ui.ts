// Avatar UI: écoute les événements de conversation + expose une petite API
// pour synchroniser le GIF avec l'audio TTS.

declare global {
  interface Window {
    A11Avatar?: {
      showIdle: () => void;
      showTalking: () => void;
      setSpeaking?: (speaking: boolean) => void;
    };
    A11AvatarUI?: {
      playGifWhileAudio: (
        audio: HTMLAudioElement,
        gifSrc: string,
        durationMs?: number
      ) => void;
      _cleanup?: () => void;
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
    window.A11Avatar = { showIdle, showTalking };

    // Listen to global speech events to toggle avatar image
    const onSpeechStart = showTalking;
    const onSpeechEnd = showIdle;

    window.addEventListener('a11:speechstart', onSpeechStart);
    window.addEventListener('a11:speechend', onSpeechEnd);

    window.A11AvatarUI = {
      playGifWhileAudio: (audio: HTMLAudioElement) => {
        showTalking();
        const reset = () => showIdle();
        audio.addEventListener('ended', reset, { once: true });
        audio.addEventListener('pause', reset, { once: true });
      },
      _cleanup: () => {
        try { window.removeEventListener('a11:speechstart', onSpeechStart); } catch {}
        try { window.removeEventListener('a11:speechend', onSpeechEnd); } catch {}
      },
    };
  })();
}

// À placer dans apps/web/src/lib/avatar-ui.ts ou dans un useEffect global
if (typeof window !== 'undefined') {
  const idle = document.getElementById("a11-avatar-idle") as HTMLElement | null;
  const gif  = document.getElementById("a11-avatar-gif") as HTMLElement | null;
  if (idle && gif) {
    const idleEl = idle;
    const gifEl = gif;
    function showIdle()  { idleEl.style.opacity = "1"; gifEl.style.opacity = "0"; }
    function showTalking() { idleEl.style.opacity = "0"; gifEl.style.opacity = "1"; }
    window.A11Avatar = { showIdle, showTalking };
  }
}
