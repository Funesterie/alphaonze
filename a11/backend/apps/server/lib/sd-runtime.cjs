const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  detectPromptLanguageProfile,
} = require('../src/mask/build-sd-prompt-bundle.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const VENDORED_SD_SCRIPT = path.join(SERVER_ROOT, 'tools', 'sd', 'generate_sd_image.py');
const BACKEND_SD_VENV = path.join(
  SERVER_ROOT,
  'tools',
  'sd',
  'venv',
  process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
);

function normalizePromptText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countPromptClauses(value = '') {
  return normalizePromptText(value)
    .split(/[.!?;:\n]+/)
    .map((entry) => normalizePromptText(entry))
    .filter(Boolean)
    .length;
}

function analyzePromptDensity(value = '') {
  const text = normalizePromptText(value);
  return {
    length: text.length,
    words: text ? text.split(/\s+/).filter(Boolean).length : 0,
    clauses: countPromptClauses(text),
    commas: (text.match(/,/g) || []).length,
  };
}

function isRichPromptForTranslation(value = '') {
  const density = analyzePromptDensity(value);
  return (
    density.length >= 260
    || density.words >= 45
    || density.clauses >= 5
    || (density.length >= 220 && density.commas >= 5)
  );
}

function isOvercompressedPromptTranslation(source = '', translated = '') {
  const sourceDensity = analyzePromptDensity(source);
  const translatedDensity = analyzePromptDensity(translated);
  if (!sourceDensity.length || !translatedDensity.length) return false;
  if (!isRichPromptForTranslation(source)) return false;

  if (translatedDensity.length < Math.max(220, Math.round(sourceDensity.length * 0.72))) {
    return true;
  }
  if (translatedDensity.words < Math.max(38, Math.round(sourceDensity.words * 0.7))) {
    return true;
  }
  if (translatedDensity.clauses < Math.max(4, Math.round(sourceDensity.clauses * 0.72))) {
    return true;
  }

  return false;
}

function isAcceptableEnglishTranslation(value = '', { allowMixed = false } = {}) {
  const text = normalizePromptText(value);
  if (!text) return false;
  const profile = typeof detectPromptLanguageProfile === 'function'
    ? detectPromptLanguageProfile(text)
    : { dominant: 'unknown', mixed: false };
  if (
    profile?.dominant === 'en'
    && (
      allowMixed
      || profile?.mixed !== true
      || Number(profile?.englishScore || 0) >= Number(profile?.frenchScore || 0) + 6
    )
  ) {
    return true;
  }
  return false;
}

async function requestEnglishPromptTranslation({
  ollamaBase = '',
  model = '',
  raw = '',
  previousRejected = '',
} = {}) {
  const systemPrompt = previousRejected
    ? [
        'You translate image-generation prompts into natural English for Stable Diffusion.',
        'A previous translation attempt was rejected because it was too short or lost important details.',
        'Rewrite from the original source, not from the rejected candidate.',
        'Preserve every concrete detail and constraint from the source prompt.',
        'Do not summarize, condense, simplify, shorten, merge away details, or omit constraints.',
        'Preserve subject count, identity locks, face, body, pose, framing, outfit, props, environment, lighting, palette, mood, style, and all negative constraints.',
        'If the source is rich and long, the translation must stay rich and long.',
        'Output only the final English prompt.',
      ].join(' ')
    : [
        'You translate image-generation prompts into natural English for Stable Diffusion.',
        'Preserve every concrete detail and constraint from the source prompt.',
        'Do not summarize, condense, simplify, shorten, merge away details, or omit constraints.',
        'Preserve subject count, identity locks, face, body, pose, framing, outfit, props, environment, lighting, palette, mood, style, and all negative constraints.',
        'If the source is rich and long, the translation should stay rich and long.',
        'Output only the final English prompt.',
      ].join(' ');

  const userPrompt = [
    'Translate the following image-generation prompt into clean natural English for Stable Diffusion.',
    'Keep all useful concrete details.',
    'Never summarize or compress it.',
    '',
    previousRejected ? 'Rejected translation candidate (too short, do not imitate it):' : '',
    previousRejected || '',
    previousRejected ? '' : '',
    'Source prompt:',
    raw,
  ].filter(Boolean).join('\n');

  const resp = await fetch(`${ollamaBase}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options: {
        temperature: 0.1,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return '';
  const data = await resp.json();
  return normalizePromptText(data?.message?.content || '');
}

async function translatePromptToEnglish(prompt) {
  const raw = String(prompt || '').trim();
  if (!raw) return raw;
  const sourceProfile = typeof detectPromptLanguageProfile === 'function'
    ? detectPromptLanguageProfile(raw)
    : { dominant: 'unknown', mixed: false };
  const needsEnglishNormalization = sourceProfile?.dominant === 'fr' || sourceProfile?.mixed === true;
  if (!needsEnglishNormalization) return raw;

  const ollamaBase = String(process.env.OLLAMA_BASE || 'http://127.0.0.1:11434').trim();
  const model = String(process.env.A11_OLLAMA_PRIMARY_MODEL || 'gemma4:e4b').trim();
  try {
    let translated = await requestEnglishPromptTranslation({
      ollamaBase,
      model,
      raw,
    });
    if (
      translated
      && translated.length > 3
      && isAcceptableEnglishTranslation(translated)
      && !isOvercompressedPromptTranslation(raw, translated)
    ) {
      console.log('[SD][PROMPT_TRANSLATE]', translated);
      return translated;
    }
    translated = await requestEnglishPromptTranslation({
      ollamaBase,
      model,
      raw,
      previousRejected: translated,
    });
    if (
      translated
      && translated.length > 3
      && isAcceptableEnglishTranslation(translated)
      && !isOvercompressedPromptTranslation(raw, translated)
    ) {
      console.log('[SD][PROMPT_TRANSLATE]', translated);
      return translated;
    }
  } catch {
    // fallback silencieux
  }
  return raw;
}

function isWindowsDrivePath(value = '') {
  return /^[a-zA-Z]:[\\/]/.test(String(value || '').trim());
}

function isWindowsUncPath(value = '') {
  return /^\\\\[^\\]+\\[^\\]+/.test(String(value || '').trim());
}

function isForeignAbsolutePath(value = '', platform = process.platform) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (platform === 'win32') {
    return false;
  }
  return isWindowsDrivePath(raw) || isWindowsUncPath(raw);
}

function normalizeCandidate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isForeignAbsolutePath(raw)) return '';
  return path.resolve(raw);
}

function uniqueCandidates(values) {
  return [...new Set(values.map(normalizeCandidate).filter(Boolean))];
}

function isProductionRuntime(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function toBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function hasSdProxyUrl(env = process.env) {
  return [env.A11_SD_PROXY_URL, env.SD_PROXY_URL]
    .map((value) => String(value || '').trim())
    .some(Boolean);
}

function isExplicitLocalRuntime(env = process.env) {
  return toBoolean(env.A11_LOCAL_MODE) || String(env.A11_RUNTIME_PROFILE || '').trim().toLowerCase() === 'local';
}

function shouldAllowLocalSdFallback(env = process.env) {
  if (String(env.A11_SD_ALLOW_LOCAL_FALLBACK || '').trim() !== '') {
    return toBoolean(env.A11_SD_ALLOW_LOCAL_FALLBACK);
  }
  if (!isProductionRuntime(env)) {
    return true;
  }

  if (hasSdProxyUrl(env) && !isExplicitLocalRuntime(env)) {
    return false;
  }

  if (toBoolean(env.ENABLE_SD)) {
    return true;
  }

  if (isExplicitLocalRuntime(env)) {
    return true;
  }

  if (String(env.SD_SCRIPT_PATH || '').trim() || String(env.SD_PYTHON_PATH || '').trim()) {
    return true;
  }

  return false;
}

function resolveSdProxyUrl() {
  return [
    process.env.A11_SD_PROXY_URL,
    process.env.SD_PROXY_URL,
  ].map((value) => String(value || '').trim()).find(Boolean) || '';
}

function resolveSdScriptPath() {
  const explicit = normalizeCandidate(process.env.SD_SCRIPT_PATH || '');
  const allowLocalFallback = shouldAllowLocalSdFallback(process.env);
  const candidates = uniqueCandidates([
    ...(allowLocalFallback ? [
      explicit,
      VENDORED_SD_SCRIPT,
    ] : [explicit]),
  ]);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (!allowLocalFallback) {
    return explicit || '';
  }

  return explicit || normalizeCandidate(VENDORED_SD_SCRIPT) || VENDORED_SD_SCRIPT;
}

function resolveSdPythonBin(scriptPath = '') {
  const explicit = normalizeCandidate(process.env.SD_PYTHON_PATH || '');
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  if (!shouldAllowLocalSdFallback(process.env)) {
    return explicit || '';
  }

  const scriptDir = scriptPath && fs.existsSync(scriptPath) ? path.dirname(scriptPath) : '';
  const adjacentVenv = scriptDir
    ? (process.platform === 'win32'
      ? path.join(scriptDir, 'venv', 'Scripts', 'python.exe')
      : path.join(scriptDir, 'venv', 'bin', 'python'))
    : '';

  const candidates = uniqueCandidates([
    explicit,
    adjacentVenv,
    BACKEND_SD_VENV,
  ]);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return explicit || (process.platform === 'win32' ? 'python' : 'python3');
}

function sanitizeProxyHeaders(headers = {}) {
  const forwarded = {};
  for (const headerName of ['authorization', 'x-nez-admin', 'x-nez-token']) {
    const value = headers?.[headerName];
    if (typeof value === 'string' && value.trim()) {
      forwarded[headerName] = value;
    }
  }
  return forwarded;
}

function normalizeSdModelProfile(value = '') {
  const profile = String(value || '').trim().toLowerCase();
  if (!profile) return '';
  if (['sd35', 'sd3.5', 'sd35-medium', 'stable-diffusion-3.5', 'stable-diffusion-3.5-medium'].includes(profile)) {
    return 'sd35';
  }
  if (['sd35large', 'sd35-large', 'sd3.5-large', 'stable-diffusion-3.5-large'].includes(profile)) {
    return 'sd35large';
  }
  if (['sd35turbo', 'sd35-turbo', 'sd3.5-turbo', 'stable-diffusion-3.5-large-turbo'].includes(profile)) {
    return 'sd35turbo';
  }
  if (['multilingual', 'alt'].includes(profile)) {
    return 'multilingual';
  }
  if (['classic', 'sd15', 'v1.5'].includes(profile)) {
    return 'classic';
  }
  return profile;
}

async function invokeSdProxy(payload = {}, options = {}) {
  const proxyUrl = resolveSdProxyUrl();
  if (!proxyUrl) {
    return { ok: false, skipped: true, error: 'sd_proxy_unconfigured' };
  }
  if (typeof fetch !== 'function') {
    throw new Error('fetch_unavailable');
  }

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...sanitizeProxyHeaders(options.headers || {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    body,
    proxyUrl,
  };
}

async function runSdScript(payload = {}, options = {}) {

  const scriptPath = options.scriptPath || resolveSdScriptPath();
  const pythonBin = options.pythonBin || resolveSdPythonBin(scriptPath);
  const outputPath = String(payload.output || payload.outputPath || '').trim();
  const rawPrompt = String(payload.prompt || '').trim();
  const finalPrompt = await translatePromptToEnglish(rawPrompt);
  const finalPrompt2 = String(payload.prompt_2 || payload.prompt2 || '').trim();
  const finalPrompt3 = String(payload.prompt_3 || payload.prompt3 || '').trim();
  const finalNegativePrompt2 = String(payload.negative_prompt_2 || payload.negativePrompt2 || '').trim();
  const finalNegativePrompt3 = String(payload.negative_prompt_3 || payload.negativePrompt3 || '').trim();

  console.log('[DEBUG][IMAGE][FINAL_PROMPT]', finalPrompt);
  if (finalPrompt2) {
    console.log('[DEBUG][IMAGE][FINAL_PROMPT_2]', finalPrompt2);
  }
  if (finalPrompt3) {
    console.log('[DEBUG][IMAGE][FINAL_PROMPT_3]', finalPrompt3);
  }
  console.log('[DEBUG][IMAGE][OUTPUT]', outputPath || '(none)');
  console.log(
    '[DEBUG][IMAGE][SIZE]',
    `${Number(payload.width || 0) || 0}x${Number(payload.height || 0) || 0}`,
    `source=${String(payload.size_source || 'unknown').trim() || 'unknown'}`,
    `reason=${String(payload.size_reason || 'n/a').trim() || 'n/a'}`
  );
  const requestedModelProfile = normalizeSdModelProfile(
    payload.model_profile
    || payload.modelProfile
    || payload.sd_model_profile
  );
  if (requestedModelProfile) {
    console.log('[DEBUG][IMAGE][MODEL_PROFILE]', requestedModelProfile);
  }
  console.log('[DEBUG][IMAGE][PYTHON]', pythonBin);
  console.log('[DEBUG][IMAGE][SCRIPT]', scriptPath);

  if (!scriptPath || !fs.existsSync(scriptPath)) {
    return Promise.resolve({ ok: false, error: 'sd_unavailable', scriptPath });
  }
  if (!outputPath) {
    return Promise.resolve({ ok: false, error: 'missing_output_path', scriptPath });
  }

  const args = [
    scriptPath,
    '--prompt', finalPrompt,
    '--num_inference_steps', String(Number(payload.num_inference_steps || payload.numInferenceSteps || 35) || 35),
    '--guidance_scale', String(Number(payload.guidance_scale || payload.guidanceScale || 8.0) || 8.0),
    '--width', String(Number(payload.width || 768) || 768),
    '--height', String(Number(payload.height || 768) || 768),
    '--output', outputPath,
  ];
  if (finalPrompt2) {
    args.push('--prompt_2', finalPrompt2);
  }
  if (finalPrompt3) {
    args.push('--prompt_3', finalPrompt3);
  }

  if (payload.negative_prompt !== undefined && payload.negative_prompt !== null) {
    const negativePrompt = String(payload.negative_prompt || '').trim();
    if (negativePrompt) {
      args.push('--negative_prompt', negativePrompt);
    }
  }
  if (finalNegativePrompt2) {
    args.push('--negative_prompt_2', finalNegativePrompt2);
  }
  if (finalNegativePrompt3) {
    args.push('--negative_prompt_3', finalNegativePrompt3);
  }

  const initImage = String(
    payload.init_image
    || payload.initImage
    || payload.init_image_url
    || payload.initImageUrl
    || payload.reference_image_url
    || payload.referenceImageUrl
    || ''
  ).trim();
  if (initImage) {
    args.push('--init_image', initImage);
  }

  const resolvedStrength = Number(
    payload.strength_value !== undefined
      ? payload.strength_value
      : payload.strength
  );
  if (Number.isFinite(resolvedStrength)) {
    args.push('--strength', String(resolvedStrength).trim());
  }

  if (payload.seed !== undefined && payload.seed !== null && String(payload.seed).trim() !== '') {
    args.push('--seed', String(payload.seed).trim());
  }

  return new Promise((resolve) => {
    const sdEnv = {
      ...process.env,
      SD_MODEL_PROFILE: requestedModelProfile || String(process.env.SD_MODEL_PROFILE || 'sd35').trim(),
    };
    const py = spawn(pythonBin, args, { cwd: path.dirname(scriptPath), env: sdEnv });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);

    py.stdout.on('data', (data) => { stdout = Buffer.concat([stdout, data]); });
    py.stderr.on('data', (data) => { stderr = Buffer.concat([stderr, data]); });
    py.on('error', (error_) => {
      resolve({
        ok: false,
        error: 'python_spawn_failed',
        message: String(error_?.message || error_),
        scriptPath,
        pythonBin,
      });
    });
    py.on('close', (code, signal) => {
      if (code !== 0) {
        const exitCode = Number.isInteger(code) ? code : null;
        const signalLabel = String(signal || '').trim() || null;
        return resolve({
          ok: false,
          error: 'python_failed',
          message: signalLabel
            ? `python_signal_${signalLabel}`
            : `python_exit_${exitCode ?? 'unknown'}`,
          stderr: stderr.toString(),
          stdout: stdout.toString(),
          exitCode,
          signal: signalLabel,
          scriptPath,
          pythonBin,
        });
      }
      try {
        const parsed = JSON.parse(stdout.toString() || '{}');
        // Log the full JSON output from the Python script
        console.log('[SD][PYTHON][JSON_OUTPUT]', JSON.stringify(parsed, null, 2));
        return resolve({
          ...parsed,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          scriptPath,
          pythonBin,
        });
      } catch (error_) {
        return resolve({
          ok: false,
          error: 'bad_python_output',
          message: String(error_?.message || error_),
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          scriptPath,
          pythonBin,
        });
      }
    });
  });
}

module.exports = {
  resolveSdProxyUrl,
  resolveSdScriptPath,
  resolveSdPythonBin,
  invokeSdProxy,
  runSdScript,
  sanitizeProxyHeaders,
  VENDORED_SD_SCRIPT,
  BACKEND_SD_VENV,
  shouldAllowLocalSdFallback,
  isForeignAbsolutePath,
  hasSdProxyUrl,
};
