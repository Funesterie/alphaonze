const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = path.join(os.tmpdir(), `vivy-stream-test-${process.pid}`);
process.env.A11_RUNTIME_ROOT = path.join(tmpRoot, 'runtime');
process.env.VIVY_STREAM_ALLOW_UNSIGNED = '1';

const {
  buildOverlayHtml,
  createVivyStreamRouter,
  parseVivyStreamChatMessage,
} = require('../src/routes/vivy-stream.cjs');
const {
  ANNOUNCE_MESSAGES,
  createAnnouncementRotator,
  parsePrivmsg,
  resolveAnnounceInterval,
  shouldForwardMessage,
} = require('../scripts/vivy-twitch-chat-worker.cjs');

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function withServer({ stateName = 'state.json' } = {}, runAssertions) {
  const app = express();
  const statePath = path.join(tmpRoot, stateName);
  app.use('/api/vivy/stream', createVivyStreamRouter({ statePath }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runAssertions(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(baseUrl, route, body, headers = {}) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

test('Vivy stream parser detects suggestions, votes and star ratings', () => {
  const suggestion = parseVivyStreamChatMessage({
    username: 'René',
    message: '!nossen Bleach opening nerveux avec Ichigo et Rukia',
  });
  assert.equal(suggestion.author, 'René');
  assert.equal(suggestion.suggestion, 'Bleach opening nerveux avec Ichigo et Rukia');

  const vote = parseVivyStreamChatMessage({ username: 'chat', message: '!vote S12' });
  assert.equal(vote.voteTargetId, 'S12');

  const stars = parseVivyStreamChatMessage({ username: 'chat', message: '!etoiles 5 S12' });
  assert.deepEqual(stars.star, { rating: 5, targetId: 'S12' });

  const emojiStars = parseVivyStreamChatMessage({ username: 'chat', message: '⭐⭐⭐⭐' });
  assert.deepEqual(emojiStars.star, { rating: 4, targetId: '' });
});

test('Vivy stream route stores Twitch ideas, votes, stars and builds a NOSSEN seed', async () => {
  await withServer({ stateName: 'round.json' }, async (baseUrl) => {
    let result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'renedoran',
      message: '!nossen Bleach opening sombre, Ichigo contre Soul Society, riffs tranchants',
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.action, 'suggestion');
    assert.equal(result.json.suggestion.id, 'S1');
    assert.equal(result.json.state.current.phase, 'voting');
    assert.ok(Date.parse(result.json.state.round.endsAt) - Date.parse(result.json.state.round.startedAt) >= 44_000);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'aizenfan',
      message: '!vote S1',
    });
    assert.equal(result.json.action, 'vote');
    assert.equal(result.json.vote.id, 'S1');
    assert.equal(result.json.vote.votes, 2);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'rukia',
      message: '!etoiles 5 S1',
    });
    assert.equal(result.json.action, 'star');
    assert.equal(result.json.star.rating, 5);

    result = await postJson(baseUrl, '/api/vivy/stream/round/lock', {});
    assert.equal(result.response.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.winner.id, 'S1');
    assert.equal(result.json.state.current.phase, 'winner');
    assert.equal(result.json.state.round.status, 'locked');
    assert.match(result.json.nossenSeed.canvas, /Bleach opening sombre/);
    assert.match(result.json.nossenSeed.canvas, /ichigo|bleach/i);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'late-listener',
      message: '!etoiles 4',
    });
    assert.equal(result.json.action, 'star');
    assert.equal(result.json.state.round.status, 'locked');
    assert.equal(result.json.state.round.winningSuggestionId, 'S1');
  });
});

test('Vivy stream control drives production, presentation and playback metadata', async () => {
  await withServer({ stateName: 'control.json' }, async (baseUrl) => {
    await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'funeste38',
      message: '!nossen Les lumières de la ville, électro nocturne',
    });
    await postJson(baseUrl, '/api/vivy/stream/round/lock', {});

    let result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'progress',
      stage: 'lyrics',
      progress: 62,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.current.phase, 'composing');
    assert.equal(result.json.state.production.stages.analysis.progress, 100);
    assert.equal(result.json.state.production.stages.lyrics.progress, 62);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'late-topic',
      message: '!nossen Cette idée doit attendre le prochain round',
    });
    assert.equal(result.json.action, 'suggestion_ignored');
    assert.equal(result.json.state.round.status, 'locked');
    assert.equal(result.json.state.round.suggestions.length, 1);

    result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'ready',
      title: 'Les lumières de la ville',
      trackUrl: '/api/double-harmonic/out/live.mp3',
      durationSeconds: 222,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.current.phase, 'presenting');
    assert.equal(result.json.state.current.durationSeconds, 222);
    assert.equal(result.json.state.current.requestedBy, 'funeste38');

    await postJson(baseUrl, '/api/vivy/stream/control', { action: 'next' });
    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'next-round',
      message: '!nossen Nouveau thème du prochain round',
    });
    assert.equal(result.json.suggestion.id, 'S1');
    assert.equal(result.json.state.stats.suggestions, 2);
  });
});

