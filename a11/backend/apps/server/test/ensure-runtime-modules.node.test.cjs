'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(SERVER_ROOT, 'scripts', 'ensure-runtime-modules.cjs');

test('ensure-runtime-modules resolves Rome from NODE_PATH', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-runtime-modules-'));
  const runtimeRoot = path.join(tempRoot, 'runtime');
  const nodePathRoot = path.join(tempRoot, 'node_modules');
  const romeRoot = path.join(nodePathRoot, '@nossen', 'rome');

  fs.mkdirSync(path.join(runtimeRoot, 'Corpus'), { recursive: true });
  fs.mkdirSync(path.join(romeRoot, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(romeRoot, 'package.json'),
    `${JSON.stringify({
      name: '@nossen/rome',
      version: '9.9.9-test',
      main: 'dist/index.js',
    }, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(path.join(romeRoot, 'dist', 'index.js'), "'use strict';\nmodule.exports = {};\n", 'utf8');

  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      A11_RUNTIME_ROOT: runtimeRoot,
      NODE_PATH: nodePathRoot,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  const rome = summary.modules.find((moduleInfo) => moduleInfo.id === 'rome');

  assert.equal(summary.ok, true);
  assert.equal(summary.minimumOk, true);
  assert.equal(rome.installed, true);
  assert.equal(rome.source, 'npm:@nossen/rome');
  assert.equal(rome.version, '9.9.9-test');
});
