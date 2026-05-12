import { buildApiUrlFromBase, getApiOriginFromBase, getAuthToken, getCurrentApiBase } from './api';

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
let serverTtsDisabledUntil = 0;

// Unlock audio context on first user interaction (required by autoplay policy)
let _audioUnlocked = false;
let audioUnlockPromise: Promise<boolean> | null = null;
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';

export function isAudioOutputUnlocked(): boolean {
  return _audioUnlocked;
}

export async function unlockAudioOutput(): Promise<boolean> {
  if (_audioUnlocked) return true;
  if (audioUnlockPromise) return audioUnlockPromise;

  audioUnlockPromise = (async () => {
    let unlocked = false;
    try {
      const AudioContextCtor =
        (globalThis as any).AudioContext ||
        (globalThis as any).webkitAudioContext;
      if (AudioContextCtor) {
        const ctx = new AudioContextCtor();
        if (typeof ctx.resume === 'function') {
          await ctx.resume().catch(() => undefined);
        }
        unlocked = ctx.state === 'running' || ctx.state === 'closed' || unlocked;
        if (typeof ctx.close === 'function') {
          await ctx.close().catch(() => undefined);
        }
      }
    } catch {
      // Continue with the media element probe below.
    }

    try {
      const probe = new Audio(SILENT_WAV_DATA_URI);
      probe.muted = true;
      probe.volume = 0;
      await probe.play();
      probe.pause();
      probe.removeAttribute('src');
      unlocked = true;
    } catch {
      // Some browsers only unlock real media later; keep the retry banner path.
    }

    _audioUnlocked = unlocked || _audioUnlocked;
    if (_audioUnlocked) emitCustomEvent('a11:audioUnlocked', {});
    return _audioUnlocked;
  })().finally(() => {
    audioUnlockPromise = null;
  });

  return audioUnlockPromise;
}

