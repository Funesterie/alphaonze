const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  hasSdProxyUrl,
  resolveSdScriptPath,
  resolveSdPythonBin,
  isForeignAbsolutePath,
  shouldAllowLocalSdFallback,
} = require('../lib/sd-runtime.cjs');

test('resolveSdPythonBin ignores a stale explicit path when a local adjacent venv exists', () => {
  const previousExplicit = process.env.SD_PYTHON_PATH;
  const previousFallbackFlag = process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-runtime-'));
  const scriptPath = path.join(tempRoot, 'generate_sd_image.py');
  const pythonPath = path.join(
    tempRoot,
    'venv',
    process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
  );

  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(scriptPath, '# test script\n', 'utf8');
  fs.writeFileSync(pythonPath, '', 'utf8');

  try {
    process.env.SD_PYTHON_PATH = path.join(tempRoot, 'missing', 'python.exe');
    process.env.A11_SD_ALLOW_LOCAL_FALLBACK = '1';

    assert.equal(resolveSdPythonBin(scriptPath), pythonPath);
  } finally {
    if (previousExplicit === undefined) delete process.env.SD_PYTHON_PATH;
    else process.env.SD_PYTHON_PATH = previousExplicit;

    if (previousFallbackFlag === undefined) delete process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
    else process.env.A11_SD_ALLOW_LOCAL_FALLBACK = previousFallbackFlag;

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('isForeignAbsolutePath treats windows absolute paths as foreign on linux runtimes', () => {
  const previousPlatform = process.platform;
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    assert.equal(isForeignAbsolutePath('D:\\funesterie\\a11\\llm\\scripts\\venv\\Scripts\\python.exe'), true);
    assert.equal(isForeignAbsolutePath('C:/Users/cella/Desktop/LLM/scripts/generate_sd_image.py'), true);
    assert.equal(isForeignAbsolutePath('/app/tools/sd/generate_sd_image.py'), false);
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform });
  }
});

test('resolveSdPythonBin ignores a windows explicit path on linux runtimes', () => {
  const previousExplicit = process.env.SD_PYTHON_PATH;
  const previousFallbackFlag = process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
  const previousPlatform = process.platform;

  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.SD_PYTHON_PATH = 'D:\\funesterie\\a11\\launchers\\dist\\a11-local\\llm\\scripts\\venv\\Scripts\\python.exe';
    process.env.A11_SD_ALLOW_LOCAL_FALLBACK = '1';

    assert.equal(resolveSdPythonBin('/app/tools/sd/generate_sd_image.py'), 'python3');
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform });
    if (previousExplicit === undefined) delete process.env.SD_PYTHON_PATH;
    else process.env.SD_PYTHON_PATH = previousExplicit;

    if (previousFallbackFlag === undefined) delete process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
    else process.env.A11_SD_ALLOW_LOCAL_FALLBACK = previousFallbackFlag;
  }
});

test('resolveSdScriptPath ignores a windows explicit path on linux runtimes', () => {
  const previousExplicit = process.env.SD_SCRIPT_PATH;
  const previousFallbackFlag = process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
  const previousPlatform = process.platform;

  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.SD_SCRIPT_PATH = 'D:\\funesterie\\a11\\backend\\apps\\server\\tools\\sd\\generate_sd_image.py';
    process.env.A11_SD_ALLOW_LOCAL_FALLBACK = '0';

    assert.equal(resolveSdScriptPath(), '');
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform });
    if (previousExplicit === undefined) delete process.env.SD_SCRIPT_PATH;
    else process.env.SD_SCRIPT_PATH = previousExplicit;

    if (previousFallbackFlag === undefined) delete process.env.A11_SD_ALLOW_LOCAL_FALLBACK;
    else process.env.A11_SD_ALLOW_LOCAL_FALLBACK = previousFallbackFlag;
  }
});

test('hasSdProxyUrl only considers SD proxy variables', () => {
  assert.equal(hasSdProxyUrl({ A11_SD_PROXY_URL: 'https://sd.example.com/api/tools/generate_sd' }), true);
  assert.equal(hasSdProxyUrl({ SD_PROXY_URL: 'https://sd.example.com/api/tools/generate_sd' }), true);
  assert.equal(hasSdProxyUrl({ A11_VISION_BASE_URL: 'https://vision.example.com' }), false);
});

test('shouldAllowLocalSdFallback keeps production proxy-only by default when SD proxy is configured', () => {
  assert.equal(shouldAllowLocalSdFallback({
    NODE_ENV: 'production',
    ENABLE_SD: 'true',
    A11_SD_PROXY_URL: 'https://sd.example.com/api/tools/generate_sd',
  }), false);

  assert.equal(shouldAllowLocalSdFallback({
    NODE_ENV: 'production',
    A11_SD_PROXY_URL: 'https://sd.example.com/api/tools/generate_sd',
    A11_SD_ALLOW_LOCAL_FALLBACK: 'true',
  }), true);
});
