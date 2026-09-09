'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../src/clips/clip-vivy-director.cjs');
const source = fs.readFileSync(filename, 'utf8');
function loadDirector({ status = 200, data, sequence = 'openai/gpt-4o' }) {
  const calls = [];
  const https = { request(url, options, callback) {
    const req = new EventEmitter();
    req.write = body => calls.push({ url: String(url), options, body: JSON.parse(body) });
    req.destroy = () => {};
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter();
      res.statusCode = status;
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify(data)));
      res.emit('end');
    });
    return req;
  } };
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, require: name => name === 'https' ? https : realRequire(name),
    process: { env: { NOSSEN_SEQUENCE_MODEL: sequence, OPENROUTER_API_KEY: 'test-only-router', NOSSEN_OPENAI_API_KEY: 'test-only-direct' } },
    URL, Buffer, console: { log() {}, warn() {} },
  }, { filename });
  return { director: module.exports, calls };
}
test('sequence provider is explicit and preserves the same GPT model through OpenRouter', async () => {
  const plans = Array.from({ length: 3 }, (_, i) => ({ name: `Plan ${i}`, visual: `Performer crosses the stage, shot ${i}.` }));
  const { director, calls } = loadDirector({ data: { choices: [{ message: { content: JSON.stringify({ lieu: 'stage', plans }) } }] } });
  const scenes = await director.generateVisualScenes('Test', '', '', '', [], null, '', '', null);
  assert.equal(scenes.length, 3);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].body.model, 'openai/gpt-4o');
});
test('invalid credentials stop scenarisation instead of silently purchasing generic video scenes', async () => {
  const { director, calls } = loadDirector({ status: 401, sequence: 'gpt-4o', data: { error: { message: 'Incorrect API key: secret-fragment' } } });
  await assert.rejects(director.generateVisualScenes('Test', '', '', '', [], null, '', '', null), err => {
    assert.match(err.message, /Scénarisation gpt-4o impossible.*HTTP 401/);
    assert.doesNotMatch(err.message, /secret-fragment/);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
});
test('malformed sequence response is actionable, not a generic success', async () => {
  const { director } = loadDirector({ data: { choices: [{ message: { content: '{}' } }] } });
  await assert.rejects(director.generateVisualScenes('Test', '', '', '', [], null, '', '', null), /trois plans exploitables/);
});
test('audio teardown resolver refuses arbitrary local paths and foreign hosts', () => {
  const { director } = loadDirector({ data: {} });
  assert.equal(director.resolveLocalAudioPath(filename), null);
  assert.equal(director.resolveLocalAudioPath('https://example.org/api/mcp-bridge/play-upload/a.mp3'), null);
  assert.equal(director.resolveLocalAudioPath('https://a11.funesterie.me:8443/api/mcp-bridge/play-upload/a.mp3'), null);
});
