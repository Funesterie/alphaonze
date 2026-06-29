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
  createVivyStreamStore,
  parseVivyStreamChatMessage,
  resolveRoundMs,
} = require('../src/routes/vivy-stream.cjs');
const {
  createVivyStreamNossenRunner,
} = require('../src/vivy/twitch-nossen-runner.cjs');
const {
  ANNOUNCE_MESSAGES,
  buildSongRecapMessages,
  buildTrackNoticeMessage,
  createAnnouncementRotator,
  createSongRecapRotator,
  createTrackNoticeWatcher,
  fetchTwitchStreamStatus,
  parsePrivmsg,
  postStreamReset,
  resolveAnnounceInterval,
  resolveLivePollInterval,
  resolveRecapInterval,
  resolveStreamResetUrl,
  resolveTrackNoticePollInterval,
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
    assert.ok(Date.parse(result.json.state.round.endsAt) - Date.parse(result.json.state.round.startedAt) >= 89_000);

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

test('Vivy stream reset clears the Twitch live session without deleting song history', async () => {
  await withServer({ stateName: 'reset.json' }, async (baseUrl) => {
    let result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'leo',
      message: '!nossen Tortues Ninja dans les égouts',
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.twitch.online, true);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'leo',
      message: '!etoiles 5 S1',
    });
    assert.equal(result.json.action, 'star');

    result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'ready',
      title: 'Tortues Ninja',
      trackUrl: '/api/vivy/studio/assets/twitch-turtles.mp3',
      durationSeconds: 180,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.songs.length, 1);

    result = await postJson(baseUrl, '/api/vivy/stream/reset', {
      reason: 'twitch_stream_offline',
      clearMemory: true,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.state.twitch.online, false);
    assert.equal(result.json.state.round.suggestions.length, 0);
    assert.equal(result.json.state.pendingSuggestions.length, 0);
    assert.equal(result.json.state.recentMessages.length, 0);
    assert.equal(result.json.state.stars.length, 0);
    assert.equal(result.json.state.songs.length, 1);
    assert.equal(result.json.state.learning.totalStars, 1);
    assert.equal(result.json.state.current.trackUrl, '');

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'leo',
      message: '!nossen Bleach opening nerveux',
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.twitch.online, true);
    assert.equal(result.json.state.round.suggestions.length, 1);
    assert.match(result.json.state.round.suggestions[0].text, /Bleach opening/);
  });
});

test('Vivy stream vote duration defaults to 90 seconds and remains configurable', () => {
  const previousVoteMs = process.env.VIVY_STREAM_VOTE_MS;
  const previousRoundMs = process.env.VIVY_STREAM_ROUND_MS;
  delete process.env.VIVY_STREAM_VOTE_MS;
  delete process.env.VIVY_STREAM_ROUND_MS;
  try {
    assert.equal(resolveRoundMs(), 90_000);
    assert.equal(resolveRoundMs('45000'), 45_000);
    assert.equal(resolveRoundMs('500'), 10_000);
    assert.equal(resolveRoundMs('999999999'), 600_000);
  } finally {
    if (previousVoteMs === undefined) delete process.env.VIVY_STREAM_VOTE_MS;
    else process.env.VIVY_STREAM_VOTE_MS = previousVoteMs;
    if (previousRoundMs === undefined) delete process.env.VIVY_STREAM_ROUND_MS;
    else process.env.VIVY_STREAM_ROUND_MS = previousRoundMs;
  }
});

test('Vivy stream lock starts automatic NOSSEN only once per round', async () => {
  const starts = [];
  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'automatic-lock.json'),
    onRoundLocked: (payload) => starts.push(payload),
  });
  store.addChatMessage({
    username: 'funeste38',
    message: '!nossen Course urbaine, visière fumée et synthés agressifs',
  });
  const first = store.lockRound({});
  const second = store.lockRound({});
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(first.ok, true);
  assert.equal(second.alreadyLocked, true);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].winner.id, 'S1');
  assert.match(starts[0].nossenSeed.canvas, /visière fumée/i);
});

