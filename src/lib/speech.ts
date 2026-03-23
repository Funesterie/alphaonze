/**
 * Helper pour gérer la lecture vocale (TTS) avec interruption automatique et queue
 * Usage: appeler speak(text) pour lire, cancelSpeech() pour interrompre
 */

let speechQueue: Array<{ text: string; options: any }> = [];
let isProcessingQueue = false;

// Mode: true = queue TTS (mode vocal/mic), false = pas de queue (mode normal)
export let ttsQueueEnabled = false;
export function setTtsQueueEnabled(val: boolean) { ttsQueueEnabled = val; }

let currentAudio: HTMLAudioElement | null = null;

function emitEvent(name: string) {
  try { window.dispatchEvent(new Event(name)); } catch (e) { /* ignore */ }
}

function stopCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
    emitEvent('a11:speechend');
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
    const res = await fetch('http://127.0.0.1:5002/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...options })
    });
    if (!res.ok) throw new Error('Piper TTS server error');
    const data = await res.json();
    if (!data.audio_url) throw new Error('No audio_url in Piper response');
    const audio = new Audio(data.audio_url);
    currentAudio = audio;
    audio.onended = () => {
      emitEvent('a11:speechend');
      options.onEnd?.();
      onEnd?.();
      if (currentAudio === audio) currentAudio = null;
    };
    audio.onerror = (e) => {
      emitEvent('a11:speechend');
      options.onError?.(new Error('Audio playback error'));
      onEnd?.();
      if (currentAudio === audio) currentAudio = null;
    };
    emitEvent('a11:speechstart');
    audio.play();
  } catch (err: any) {
    emitEvent('a11:speechend');
    options.onError?.(err);
    onEnd?.();
    if (currentAudio) currentAudio = null;
  }
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
