'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { encodeZenFileAsync } = require('../src/index.cjs');

test('public CLI verifies safely as JSON and rejects a wrong key', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-zen-cli-'));
  const inputPath = path.join(directory, 'private.txt');
  const archivePath = path.join(directory, 'private.zen');
  const key = 'cli-public-secret';
  fs.writeFileSync(inputPath, 'decoded-private-value');
  await encodeZenFileAsync(inputPath, archivePath, { key });

  const bin = path.join(__dirname, '..', 'bin', 'nossen-zen.cjs');
  const ok = spawnSync(process.execPath, [bin, 'verify', '--in', archivePath, '--key-env', 'ZEN_CLI_TEST_KEY', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ZEN_CLI_TEST_KEY: key, ZEN_KEY: '' }
  });
  assert.equal(ok.status, 0, ok.stderr);
  const result = JSON.parse(ok.stdout);
  assert.equal(result.valid, true);
  assert.equal(result.format, 'zen');
  assert.equal(ok.stdout.includes(key), false);
  assert.equal(ok.stdout.includes('decoded-private-value'), false);

  const wrong = spawnSync(process.execPath, [bin, 'verify', '--in', archivePath, '--key-env', 'ZEN_CLI_TEST_KEY', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ZEN_CLI_TEST_KEY: 'wrong', ZEN_KEY: '' }
  });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /ZEN_ERR_AUTH/);
  assert.equal(wrong.stderr.includes(key), false);
});