test('Twitch suggestions received during playback enter the next round', () => {
  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'queued-suggestions.json'),
  });
  store.addChatMessage({
    username: 'first',
    message: '!nossen Course urbaine sous les néons',
  });
  store.lockRound({});
  store.updateLive({
    action: 'ready',
    trackUrl: '/api/vivy/studio/assets/current.mp3',
    durationSeconds: 180,
  });
  store.updateLive({ action: 'play' });

  const queued = store.addChatMessage({
    username: 'funeste38',
    message: '!nossen remballe tous ces twitcher en carton',
  });
  assert.equal(queued.action, 'suggestion_queued');
  assert.equal(queued.state.current.phase, 'playing');
  assert.equal(queued.state.pendingSuggestions.length, 1);

  const next = store.startRound();
  assert.equal(next.current.phase, 'voting');
  assert.equal(next.round.suggestions.length, 1);
  assert.equal(next.round.suggestions[0].text, 'remballe tous ces twitcher en carton');
  assert.equal(next.round.suggestions[0].author, 'funeste38');
  assert.equal(next.pendingSuggestions.length, 0);
});

test('Vivy idle jukebox replays known live songs and yields to chat requests', () => {
  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'idle-jukebox.json'),
    idleJukeboxEnabled: true,
    randomInt: () => 0,
  });
  store.addJukeboxTrack({
    title: 'Les lumières de la ville',
    trackUrl: '/api/vivy/studio/assets/vivy-music-suno-known.mp3',
    requestedBy: 'funeste38',
    durationSeconds: 151,
  });

  const interlude = store.startIdleJukebox();
  assert.equal(interlude.current.phase, 'interlude');
  assert.equal(interlude.current.trackTitle, 'Les lumières de la ville');
  assert.equal(interlude.current.durationSeconds, 151);
  assert.equal(interlude.round.status, 'open');
  assert.equal(interlude.round.suggestions.length, 0);

  const interrupted = store.addChatMessage({
    username: 'viewer',
    message: '!nossen opening Bleach sombre avec guitare nerveuse',
  });
  assert.equal(interrupted.action, 'suggestion');
  assert.equal(interrupted.state.current.phase, 'voting');
  assert.equal(interrupted.state.current.trackUrl, '');
  assert.equal(interrupted.state.round.suggestions[0].text, 'opening Bleach sombre avec guitare nerveuse');
});

test('Vivy idle jukebox can seed itself from generated Vivy MP3 assets', () => {
  const assetDir = path.join(process.env.A11_RUNTIME_ROOT, 'files', 'generated', 'vivy');
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'vivy-music-suno-testarchive.mp3'), Buffer.alloc(2048, 1));

  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'idle-jukebox-assets.json'),
    idleJukeboxEnabled: true,
    randomInt: () => 0,
  });
  const interlude = store.startIdleJukebox();
  assert.equal(interlude.current.phase, 'interlude');
  assert.match(interlude.current.trackUrl, /\/api\/vivy\/studio\/assets\/vivy-music-suno-testarchive\.mp3/);
  assert.equal(interlude.current.requestedBy, 'Vivy Live');
});

