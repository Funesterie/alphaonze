'use strict';
/**
 * SFX Engine — Sons de karma émotionnel pour A11
 *
 * Génère des sons de jeu vidéo style Final Fantasy / 8-bit en pur PCM/WAV.
 * Pas de dépendance externe — synthèse de notes musicales directement en Node.js.
 *
 * Sons disponibles :
 *   heart_lost    — note grave descendante (perte de cœur, Zelda)
 *   heart_gained  — arpège montant lumineux (regain de moral)
 *   victory       — fanfare Final Fantasy style (tâche réussie)
 *   levelup       — jingle ascendant 8-bit (grande réussite)
 *   error         — buzzer court (erreur)
 *   notify        — ding léger (notification)
 *   thinking      — mélodie courte mystérieuse (A11 réfléchit)
 *
 * Usage :
 *   const { getSfxPath, parseSfxTags, generateAllSfx } = require('./sfx-engine.cjs');
 *   await generateAllSfx(runtimeRoot);
 *   const segments = parseSfxTags('[SFX:victory] Tâche accomplie !');
 *   // → [{ type: 'sfx', name: 'victory' }, { type: 'text', content: ' Tâche accomplie !' }]
 */

const fs = require('node:fs');
const path = require('node:path');

// ─── Synthèse WAV ─────────────────────────────────────────────────────────────

const SAMPLE_RATE = 22050;
const CHANNELS = 1;
const BIT_DEPTH = 16;

/**
 * Génère un buffer WAV PCM 16-bit mono à partir d'une liste de notes.
 * Chaque note : { freq, duration, wave, volume, envelope }
 *   freq     — fréquence Hz (0 = silence)
 *   duration — durée en secondes
 *   wave     — 'sine' | 'square' | 'triangle' | 'sawtooth' (défaut: 'square')
 *   volume   — 0.0-1.0 (défaut: 0.5)
 *   envelope — { attack, decay, sustain, release } en secondes
 */
function synthesizeWav(notes) {
  const allSamples = [];

  for (const note of notes) {
    const freq = Number(note.freq || 0);
    const duration = Number(note.duration || 0.1);
    const wave = note.wave || 'square';
    const volume = Math.max(0, Math.min(1, Number(note.volume ?? 0.5)));
    const env = note.envelope || {};
    const attack = Number(env.attack || 0.01);
    const decay = Number(env.decay || 0.05);
    const sustain = Number(env.sustain ?? 0.7);
    const release = Number(env.release || 0.05);

    const numSamples = Math.floor(SAMPLE_RATE * duration);

    for (let i = 0; i < numSamples; i++) {
      const t = i / SAMPLE_RATE;
      const tEnd = duration - t;

      // Enveloppe ADSR
      let amp = 1.0;
      if (t < attack) {
        amp = t / attack;
      } else if (t < attack + decay) {
        amp = 1.0 - (1.0 - sustain) * ((t - attack) / decay);
      } else if (tEnd < release) {
        amp = sustain * (tEnd / release);
      } else {
        amp = sustain;
      }

      // Forme d'onde
      let sample = 0;
      if (freq > 0) {
        const phase = (t * freq) % 1.0;
        switch (wave) {
          case 'sine':
            sample = Math.sin(2 * Math.PI * t * freq);
            break;
          case 'square':
            sample = phase < 0.5 ? 1.0 : -1.0;
            break;
          case 'triangle':
            sample = phase < 0.5 ? (4 * phase - 1) : (3 - 4 * phase);
            break;
          case 'sawtooth':
            sample = 2 * phase - 1;
            break;
          default:
            sample = phase < 0.5 ? 1.0 : -1.0;
        }
      }

      allSamples.push(Math.round(sample * amp * volume * 32767));
    }
  }

  return buildWavBuffer(allSamples);
}

function buildWavBuffer(samples) {
  const dataSize = samples.length * 2; // 16-bit = 2 bytes/sample
  const buf = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);           // chunk size
  buf.writeUInt16LE(1, 20);            // PCM
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * BIT_DEPTH / 8, 28); // byte rate
  buf.writeUInt16LE(CHANNELS * BIT_DEPTH / 8, 32); // block align
  buf.writeUInt16LE(BIT_DEPTH, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, samples[i])), 44 + i * 2);
  }

  return buf;
}