test('Vivy live overlay contains the production show and bundled background', () => {
  const html = buildOverlayHtml();
  assert.match(html, /vivy-presence-musicale|overlay\/background/);
  assert.match(html, /VIVY LIVE/);
  assert.match(html, /Analyse du thème/);
  assert.match(html, /!etoiles 5/);
  assert.match(html, /Lecture en cours/);
});

test('Vivy stream write guard requires the shared secret when configured', async () => {
  const previousSecret = process.env.VIVY_STREAM_SECRET;
  const previousAllowUnsigned = process.env.VIVY_STREAM_ALLOW_UNSIGNED;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.VIVY_STREAM_SECRET = 'stream-secret';
  process.env.VIVY_STREAM_ALLOW_UNSIGNED = '1';
  process.env.NODE_ENV = 'production';

  try {
    await withServer({ stateName: 'secret.json' }, async (baseUrl) => {
      let result = await postJson(baseUrl, '/api/vivy/stream/chat', {
        username: 'chat',
        message: '!nossen should fail',
      });
      assert.equal(result.response.status, 401);
      assert.equal(result.json.error, 'vivy_stream_secret_invalid');

      result = await postJson(baseUrl, '/api/vivy/stream/chat', {
        username: 'chat',
        message: '!nossen should fail too',
      }, { 'X-Vivy-Stream-Secret': 'wrong' });
      assert.equal(result.response.status, 401);

      result = await postJson(baseUrl, '/api/vivy/stream/chat', {
        username: 'chat',
        message: '!nossen secret ok',
      }, { 'X-Vivy-Stream-Secret': 'stream-secret' });
      assert.equal(result.response.status, 200);
      assert.equal(result.json.ok, true);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.VIVY_STREAM_SECRET;
    else process.env.VIVY_STREAM_SECRET = previousSecret;
    if (previousAllowUnsigned === undefined) delete process.env.VIVY_STREAM_ALLOW_UNSIGNED;
    else process.env.VIVY_STREAM_ALLOW_UNSIGNED = previousAllowUnsigned;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('Twitch worker parses IRC PRIVMSG lines and command filtering', () => {
  const parsed = parsePrivmsg('@display-name=VivyFan;id=abc;color=#ff00aa;badges=subscriber/12 :vivyfan!vivyfan@vivyfan.tmi.twitch.tv PRIVMSG #funesterie :!vote S1');
  assert.equal(parsed.username, 'VivyFan');
  assert.equal(parsed.channel, 'funesterie');
  assert.equal(parsed.message, '!vote S1');
  assert.equal(parsed.messageId, 'abc');

  const previous = process.env.VIVY_STREAM_COMMANDS_ONLY;
  process.env.VIVY_STREAM_COMMANDS_ONLY = '1';
  try {
    assert.equal(shouldForwardMessage('salut tout le monde'), false);
    assert.equal(shouldForwardMessage('!nossen SAO opening'), true);
    assert.equal(shouldForwardMessage('⭐⭐⭐⭐⭐'), true);
  } finally {
    if (previous === undefined) delete process.env.VIVY_STREAM_COMMANDS_ONLY;
    else process.env.VIVY_STREAM_COMMANDS_ONLY = previous;
  }
});

test('Twitch announcements rotate only while the worker is connected', () => {
  const sent = [];
  let connected = false;
  let scheduled = null;
  let cleared = null;
  const rotator = createAnnouncementRotator({
    intervalMs: 1234,
    isConnected: () => connected,
    sendMessage: (message) => sent.push(message),
    setIntervalFn: (callback, intervalMs) => {
      scheduled = { callback, intervalMs, unref() {} };
      return scheduled;
    },
    clearIntervalFn: (timer) => {
      cleared = timer;
    },
  });

  assert.equal(rotator.intervalMs, 1234);
  assert.equal(rotator.start(), true);
  assert.equal(scheduled.intervalMs, 1234);
  assert.equal(scheduled.callback(), false);
  assert.deepEqual(sent, []);

  connected = true;
  assert.equal(scheduled.callback(), true);
  assert.equal(scheduled.callback(), true);
  assert.equal(scheduled.callback(), true);
  assert.deepEqual(sent, [ANNOUNCE_MESSAGES[0], ANNOUNCE_MESSAGES[1], ANNOUNCE_MESSAGES[0]]);
  assert.ok(sent.every((message) => !/[\r\n]/.test(message)));

  connected = false;
  assert.equal(scheduled.callback(), false);
  assert.equal(sent.length, 3);
  assert.equal(rotator.stop(), true);
  assert.equal(cleared, scheduled);

  assert.equal(resolveAnnounceInterval('invalid'), 300000);
  assert.equal(resolveAnnounceInterval('500'), 1000);
  const disabled = createAnnouncementRotator({ disabled: true, sendMessage: (message) => sent.push(message) });
  assert.equal(disabled.start(), false);
  assert.equal(disabled.tick(), false);
});
