'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const chatRoute = require('../src/routes/chat.cjs');

function withEnv(values, fn) {
  const keys = Object.keys(values);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = String(value);
      }
    }
    return fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('chat route keeps local interactive timeout bounded', () => {
  withEnv({
    A11_LOCAL_CHAT_TIMEOUT_MS: null,
    A11_OLLAMA_CHAT_TIMEOUT_MS: null,
  }, () => {
    assert.equal(chatRoute.resolveLocalChatTimeoutMs(), 18_000);
  });

  withEnv({
    A11_LOCAL_CHAT_TIMEOUT_MS: '12000',
    A11_OLLAMA_CHAT_TIMEOUT_MS: null,
  }, () => {
    assert.equal(chatRoute.resolveLocalChatTimeoutMs(), 12_000);
  });

  withEnv({
    A11_LOCAL_CHAT_TIMEOUT_MS: '180000',
    A11_OLLAMA_CHAT_TIMEOUT_MS: null,
  }, () => {
    assert.equal(chatRoute.resolveLocalChatTimeoutMs(), 45_000);
  });
});
