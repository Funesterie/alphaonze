import { TTS_API } from "./api";

export interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
  voice?: string; // Ajout option voix
}

function cleanTTS(text: string): string {
  return String(text || "").replace(/[*_`#>~\-]/g, '').replace(/\[(.*?)\]\((.*?)\)/g, '$1').replace(/!\[(.*?)\]\((.*?)\)/g, '').replace(/\s{2,}/g, ' ').trim();
}

let a11Audio: HTMLAudioElement | null = null;

export function stopA11Audio() {
  try {
    if (a11Audio) {
      a11Audio.pause();
      a11Audio.currentTime = 0;
      a11Audio = null;
    }
  } catch {}
}

export async function speakTts(text: string, opts: SpeakOptions = {}) {
  const t = cleanTTS(text);
  if (!t) return;

  stopA11Audio(); // coupe le son précédent

  try {
    const payload: any = { text: t };
    if (opts.voice) payload.voice = opts.voice;

    const res = await fetch(TTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[TTS] HTTP error', res.status, txt);
      return;
    }

    const contentType = res.headers.get('content-type') || '';

    // If response is audio blob
    if (contentType.startsWith('audio/') || contentType === 'application/octet-stream') {
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      a11Audio = new Audio(audioUrl);
    } else {
      // expect JSON
      const data = await res.json().catch(() => null);
      // Priorité sur audio_url
      const audioUrl = data?.audio_url || data?.audioUrl || data?.url || data?.body?.audio_url || data?.body?.audioUrl || (data?.success && data.audioUrl) || null;
      if (audioUrl) {
        a11Audio = new Audio(String(audioUrl));
      } else if (data && data.via === 'spawn' && data.audioUrl) {
        a11Audio = new Audio(String(data.audioUrl));
      } else if (data && data.body && typeof data.body === 'string') {
        // sometimes callPiperHttp returns raw wave path
        const maybeUrl = String(data.body);
        a11Audio = new Audio(maybeUrl);
      } else {
        console.warn('[TTS] Unknown response format', data);
        return;
      }
    }

    if (!a11Audio) return;

    a11Audio.volume = 1;

    a11Audio.addEventListener('play', () => opts.onStart?.());
    a11Audio.addEventListener('ended', () => opts.onEnd?.());
    a11Audio.addEventListener('error', (e) => { console.warn('[TTS] audio playback error', e); opts.onEnd?.(); });

    try { await a11Audio.play(); } catch (e) {
      console.warn('[TTS] playback failed', e);
      opts.onEnd?.();
    }
  } catch (e) {
    console.warn('[TTS] speakTts error', e);
    opts.onEnd?.();
  }
}

// Alias for compatibility with wyhudohe.tsx
export async function speakMaleFR(text: string): Promise<void> {
  return speakTts(text);
}

// Optionnel : expose stopA11Audio globalement
if (typeof window !== 'undefined') {
  (window as any).stopA11Audio = stopA11Audio;
}
