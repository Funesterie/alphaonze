import { buildApiUrlFromBase, getApiOriginFromBase, getCurrentApiBase } from './api';

/**
 * Helper pour gérer la lecture vocale (TTS) avec interruption automatique et queue
 * Usage: appeler speak(text) pour lire, cancelSpeech() pour interrompre
 */

let speechQueue: Array<{ text: string; options: any }> = [];
let isProcessingQueue = false;
let speechMuted = false;

function buildApiUrl(path: string): string {
  return buildApiUrlFromBase(getCurrentApiBase(), path);
}

function getTtsEndpoint() {
  return (import.meta as any)?.env?.VITE_TTS_API || buildApiUrl('/api/tts/piper');
}

// Mode: true = queue TTS (mode vocal/mic), false = pas de queue (mode normal)
export let ttsQueueEnabled = false;
export function setTtsQueueEnabled(val: boolean) { ttsQueueEnabled = val; }
export function setSpeechMuted(val: boolean) {
  speechMuted = Boolean(val);
  if (speechMuted) {
    cancelSpeech();
  }
}
export function isSpeechMuted() { return speechMuted; }

let currentAudio: HTMLAudioElement | null = null;
let currentAudioObjectUrl: string | null = null;

function isLikelyTouchDevice() {
  try {
    const hasTouchPoints = Number((globalThis as any)?.navigator?.maxTouchPoints || 0) > 0;
    const coarsePointer = typeof (globalThis as any)?.matchMedia === 'function'
      ? !!(globalThis as any).matchMedia('(pointer: coarse)').matches
      : false;
    const userAgent = String((globalThis as any)?.navigator?.userAgent || '').toLowerCase();
    return hasTouchPoints || coarsePointer || /android|iphone|ipad|ipod|mobile/i.test(userAgent);
  } catch {
    return false;
  }
}

