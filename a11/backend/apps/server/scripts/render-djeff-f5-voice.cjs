'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  DEFAULT_VARIANT,
  renderVariant,
  sanitizeFilename,
} = require('./render-djeff-double-harmonic.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const BACKEND_ROOT = path.resolve(SERVER_ROOT, '..', '..');
const DEFAULT_OUT_DIR = path.join(BACKEND_ROOT, 'public', 'tts');
const DEFAULT_F5_ROOT = 'D:\\agent-bus\\voice\\F5-TTS';
const DEFAULT_REF_AUDIO = 'C:\\Users\\Djeff\\Documents\\Audacity\\pignon.wav';
const DEFAULT_REF_TEXT = "Un quatorzième dans l'essence, deux-point-deux dans la bombonne d'Ipone, je dose au millimètre, pas de hasard dans le style.";
const DEFAULT_TEXT = 'Je peux dire ce que je veux avec ma voix Djeff, sans passer par XTTS.';

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  return String(args[index + 1] || '').trim();
}

function resolveF5Cli(f5Root = DEFAULT_F5_ROOT) {
  const configured = String(process.env.A11_F5_TTS_CLI || '').trim();
  if (configured) return path.resolve(configured);
  return path.join(path.resolve(f5Root), '.venv', 'Scripts', 'f5-tts_infer-cli.exe');
}

function buildF5Args({
  model = 'F5TTS_v1_Base',
  refAudio = DEFAULT_REF_AUDIO,
  refText = DEFAULT_REF_TEXT,
  genText = DEFAULT_TEXT,
  outputDir,
  outputFile,
} = {}) {
  return [
    '--model',
    model,
    '--ref_audio',
    refAudio,
    '--ref_text',
    refText,
    '--gen_text',
    genText,
    '--output_dir',
    outputDir,
    '--output_file',
    outputFile,
  ];
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        ...(options.env || {}),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on?.('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr?.on?.('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      return reject(new Error(`f5_tts_failed:${code}:${stderr.slice(-2000) || stdout.slice(-2000)}`));
    });
  });
}

async function renderDjeffF5Voice(options = {}) {
  const outDir = path.resolve(options.outDir || DEFAULT_OUT_DIR);
  const workDir = path.resolve(options.workDir || path.join(outDir, '_f5-work'));
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  const f5Root = path.resolve(options.f5Root || DEFAULT_F5_ROOT);
  const f5Cli = resolveF5Cli(f5Root);
  if (!fs.existsSync(f5Cli)) throw new Error(`f5_cli_missing:${f5Cli}`);

  const outputStem = sanitizeFilename(options.outputStem || `djeff-f5-${Date.now()}`, 'djeff-f5.wav').replace(/\.wav$/i, '');
  const f5OutputFile = `${outputStem}.base.wav`;
  const f5OutputPath = path.join(workDir, f5OutputFile);
  const variant = options.variant || DEFAULT_VARIANT;
  const finalOutputName = `${outputStem}.dh-${variant}.wav`;

  await runCommand(f5Cli, buildF5Args({
    model: options.model || 'F5TTS_v1_Base',
    refAudio: path.resolve(options.refAudio || DEFAULT_REF_AUDIO),
    refText: options.refText || DEFAULT_REF_TEXT,
    genText: options.text || DEFAULT_TEXT,
    outputDir: workDir,
    outputFile: f5OutputFile,
  }), { cwd: f5Root });

  if (!fs.existsSync(f5OutputPath) || fs.statSync(f5OutputPath).size <= 0) {
    throw new Error(`f5_output_missing:${f5OutputPath}`);
  }

  const harmonic = await renderVariant(variant, {
    sourcePath: f5OutputPath,
    outDir,
    outputName: finalOutputName,
  });

  return {
    ok: true,
    provider: 'f5-tts',
    method: 'f5-text-to-speech-plus-djeff-double-harmonic-v1',
    text: options.text || DEFAULT_TEXT,
    baseAudio: f5OutputPath,
    finalAudio: harmonic.outputPath,
    url: harmonic.url,
    variant: harmonic.variant,
    bytes: harmonic.bytes,
  };
}

async function main(argv = process.argv.slice(2)) {
  const result = await renderDjeffF5Voice({
    text: valueAfter(argv, '--text') || DEFAULT_TEXT,
    refAudio: valueAfter(argv, '--ref-audio') || DEFAULT_REF_AUDIO,
    refText: valueAfter(argv, '--ref-text') || DEFAULT_REF_TEXT,
    outDir: valueAfter(argv, '--out-dir') || DEFAULT_OUT_DIR,
    workDir: valueAfter(argv, '--work-dir') || '',
    outputStem: valueAfter(argv, '--output-stem') || 'djeff-f5-smoke',
    variant: valueAfter(argv, '--variant') || DEFAULT_VARIANT,
    f5Root: valueAfter(argv, '--f5-root') || DEFAULT_F5_ROOT,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_F5_ROOT,
  DEFAULT_REF_AUDIO,
  DEFAULT_REF_TEXT,
  buildF5Args,
  renderDjeffF5Voice,
  resolveF5Cli,
};
