'use strict';

/**
 * Normalisation des audios recus a l'upload.
 *
 * Le corpus d'apprentissage vocal n'analysait que le WAV: pour un m4a, un mp3 ou un
 * ogg, la duree retombait sur une valeur envoyee par le navigateur, et si elle
 * manquait le clip etait enregistre a 0 ms. Il ne comptait alors pas vers le quota
 * requis, sans qu'aucune erreur ne remonte -- un echec parfaitement silencieux.
 *
 * Ici on convertit systematiquement ce qui n'est pas deja un WAV lisible, pour que
 * la duree soit toujours mesuree sur le fichier reel.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const { analyzeWavBuffer } = require('./voice-reference-store.cjs');

const DEFAULT_TIMEOUT_MS = 120000;
const TARGET_SAMPLE_RATE = 22050;

function resolveFfmpegBin(env = process.env) {
  return String(env.A11_VOICE_FFMPEG_BIN || env.A11_DH_FFMPEG_BIN || env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
}

function runFfmpeg(args, env = process.env) {
  const bin = resolveFfmpegBin(env);
  const timeout = Number(env.A11_VOICE_FFMPEG_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        error.stderr = String(stderr || '').slice(-600);
        return reject(error);
      }
      return resolve(true);
    });
  });
}

/**
 * Renvoie toujours un WAV analysable, quel que soit le format entrant.
 * Le fichier d'origine n'est jamais perdu: on renvoie aussi sa taille et son format.
 */
/**
 * @param {object} [options]
 * @param {number} [options.sampleRate] Frequence cible. 22,05 kHz pour la chaine de
 *   reference vocale; 16 kHz pour la transcription, frequence native des modeles
 *   Whisper -- lui donner du WAV propre evite un reencodage et ameliore le resultat.
 */
async function ensureAnalyzableWav(buffer, originalName = '', env = process.env, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { ok: false, error: 'empty_buffer' };
  }

  // Deja un WAV exploitable: aucune conversion, aucune perte.
  const direct = analyzeWavBuffer(buffer);
  if (direct?.ok && Number(direct.durationMs) > 0) {
    return {
      ok: true,
      converted: false,
      buffer,
      durationMs: Number(direct.durationMs),
      sourceFormat: 'wav',
      sourceBytes: buffer.length,
    };
  }

  const ext = (path.extname(String(originalName || '')) || '.bin').toLowerCase().slice(0, 12);
  const stamp = crypto.randomBytes(6).toString('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-audio-'));
  const src = path.join(dir, `in-${stamp}${ext}`);
  const dst = path.join(dir, `out-${stamp}.wav`);

  try {
    fs.writeFileSync(src, buffer);
    // Mono 16 bits. 22,05 kHz par defaut: format attendu par la chaine de reference
    // vocale. Les appelants qui transcrivent demandent 16 kHz.
    const frequence = Math.max(8000, Math.min(48000, Number(options?.sampleRate) || TARGET_SAMPLE_RATE));
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', src,
      '-vn',
      '-ac', '1',
      '-ar', String(frequence),
      '-c:a', 'pcm_s16le',
      dst,
    ], env);

    const out = fs.readFileSync(dst);
    const analysis = analyzeWavBuffer(out);
    if (!analysis?.ok || !(Number(analysis.durationMs) > 0)) {
      return { ok: false, error: 'conversion_unreadable', sourceFormat: ext.replace('.', '') };
    }

    return {
      ok: true,
      converted: true,
      buffer: out,
      durationMs: Number(analysis.durationMs),
      sourceFormat: ext.replace('.', '') || 'inconnu',
      sourceBytes: buffer.length,
    };
  } catch (error) {
    return {
      ok: false,
      error: 'conversion_failed',
      detail: String(error.stderr || error.message || error).slice(0, 300),
      sourceFormat: ext.replace('.', ''),
    };
  } finally {
    // Nettoyage systematique: ces fichiers ne doivent pas s'accumuler dans /tmp.
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* rien a faire */ }
  }
}

module.exports = {
  ensureAnalyzableWav,
  resolveFfmpegBin,
};