// ─── Définitions des sons ─────────────────────────────────────────────────────

// Fréquences de notes musicales (Hz)
const NOTE = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
  C6: 1046.50, D6: 1174.66, E6: 1318.51,
  Bb3: 233.08, Eb4: 311.13, Ab4: 415.30, Bb4: 466.16, Eb5: 622.25, Ab5: 830.61,
};

const SFX_DEFINITIONS = {
  // Perte d'un cœur — descente grave, style Zelda "game over"
  heart_lost: [
    { freq: NOTE.A4, duration: 0.12, wave: 'square', volume: 0.6, envelope: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.05 } },
    { freq: NOTE.F4, duration: 0.12, wave: 'square', volume: 0.55, envelope: { attack: 0.01, decay: 0.05, sustain: 0.7, release: 0.05 } },
    { freq: NOTE.D4, duration: 0.12, wave: 'square', volume: 0.5, envelope: { attack: 0.01, decay: 0.05, sustain: 0.6, release: 0.05 } },
    { freq: NOTE.B3, duration: 0.25, wave: 'square', volume: 0.45, envelope: { attack: 0.01, decay: 0.1, sustain: 0.4, release: 0.1 } },
    { freq: 0, duration: 0.05 },
  ],

  // Regain de moral — arpège montant lumineux, style Zelda "item get"
  heart_gained: [
    { freq: NOTE.C4, duration: 0.08, wave: 'square', volume: 0.5, envelope: { attack: 0.005, decay: 0.03, sustain: 0.8, release: 0.03 } },
    { freq: NOTE.E4, duration: 0.08, wave: 'square', volume: 0.55, envelope: { attack: 0.005, decay: 0.03, sustain: 0.8, release: 0.03 } },
    { freq: NOTE.G4, duration: 0.08, wave: 'square', volume: 0.6, envelope: { attack: 0.005, decay: 0.03, sustain: 0.8, release: 0.03 } },
    { freq: NOTE.C5, duration: 0.20, wave: 'square', volume: 0.65, envelope: { attack: 0.005, decay: 0.05, sustain: 0.7, release: 0.08 } },
  ],

  // Victoire — fanfare Final Fantasy style (tintinnabulement !)
  victory: [
    { freq: NOTE.G4, duration: 0.10, wave: 'square', volume: 0.6 },
    { freq: NOTE.G4, duration: 0.10, wave: 'square', volume: 0.6 },
    { freq: NOTE.G4, duration: 0.10, wave: 'square', volume: 0.6 },
    { freq: NOTE.Eb4, duration: 0.08, wave: 'square', volume: 0.55 },
    { freq: NOTE.Bb4, duration: 0.08, wave: 'square', volume: 0.6 },
    { freq: NOTE.G4, duration: 0.12, wave: 'square', volume: 0.65 },
    { freq: NOTE.Eb4, duration: 0.08, wave: 'square', volume: 0.55 },
    { freq: NOTE.Bb4, duration: 0.25, wave: 'square', volume: 0.7, envelope: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.1 } },
    { freq: 0, duration: 0.05 },
    { freq: NOTE.D5, duration: 0.10, wave: 'square', volume: 0.65 },
    { freq: NOTE.D5, duration: 0.10, wave: 'square', volume: 0.65 },
    { freq: NOTE.D5, duration: 0.10, wave: 'square', volume: 0.65 },
    { freq: NOTE.Eb5, duration: 0.12, wave: 'square', volume: 0.6 },
    { freq: NOTE.Bb4, duration: 0.08, wave: 'square', volume: 0.55 },
    { freq: NOTE.Ab4, duration: 0.08, wave: 'square', volume: 0.55 },
    { freq: NOTE.G4, duration: 0.08, wave: 'square', volume: 0.6 },
    { freq: NOTE.Eb4, duration: 0.08, wave: 'square', volume: 0.55 },
    { freq: NOTE.Bb4, duration: 0.30, wave: 'square', volume: 0.7, envelope: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.15 } },
  ],

  // Level up — jingle ascendant 8-bit
  levelup: [
    { freq: NOTE.C4, duration: 0.07, wave: 'square', volume: 0.55 },
    { freq: NOTE.E4, duration: 0.07, wave: 'square', volume: 0.58 },
    { freq: NOTE.G4, duration: 0.07, wave: 'square', volume: 0.60 },
    { freq: NOTE.C5, duration: 0.07, wave: 'square', volume: 0.62 },
    { freq: NOTE.E5, duration: 0.07, wave: 'square', volume: 0.64 },
    { freq: NOTE.G5, duration: 0.07, wave: 'square', volume: 0.66 },
    { freq: NOTE.C6, duration: 0.25, wave: 'square', volume: 0.7, envelope: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.12 } },
  ],

  // Erreur — buzzer court
  error: [
    { freq: NOTE.Bb3, duration: 0.08, wave: 'square', volume: 0.6 },
    { freq: 0, duration: 0.03 },
    { freq: NOTE.Bb3, duration: 0.08, wave: 'square', volume: 0.55 },
    { freq: 0, duration: 0.03 },
    { freq: NOTE.G3, duration: 0.15, wave: 'square', volume: 0.5, envelope: { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.08 } },
  ],

  // Notification — ding léger
  notify: [
    { freq: NOTE.E5, duration: 0.08, wave: 'sine', volume: 0.45, envelope: { attack: 0.005, decay: 0.03, sustain: 0.7, release: 0.04 } },
    { freq: NOTE.A5, duration: 0.15, wave: 'sine', volume: 0.4, envelope: { attack: 0.005, decay: 0.05, sustain: 0.6, release: 0.08 } },
  ],

  // Réflexion — mélodie courte mystérieuse
  thinking: [
    { freq: NOTE.E4, duration: 0.10, wave: 'triangle', volume: 0.4 },
    { freq: NOTE.G4, duration: 0.10, wave: 'triangle', volume: 0.38 },
    { freq: NOTE.A4, duration: 0.10, wave: 'triangle', volume: 0.36 },
    { freq: NOTE.G4, duration: 0.10, wave: 'triangle', volume: 0.34 },
    { freq: NOTE.E4, duration: 0.15, wave: 'triangle', volume: 0.32, envelope: { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.08 } },
  ],

  // Shikai - light draw and release.
  shikai: [
    { freq: NOTE.A4, duration: 0.04, wave: 'sawtooth', volume: 0.35, envelope: { attack: 0.005, decay: 0.02, sustain: 0.5, release: 0.02 } },
    { freq: NOTE.D5, duration: 0.06, wave: 'triangle', volume: 0.45, envelope: { attack: 0.005, decay: 0.02, sustain: 0.7, release: 0.03 } },
    { freq: NOTE.A5, duration: 0.10, wave: 'sine', volume: 0.35, envelope: { attack: 0.005, decay: 0.04, sustain: 0.5, release: 0.06 } },
  ],

  // Bankai - pressure burst.
  bankai: [
    { freq: NOTE.C3, duration: 0.10, wave: 'sawtooth', volume: 0.55, envelope: { attack: 0.01, decay: 0.04, sustain: 0.8, release: 0.04 } },
    { freq: NOTE.C4, duration: 0.10, wave: 'square', volume: 0.65, envelope: { attack: 0.005, decay: 0.03, sustain: 0.8, release: 0.04 } },
    { freq: NOTE.G4, duration: 0.12, wave: 'square', volume: 0.7, envelope: { attack: 0.005, decay: 0.04, sustain: 0.7, release: 0.06 } },
    { freq: NOTE.C5, duration: 0.28, wave: 'sawtooth', volume: 0.58, envelope: { attack: 0.01, decay: 0.06, sustain: 0.5, release: 0.16 } },
  ],

  // Alert - active radar pulse.
  alert: [
    { freq: NOTE.C5, duration: 0.07, wave: 'sine', volume: 0.48 },
    { freq: 0, duration: 0.04 },
    { freq: NOTE.C5, duration: 0.07, wave: 'sine', volume: 0.42 },
    { freq: 0, duration: 0.04 },
    { freq: NOTE.G5, duration: 0.12, wave: 'sine', volume: 0.38, envelope: { attack: 0.005, decay: 0.04, sustain: 0.6, release: 0.06 } },
  ],

  // Gear 5 - bright bounce and small drums.
  gear5: [
    { freq: NOTE.C4, duration: 0.05, wave: 'triangle', volume: 0.55 },
    { freq: NOTE.G4, duration: 0.05, wave: 'triangle', volume: 0.55 },
    { freq: NOTE.C5, duration: 0.08, wave: 'square', volume: 0.45 },
    { freq: NOTE.E5, duration: 0.05, wave: 'triangle', volume: 0.5 },
    { freq: 0, duration: 0.03 },
    { freq: NOTE.C3, duration: 0.06, wave: 'square', volume: 0.35 },
    { freq: NOTE.C3, duration: 0.06, wave: 'square', volume: 0.35 },
    { freq: NOTE.G5, duration: 0.16, wave: 'sine', volume: 0.36, envelope: { attack: 0.005, decay: 0.04, sustain: 0.5, release: 0.08 } },
  ],

  // Ultra Instinct - near-silence plus aura shimmer.
  ui: [
    { freq: 0, duration: 0.08 },
    { freq: NOTE.E6, duration: 0.09, wave: 'sine', volume: 0.18, envelope: { attack: 0.02, decay: 0.02, sustain: 0.5, release: 0.07 } },
    { freq: NOTE.C6, duration: 0.09, wave: 'sine', volume: 0.14, envelope: { attack: 0.02, decay: 0.02, sustain: 0.5, release: 0.07 } },
    { freq: NOTE.G5, duration: 0.18, wave: 'triangle', volume: 0.12, envelope: { attack: 0.03, decay: 0.04, sustain: 0.4, release: 0.10 } },
  ],

  // Domain Expansion - barrier unfolding.
  domain: [
    { freq: NOTE.F3, duration: 0.10, wave: 'triangle', volume: 0.35 },
    { freq: NOTE.C4, duration: 0.10, wave: 'triangle', volume: 0.40 },
    { freq: NOTE.F4, duration: 0.10, wave: 'triangle', volume: 0.45 },
    { freq: NOTE.Ab4, duration: 0.16, wave: 'sawtooth', volume: 0.42, envelope: { attack: 0.02, decay: 0.05, sustain: 0.6, release: 0.08 } },
    { freq: NOTE.C5, duration: 0.28, wave: 'sine', volume: 0.30, envelope: { attack: 0.03, decay: 0.05, sustain: 0.5, release: 0.18 } },
  ],

  // Void - spaced echoes into silence.
  void: [
    { freq: NOTE.D4, duration: 0.08, wave: 'sine', volume: 0.34, envelope: { attack: 0.01, decay: 0.03, sustain: 0.5, release: 0.04 } },
    { freq: 0, duration: 0.08 },
    { freq: NOTE.D4, duration: 0.08, wave: 'sine', volume: 0.22, envelope: { attack: 0.01, decay: 0.03, sustain: 0.4, release: 0.05 } },
    { freq: 0, duration: 0.12 },
    { freq: NOTE.A3, duration: 0.12, wave: 'triangle', volume: 0.18, envelope: { attack: 0.02, decay: 0.04, sustain: 0.35, release: 0.08 } },
    { freq: 0, duration: 0.18 },
  ],

  // Cri avec echo a levier - pull, shout, three fading rebounds.
  cri_echo_levier: [
    { freq: NOTE.G3, duration: 0.05, wave: 'sawtooth', volume: 0.45 },
    { freq: NOTE.C3, duration: 0.07, wave: 'square', volume: 0.38 },
    { freq: NOTE.C5, duration: 0.08, wave: 'sawtooth', volume: 0.65, envelope: { attack: 0.005, decay: 0.02, sustain: 0.9, release: 0.03 } },
    { freq: NOTE.G5, duration: 0.10, wave: 'sawtooth', volume: 0.58, envelope: { attack: 0.005, decay: 0.03, sustain: 0.7, release: 0.05 } },
    { freq: 0, duration: 0.06 },
    { freq: NOTE.G5, duration: 0.08, wave: 'sine', volume: 0.32, envelope: { attack: 0.005, decay: 0.02, sustain: 0.45, release: 0.05 } },
    { freq: 0, duration: 0.08 },
    { freq: NOTE.E5, duration: 0.08, wave: 'sine', volume: 0.22, envelope: { attack: 0.005, decay: 0.02, sustain: 0.4, release: 0.05 } },
    { freq: 0, duration: 0.10 },
    { freq: NOTE.C5, duration: 0.14, wave: 'sine', volume: 0.16, envelope: { attack: 0.01, decay: 0.03, sustain: 0.3, release: 0.10 } },
  ],
};

