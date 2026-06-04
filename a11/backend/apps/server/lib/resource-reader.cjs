const path = require('node:path');
const zlib = require('node:zlib');

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx',
  '.mjs', '.cjs', '.py', '.java', '.cs', '.cpp', '.c', '.h', '.hpp',
  '.html', '.css', '.scss', '.sass', '.less', '.xml', '.yml', '.yaml',
  '.toml', '.ini', '.env', '.sql', '.sh', '.ps1', '.bat', '.log', '.rtf',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.cs',
  '.cpp', '.c', '.h', '.hpp', '.html', '.css', '.scss', '.sass', '.less',
  '.xml', '.yml', '.yaml', '.toml', '.ini', '.sql', '.sh', '.ps1', '.bat',
]);

const JSON_EXTENSIONS = new Set(['.json']);
const CSV_EXTENSIONS = new Set(['.csv']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus', '.wma', '.aiff', '.aif']);
const IMAGE_OCR_ENABLED = String(process.env.IMAGE_OCR_ENABLED || 'true').trim().toLowerCase() !== 'false';
const IMAGE_OCR_MAX_BYTES = Number(process.env.IMAGE_OCR_MAX_BYTES || 4 * 1024 * 1024);
const IMAGE_OCR_MAX_WIDTH = Number(process.env.IMAGE_OCR_MAX_WIDTH || 1600);
const IMAGE_OCR_MIN_WIDTH = Math.max(640, Math.min(IMAGE_OCR_MAX_WIDTH, Number(process.env.IMAGE_OCR_MIN_WIDTH || 960)));
const IMAGE_OCR_TARGET_BYTES = Math.max(
  512 * 1024,
  Math.min(IMAGE_OCR_MAX_BYTES, Number(process.env.IMAGE_OCR_TARGET_BYTES || 2 * 1024 * 1024))
);
const IMAGE_OCR_TIMEOUT_MS = Number(process.env.IMAGE_OCR_TIMEOUT_MS || 20000);

let sharpLib = null;
let tesseractLib = null;

function getSharp() {
  if (sharpLib !== null) return sharpLib;
  try {
    sharpLib = require('sharp');
  } catch {
    sharpLib = null;
  }
  return sharpLib;
}

function getTesseract() {
  if (tesseractLib !== null) return tesseractLib;
  try {
    tesseractLib = require('tesseract.js');
  } catch {
    tesseractLib = null;
  }
  return tesseractLib;
}

function normalizeMime(contentType) {
  return String(contentType || '').trim().toLowerCase();
}

function getExtension(filename) {
  return path.extname(String(filename || '').trim().toLowerCase());
}

function inferResourceKind(contentType, filename) {
  const mime = normalizeMime(contentType);
  const extension = getExtension(filename);

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (mime === 'application/pdf' || extension === '.pdf') return 'pdf';
  if (mime === 'application/json' || JSON_EXTENSIONS.has(extension)) return 'json';
  if (mime === 'text/csv' || CSV_EXTENSIONS.has(extension)) return 'csv';
  if (mime.startsWith('text/')) return CODE_EXTENSIONS.has(extension) ? 'code' : 'text';
  if (mime.includes('javascript') || mime.includes('typescript')) return 'code';
  if (mime.includes('yaml') || mime.includes('xml') || mime.includes('sql')) return 'code';
  if (TEXT_EXTENSIONS.has(extension)) return CODE_EXTENSIONS.has(extension) ? 'code' : 'text';
  return 'binary';
}

function isLikelyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  let nullBytes = 0;
  for (const byte of sample) {
    if (byte === 0) nullBytes += 1;
  }
  return nullBytes > 0;
}