test('Twitch NOSSEN runner writes lyrics, follows Suno and publishes the track', async () => {
  const updates = [];
  let pollCount = 0;
  const lyrics = [
    '[Intro]',
    'Sous la visière fumée les néons griffent le bitume',
    '[Verse 1]',
    'Le casque coupe la ville et le moteur prend la rue',
    'Les feux passent au rouge dans le reflet de la bulle',
    'Chaque virage est un pari que la nuit continue',
    '[Chorus]',
    'Visière fumée, la course avale nos ombres',
    'Visière fumée, les synthés cognent dans le nombre',
  ].join('\n');
  const runner = createVivyStreamNossenRunner({
    routeComposition: async () => ({
      artists: ['vivy', 'a11'],
      songMood: 'electro-rock urbain, batterie nerveuse, synthés métalliques',
    }),
    writeLyrics: async () => ({ publicLyrics: lyrics }),
    startMusic: async () => ({ state: 'processing', taskId: 'task-live-1' }),
    pollMusic: async () => {
      pollCount += 1;
      return pollCount === 1
        ? { state: 'processing', taskId: 'task-live-1' }
        : {
          state: 'done',
          taskId: 'task-live-1',
          media: {
            url: '/api/vivy/studio/assets/twitch-live.mp3',
            path: '/runtime/twitch-live.mp3',
          },
        };
    },
    probeDuration: async (media) => {
      assert.equal(media.path, '/runtime/twitch-live.mp3');
      return 218;
    },
    updateLive: (input) => updates.push(input),
    sleep: async () => {},
    pollAttempts: 4,
    pollIntervalMs: 10,
  });

  const result = await runner.run({
    roundId: 'round-live-1',
    winner: {
      id: 'S1',
      text: 'visière fumée casque intégral style course urbaine agressive',
      author: 'funeste38',
    },
    nossenSeed: {
      canvas: 'Matière Twitch gagnante: course urbaine',
      notes: 'Éviter les images génériques.',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.taskId, 'task-live-1');
  assert.equal(pollCount, 2);
  assert.deepEqual(updates.at(-1), {
    source: 'twitch-live',
    action: 'ready',
    title: 'visière fumée casque intégral style course urbaine agressive',
    trackTitle: 'visière fumée casque intégral style course urbaine agressive',
    trackUrl: '/api/vivy/studio/assets/twitch-live.mp3',
    durationSeconds: 218,
    requestedBy: 'funeste38',
  });
});

test('Twitch NOSSEN runner rejects a duplicate active round', async () => {
  let releaseRouting;
  const routingGate = new Promise((resolve) => {
    releaseRouting = resolve;
  });
  const runner = createVivyStreamNossenRunner({
    routeComposition: () => routingGate,
    writeLyrics: async () => ({ publicLyrics: '[Verse]\n' + 'paroles concrètes '.repeat(12) }),
    startMusic: async () => ({
      url: '/api/vivy/studio/assets/ready.mp3',
      durationSeconds: 180,
    }),
    updateLive: () => {},
    revealDelayMs: 0,
  });
  const payload = {
    roundId: 'round-duplicate',
    winner: { id: 'S1', text: 'thème distinct suffisamment précis', author: 'chat' },
  };
  const first = runner.start(payload);
  const second = runner.start(payload);
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(second.error, 'round_already_running');
  releaseRouting({ artists: ['vivy'], songMood: 'electro pop nocturne' });
  await first.promise;
});

test('Vivy stream control drives production, presentation and playback metadata', async () => {
  await withServer({ stateName: 'control.json' }, async (baseUrl) => {
    await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'funeste38',
      message: '!nossen Les lumières de la ville, électro nocturne',
    });
    await postJson(baseUrl, '/api/vivy/stream/round/lock', {});
    await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'pre-release-rating-viewer',
      message: '!etoiles 5 S1',
    });

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
    assert.equal(result.json.action, 'suggestion_queued');
    assert.equal(result.json.state.round.status, 'locked');
    assert.equal(result.json.state.round.suggestions.length, 1);
    assert.equal(result.json.state.pendingSuggestions.length, 1);

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
    assert.equal(result.json.state.songs.length, 1);
    assert.equal(result.json.state.songs[0].starCount, 1);
    assert.equal(result.json.state.songs[0].starAverage, 5);
    assert.match(result.json.state.songs[0].sharePath, /\/api\/vivy\/stream\/s\/les-lumieres-de-la-ville-/);

    const redirect = await fetch(baseUrl + result.json.state.songs[0].sharePath, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/api/double-harmonic/out/live.mp3');

    result = await postJson(baseUrl, '/api/vivy/stream/control', { action: 'play' });
    assert.equal(result.json.state.current.phase, 'playing');
    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'early-rating-viewer',
      message: '!etoiles 4 S1',
    });
    assert.equal(result.json.state.songs[0].starCount, 2);
    assert.equal(result.json.state.songs[0].starAverage, 4.5);
    result = await postJson(baseUrl, '/api/vivy/stream/control', { action: 'rating' });
    assert.equal(result.json.state.current.phase, 'rating');
    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'rating-viewer',
      message: '!etoiles 5',
    });
    assert.equal(result.json.state.songs[0].starCount, 3);
    assert.equal(result.json.state.songs[0].starAverage, 4.67);

    await postJson(baseUrl, '/api/vivy/stream/control', { action: 'next' });
    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'next-round',
      message: '!nossen Nouveau thème du prochain round',
    });
    assert.equal(result.json.suggestion.id, 'S2');
    assert.equal(result.json.state.stats.suggestions, 3);
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

