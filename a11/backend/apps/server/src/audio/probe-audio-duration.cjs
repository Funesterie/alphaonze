'use strict';

/**
 * Mesure la duree REELLE d'un fichier audio local.
 *
 * Regle NOSSEN: la duree annoncee par un fournisseur n'est jamais la source de
 * verite. Le fichier doit d'abord etre rapatrie sur le serveur, puis mesure ici.
 * Cela garde le traitement independant de R2 et du lecteur du navigateur.
 *
 * Ordre des sondes:
 *   1. ffprobe / format=duration (rapide, chemin normal)
 *   2. ffprobe / stream=duration (certains MP3 n'exposent pas la duree au format)
 *   3. ffmpeg lit effectivement l'audio jusqu'a la fin et on prend son dernier time=
 *      (repli plus couteux, seulement si les metadonnees sont insuffisantes)
 *
 * Zero signifie toujours « duree inconnue », jamais « fichier vide ».
 */

const fs = require('node:fs');
const { execFile } = require('node:child_process');

const PROBE_TIMEOUT_MS = 15000;
const DECODE_PROBE_TIMEOUT_MS = 60000;

function asPositiveSeconds(value) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parseFirstPositiveDuration(stdout = '') {
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const duration = asPositiveSeconds(line);
    if (duration > 0) return duration;
  }
  return 0;
}

function parseFfmpegTimeSeconds(stderr = '') {
  let seconds = 0;
  const source = String(stderr || '');
  const pattern = /time=(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)/g;
  let match;
  while ((match = pattern.exec(source))) {
    const candidate = (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
    if (Number.isFinite(candidate) && candidate > seconds) seconds = candidate;
  }
  return seconds;
}

function execLocal(binary, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout, stderr) => resolve({ error, stdout: stdout || '', stderr: stderr || '' })
    );
  });
}

/**
 * @returns {Promise<number>} duree locale en secondes, 0 si non mesurable.
 */
async function probeAudioDurationSeconds(filePath = '', options = {}) {
  const target = String(filePath || '').trim();
  if (!target) return 0;
  try {
    if (!fs.existsSync(target) || !fs.statSync(target).isFile() || fs.statSync(target).size <= 0) return 0;
  } catch {
    return 0;
  }

  const env = options.env || process.env;
  const ffprobeBin = String(options.ffprobeBin || env.FFPROBE_BIN || 'ffprobe').trim() || 'ffprobe';
  const ffmpegBin = String(options.ffmpegBin || env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
  const probeTimeoutMs = Math.max(1000, Number(options.probeTimeoutMs || env.VIVY_AUDIO_DURATION_PROBE_TIMEOUT_MS || PROBE_TIMEOUT_MS) || PROBE_TIMEOUT_MS);
  const decodeTimeoutMs = Math.max(probeTimeoutMs, Number(options.decodeTimeoutMs || env.VIVY_AUDIO_DURATION_DECODE_TIMEOUT_MS || DECODE_PROBE_TIMEOUT_MS) || DECODE_PROBE_TIMEOUT_MS);
  const run = typeof options.execLocal === 'function' ? options.execLocal : execLocal;

  const formatProbe = await run(
    ffprobeBin,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', target],
    probeTimeoutMs
  );
  const formatDuration = parseFirstPositiveDuration(formatProbe?.stdout);
  if (formatDuration > 0) return formatDuration;

  const streamProbe = await run(
    ffprobeBin,
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'default=noprint_wrappers=1:nokey=1', target],
    probeTimeoutMs
  );
  const streamDuration = parseFirstPositiveDuration(streamProbe?.stdout);
  if (streamDuration > 0) return streamDuration;

  // Dernier recours: on decode le fichier LOCAL jusqu'au bout. ffmpeg retourne souvent
  // un code non nul pour des conteneurs imparfaits, mais son dernier time= reste une
  // mesure de ce qu'il a reellement pu lire. Aucune URL R2/fournisseur n'est consultee.
  const decodeProbe = await run(
    ffmpegBin,
    ['-hide_banner', '-nostdin', '-i', target, '-map', '0:a:0', '-vn', '-f', 'null', '-'],
    decodeTimeoutMs
  );
  return parseFfmpegTimeSeconds(decodeProbe?.stderr);
}

module.exports = {
  probeAudioDurationSeconds,
  PROBE_TIMEOUT_MS,
  DECODE_PROBE_TIMEOUT_MS,
  parseFirstPositiveDuration,
  parseFfmpegTimeSeconds,
};