// ─── Gestion des fichiers SFX ─────────────────────────────────────────────────

function getSfxDir(runtimeRoot) {
  const root = runtimeRoot
    || process.env.A11_RUNTIME_ROOT
    || path.resolve(__dirname, '..', '..', '..', '..', 'runtime');
  return path.join(root, 'sfx');
}

function getSfxPath(name, runtimeRoot) {
  return path.join(getSfxDir(runtimeRoot), `${name}.wav`);
}

/**
 * Génère tous les fichiers SFX dans le dossier runtime/sfx/.
 * Idempotent — ne régénère que les fichiers manquants sauf si force=true.
 */
function generateAllSfx(runtimeRoot, { force = false } = {}) {
  const sfxDir = getSfxDir(runtimeRoot);
  if (!fs.existsSync(sfxDir)) fs.mkdirSync(sfxDir, { recursive: true });

  const generated = [];
  for (const [name, notes] of Object.entries(SFX_DEFINITIONS)) {
    const filePath = path.join(sfxDir, `${name}.wav`);
    if (!force && fs.existsSync(filePath)) {
      generated.push({ name, path: filePath, status: 'exists' });
      continue;
    }
    const wav = synthesizeWav(notes);
    fs.writeFileSync(filePath, wav);
    generated.push({ name, path: filePath, status: 'generated', size: wav.length });
  }

  return generated;
}

