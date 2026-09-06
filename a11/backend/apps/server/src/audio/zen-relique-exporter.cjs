'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SCHEMA = 'funesterie.audio.zen-relique-public-export.v1';
const RIFF_INFINITE_SIZE = 0xffffffff;

function cleanText(value = '', max = 2000) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeBaseName(value = 'relique') {
  return path.basename(String(value || 'relique'))
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'relique';
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function parseWaveChunks(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) {
    const error = new Error('relique_too_short');
    error.code = 'relique_too_short';
    throw error;
  }
  const riff = buffer.toString('ascii', 0, 4);
  const wave = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    const error = new Error('not_wave_relique');
    error.code = 'not_wave_relique';
    throw error;
  }

  const riffSize = buffer.readUInt32LE(4);
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const storedSize = buffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    let actualSize = storedSize;
    if (storedSize === RIFF_INFINITE_SIZE || payloadOffset + actualSize > buffer.length) {
      actualSize = Math.max(0, buffer.length - payloadOffset);
    }
    chunks.push({
      id,
      offset,
      payloadOffset,
      sizeOffset: offset + 4,
      storedSize,
      actualSize,
      infiniteSize: storedSize === RIFF_INFINITE_SIZE,
    });
    const next = payloadOffset + actualSize + (actualSize % 2);
    if (next <= offset) break;
    offset = next;
  }

  const fmt = chunks.find((chunk) => chunk.id === 'fmt ');
  const data = chunks.find((chunk) => chunk.id === 'data');
  if (!fmt || !data) {
    const error = new Error('wave_relique_missing_fmt_or_data');
    error.code = 'wave_relique_missing_fmt_or_data';
    throw error;
  }

  let audioFormat = null;
  let channels = null;
  let sampleRate = null;
  let byteRate = null;
  let blockAlign = null;
  let bitsPerSample = null;
  if (fmt.actualSize >= 16 && fmt.payloadOffset + 16 <= buffer.length) {
    audioFormat = buffer.readUInt16LE(fmt.payloadOffset);
    channels = buffer.readUInt16LE(fmt.payloadOffset + 2);
    sampleRate = buffer.readUInt32LE(fmt.payloadOffset + 4);
    byteRate = buffer.readUInt32LE(fmt.payloadOffset + 8);
    blockAlign = buffer.readUInt16LE(fmt.payloadOffset + 12);
    bitsPerSample = buffer.readUInt16LE(fmt.payloadOffset + 14);
  }

  return {
    riffSize,
    riffInfinite: riffSize === RIFF_INFINITE_SIZE,
    chunks,
    fmt,
    data,
    audio: {
      audioFormat,
      channels,
      sampleRate,
      byteRate,
      blockAlign,
      bitsPerSample,
      durationSeconds: byteRate ? data.actualSize / byteRate : null,
      sampleCount: blockAlign ? Math.floor(data.actualSize / blockAlign) : null,
    },
  };
}

function fixReliqueWaveBuffer(inputBuffer) {
  const parsed = parseWaveChunks(inputBuffer);
  if (inputBuffer.length - 8 > RIFF_INFINITE_SIZE - 1 || parsed.data.actualSize > RIFF_INFINITE_SIZE - 1) {
    const error = new Error('wave_relique_too_large_for_standard_riff');
    error.code = 'wave_relique_too_large_for_standard_riff';
    throw error;
  }
  const output = Buffer.from(inputBuffer);
  output.writeUInt32LE(inputBuffer.length - 8, 4);
  output.writeUInt32LE(parsed.data.actualSize, parsed.data.sizeOffset);
  return {
    buffer: output,
    parsed,
    repairs: {
      riffSize: {
        from: parsed.riffSize,
        to: inputBuffer.length - 8,
        repaired: parsed.riffSize !== inputBuffer.length - 8,
      },
      dataSize: {
        from: parsed.data.storedSize,
        to: parsed.data.actualSize,
        repaired: parsed.data.storedSize !== parsed.data.actualSize,
      },
    },
  };
}

