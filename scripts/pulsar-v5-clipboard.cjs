'use strict';

/**
 * Pulsar v5 — Clipboard Bind
 * 
 * Bind: copier un fichier (Ctrl+C) -> lancer ce script -> compression automatique
 * Le script lit le chemin du fichier dans le presse-papier et le compresse.
 * 
 * Usage:
 *   node pulsar-v5-clipboard.cjs              -> compresse le fichier dans le presse-papier (CQ 30)
 *   node pulsar-v5-clipboard.cjs --quality 46.7  -> compresse avec CQ 46.7 (ultra compressé)
 *   node pulsar-v5-clipboard.cjs --upload     -> compresse + upload YouTube
 * 
 * Bind Windows: associer ce script à un raccourci clavier au lieu de Ctrl+V
 */

const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const opts = {
  quality: 30,
  upload: false,
  maxHeight: 1080,
  audioBitrate: 128,
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--quality') opts.quality = parseFloat(args[++i]);
  else if (args[i] === '--upload') opts.upload = true;
  else if (args[i] === '--max-height') opts.maxHeight = parseInt(args[++i], 10);
  else if (args[i] === '--audio-bitrate') opts.audioBitrate = parseInt(args[++i], 10);
}

function getClipboardFilePath() {
  try {
    // Read clipboard content via PowerShell
    const clip = execSync('powershell -NoProfile -Command "Get-Clipboard"', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    // Check if it's a valid file path
    if (clip && fs.existsSync(clip) && /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(clip)) {
      return clip;
    }

    // Maybe it's a file path with quotes
    const cleaned = clip.replace(/^["']|["']$/g, '').trim();
    if (cleaned && fs.existsSync(cleaned) && /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(cleaned)) {
      return cleaned;
    }
  } catch (e) {}

  return null;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function probeVideo(filePath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const data = JSON.parse(out);
    const video = (data.streams || []).find(s => s.codec_type === 'video');
    return {
      width: video ? parseInt(video.width, 10) : 0,
      height: video ? parseInt(video.height, 10) : 0,
      duration: parseFloat(data.format?.duration || 0),
      codec: video?.codec_name,
      size: fs.statSync(filePath).size,
    };
  } catch (e) {
    return null;
  }
}

console.log('========================================');
console.log('  PULSAR v5 — Clipboard Bind');
console.log('  Copier un fichier -> Lancer -> Compressé');
console.log('========================================\n');

// Read clipboard
const clipPath = getClipboardFilePath();

if (!clipPath) {
  console.log('Aucun fichier vidéo trouvé dans le presse-papier.');
  console.log('Copiez le chemin d\'un fichier vidéo (Ctrl+C) puis relancez ce script.');
  process.exit(1);
}

console.log('Fichier détecté:', path.basename(clipPath));

const probe = probeVideo(clipPath);
if (!probe) {
  console.log('Impossible de lire le fichier vidéo.');
  process.exit(1);
}

console.log(`Source: ${probe.width}x${probe.height} ${probe.codec} ${formatBytes(probe.size)}`);

// Compress
const dir = path.dirname(clipPath);
const ext = path.extname(clipPath);
const base = path.basename(clipPath, ext);
const outputPath = path.join(dir, `${base}_pulsar.mp4`);

const ffArgs = [
  '-i', clipPath,
  '-c:v', 'hevc_nvenc',
  '-preset', 'p6',
  '-tune', 'hq',
  '-rc', 'vbr',
  '-cq', String(opts.quality),
  '-b:v', '0',
  '-maxrate', '8M',
  '-bufsize', '16M',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', `${opts.audioBitrate}k`,
  '-movflags', '+faststart',
  '-y', outputPath,
];

if (probe.height > opts.maxHeight) {
  ffArgs.splice(ffArgs.indexOf('-pix_fmt'), 0, '-vf', `scale=-2:${opts.maxHeight}`);
}

console.log(`\nCompression NVENC HEVC (CQ=${opts.quality})...`);
console.log(`Output: ${outputPath}\n`);

const result = spawnSync('ffmpeg', ffArgs, {
  encoding: 'utf8',
  timeout: 600000,
  stdio: ['ignore', 'inherit', 'inherit'],
});

if (result.status !== 0) {
  console.log('\nÉchec de la compression.');
  process.exit(1);
}

const outSize = fs.statSync(outputPath).size;
const ratio = ((1 - outSize / probe.size) * 100).toFixed(1);

console.log(`\n========================================`);
console.log(`  PULSAR v5 — Compression terminée`);
console.log(`  ${formatBytes(probe.size)} -> ${formatBytes(outSize)} (${ratio}% réduction)`);
console.log(`  Output: ${outputPath}`);
console.log(`========================================`);

// Copy output path to clipboard for easy pasting
try {
  execSync(`powershell -NoProfile -Command "Set-Clipboard -Value '${outputPath.replace(/'/g, "''")}'"`, { timeout: 5000 });
  console.log('\nChemin de sortie copié dans le presse-papier.');
} catch (e) {}

// Upload if requested
if (opts.upload) {
  console.log('\nUpload YouTube...');
  const upResult = spawnSync('python', [
    'scripts/vivy-youtube-upload.py',
    '--file', outputPath,
    '--title', base,
    '--description', `Funesterie - ${base}`,
    '--tags', 'Funesterie',
    '--privacy-status', 'private',
  ], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'inherit', 'inherit'] });

  if (upResult.status === 0) {
    console.log('Upload: OK');
  } else {
    console.log('Upload: FAIL');
  }
}