// ─── Parser de balises SFX ────────────────────────────────────────────────────

/**
 * Parse un texte contenant des balises [SFX:nom] et retourne une liste de segments.
 *
 * @param {string} text
 * @returns {Array<{type: 'text'|'sfx', content?: string, name?: string}>}
 *
 * Exemple :
 *   parseSfxTags('[SFX:victory] Tâche accomplie !')
 *   → [{ type: 'sfx', name: 'victory' }, { type: 'text', content: ' Tâche accomplie !' }]
 */
function parseSfxTags(text) {
  const segments = [];
  const regex = /\[SFX:([a-z_]+)\]/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Texte avant la balise
    if (match.index > lastIndex) {
      const content = text.slice(lastIndex, match.index);
      if (content) segments.push({ type: 'text', content });
    }
    // Balise SFX
    const name = match[1].toLowerCase();
    if (SFX_DEFINITIONS[name]) {
      segments.push({ type: 'sfx', name });
    } else {
      // Balise inconnue → garder comme texte
      segments.push({ type: 'text', content: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }

  // Texte restant
  if (lastIndex < text.length) {
    const content = text.slice(lastIndex);
    if (content) segments.push({ type: 'text', content });
  }

  return segments;
}

/**
 * Retourne le texte sans les balises SFX (pour le TTS vocal).
 */
function stripSfxTags(text) {
  return String(text || '').replace(/\[SFX:[a-z_]+\]/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Extrait uniquement les noms des SFX présents dans le texte.
 */
function extractSfxNames(text) {
  const names = [];
  const regex = /\[SFX:([a-z_]+)\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].toLowerCase();
    if (SFX_DEFINITIONS[name]) names.push(name);
  }
  return names;
}

/**
 * Liste tous les sons disponibles.
 */
function listAvailableSfx() {
  return Object.keys(SFX_DEFINITIONS);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  generateAllSfx,
  getSfxPath,
  getSfxDir,
  parseSfxTags,
  stripSfxTags,
  extractSfxNames,
  listAvailableSfx,
  SFX_DEFINITIONS,
  synthesizeWav,
  NOTE,
};
