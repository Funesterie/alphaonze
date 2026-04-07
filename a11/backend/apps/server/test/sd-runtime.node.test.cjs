const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveSdPythonBin,
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