function resolveFfmpegBin(options = {}) {
  return cleanText(options.ffmpegPath || process.env.A11_RELIQUE_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg', 400) || 'ffmpeg';
}

function resolveFfprobeBin(options = {}) {
  const explicit = cleanText(options.ffprobePath || process.env.A11_RELIQUE_FFPROBE_BIN || process.env.FFPROBE_BIN || '', 400);
  if (explicit) return explicit;
  const ffmpeg = resolveFfmpegBin(options);
  const base = path.basename(ffmpeg);
  if (/^ffmpeg(?:\.exe)?$/i.test(base)) {
    return path.join(path.dirname(ffmpeg), base.replace(/^ffmpeg/i, 'ffprobe'));
  }
  return 'ffprobe';
}

function execFilePromise(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      windowsHide: true,
      timeout: Number(options.timeoutMs || process.env.A11_RELIQUE_FFMPEG_TIMEOUT_MS || 240_000),
      maxBuffer: Number(options.maxBuffer || 4 * 1024 * 1024),
    }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(`${path.basename(bin)}_failed:${error.message}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.status = error.code;
        return reject(err);
      }
      return resolve({ stdout, stderr });
    });
  });
}

async function ffprobeJson(filePath, options = {}) {
  try {
    const probe = resolveFfprobeBin(options);
    const { stdout } = await execFilePromise(probe, [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      filePath,
    ], options);
    return JSON.parse(stdout || '{}');
  } catch (error) {
    return {
      unavailable: true,
      error: cleanText(error?.message || error, 500),
    };
  }
}

async function convertAudioWithFfmpeg({ inputPath, outputPath, codec = 'flac', polish = false, durationSeconds = 0, options = {} } = {}) {
  const ffmpeg = resolveFfmpegBin(options);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath];

  if (polish) {
    const duration = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
      ? Number(durationSeconds)
      : 3600;
    const fadeOutStart = Math.max(0, duration - 0.2);
    args.push(
      '-filter_complex',
      [
        '[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[base]',
        `anoisesrc=color=white:amplitude=0.00022:duration=${duration.toFixed(6)}:sample_rate=44100,highpass=f=8500,lowpass=f=15500,afade=t=in:st=0:d=0.12,afade=t=out:st=${fadeOutStart.toFixed(6)}:d=0.18,pan=stereo|c0=c0|c1=c0[air]`,
        '[base][air]amix=inputs=2:weights=\'1 1\':normalize=0,alimiter=limit=0.98[out]',
      ].join(';'),
      '-map',
      '[out]'
    );
  } else {
    args.push('-map', '0:a:0');
  }

  if (codec === 'flac') args.push('-codec:a', 'flac');
  else if (codec === 'wav') args.push('-codec:a', 'pcm_s24le');
  else if (codec === 'mp3') args.push('-codec:a', 'libmp3lame', '-b:a', '192k');
  args.push(outputPath);
  await execFilePromise(ffmpeg, args, options);
}

async function exportZenReliqueForPublic({
  inputPath,
  outputDir,
  baseName,
  polish = false,
  writeFlac = true,
  writeWav = true,
  manifestPath,
  options = {},
} = {}) {
  if (!inputPath) throw new Error('missing_relique_input_path');
  const sourcePath = path.resolve(inputPath);
  const outDir = path.resolve(outputDir || path.dirname(sourcePath));
  await fsp.mkdir(outDir, { recursive: true });

  const inputBuffer = await fsp.readFile(sourcePath);
  const { buffer, parsed, repairs } = fixReliqueWaveBuffer(inputBuffer);
  const base = safeBaseName(baseName || path.basename(sourcePath));
  const standardWavPath = path.join(outDir, `${base}.public.wav`);
  const flacPath = path.join(outDir, `${base}.public.flac`);
  const polishedWavPath = path.join(outDir, `${base}.public-polished.wav`);
  const polishedFlacPath = path.join(outDir, `${base}.public-polished.flac`);

  if (writeWav) await fsp.writeFile(standardWavPath, buffer);
  if (writeFlac) {
    await convertAudioWithFfmpeg({
      inputPath: standardWavPath,
      outputPath: flacPath,
      codec: 'flac',
      durationSeconds: parsed.audio.durationSeconds || 0,
      options,
    });
  }

  const polished = {};
  if (polish) {
    await convertAudioWithFfmpeg({
      inputPath: standardWavPath,
      outputPath: polishedWavPath,
      codec: 'wav',
      polish: true,
      durationSeconds: parsed.audio.durationSeconds || 0,
      options,
    });
    await convertAudioWithFfmpeg({
      inputPath: polishedWavPath,
      outputPath: polishedFlacPath,
      codec: 'flac',
      durationSeconds: parsed.audio.durationSeconds || 0,
      options,
    });
    polished.wav = polishedWavPath;
    polished.flac = polishedFlacPath;
  }

  const outputs = {};
  if (writeWav) outputs.wav = {
    path: standardWavPath,
    bytes: fs.statSync(standardWavPath).size,
    sha256: sha256File(standardWavPath),
    probe: await ffprobeJson(standardWavPath, options),
  };
  if (writeFlac) outputs.flac = {
    path: flacPath,
    bytes: fs.statSync(flacPath).size,
    sha256: sha256File(flacPath),
    probe: await ffprobeJson(flacPath, options),
  };
  if (polish) {
    outputs.polishedWav = {
      path: polishedWavPath,
      bytes: fs.statSync(polishedWavPath).size,
      sha256: sha256File(polishedWavPath),
      probe: await ffprobeJson(polishedWavPath, options),
    };
    outputs.polishedFlac = {
      path: polishedFlacPath,
      bytes: fs.statSync(polishedFlacPath).size,
      sha256: sha256File(polishedFlacPath),
      probe: await ffprobeJson(polishedFlacPath, options),
    };
  }

  const manifest = {
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    source: {
      path: sourcePath,
      bytes: inputBuffer.length,
      sha256: sha256File(sourcePath),
      preservedIntact: true,
      riffSize: parsed.riffSize,
      riffInfinite: parsed.riffInfinite,
      dataChunkStoredSize: parsed.data.storedSize,
      dataChunkActualSize: parsed.data.actualSize,
    },
    audio: parsed.audio,
    chunks: parsed.chunks.map((chunk) => ({
      id: chunk.id,
      offset: chunk.offset,
      storedSize: chunk.storedSize,
      actualSize: chunk.actualSize,
      infiniteSize: chunk.infiniteSize,
    })),
    repairs,
    publicProjection: {
      mode: 'flat-standard-wav-flac-no-hidden-runtime',
      reliqueOriginalUntouched: true,
      publicFilesAreStandalone: true,
      protectionPolish: polish
        ? {
            enabled: true,
            mode: 'ultra-low-air-noise-sacrificial-shell',
            amplitude: 0.00022,
            bandHz: [8500, 15500],
          }
        : { enabled: false },
    },
    outputs,
  };

  const resolvedManifestPath = manifestPath
    ? path.resolve(manifestPath)
    : path.join(outDir, `${base}.public.manifest.json`);
  await fsp.writeFile(resolvedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    schema: SCHEMA,
    inputPath: sourcePath,
    manifestPath: resolvedManifestPath,
    repairs,
    audio: parsed.audio,
    outputs,
  };
}

module.exports = {
  SCHEMA,
  RIFF_INFINITE_SIZE,
  exportZenReliqueForPublic,
  fixReliqueWaveBuffer,
  parseWaveChunks,
  safeBaseName,
  sha256File,
};
