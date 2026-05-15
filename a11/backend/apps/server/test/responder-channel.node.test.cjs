'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createResponderState,
  startResponderChannel,
} = require('../src/responder-channel.cjs');

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

async function withResponderChannel(options, runAssertions) {
  const channel = await startResponderChannel({
    enabled: true,
    host: '127.0.0.1',
    port: 0,
    logger: {
      log() {},
      warn() {},
    },
    ...options,
  });

  const baseUrl = `http://127.0.0.1:${channel.port}`;
  try {
    await runAssertions({ channel, baseUrl });
  } finally {
    await channel.close();
  }
}

test('responder channel ignores unrelated messages in heuristic mode', async () => {
  const state = createResponderState({ mode: 'heuristic' });
  let invokeCount = 0;

  await withResponderChannel(
    {
      state,
      mode: 'heuristic',
      async invokeChat() {
        invokeCount += 1;
        return 'should_not_be_called';
      },
    },
    async ({ baseUrl }) => {
      const { response, json } = await postJson(baseUrl, '/message', {
        message: 'il pleut dehors',
      });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.replied, false);
      assert.equal(json.decision.modeUsed, 'heuristic');
      assert.equal(json.decision.reason, 'heuristic_skip');
      assert.equal(invokeCount, 0);
    }
  );
});

test('responder channel replies on direct A11 mention in heuristic mode', async () => {
  const state = createResponderState({ mode: 'heuristic' });

  await withResponderChannel(
    {
      state,
      mode: 'heuristic',
      async invokeChat(payload) {
        assert.equal(payload.message, 'A11, réponds-moi.');
        return 'Réponse A11';
      },
    },
    async ({ baseUrl, channel }) => {
      const { response, json } = await postJson(baseUrl, '/message', {
        message: 'A11, réponds-moi.',
      });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.replied, true);
      assert.equal(json.assistant, 'Réponse A11');
      assert.equal(json.decision.reason, 'direct_mention');
      assert.equal(channel.state.repliedCount, 1);
    }
  );
});

test('responder channel protects mode changes with a token and applies always mode', async () => {
  const state = createResponderState({ mode: 'off' });

  await withResponderChannel(
    {
      state,
      mode: 'off',
      token: 'token-3002',
      async invokeChat() {
        return 'Réponse forcée';
      },
    },
    async ({ baseUrl }) => {
      const unauthorized = await postJson(baseUrl, '/mode', { mode: 'always' });
      assert.equal(unauthorized.response.status, 401);

      const updated = await postJson(
        baseUrl,
        '/mode',
        { mode: 'always' },
        { 'x-a11-responder-token': 'token-3002' }
      );
      assert.equal(updated.response.status, 200);
      assert.equal(updated.json.mode, 'always');

      const replied = await postJson(
        baseUrl,
        '/message',
        { message: 'message neutre' },
        { 'x-a11-responder-token': 'token-3002' }
      );
      assert.equal(replied.response.status, 200);
      assert.equal(replied.json.replied, true);
      assert.equal(replied.json.assistant, 'Réponse forcée');
      assert.equal(replied.json.decision.reason, 'mode_always');
    }
  );
});