function ensureAudioUnlocked() {
  if (_audioUnlocked) return;
  const unlock = () => {
    if (_audioUnlocked) return;
    void unlockAudioOutput();
    document.removeEventListener('click', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    document.removeEventListener('touchstart', unlock, true);
    document.removeEventListener('pointerdown', unlock, true);
  };
  document.addEventListener('click', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
  document.addEventListener('touchstart', unlock, { once: true, capture: true });
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
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

function canUseBrowserSpeech() {
  return typeof (globalThis as any)?.speechSynthesis !== 'undefined'
    && typeof (globalThis as any)?.SpeechSynthesisUtterance !== 'undefined';
}

function playWithBrowserSpeech(
  text: string,
  options: any = {},
  onEnd?: () => void,
  reason = 'browser_fallback'
) {
  if (!canUseBrowserSpeech()) return false;
  try {
    stopCurrentAudio();
    const synthesis = (globalThis as any).speechSynthesis;
    const Utterance = (globalThis as any).SpeechSynthesisUtterance;
    const utterance = new Utterance(String(text || ''));
    utterance.lang = options.lang || 'fr-FR';
    utterance.rate = Number(options.rate || 1) || 1;
    utterance.pitch = Number(options.pitch || 1) || 1;
    utterance.volume = Number(options.volume ?? 1);
    utterance.onstart = () => emitEvent('a11:speechstart');
    utterance.onend = () => {
      emitEvent('a11:speechend');
      options.onEnd?.();
      onEnd?.();
    };
    utterance.onerror = (event: any) => {
      emitCustomEvent('a11:audioBlocked', {
        reason: String(event?.error || reason),
      });
      emitEvent('a11:speechend');
      options.onError?.(new Error(`Browser speech failed: ${String(event?.error || reason)}`));
      onEnd?.();
    };
    synthesis.cancel();
    synthesis.speak(utterance);
    return true;
  } catch (error) {
    return false;
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

function isRobotVoiceFallbackPayload(data: any): boolean {
  const provider = String(data?.provider || data?.audioModule?.provider || '').trim().toLowerCase();
  const via = String(data?.via || data?.audioModule?.via || provider).trim().toLowerCase();
  return provider.includes('espeak') || via.includes('espeak');
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
    voiceReferenceId?: string;
    vocalMode?: 'speech' | 'adaptive' | 'sing';
    onEnd?: () => void;
    onError?: (error: Error) => void;
    [key: string]: any;
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
    voiceReferenceId?: string;
    vocalMode?: 'speech' | 'adaptive' | 'sing';
    onEnd?: () => void;
    onError?: (error: Error) => void;
    [key: string]: any;
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
    if (Date.now() < serverTtsDisabledUntil && playWithBrowserSpeech(text, options, onEnd, 'server_tts_cooldown')) {
      return;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(getTtsEndpoint(), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ text, stream: true, ...options })
    });
    if (!res.ok) {
      const retryable = [404, 502, 503, 504].includes(res.status);
      if (retryable) {
        serverTtsDisabledUntil = Date.now() + 60_000;
        if (playWithBrowserSpeech(text, options, onEnd, `server_tts_${res.status}`)) {
          return;
        }
      }
      throw new Error(`Piper TTS server error (${res.status})`);
    }

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
      if (data?.audioModule) {
        emitCustomEvent('a11:ttsDiagnostics', {
          ...data.audioModule,
          provider: data?.provider || data?.audioModule?.provider || null,
          via: data?.via || data?.audioModule?.via || data?.provider || null,
        });
      }
      if (isRobotVoiceFallbackPayload(data) && options.allowRobotVoice !== true) {
        serverTtsDisabledUntil = Date.now() + 30_000;
        if (playWithBrowserSpeech(text, options, onEnd, 'robot_voice_fallback')) {
          return;
        }
        throw new Error('Robot voice fallback skipped');
      }
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
      emitCustomEvent('a11:audioBlocked', {
        url: audio.src,
        reason: 'audio_element_error',
      });
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
    playPromise.then(() => {
      _audioUnlocked = true;
    }).catch((error) => {
      console.error('[speech] audio.play() failed', error);
      emitCustomEvent('a11:audioBlocked', {
        url: audio.src,
        reason: String(error?.message || error || 'play_failed'),
      });
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
    if (playWithBrowserSpeech(text, options, onEnd, 'server_tts_failed')) {
      return;
    }
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
  void unlockAudioOutput();
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
  audio.play().then(() => {
    _audioUnlocked = true;
  }).catch((e) => {
    console.error('[speech] retryPlayUrl failed', e);
    emitCustomEvent('a11:audioBlocked', {
      url: audio.src,
      reason: String(e?.message || e || 'retry_play_failed'),
    });
    emitEvent('a11:speechend');
    if (currentAudio === audio) currentAudio = null;
  });
}

// --- Reconnaissance vocale (Web Speech API) ---
let recognition: any = null;
let recognitionCallback: ((txt: string, isFinal?: boolean) => void) | null = null;
let recognitionActive = false;
let recognitionLanguage = 'fr-FR';
let pendingStart:
  | {
      promise: Promise<void>;
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | null = null;

function settlePendingStart(error?: Error): void {
  if (!pendingStart) return;
  const pending = pendingStart;
  pendingStart = null;
  clearTimeout(pending.timer);
  if (error) pending.reject(error);
  else pending.resolve();
}

function normalizeRecognitionLanguage(value?: string) {
  const raw = String(value || '').trim();
  return raw || 'fr-FR';
}

export function setSpeechRecognitionLanguage(value?: string): void {
  recognitionLanguage = normalizeRecognitionLanguage(value);
  if (!recognition) return;
  try {
    recognition.lang = recognitionLanguage;
  } catch {
    // Some browsers reject language changes while recognition is active.
  }
}

/**
 * Initialise la reconnaissance vocale avec un callback (txt, isFinal?) => void
 */
export function initSpeech(
  onResult: (txt: string, isFinal?: boolean) => void,
  options: { lang?: string } = {}
): void {
  recognitionCallback = onResult;
  if (options.lang) setSpeechRecognitionLanguage(options.lang);
  if (recognition) return; // déjà créé
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return;
  }
  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = recognitionLanguage;
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
    recognition.onstart = () => {
      recognitionActive = true;
      settlePendingStart();
    };
    recognition.onerror = (e: any) => {
      const error = String(e?.error || 'unknown');
      recognitionActive = false;
      emitCustomEvent('a11:micError', {
        error,
        message: String(e?.message || ''),
      });
      settlePendingStart(new Error(`SpeechRecognition ${error}`));
      if (error !== 'not-allowed' && error !== 'service-not-allowed') {
        console.warn('[speech] recognition error', e);
      }
    };
    recognition.onend = () => {
      settlePendingStart(new Error('SpeechRecognition ended before start'));
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
export function startMic(options: { lang?: string } = {}): Promise<void> {
  if (options.lang) setSpeechRecognitionLanguage(options.lang);
  if (recognitionActive) return Promise.resolve();
  if (pendingStart) return pendingStart.promise;

  if (!recognition) {
    initSpeech(recognitionCallback ?? (() => {}), { lang: recognitionLanguage });
  }
  if (!recognition) return Promise.reject(new Error('SpeechRecognition not available'));
  setSpeechRecognitionLanguage(recognitionLanguage);

  let resolveStart!: () => void;
  let rejectStart!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });
  pendingStart = {
    promise,
    resolve: resolveStart,
    reject: rejectStart,
    timer: setTimeout(() => {
      recognitionActive = false;
      settlePendingStart(new Error('SpeechRecognition start timeout'));
    }, 10000),
  };

  try {
    recognition.start();
  } catch (e) {
    try {
      recognition.stop();
      setTimeout(() => {
        try {
          recognition.start();
        } catch (err: any) {
          recognitionActive = false;
          settlePendingStart(err instanceof Error ? err : new Error(String(err)));
        }
      }, 80);
    } catch (err) {
      recognitionActive = false;
      settlePendingStart(err instanceof Error ? err : new Error(String(err)));
    }
  }
  return promise;
}

/**
 * Stoppe la reconnaissance micro.
 */
export function stopMic(): void {
  try {
    settlePendingStart(new Error('SpeechRecognition stopped'));
    if (recognition) {
      recognition.stop();
      recognitionActive = false;
    }
  } catch (e) {
    console.warn('[speech] stopMic failed', e);
  }
}
