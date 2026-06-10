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
const DEFAULT_COSY_ROOT = 'D:\\agent-bus\\voice\\CosyVoice';
const DEFAULT_COSY_PYTHON = path.join(DEFAULT_COSY_ROOT, '.venv', 'Scripts', 'python.exe');
const DEFAULT_PROMPT_AUDIO = path.join(DEFAULT_COSY_ROOT, 'outputs', 'djeff-ref-pignon-5s.wav');
const DEFAULT_SOURCE_AUDIO = 'C:\\Users\\Djeff\\Documents\\Audacity\\pignon.wav';
const DEFAULT_TEXT = 'Le moteur respire, le pignon répond, les rimes claquent en français. Je garde la route et la voix reste proche du micro.';

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  return String(args[index + 1] || '').trim();
}

function resolvePython(cosyRoot = DEFAULT_COSY_ROOT) {
  const configured = String(process.env.A11_COSYVOICE_PYTHON || '').trim();
  if (configured) return path.resolve(configured);
  return path.join(path.resolve(cosyRoot), '.venv', 'Scripts', 'python.exe');
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
        TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
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
      reject(new Error(`cosyvoice3_failed:${code}:${stderr.slice(-2400) || stdout.slice(-2400)}`));
    });
  });
}

function ensureShortPromptAudio({ ffmpegBin = 'ffmpeg', sourceAudio = DEFAULT_SOURCE_AUDIO, promptAudio = DEFAULT_PROMPT_AUDIO } = {}) {
  const target = path.resolve(promptAudio);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return Promise.resolve(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return runCommand(ffmpegBin, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    path.resolve(sourceAudio),
    '-t',
    '5.2',
    '-ac',
    '1',
    '-ar',
    '16000',
    target,
  ]).then(() => target);
}

function normalizeMode(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'cross' || raw === 'cross-lingual') return 'cross';
  if (raw === 'zero' || raw === 'zero-shot') return 'zero';
  return 'instruct';
}

async function renderDjeffCosyVoice3(options = {}) {
  const cosyRoot = path.resolve(options.cosyRoot || DEFAULT_COSY_ROOT);
  const python = resolvePython(cosyRoot);
  if (!fs.existsSync(python)) throw new Error(`cosyvoice_python_missing:${python}`);
  const outDir = path.resolve(options.outDir || DEFAULT_OUT_DIR);
  const workDir = path.resolve(options.workDir || path.join(outDir, '_cosyvoice-work'));
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  const promptAudio = await ensureShortPromptAudio({
    sourceAudio: options.sourceAudio || DEFAULT_SOURCE_AUDIO,
    promptAudio: options.promptAudio || DEFAULT_PROMPT_AUDIO,
  });
  const outputStem = sanitizeFilename(options.outputStem || `djeff-cosy3-${Date.now()}`, 'djeff-cosy3.wav').replace(/\.wav$/i, '');
  const mode = normalizeMode(options.mode);
  const baseOutput = path.join(workDir, `${outputStem}.${mode}.base.wav`);
  const runner = path.join(__dirname, 'render-djeff-cosyvoice3.py');

  await runCommand(python, [
    runner,
    '--cosy-root',
    cosyRoot,
    '--prompt-audio',
    promptAudio,
    '--text',
    options.text || DEFAULT_TEXT,
    '--mode',
    mode,
    '--output',
    baseOutput,
  ], { cwd: cosyRoot });

  if (!fs.existsSync(baseOutput) || fs.statSync(baseOutput).size <= 0) {
    throw new Error(`cosyvoice_output_missing:${baseOutput}`);
  }

  fs.copyFileSync(baseOutput, path.join(outDir, `${outputStem}.${mode}.base.wav`));
  const harmonic = await renderVariant(options.variant || DEFAULT_VARIANT, {
    sourcePath: baseOutput,
    outDir,
    outputName: `${outputStem}.${mode}.dh-${options.variant || DEFAULT_VARIANT}.wav`,
  });

  return {
    ok: true,
    provider: 'cosyvoice3',
    method: 'cosyvoice3-plus-djeff-double-harmonic-v1',
    mode,
    variant: harmonic.variant,
    baseAudio: baseOutput,
    finalAudio: harmonic.outputPath,
    url: harmonic.url,
    bytes: harmonic.bytes,
  };
}

async function main(argv = process.argv.slice(2)) {
  const result = await renderDjeffCosyVoice3({
    text: valueAfter(argv, '--text') || DEFAULT_TEXT,
    mode: valueAfter(argv, '--mode') || 'instruct',
    variant: valueAfter(argv, '--variant') || DEFAULT_VARIANT,
    outputStem: valueAfter(argv, '--output-stem') || 'djeff-cosy3-direct-test',
    outDir: valueAfter(argv, '--out-dir') || DEFAULT_OUT_DIR,
    cosyRoot: valueAfter(argv, '--cosy-root') || DEFAULT_COSY_ROOT,
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
  DEFAULT_COSY_PYTHON,
  DEFAULT_COSY_ROOT,
  DEFAULT_PROMPT_AUDIO,
  DEFAULT_TEXT,
  normalizeMode,
  renderDjeffCosyVoice3,
  resolvePython,
};