function truncateText(value, maxChars) {
  const text = String(value || '').trim();
  if (!text) return { text: '', truncated: false };
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`,
    truncated: true,
  };
}

function cleanTextPreview(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildPreviewFromText(text, options = {}) {
  const maxLines = Number(options.maxLines || 36);
  const maxChars = Number(options.maxChars || 1400);
  const lines = cleanTextPreview(text).split('\n').slice(0, maxLines);
  const clipped = truncateText(lines.join('\n'), maxChars);
  return {
    preview: clipped.text,
    truncated: clipped.truncated || lines.length >= maxLines,
    lineCount: cleanTextPreview(text) ? cleanTextPreview(text).split('\n').length : 0,
    charCount: cleanTextPreview(text).length,
  };
}

function promiseWithTimeout(promise, timeoutMs, code) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(code || 'operation_timeout');
        error.code = code || 'operation_timeout';
        reject(error);
      }, timeoutMs);
    }),
  ]);
}

function buildOcrResizeWidths(metadata) {
  const sourceWidth = Number(metadata?.width || 0) || IMAGE_OCR_MAX_WIDTH;
  const preferred = [
    Math.min(sourceWidth, IMAGE_OCR_MAX_WIDTH),
    1440,
    1280,
    1080,
    IMAGE_OCR_MIN_WIDTH,
    800,
    640,
  ];
  return preferred
    .map((value) => Math.max(320, Math.round(Number(value || 0))))
    .filter((value, index, list) => value > 0 && value <= sourceWidth && list.indexOf(value) === index)
    .filter((value) => value >= Math.min(IMAGE_OCR_MIN_WIDTH, sourceWidth) || value === sourceWidth);
}

async function prepareImageBufferForOcr(buffer) {
  const sharp = getSharp();
  if (!sharp) {
    return {
      metadata: null,
      preparedBuffer: buffer,
      preparedFormat: null,
      preparedBytes: buffer.length,
      compressedForOcr: false,
      resizedForOcr: false,
    };
  }

  try {
    const probe = sharp(buffer, { failOn: 'none' });
    const metadata = await probe.metadata();
    const widths = buildOcrResizeWidths(metadata);
    const jpegQualities = [84, 76, 68, 60, 52];

    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;

    const buildPipeline = (width) => sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({
        width,
        withoutEnlargement: true,
      })
      .grayscale()
      .normalize();

    for (const width of widths) {
      try {
        const pngBuffer = await buildPipeline(width).png().toBuffer();
        const delta = Math.abs(pngBuffer.length - IMAGE_OCR_TARGET_BYTES);
        if (!best || pngBuffer.length < best.preparedBytes || delta < bestDelta) {
          best = {
            metadata,
            preparedBuffer: pngBuffer,
            preparedFormat: 'png',
            preparedBytes: pngBuffer.length,
            compressedForOcr: pngBuffer.length < buffer.length,
            resizedForOcr: width < (Number(metadata?.width || 0) || width),
          };
          bestDelta = delta;
        }
        if (pngBuffer.length <= IMAGE_OCR_MAX_BYTES) return best;
      } catch {
        // ignore a failed encode and continue to the next candidate
      }

      for (const quality of jpegQualities) {
        try {
          const jpegBuffer = await buildPipeline(width)
            .jpeg({
              quality,
              mozjpeg: true,
            })
            .toBuffer();
          const delta = Math.abs(jpegBuffer.length - IMAGE_OCR_TARGET_BYTES);
          if (!best || jpegBuffer.length < best.preparedBytes || delta < bestDelta) {
            best = {
              metadata,
              preparedBuffer: jpegBuffer,
              preparedFormat: 'jpeg',
              preparedBytes: jpegBuffer.length,
              compressedForOcr: jpegBuffer.length < buffer.length,
              resizedForOcr: width < (Number(metadata?.width || 0) || width),
            };
            bestDelta = delta;
          }
          if (jpegBuffer.length <= IMAGE_OCR_MAX_BYTES) return best;
        } catch {
          // ignore a failed encode and continue to the next candidate
        }
      }
    }

    if (best) return best;

    return {
      metadata,
      preparedBuffer: buffer,
      preparedFormat: String(metadata?.format || '').trim() || null,
      preparedBytes: buffer.length,
      compressedForOcr: false,
      resizedForOcr: false,
    };
  } catch {
    return {
      metadata: null,
      preparedBuffer: buffer,
      preparedFormat: null,
      preparedBytes: buffer.length,
      compressedForOcr: false,
      resizedForOcr: false,
    };
  }
}

function decodePdfLiteralString(value) {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '\\') {
      result += char;
      continue;
    }

    index += 1;
    const next = value[index];
    if (next == null) break;

    if (next === 'n') result += '\n';
    else if (next === 'r') result += '\r';
    else if (next === 't') result += '\t';
    else if (next === 'b') result += '\b';
    else if (next === 'f') result += '\f';
    else if (next === '(' || next === ')' || next === '\\') result += next;
    else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let lookahead = 0; lookahead < 2; lookahead += 1) {
        const peek = value[index + 1];
        if (!peek || !/[0-7]/.test(peek)) break;
        index += 1;
        octal += peek;
      }
      result += String.fromCharCode(parseInt(octal, 8));
    } else if (next === '\n' || next === '\r') {
      if (next === '\r' && value[index + 1] === '\n') {
        index += 1;
      }
    } else {
      result += next;
    }
  }

  return result;
}

function decodePdfHexString(hexValue) {
  const normalized = String(hexValue || '').replace(/\s+/g, '');
  if (!normalized) return '';
  const padded = normalized.length % 2 === 0 ? normalized : `${normalized}0`;
  const buffer = Buffer.from(padded, 'hex');

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    let text = '';
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      text += String.fromCharCode(buffer.readUInt16BE(index));
    }
    return text;
  }

  return buffer.toString('utf8').replace(/\u0000/g, '') || buffer.toString('latin1');
}

function extractPdfTextOperators(source) {
  const chunks = [];

  const pushChunk = (value) => {
    const cleaned = cleanTextPreview(value);
    if (!cleaned) return;
    chunks.push(cleaned);
  };

  const parseScope = (scope) => {
    const literalMatches = scope.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj\b/g);
    for (const match of literalMatches) {
      pushChunk(decodePdfLiteralString(match[1]));
    }

    const hexMatches = scope.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj\b/g);
    for (const match of hexMatches) {
      pushChunk(decodePdfHexString(match[1]));
    }

    const arrayMatches = scope.matchAll(/\[(.*?)\]\s*TJ\b/gs);
    for (const match of arrayMatches) {
      const arrayScope = match[1];
      const literalParts = arrayScope.matchAll(/\(((?:\\.|[^\\()])*)\)/g);
      for (const part of literalParts) {
        pushChunk(decodePdfLiteralString(part[1]));
      }

      const hexParts = arrayScope.matchAll(/<([0-9A-Fa-f\s]+)>/g);
      for (const part of hexParts) {
        pushChunk(decodePdfHexString(part[1]));
      }
    }
  };

  const textBlocks = Array.from(source.matchAll(/BT[\s\S]*?ET/g)).map((match) => match[0]);
  if (textBlocks.length) {
    for (const block of textBlocks) parseScope(block);
  } else {
    parseScope(source);
  }

  return chunks;
}

function extractPdfTextPreview(buffer) {
  const sources = [];
  const raw = buffer.toString('latin1');
  sources.push(raw);

  const streamMatches = raw.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gs);
  for (const match of streamMatches) {
    const dictionary = String(match[1] || '');
    const streamText = String(match[2] || '');
    if (dictionary.includes('/FlateDecode')) {
      try {
        const inflated = zlib.inflateSync(Buffer.from(streamText, 'latin1'));
        sources.push(inflated.toString('latin1'));
      } catch {
        // ignore broken or unsupported stream variants
      }
    } else {
      sources.push(streamText);
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const source of sources) {
    const chunks = extractPdfTextOperators(source);
    for (const chunk of chunks) {
      const normalized = cleanTextPreview(chunk);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      deduped.push(normalized);
    }
  }

  const previewInfo = buildPreviewFromText(deduped.join('\n\n'), {
    maxLines: 40,
    maxChars: 1800,
  });

  return {
    preview: previewInfo.preview,
    truncated: previewInfo.truncated,
    blockCount: deduped.length,
    charCount: deduped.join('\n\n').length,
  };
}

async function analyzeImageBuffer(buffer, mime) {
  const prepared = await prepareImageBufferForOcr(buffer);
  const metadata = prepared.metadata;
  const preparedBuffer = prepared.preparedBuffer || buffer;

  const base = {
    readableInChatContext: false,
    parser: 'image_metadata',
    preview: '',
    width: Number(metadata?.width || 0) || null,
    height: Number(metadata?.height || 0) || null,
    density: Number(metadata?.density || 0) || null,
    format: String(metadata?.format || mime || 'image').trim() || 'image',
    originalBytes: buffer.length,
    preparedBytes: Number(prepared.preparedBytes || preparedBuffer.length || buffer.length) || buffer.length,
    preparedFormat: prepared.preparedFormat || null,
    compressedForOcr: Boolean(prepared.compressedForOcr),
    resizedForOcr: Boolean(prepared.resizedForOcr),
    note: 'image_recue_sans_texte_detecte',
  };

  if (!IMAGE_OCR_ENABLED) {
    return {
      ...base,
      parser: 'image_ocr_disabled',
      note: 'ocr_image_desactive',
    };
  }

  if (preparedBuffer.length > IMAGE_OCR_MAX_BYTES) {
    return {
      ...base,
      parser: 'image_ocr_skipped_size',
      note: 'ocr_image_ignoree_taille_apres_optimisation',
    };
  }

  const Tesseract = getTesseract();
  const recognize = Tesseract?.recognize || Tesseract?.default?.recognize;
  if (typeof recognize !== 'function') {
    return {
      ...base,
      parser: 'image_ocr_unavailable',
      note: 'ocr_image_indisponible',
    };
  }

  try {
    const result = await promiseWithTimeout(
      recognize(preparedBuffer, 'fra+eng', { logger: () => {} }),
      IMAGE_OCR_TIMEOUT_MS,
      'image_ocr_timeout'
    );
    const text = cleanTextPreview(result?.data?.text || result?.text || '');
    if (!text) {
      return {
        ...base,
        parser: 'image_ocr_empty',
        note: 'ocr_image_aucun_texte',
      };
    }

    const previewInfo = buildPreviewFromText(text, {
      maxLines: 24,
      maxChars: 1200,
    });

    return {
      ...base,
      readableInChatContext: true,
      parser: 'image_ocr',
      preview: previewInfo.preview,
      truncated: previewInfo.truncated,
      charCount: previewInfo.charCount,
      lineCount: previewInfo.lineCount,
      note: null,
    };
  } catch (error_) {
    return {
      ...base,
      parser: String(error_?.code || 'image_ocr_failed'),
      note: 'ocr_image_echec',
      error: String(error_?.message || error_),
    };
  }
}

function analyzeTextBuffer(buffer, fileKind) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return {
      readableInChatContext: false,
      parser: 'empty',
      preview: '',
      note: 'fichier_vide',
    };
  }

  if (isLikelyBinary(buffer)) {
    return {
      readableInChatContext: false,
      parser: 'binary_detected',
      preview: '',
      note: 'contenu_binaire_non_lisible',
    };
  }

  const rawText = buffer.toString('utf8');
  let parsedText = rawText;
  let parser = 'utf8_text';

  if (fileKind === 'json') {
    try {
      parsedText = JSON.stringify(JSON.parse(rawText), null, 2);
      parser = 'json';
    } catch {
      parser = 'json_text_fallback';
    }
  } else if (fileKind === 'csv') {
    parser = 'csv_text';
  } else if (fileKind === 'code') {
    parser = 'code_text';
  }

  const previewInfo = buildPreviewFromText(parsedText, {
    maxLines: fileKind === 'csv' ? 24 : 36,
    maxChars: fileKind === 'csv' ? 1200 : 1600,
  });

  return {
    readableInChatContext: !!previewInfo.preview,
    parser,
    preview: previewInfo.preview,
    truncated: previewInfo.truncated,
    lineCount: previewInfo.lineCount,
    charCount: previewInfo.charCount,
    note: previewInfo.preview ? null : 'texte_vide',
  };
}

function buildResourceActionInference({ filename, fileKind, analysis = {} }) {
  const safeName = String(filename || 'fichier').trim() || 'fichier';
  const preview = String(analysis.preview || '').trim();
  const loweredName = safeName.toLowerCase();
  const loweredPreview = preview.toLowerCase();
  const hasBriefSignal = /\b(brief|objectif|mission|todo|tache|task|spec|cahier des charges|prompt)\b/.test(`${loweredName}\n${loweredPreview}`);
  const hasInvoiceSignal = /\b(facture|invoice|devis|montant|tva|iban|paiement)\b/.test(`${loweredName}\n${loweredPreview}`);
  const hasVoiceSignal = /\b(voix|voice|xtts|rvc|piper|cartesia|eleven|chant|song|audio)\b/.test(`${loweredName}\n${loweredPreview}`);
  const hasImageEditSignal = /\b(image|photo|portrait|retouche|decor|scene|visuel|thumbnail|miniature)\b/.test(`${loweredName}\n${loweredPreview}`);
  const hasCodeSignal = fileKind === 'code' || /\b(error|stack|exception|bug|fix|commit|diff|function|class|import|export)\b/.test(loweredPreview);

  if (fileKind === 'image') {
    return {
      intent: hasImageEditSignal ? 'image_reference_or_edit' : 'visual_context',
      suggestedAction: 'Analyser le visuel, identifier sujet/style/texte lisible, puis proposer la suite probable: description, retouche, generation ou comparaison.',
      routeHints: ['vision_analyze', 'image_context'],
    };
  }

  if (fileKind === 'audio') {
    return {
      intent: hasVoiceSignal ? 'voice_or_music_source' : 'audio_context',
      suggestedAction: 'Ecouter/analyser les metadonnees et la transcription si disponible, puis decider si le fichier sert de reference voix, de chanson, de note vocale ou de contexte.',
      routeHints: ['audio_transcribe', 'voice_reference', 'song_brief'],
    };
  }

  if (fileKind === 'pdf') {
    return {
      intent: hasInvoiceSignal ? 'document_finance_or_admin' : 'document_summary',
      suggestedAction: 'Resumer le document, extraire les points d action, puis signaler s il faut repondre, classer, transformer en brief ou produire un artefact.',
      routeHints: ['document_summary', 'task_extract'],
    };
  }

  if (fileKind === 'json' || fileKind === 'csv') {
    return {
      intent: 'structured_data',
      suggestedAction: 'Inspecter la structure, resumer les champs importants, detecter anomalies/taches, puis proposer analyse, nettoyage ou import.',
      routeHints: ['data_summary', 'task_extract'],
    };
  }

  if (hasCodeSignal) {
    return {
      intent: 'code_or_debug_context',
      suggestedAction: 'Lire le code ou log, detecter le probleme probable, puis proposer correction, test ou integration.',
      routeHints: ['code_review', 'debug'],
    };
  }

  if (hasBriefSignal) {
    return {
      intent: 'brief_or_task_context',
      suggestedAction: 'Transformer le contenu en brouillon de travail: objectif, contraintes, prochaines actions, agent le plus adapte.',
      routeHints: ['brief', 'task_extract'],
    };
  }

  if (hasInvoiceSignal) {
    return {
      intent: 'document_finance_or_admin',
      suggestedAction: 'Extraire montants, dates, interlocuteurs et action attendue, puis proposer classement ou reponse.',
      routeHints: ['document_summary', 'admin'],
    };
  }

  return {
    intent: analysis.readableInChatContext ? 'general_file_context' : 'stored_attachment',
    suggestedAction: analysis.readableInChatContext
      ? 'Resumer le contenu visible, deviner l usage attendu, puis demander seulement si l action reste ambigue.'
      : 'Garder le fichier rattache et expliquer ce qui manque pour l analyser plus loin.',
    routeHints: analysis.readableInChatContext ? ['summary', 'task_extract'] : ['file_reference'],
  };
}

/**
 * Analyse un buffer audio (MP3, WAV, OGG, FLAC, etc.) via ffprobe.
 * Retourne les métadonnées techniques + une transcription Whisper si disponible.
 *
 * @param {Buffer} buffer - Contenu du fichier audio
 * @param {string} mime - Type MIME
 * @param {string} filename - Nom du fichier
 * @returns {Promise<object>}
 */
async function analyzeAudioBuffer(buffer, mime, filename) {
  const os = require('node:os');
  const fs = require('node:fs');
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const execFileAsync = promisify(execFile);

  const base = {
    readableInChatContext: false,
    parser: 'audio_metadata',
    preview: '',
    note: null,
  };

  // Écrire le buffer dans un fichier temporaire pour ffprobe
  const tmpDir = os.tmpdir();
  const ext = path.extname(filename || '.mp3') || '.mp3';
  const tmpFile = path.join(tmpDir, `a11_audio_${Date.now()}${ext}`);

  try {
    fs.writeFileSync(tmpFile, buffer);

    // Trouver ffprobe dans le PATH
    const { execSync } = require('node:child_process');
    let ffprobePath = 'ffprobe';
    try {
      const which = process.platform === 'win32'
        ? execSync('where ffprobe 2>nul', { encoding: 'utf8' }).trim().split('\n')[0].trim()
        : execSync('which ffprobe 2>/dev/null', { encoding: 'utf8' }).trim();
      if (which) ffprobePath = which;
    } catch {
      // ffprobe dans le PATH par défaut
    }

    // Analyse ffprobe
    let ffprobeData = null;
    try {
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        tmpFile,
      ], { timeout: 15000 });
      ffprobeData = JSON.parse(stdout);
    } catch (ffprobeErr) {
      base.note = `ffprobe_unavailable: ${String(ffprobeErr?.message || ffprobeErr).slice(0, 100)}`;
      return base;
    }

    const format = ffprobeData?.format || {};
    const stream = (ffprobeData?.streams || []).find((s) => s.codec_type === 'audio') || {};

    const durationSec = parseFloat(format.duration || stream.duration || 0);
    const durationMin = Math.floor(durationSec / 60);
    const durationSecRem = Math.round(durationSec % 60);
    const bitrateKbps = Math.round(parseInt(format.bit_rate || stream.bit_rate || 0, 10) / 1000);
    const sampleRate = parseInt(stream.sample_rate || 0, 10);
    const channels = parseInt(stream.channels || 0, 10);
    const channelLayout = stream.channel_layout || (channels === 2 ? 'stereo' : channels === 1 ? 'mono' : `${channels}ch`);
    const codec = stream.codec_name || 'unknown';
    const encoder = format.tags?.encoder || stream.tags?.encoder || '';
    const sizeKb = Math.round(buffer.length / 1024);

    // Analyse loudness via ffmpeg volumedetect (optionnel, rapide)
    let loudnessInfo = '';
    try {
      const ffmpegPath = ffprobePath.replace('ffprobe', 'ffmpeg');
      const { stderr } = await execFileAsync(ffmpegPath, [
        '-i', tmpFile,
        '-af', 'volumedetect',
        '-f', 'null',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
      ], { timeout: 20000 });
      const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      const maxMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
      if (meanMatch && maxMatch) {
        loudnessInfo = ` | Volume moyen: ${meanMatch[1]} dB, Peak: ${maxMatch[1]} dB`;
      }
    } catch {
      // loudness optionnel
    }

    // Tentative de transcription via le service STT central (Ollama prioritaire, fallback encadré).
    let transcription = '';
    let transcriptionNote = '';
    const whisperEnabled = String(process.env.AUDIO_TRANSCRIPTION_ENABLED || 'true').trim().toLowerCase() !== 'false';
    if (whisperEnabled && buffer.length < 25 * 1024 * 1024) {
      try {
        const { getSttStatus, transcribe } = require('./stt-service.cjs');
        const sttStatus = getSttStatus();
        if (sttStatus.available) {
          const sttResult = await transcribe(buffer, mime, { language: 'fr' });
          transcription = String(sttResult?.text || '').trim();
          transcriptionNote = transcription ? `transcription_${sttResult.provider}_ok` : 'transcription_empty';
        } else {
          transcriptionNote = 'transcription_skipped_no_stt_provider';
        }
      } catch (sttErr) {
        transcriptionNote = `stt_unavailable: ${String(sttErr?.message || '').slice(0, 80)}`;
      }
    } else if (!whisperEnabled) {
      transcriptionNote = 'transcription_disabled';
    }

    // Construire le preview lisible pour le contexte LLM
    const metaLine = [
      `Durée: ${durationMin}:${String(durationSecRem).padStart(2, '0')}`,
      `Codec: ${codec.toUpperCase()}`,
      `Bitrate: ${bitrateKbps} kbps`,
      `Sample rate: ${sampleRate} Hz`,
      `Canaux: ${channelLayout}`,
      `Taille: ${sizeKb} KB`,
      encoder ? `Encodeur: ${encoder}` : null,
    ].filter(Boolean).join(' | ');

    const previewParts = [`[Analyse audio] ${metaLine}${loudnessInfo}`];
    if (transcription) {
      const truncated = transcription.length > 800
        ? transcription.slice(0, 797) + '…'
        : transcription;
      previewParts.push(`[Transcription] ${truncated}`);
    }

    return {
      readableInChatContext: true,
      parser: transcription ? 'audio_transcription' : 'audio_metadata',
      preview: previewParts.join('\n'),
      truncated: transcription.length > 800,
      durationSec,
      durationFormatted: `${durationMin}:${String(durationSecRem).padStart(2, '0')}`,
      bitrateKbps,
      sampleRate,
      channels,
      channelLayout,
      codec,
      encoder,
      sizeBytes: buffer.length,
      transcription: transcription || null,
      note: transcriptionNote || null,
    };
  } catch (err) {
    return {
      ...base,
      note: `audio_analysis_error: ${String(err?.message || err).slice(0, 100)}`,
    };
  } finally {
    // Nettoyage du fichier temporaire
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

async function analyzeUploadedResource({ filename, contentType, buffer }) {
  const extension = getExtension(filename);
  const fileKind = inferResourceKind(contentType, filename);
  const base = {
    fileKind,
    extension,
    mime: normalizeMime(contentType) || 'application/octet-stream',
    sizeBytes: Buffer.isBuffer(buffer) ? buffer.length : 0,
  };

  let analysis = null;

  if (fileKind === 'text' || fileKind === 'code' || fileKind === 'json' || fileKind === 'csv') {
    analysis = {
      ...base,
      ...analyzeTextBuffer(buffer, fileKind),
    };
  } else if (fileKind === 'image') {
    analysis = {
      ...base,
      ...(await analyzeImageBuffer(buffer, base.mime)),
    };
  } else if (fileKind === 'audio') {
    analysis = {
      ...base,
      ...(await analyzeAudioBuffer(buffer, base.mime, filename)),
    };
  } else if (fileKind === 'pdf') {
    // Tentative avec l'extracteur robuste (pdf-parse → heuristique → OCR)
    try {
      const { extractPdfText, formatPdfPreview } = require('./pdf-extractor.cjs');
      const result = await extractPdfText(buffer, { maxChars: 2000 });
      if (result && result.text) {
        analysis = {
          ...base,
          readableInChatContext: true,
          parser: `pdf_${result.method}`,
          preview: formatPdfPreview(result, filename),
          truncated: result.truncated,
          charCount: result.text.length,
          blockCount: result.pages,
          note: null,
        };
      }
    } catch (_pdfErr) {
      // fallback sur l'extracteur heuristique intégré
    }

    // Fallback heuristique intégré
    if (!analysis) {
      const pdfPreview = extractPdfTextPreview(buffer);
      if (pdfPreview.preview) {
        analysis = {
          ...base,
          readableInChatContext: true,
          parser: 'pdf_text_heuristic',
          preview: pdfPreview.preview,
          truncated: pdfPreview.truncated,
          charCount: pdfPreview.charCount,
          blockCount: pdfPreview.blockCount,
          note: null,
        };
      }
    }

    if (!analysis) {
      analysis = {
        ...base,
        readableInChatContext: false,
        parser: 'pdf_text_unavailable',
        preview: '',
        note: 'pdf_recu_mais_texte_non_extractible',
      };
    }
  } else {
    analysis = {
      ...base,
      readableInChatContext: false,
      parser: 'unsupported',
      preview: '',
      note: 'type_non_lisible_automatiquement',
    };
  }

  return {
    ...analysis,
    actionInference: buildResourceActionInference({ filename, fileKind, analysis }),
  };
}

function buildConversationResourceContext(resources, options = {}) {
  const maxResources = Math.max(1, Math.min(8, Number(options.maxResources || 4)));
  const selected = (Array.isArray(resources) ? resources : []).slice(0, maxResources);
  if (!selected.length) return '';

  const lines = ['Ressources recentes de la conversation (contexte uniquement):'];
  for (const resource of selected) {
    const metadata = resource?.metadata && typeof resource.metadata === 'object' ? resource.metadata : {};
    const analysis = metadata.analysis && typeof metadata.analysis === 'object' ? metadata.analysis : {};
    const kindLabel = String(resource.resourceKind || 'file');
    const mime = String(resource.contentType || analysis.mime || 'application/octet-stream');
    const identifier = Number(resource?.id || 0);
    lines.push(`- #${identifier > 0 ? identifier : '?'} ${String(resource.filename || 'fichier')} [${kindLabel}, ${mime}]`);

    if (resource?.url) {
      lines.push(`  URL: ${String(resource.url)}`);
    }

    if (analysis.readableInChatContext && analysis.preview) {
      const preview = truncateText(String(analysis.preview || ''), 800).text;
      lines.push(`  Extrait utile:\n${preview}`);
    }

    const inference = analysis.actionInference && typeof analysis.actionInference === 'object'
      ? analysis.actionInference
      : null;
    if (inference?.suggestedAction) {
      lines.push(`  Action probable: ${String(inference.suggestedAction)}`);
    }
    if (Array.isArray(inference?.routeHints) && inference.routeHints.length) {
      lines.push(`  Routes probables: ${inference.routeHints.map((hint) => String(hint)).join(', ')}`);
    }

    if (analysis.readableInChatContext && analysis.preview) {
      continue;
    }

    if (analysis.note) {
      lines.push(`  Note: ${String(analysis.note)}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  analyzeUploadedResource,
  buildConversationResourceContext,
};
