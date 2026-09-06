'use strict';

/**
 * Pulsar v5 — Red Matter Video Compressor
 *
 * Inspired by Star Trek red matter: compress video into a singularity.
 * Uses NVIDIA NVENC HEVC (H.265) hardware encoding for maximum compression
 * ratio with minimal quality loss. Designed for Funesterie video pipeline.
 *
 * Usage:
 *   node pulsar-v5.cjs <input.mp4> [options]
 *   node pulsar-v5.cjs --batch <directory> [options]
 *
 * Options:
 *   --quality <0-51>    Constant quality (lower=better). Default: 30
 *   --max-height <px>    Max resolution height. Default: 1080
 *   --audio-bitrate <k> Audio bitrate in kbps. Default: 128
 *   --output <path>     Output file path (single file mode)
 *   --batch <dir>       Batch compress all mp4/mov files in directory
 *   --dry-run           Show what would be compressed without encoding
 *   --upload            Upload to YouTube after compression
 *   --suffix <text>     Output suffix. Default: _pulsar
 */

const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);

function parseArgs(args) {
  const opts = {
    quality: 30,
    maxHeight: 1080,
    audioBitrate: 128,
    output: null,
    batch: null,
    dryRun: false,
    upload: false,
    suffix: '_pulsar',
    inputs: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--quality') opts.quality = parseInt(args[++i], 10);
    else if (a === '--max-height') opts.maxHeight = parseInt(args[++i], 10);
    else if (a === '--audio-bitrate') opts.audioBitrate = parseInt(args[++i], 10);
    else if (a === '--output') opts.output = args[++i];
    else if (a === '--batch') opts.batch = args[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--upload') opts.upload = true;
    else if (a === '--suffix') opts.suffix = args[++i];
    else if (!a.startsWith('--')) opts.inputs.push(a);
  }
  return opts;
}

function probeVideo(filePath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const data = JSON.parse(out);
    const video = (data.streams || []).find(s => s.codec_type === 'video');
    const audio = (data.streams || []).find(s => s.codec_type === 'audio');
    return {
      width: video ? parseInt(video.width, 10) : 0,
      height: video ? parseInt(video.height, 10) : 0,
      duration: parseFloat(data.format?.duration || 0),
      codec: video?.codec_name,
      audioCodec: audio?.codec_name,
      bitrate: parseInt(data.format?.bit_rate || 0, 10),
      fps: video ? eval(video.r_frame_rate || '0/1') : 0,
      size: fs.statSync(filePath).size,
    };
  } catch (e) {
    return null;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

function compressVideo(inputPath, opts) {
  const probe = probeVideo(inputPath);
  if (!probe) {
    console.log(`  SKIP: cannot probe ${inputPath}`);
    return null;
  }

  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const outputPath = opts.output || path.join(dir, `${base}${opts.suffix}.mp4`);

  console.log(`  Source: ${probe.width}x${probe.height} ${probe.codec} ${formatDuration(probe.duration)} ${formatBytes(probe.size)}`);

  // Calculate scale filter
  const scaleFilter = probe.height > opts.maxHeight
    ? `scale=-2:${opts.maxHeight}`
    : null;

  // Build ffmpeg command
  const ffArgs = ['-i', inputPath, '-c:v', 'hevc_nvenc'];

  // NVENC quality settings
  ffArgs.push('-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', String(opts.quality));
  ffArgs.push('-b:v', '0', '-maxrate', '8M', '-bufsize', '16M');

  // Pixel format for compatibility
  ffArgs.push('-pix_fmt', 'yuv420p');

  // Scale if needed
  if (scaleFilter) {
    ffArgs.push('-vf', scaleFilter);
  }

  // Audio: AAC at target bitrate
  ffArgs.push('-c:a', 'aac', '-b:a', `${opts.audioBitrate}k`);

  // Move faststart for web playback
  ffArgs.push('-movflags', '+faststart');

  // Output
  ffArgs.push('-y', outputPath);

  if (opts.dryRun) {
    const estRatio = 0.15; // HEVC typically achieves ~85% reduction
    const estSize = Math.round(probe.size * estRatio);
    console.log(`  [DRY-RUN] Would compress to ~${formatBytes(estSize)} (${Math.round((1-estRatio)*100)}% smaller)`);
    console.log(`  Output: ${outputPath}`);
    return { outputPath, estSize };
  }

  console.log(`  Compressing with NVENC HEVC (CQ=${opts.quality})...`);

  const result = spawnSync('ffmpeg', ffArgs, { encoding: 'utf8', timeout: 600000 });

  if (result.status !== 0) {
    console.log(`  FAIL: ffmpeg exit ${result.status}`);
    if (result.stderr) console.log(`  ${result.stderr.substring(0, 300)}`);
    return null;
  }

  const outSize = fs.statSync(outputPath).size;
  const ratio = ((1 - outSize / probe.size) * 100).toFixed(1);

  console.log(`  Output: ${formatBytes(outSize)} (${ratio}% smaller)`);
  console.log(`  Saved: ${outputPath}`);

  return { outputPath, originalSize: probe.size, compressedSize: outSize, ratio };
}

function uploadToYouTube(filePath, title) {
  const baseTitle = path.basename(filePath, path.extname(filePath)).replace(/_pulsar$/, '');
  const result = spawnSync('python', [
    'scripts/vivy-youtube-upload.py',
    '--file', filePath,
    '--title', title || baseTitle,
    '--description', `Funesterie - ${baseTitle}. Compressed with Pulsar v5 (NVENC HEVC). https://funesterie.com`,
    '--tags', 'Funesterie,Djeff,Vivy,rap français,terminal noir',
    '--privacy-status', 'private',
  ], { encoding: 'utf8', timeout: 120000, cwd: process.cwd() });

  if (result.status === 0 && result.stdout.includes('"ok": true')) {
    console.log(`  YouTube: OK`);
    return true;
  }
  console.log(`  YouTube: FAIL - ${(result.stdout || result.stderr || '').substring(0, 100)}`);
  return false;
}

// Main
const opts = parseArgs(args);

console.log('========================================');
console.log('  PULSAR v5 — Red Matter Compressor');
console.log('  NVENC HEVC | RTX 5070 | Singularity Mode');
console.log('========================================\n');

// Batch mode
if (opts.batch) {
  const files = [];
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (/\.(mp4|mov|mkv|avi|webm)$/i.test(entry.name)) files.push(full);
    }
  };
  scan(opts.batch);
  console.log(`Found ${files.length} videos to compress\n`);

  let ok = 0, fail = 0, skip = 0;
  let totalOriginal = 0, totalCompressed = 0;

  for (const file of files) {
    console.log(`\n[${ok + fail + skip + 1}/${files.length}] ${path.basename(file)}`);
    const result = compressVideo(file, opts);
    if (result) {
      ok++;
      if (result.originalSize) { totalOriginal += result.originalSize; totalCompressed += result.compressedSize; }
      if (opts.upload) uploadToYouTube(result.outputPath);
    } else {
      fail++;
    }
  }

  console.log(`\n========================================`);
  console.log(`  PULSAR v5 COMPLETE`);
  console.log(`  Compressed: ${ok} | Failed: ${fail} | Skipped: ${skip}`);
  if (totalOriginal > 0) {
    console.log(`  Total: ${formatBytes(totalOriginal)} -> ${formatBytes(totalCompressed)} (${((1-totalCompressed/totalOriginal)*100).toFixed(1)}% reduction)`);
  }
  console.log(`========================================`);
} else if (opts.inputs.length > 0) {
  for (const input of opts.inputs) {
    if (!fs.existsSync(input)) {
      console.log(`Not found: ${input}`);
      continue;
    }
    console.log(`\nCompressing: ${path.basename(input)}`);
    const result = compressVideo(input, opts);
    if (result && opts.upload) {
      uploadToYouTube(result.outputPath);
    }
  }
} else {
  console.log('Usage: node pulsar-v5.cjs <input.mp4> [options]');
  console.log('       node pulsar-v5.cjs --batch <directory> [options]');
  console.log('\nOptions:');
  console.log('  --quality <0-51>    CQ (lower=better). Default: 30');
  console.log('  --max-height <px>    Max resolution. Default: 1080');
  console.log('  --audio-bitrate <k> Audio bitrate. Default: 128');
  console.log('  --output <path>     Output path');
  console.log('  --batch <dir>       Batch compress directory');
  console.log('  --dry-run           Preview without encoding');
  console.log('  --upload            Upload to YouTube after');
}