test('Twitch worker live gate checks Helix before opening IRC and can reset stream state', async () => {
  const calls = [];
  const online = await fetchTwitchStreamStatus({
    channel: 'Funesterie',
    clientId: 'client-id',
    accessToken: 'oauth:user-token',
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: [{
            id: 'stream-1',
            user_login: 'funesterie',
            title: 'Live Vivy',
            game_name: 'Music',
            started_at: '2026-06-29T00:00:00Z',
          }],
        }),
      };
    },
  });
  assert.equal(online.ok, true);
  assert.equal(online.live, true);
  assert.equal(online.streamId, 'stream-1');
  assert.match(calls[0].url, /user_login=funesterie/i);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer user-token');
  assert.equal(calls[0].options.headers['Client-ID'], 'client-id');

  const offline = await fetchTwitchStreamStatus({
    channel: 'Funesterie',
    clientId: 'client-id',
    accessToken: 'user-token',
    fetchFn: async () => ({ ok: true, text: async () => JSON.stringify({ data: [] }) }),
  });
  assert.equal(offline.ok, true);
  assert.equal(offline.live, false);

  const missing = await fetchTwitchStreamStatus({ channel: 'Funesterie' });
  assert.equal(missing.ok, false);
  assert.equal(missing.live, false);
  assert.equal(missing.reason, 'missing_helix_credentials');
  assert.equal(resolveLivePollInterval('1000'), 15_000);
  assert.equal(resolveLivePollInterval('999999999'), 10 * 60 * 1000);
  assert.equal(
    resolveStreamResetUrl('https://vivy.funesterie.me/api/vivy/stream/chat'),
    'https://vivy.funesterie.me/api/vivy/stream/reset'
  );

  const reset = await postStreamReset('https://vivy.funesterie.me/api/vivy/stream/reset', 'stream-secret', {
    reason: 'twitch_stream_offline',
  }, {
    fetchFn: async (url, options) => {
      assert.equal(String(url), 'https://vivy.funesterie.me/api/vivy/stream/reset');
      assert.equal(options.headers['X-Vivy-Stream-Secret'], 'stream-secret');
      assert.deepEqual(JSON.parse(options.body), { reason: 'twitch_stream_offline' });
      return { ok: true, text: async () => JSON.stringify({ ok: true, memoryCleared: 3 }) };
    },
  });
  assert.equal(reset.ok, true);
  assert.equal(reset.memoryCleared, 3);
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