// Unlock audio context on first user interaction (required by autoplay policy)
let _audioUnlocked = false;
function ensureAudioUnlocked() {
  if (_audioUnlocked) return;
  const unlock = () => {
    if (_audioUnlocked) return;
    _audioUnlocked = true;
    try {
      const AudioContextCtor =
        (globalThis as any).AudioContext ||
        (globalThis as any).webkitAudioContext;
      if (AudioContextCtor) {
        const ctx = new AudioContextCtor();
        if (typeof ctx.resume === 'function') {
          void ctx.resume().catch(() => undefined);
        }
        if (typeof ctx.close === 'function') {
          void ctx.close().catch(() => undefined);
        }
      }
    } catch {
      // Browser autoplay policies vary; actual audio playback will still be retried later if needed.
    }
    document.removeEventListener('click', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    document.removeEventListener('touchstart', unlock, true);
  };
  document.addEventListener('click', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
  document.addEventListener('touchstart', unlock, { once: true, capture: true });
}
if (typeof document !== 'undefined') ensureAudioUnlocked();

function emitEvent(name: string) {
  const dispatcher = (globalThis as any)?.dispatchEvent;
  if (typeof dispatcher === 'function') {
    dispatcher.call(globalThis, new Event(name));
  }
}

function emitCustomEvent(name: string, detail: Record<string, unknown>) {
  if (typeof (globalThis as any)?.dispatchEvent === 'function') {
    (globalThis as any).dispatchEvent(new CustomEvent(name, { detail }));
  }
}

function getApiOrigin(): string {
  return getApiOriginFromBase(getCurrentApiBase()) || ((globalThis as any)?.location?.origin || 'http://localhost');
}

function resolveAudioUrl(audioUrl: string): string {
  const value = String(audioUrl || '').trim();
  if (!value) return value;
  if (value.startsWith('blob:') || value.startsWith('data:') || /^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${getApiOrigin()}${value}`;
  try {
    return new URL(value, getTtsEndpoint()).toString();
  } catch {
    return value;
  }
}

function stopCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
    emitEvent('a11:speechend');
  }
  if (currentAudioObjectUrl) {
    try { URL.revokeObjectURL(currentAudioObjectUrl); } catch {}
    currentAudioObjectUrl = null;
  }
}

async function processTTSQueue() {
  if (isProcessingQueue || speechQueue.length === 0) {
    isProcessingQueue = false;
    return;
  }
  isProcessingQueue = true;
  const { text, options } = speechQueue.shift()!;
  await fetchAndPlayPiperTTS(text, options, () => {
    isProcessingQueue = false;
    processTTSQueue();
  });
}

/**
 * Lit un texte à voix haute (mode queue ou non selon ttsQueueEnabled)
 */
export function speak(
  text: string,
  options: {
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
    onEnd?: () => void;
    onError?: (error: Error) => void;
  } = {}
): void {
  if (speechMuted || !String(text || '').trim()) {
    options.onEnd?.();
    return;
  }

  if (ttsQueueEnabled) {
    // Ajoute à la queue et traite en séquence
    speechQueue.push({ text, options });
    if (!isProcessingQueue && !currentAudio) {
      processTTSQueue();
    }
  } else {
    // Mode normal: coupe tout et joue immédiatement
    stopCurrentAudio();
    speechQueue = [];
    isProcessingQueue = false;
    fetchAndPlayPiperTTS(text, options);
  }
}

/**
 * Ajoute un texte à la queue sans interrompre la lecture en cours (si ttsQueueEnabled)
 */
export function queueSpeech(
  text: string,
  options: {
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
    onEnd?: () => void;
    onError?: (error: Error) => void;
  } = {}
): void {
  if (speechMuted || !String(text || '').trim()) {
    options.onEnd?.();
    return;
  }

  if (ttsQueueEnabled) {
    speechQueue.push({ text, options });
    if (!isProcessingQueue && !currentAudio) {
      processTTSQueue();
    }
  } else {
    // En mode normal, queueSpeech agit comme speak
    speak(text, options);
  }
}

/**
 * Interrompt toute lecture vocale en cours et vide la queue
 */
export function cancelSpeech(): void {
  stopCurrentAudio();
  speechQueue = [];
  isProcessingQueue = false;
}

/**
 * Vérifie si une lecture vocale est en cours
 */
export function isSpeaking(): boolean {
  return !!currentAudio && !currentAudio.paused;
}

/**
 * Vérifie s'il y a des items en attente dans la queue
 */
export function queueLength(): number {
  return speechQueue.length;
}

async function fetchAndPlayPiperTTS(text: string, options: any = {}, onEnd?: () => void): Promise<void> {
  try {
    const res = await fetch(getTtsEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text, ...options })
    });
    if (!res.ok) throw new Error('Piper TTS server error');

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    let resolvedSource = '';
    let createdObjectUrl: string | null = null;

    if (contentType.startsWith('audio/') || contentType === 'application/octet-stream') {
      const blob = await res.blob();
      createdObjectUrl = URL.createObjectURL(blob);
      resolvedSource = createdObjectUrl;
    } else {
      const rawText = await res.text();
      let data: any = null;

      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = rawText;
      }

      const audioUrl =
        data?.audioUrl ??
        data?.audio_url ??
        data?.url ??
        data?.path ??
        data?.wav ??
        data?.body?.audioUrl ??
        data?.body?.audio_url ??
        ((typeof data?.body === 'string' && data.body) ? data.body : null) ??
        null;

      if (!audioUrl) throw new Error('No audio_url in Piper response');
      resolvedSource = resolveAudioUrl(String(audioUrl));
    }

    const audio = new Audio(resolvedSource);
    currentAudio = audio;
    currentAudioObjectUrl = createdObjectUrl;

    audio.onended = () => {
      emitEvent('a11:speechend');
      options.onEnd?.();
      onEnd?.();
      if (currentAudio === audio) currentAudio = null;
      if (currentAudioObjectUrl === createdObjectUrl && createdObjectUrl) {
        try { URL.revokeObjectURL(createdObjectUrl); } catch {}
        currentAudioObjectUrl = null;
      }
    };
    audio.onerror = (e) => {
      emitEvent('a11:speechend');
      options.onError?.(new Error('Audio playback error'));
      onEnd?.();
      if (currentAudio === audio) currentAudio = null;
      if (currentAudioObjectUrl === createdObjectUrl && createdObjectUrl) {
        try { URL.revokeObjectURL(createdObjectUrl); } catch {}
        currentAudioObjectUrl = null;
      }
    };
    emitEvent('a11:speechstart');
    const playPromise = audio.play();
    playPromise.catch((error) => {
      console.error('[speech] audio.play() failed', error);
      if (!isLikelyTouchDevice()) {
        emitCustomEvent('a11:audioBlocked', { url: audio.src });
      }
      emitEvent('a11:speechend');
      options.onError?.(new Error(`Audio playback blocked: ${String(error?.message || error)}`));
      onEnd?.();
      if (currentAudio === audio) currentAudio = null;
      if (currentAudioObjectUrl === createdObjectUrl && createdObjectUrl) {
        try { URL.revokeObjectURL(createdObjectUrl); } catch {}
        currentAudioObjectUrl = null;
      }
    });
  } catch (err: any) {
    emitEvent('a11:speechend');
    options.onError?.(err);
    onEnd?.();
    if (currentAudio) currentAudio = null;
  }
}

/**
 * Rejoue une URL audio directement (appelé après interaction utilisateur).
 * Utile pour le fallback bouton play quand l'autoplay est bloqué.
 */
export function retryPlayUrl(url: string): void {
  _audioUnlocked = true;
  stopCurrentAudio();
  const audio = new Audio(url);
  currentAudio = audio;
  audio.onended = () => {
    emitEvent('a11:speechend');
    if (currentAudio === audio) currentAudio = null;
  };
  audio.onerror = () => {
    emitEvent('a11:speechend');
    if (currentAudio === audio) currentAudio = null;
  };
  emitEvent('a11:speechstart');
  audio.play().catch((e) => {
    console.error('[speech] retryPlayUrl failed', e);
    emitEvent('a11:speechend');
    if (currentAudio === audio) currentAudio = null;
  });
}

// --- Reconnaissance vocale (Web Speech API) ---
let recognition: any = null;
let recognitionCallback: ((txt: string, isFinal?: boolean) => void) | null = null;
let recognitionActive = false;

/**
 * Initialise la reconnaissance vocale avec un callback (txt, isFinal?) => void
 */
export function initSpeech(onResult: (txt: string, isFinal?: boolean) => void): void {
  recognitionCallback = onResult;
  if (recognition) return; // déjà créé
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[speech] SpeechRecognition API not available');
    return;
  }
  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'fr-FR';
    recognition.onresult = (ev: any) => {
      if (!recognitionCallback) return;
      let interim = '';
      let final = '';
      for (let i = ev.resultIndex; i < ev.results.length; ++i) {
        const res = ev.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim) recognitionCallback(interim, false);
      if (final) recognitionCallback(final, true);
    };
    recognition.onerror = (e: any) => {
      console.warn('[speech] recognition error', e);
    };
    recognition.onend = () => {
      recognitionActive = false;
    };
  } catch (e) {
    console.warn('[speech] initSpeech failed', e);
    recognition = null;
  }
}

/**
 * Démarre la reconnaissance micro. Promise résolue quand démarré.
 */
export function startMic(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!recognition) {
      initSpeech(recognitionCallback ?? (() => {}));
    }
    if (!recognition) return reject(new Error('SpeechRecognition not available'));
    try {
      recognition.start();
      recognitionActive = true;
      resolve();
    } catch (e) {
      try {
        recognition.stop();
        recognition.start();
        recognitionActive = true;
        resolve();
      } catch (err) {
        reject(err);
      }
    }
  });
}

/**
 * Stoppe la reconnaissance micro.
 */
export function stopMic(): void {
  try {
    if (recognition) {
      recognition.stop();
      recognitionActive = false;
    }
  } catch (e) {
    console.warn('[speech] stopMic failed', e);
  }
}
