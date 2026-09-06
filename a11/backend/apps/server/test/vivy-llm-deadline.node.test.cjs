'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createVivyBundleCompletion } = require('../src/routes/vivy-studio.cjs');

test('le plafond LLM coupe les retries caches du SDK', async () => {
  let requestOptions = null;
  const bundle = {
    provider: 'cerbere',
    model: 'test-model',
    client: {
      chat: {
        completions: {
          create: async (_body, options) => {
            requestOptions = options;
            await new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            });
          },
        },
      },
    },
  };

  const start = Date.now();
  await assert.rejects(
    () => createVivyBundleCompletion(bundle, { messages: [] }, {
      deadlineAt: Date.now() + 650,
      attemptTimeoutMs: 5000,
    }),
    /vivy_llm_deadline_exceeded/
  );
  assert.equal(requestOptions.maxRetries, 0);
  assert.ok(requestOptions.signal, 'un signal d abandon doit couvrir tout le SDK');
  assert.ok(Date.now() - start < 1200, 'le plafond ne doit pas attendre les retries du SDK');
});