test('Twitch track notices share new songs once with an absolute public link', async () => {
  const message = buildTrackNoticeMessage({
    current: {
      phase: 'presenting',
      trackTitle: 'Les lumières de la ville',
      requestedBy: 'funeste38',
      trackUrl: '/api/vivy/studio/assets/song.mp3',
    },
  }, { publicBaseUrl: 'https://vivy.funesterie.me' });
  assert.match(message, /Nouvelle création Vivy/);
  assert.match(message, /Les lumières de la ville/);
  assert.match(message, /https:\/\/vivy\.funesterie\.me\/api\/vivy\/studio\/assets\/song\.mp3/);
  assert.doesNotMatch(message, /[\r\n]/);

  const sent = [];
  let connected = false;
  let cleared = null;
  let fetchIndex = 0;
  const states = [
    { current: { phase: 'listening' } },
    {
      current: {
        phase: 'playing',
        trackTitle: 'Course sous néons',
        requestedBy: 'chat',
        trackUrl: '/api/vivy/studio/assets/neons.mp3',
      },
    },
    {
      current: {
        phase: 'playing',
        trackTitle: 'Course sous néons',
        requestedBy: 'chat',
        trackUrl: '/api/vivy/studio/assets/neons.mp3',
      },
    },
  ];
  const watcher = createTrackNoticeWatcher({
    stateUrl: 'https://vivy.funesterie.me/api/vivy/stream/state',
    publicBaseUrl: 'https://vivy.funesterie.me',
    pollIntervalMs: 1234,
    isConnected: () => connected,
    sendMessage: (entry) => sent.push(entry),
    fetchFn: async () => ({
      ok: true,
      json: async () => states[Math.min(fetchIndex++, states.length - 1)],
    }),
    setIntervalFn: (_callback, intervalMs) => ({ intervalMs, unref() {} }),
    clearIntervalFn: (timer) => {
      cleared = timer;
    },
  });

  assert.equal(resolveTrackNoticePollInterval('invalid'), 10_000);
  assert.equal(resolveTrackNoticePollInterval('500'), 3000);
  assert.equal(watcher.pollIntervalMs, 3000);
  assert.equal(watcher.start(), true);
  assert.equal(await watcher.tick(), false);
  assert.deepEqual(sent, []);

  connected = true;
  assert.equal(await watcher.tick(), false);
  assert.equal(await watcher.tick(), true);
  assert.equal(await watcher.tick(), false);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /https:\/\/vivy\.funesterie\.me\/api\/vivy\/studio\/assets\/neons\.mp3/);
  assert.equal(watcher.stop(), true);
  assert.ok(cleared);
});

test('Twitch song recaps list live songs in order with stars and short links', async () => {
  const state = {
    songs: [
      {
        id: 'track-a',
        trackTitle: 'Les lumières de la ville',
        trackUrl: '/api/vivy/studio/assets/a.mp3',
        sharePath: '/api/vivy/stream/s/les-lumieres-de-la-ville-aaaa1111',
        starAverage: 4.8,
        starCount: 5,
      },
      {
        id: 'track-b',
        trackTitle: 'Bleach Hollow Memories',
        trackUrl: '/api/vivy/studio/assets/b.mp3',
        sharePath: '/api/vivy/stream/s/bleach-hollow-memories-bbbb2222',
      },
    ],
  };
  const messages = buildSongRecapMessages(state, { publicBaseUrl: 'https://vivy.funesterie.me' });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /1\. Les lumières de la ville ⭐4\.8\/5\(5\)/);
  assert.match(messages[0], /2\. Bleach Hollow Memories ⭐--/);
  assert.match(messages[0], /https:\/\/vivy\.funesterie\.me\/api\/vivy\/stream\/s\/les-lumieres-de-la-ville-aaaa1111/);
  assert.doesNotMatch(messages[0], /[\r\n]/);

  const sent = [];
  let connected = true;
  let scheduled = null;
  const rotator = createSongRecapRotator({
    stateUrl: 'https://vivy.funesterie.me/api/vivy/stream/state',
    publicBaseUrl: 'https://vivy.funesterie.me',
    intervalMs: 26 * 60 * 1000,
    isConnected: () => connected,
    sendMessage: (message) => sent.push(message),
    fetchFn: async () => ({ ok: true, json: async () => state }),
    sleep: async () => {},
    setIntervalFn: (callback, intervalMs) => {
      scheduled = { callback, intervalMs, unref() {} };
      return scheduled;
    },
  });
  assert.equal(resolveRecapInterval('120000'), 25 * 60 * 1000);
  assert.equal(resolveRecapInterval('999999999'), 30 * 60 * 1000);
  assert.equal(rotator.intervalMs, 26 * 60 * 1000);
  assert.equal(rotator.start(), true);
  assert.equal(scheduled.intervalMs, 26 * 60 * 1000);
  assert.equal(await rotator.tick(), true);
  assert.equal(sent.length, 1);
  connected = false;
  assert.equal(await rotator.tick(), false);
});
