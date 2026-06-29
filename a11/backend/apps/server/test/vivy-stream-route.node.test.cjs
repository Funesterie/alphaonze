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
  STREAM_SCHEMA,
  buildOverlayHtml,
  createVivyStreamRouter,
  createVivyStreamStore,
  parseVivyStreamChatMessage,
  resolveRoundMs,
} = require('../src/routes/vivy-stream.cjs');
const {
  buildTwitchLyricsRequest,
  createVivyStreamNossenRunner,
} = require('../src/vivy/twitch-nossen-runner.cjs');
const {
  buildVivyMusicPrompt,
} = require('../src/routes/vivy-studio.cjs');
const {
  ANNOUNCE_MESSAGES,
  buildSongRecapMessages,
  buildTrackNoticeMessage,
  createAnnouncementRotator,
  createSongRecapRotator,
  createTrackNoticeWatcher,
  createTwitchLiveStatusMonitor,
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

test('Twitch lyrics prompt keeps live plumbing out of the sung material', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: { text: "l'appel des vacances, ambiance rock hit summer" },
    routing: {
      artists: ['vivy'],
      songMood: 'rock hit summer, guitares accrocheuses, refrain solaire',
    },
    seed: {
      notes: 'Éviter les images passe-partout; chercher des détails concrets dans le sujet demandé.',
    },
  });

  assert.doesNotMatch(prompt, /^NOSSEN Twitch Live\./m);
  assert.doesNotMatch(prompt, /depuis le chat/i);
  assert.match(prompt, /contexte de diffusion.*strictement interne/i);
  assert.match(prompt, /vacances -> départ, valises, route, plage/i);
  assert.match(prompt, /mini-histoire complète/i);
  assert.match(prompt, /sujet \+ personnages \+ problème \+ évolution \+ scène finale \+ style musical/i);
  assert.match(prompt, /trois intentions/i);
  assert.match(prompt, /sujet visible.*sous-thème.*morale cachée/s);
  assert.match(prompt, /morale cachée perceptible sans phrase scolaire/i);
  assert.match(prompt, /\[Verse 1\].*\[Verse 2\].*\[Pre-Chorus\].*\[Chorus\].*\[Bridge\].*\[Final Chorus\]/s);
  assert.match(prompt, /duo ou plusieurs voix/i);
});

test('Twitch lyrics prompt supports hidden morals for fable songs', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'une grenouille qui voulait fumer, fable cartoon drôle',
    },
    routing: {
      artists: ['vivy'],
      songMood: 'électro-funk cartoon, basse rebondissante, refrain catchy',
    },
    seed: {
      notes: 'Sous-thème: vouloir paraître cool. Morale cachée: anti-tabac sans leçon scolaire.',
    },
  });

  assert.match(prompt, /une grenouille qui voulait fumer/i);
  assert.match(prompt, /morale cachée/i);
  assert.match(prompt, /sans glorifier le risque/i);
  assert.match(prompt, /conséquences, images et retournement final/i);
  assert.match(prompt, /aucun comportement dangereux présenté comme désirable/i);
  assert.doesNotMatch(prompt, /Suno chante/i);
});

test('Twitch lyrics prompt preserves a scenario and assigns roles for a duo', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'Duo homme femme, histoire complète. Un créateur travaille seul la nuit sur Vivy. Voix masculine: doute et bugs. Voix féminine: Vivy répond. Pont dramatique: tout plante. Refrain final: le système redémarre.',
    },
    routing: {
      artists: ['djeff', 'vivy'],
      songMood: 'électro-rock anime, guitares, synthés lumineux',
    },
    seed: {},
  });

  assert.match(prompt, /Voix masculine: doute et bugs/);
  assert.match(prompt, /Voix féminine: Vivy répond/);
  assert.match(prompt, /Pont dramatique: tout plante/);
  assert.match(prompt, /respecte-les comme des contraintes prioritaires/i);
  assert.match(prompt, /\[Verse 1 - voix masculine\].*\[Verse 2 - voix féminine\]/s);
  assert.match(prompt, /alternance question-réponse/i);
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
    assert.match(result.json.nossenSeed.canvas, /mini-histoire chantée/i);
    assert.match(result.json.nossenSeed.canvas, /Architecture narrative attendue/i);
    assert.match(result.json.nossenSeed.canvas, /Lecture à trois intentions/i);
    assert.match(result.json.nossenSeed.canvas, /morale cachée/i);
    assert.match(result.json.nossenSeed.canvas, /Validation avant Suno/i);
    assert.match(result.json.nossenSeed.notes, /progression dramatique/i);
    assert.match(result.json.nossenSeed.notes, /troisième intention cachée/i);
    assert.doesNotMatch(result.json.nossenSeed.canvas, /Autres idées du chat|chanson NOSSEN/i);
    assert.doesNotMatch(result.json.nossenSeed.notes, /depuis le chat/i);

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
    assert.equal(result.json.state.jukebox.tracks.length, 0);
    assert.equal(result.json.state.learning.totalStars, 0);
    assert.equal(result.json.state.learning.likedTerms.length, 0);
    assert.doesNotMatch(result.json.state.nossenSeed.canvas, /Tortues|égouts/i);
    assert.equal(result.json.state.current.trackUrl, '');

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'leo',
      message: '!nossen Bleach opening nerveux',
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.twitch.online, true);
    assert.equal(result.json.state.round.suggestions.length, 1);
    assert.match(result.json.state.round.suggestions[0].text, /Bleach opening/);
    assert.doesNotMatch(result.json.state.nossenSeed.canvas, /Tortues|égouts/i);
  });
});

test('Vivy stream ignores stored raw Suno provider URLs', () => {
  const statePath = path.join(tmpRoot, 'provider-urls.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: STREAM_SCHEMA,
    current: {
      title: 'Lien provider brut',
      phase: 'interlude',
      trackUrl: 'https://musicfile.removeai.ai/raw-provider-song',
      trackTitle: 'Lien provider brut',
      trackId: 'track-raw',
      sharePath: '/api/vivy/stream/s/provider-brut-track-raw',
      durationSeconds: 300,
    },
    jukebox: {
      tracks: [
        {
          id: 'track-raw',
          title: 'Lien provider brut',
          trackUrl: 'https://musicfile.removeai.ai/raw-provider-song',
          sharePath: '/api/vivy/stream/s/provider-brut-track-raw',
        },
        {
          id: 'track-local',
          title: 'Copie locale',
          trackUrl: '/api/vivy/studio/assets/vivy-music-suno-local.mp3',
          sharePath: '/api/vivy/stream/s/copie-locale-track-local',
        },
      ],
    },
    songs: [
      {
        id: 'track-raw',
        title: 'Lien provider brut',
        trackUrl: 'https://musicfile.removeai.ai/raw-provider-song',
        sharePath: '/api/vivy/stream/s/provider-brut-track-raw',
      },
    ],
  }), 'utf8');

  const store = createVivyStreamStore({ statePath, idleJukeboxEnabled: false });
  const state = store.getState();
  assert.equal(state.current.trackUrl, '');
  assert.equal(state.current.phase, 'idle');
  assert.deepEqual(state.jukebox.tracks.map((track) => track.trackUrl), [
    '/api/vivy/studio/assets/vivy-music-suno-local.mp3',
  ]);
  assert.equal(state.songs.length, 0);
  assert.equal(store.findSongByShareSlug('provider-brut-track-raw'), null);
  assert.equal(store.addJukeboxTrack({
    title: 'Nouveau provider brut',
    trackUrl: 'https://musicfile.removeai.ai/another-provider-song',
  }), null);
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

test('Vivy stream NOSSEN seed does not recycle liked words from a previous topic', () => {
  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'no-recycled-liked-terms.json'),
  });
  store.addChatMessage({
    username: 'first',
    message: '!nossen Course urbaine, visière fumée et casque intégral',
  });
  store.addChatMessage({
    username: 'first',
    message: '!etoiles 5 S1',
  });
  assert.deepEqual(store.getState().learning.likedTerms.slice(0, 3), ['casque', 'course', 'fumee']);

  store.startRound();
  const next = store.addChatMessage({
    username: 'second',
    message: '!nossen Bleach opening nerveux à Soul Society',
  });

  assert.match(next.state.nossenSeed.canvas, /Bleach opening nerveux/);
  assert.doesNotMatch(next.state.nossenSeed.canvas, /visière|visiere|casque|integral|fumee/i);
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

test('Vivy music prompt keeps instrumental sound design free of lyrics and vocals', () => {
  const prompt = buildVivyMusicPrompt({
    instrumental: true,
    forceInstrumental: true,
    songSource: 'Twitch Live',
    songText: 'Le cowboy et le shérif, duel au soleil couchant, instrumental avec bruitages sonores: cheval, éperons, revolver, vent.',
    songMood: 'western sombre trap cinématique, guitare sèche, sifflement, sound design poussiéreux',
    songArtists: [],
  });

  assert.match(prompt, /Original instrumental Funesterie score/i);
  assert.match(prompt, /Vocal cast: none/i);
  assert.match(prompt, /Instrumental only\. No vocals/i);
  assert.doesNotMatch(prompt, /Lyrics:/i);
  assert.doesNotMatch(prompt, /sung vocals/i);
});

test('Twitch NOSSEN runner writes lyrics, follows Suno and publishes the track', async () => {
  const updates = [];
  let productionInput = null;
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
    startMusic: async (_mode, input) => {
      productionInput = input;
      return { state: 'processing', taskId: 'task-live-1' };
    },
    pollMusic: async (_taskId, input) => {
      assert.equal(input.requireLocalSunoAudio, true);
      assert.equal(input.sunoLocalAudioRequired, true);
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
  assert.equal(productionInput.requireLocalSunoAudio, true);
  assert.equal(productionInput.sunoLocalAudioRequired, true);
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

test('Twitch NOSSEN runner sends instrumental sound design requests without lyrics', async () => {
  const updates = [];
  let routedInput = null;
  let productionInput = null;
  let writeLyricsCalled = false;
  const runner = createVivyStreamNossenRunner({
    routeComposition: async (input) => {
      routedInput = input;
      return {
        artists: ['vivy'],
        songMood: 'instrumental western sombre, trap cinématique, guitare sèche, sifflement, bruitages de cheval, éperons, revolver et vent',
      };
    },
    writeLyrics: async () => {
      writeLyricsCalled = true;
      return { publicLyrics: 'should not be used' };
    },
    startMusic: async (_mode, input) => {
      productionInput = input;
      return {
        media: {
          url: '/api/vivy/studio/assets/western-instrumental.mp3',
          durationSeconds: 162,
        },
      };
    },
    pollMusic: async () => {
      throw new Error('poll should not be needed');
    },
    probeDuration: async () => 162,
    updateLive: (input) => updates.push(input),
    sleep: async () => {},
  });

  const result = await runner.run({
    roundId: 'round-western-instrumental',
    winner: {
      id: 'S1',
      text: 'Le cowboy et le shérif, western sombre, duel au soleil couchant, instrumental avec bruitages sonores: cheval, éperons, revolver, vent',
      author: 'funeste38',
    },
    nossenSeed: {
      canvas: 'Matière Twitch gagnante: duel western instrumental',
      notes: 'Garder les bruitages comme éléments de scène.',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.lyrics, '');
  assert.equal(writeLyricsCalled, false);
  assert.match(routedInput.notes, /instrumental pur/i);
  assert.match(routedInput.notes, /bruitages/i);
  assert.equal(productionInput.instrumental, true);
  assert.equal(productionInput.forceInstrumental, true);
  assert.equal(productionInput.preserveSelectedVoice, false);
  assert.equal(productionInput.lyrics, '');
  assert.deepEqual(productionInput.songArtists, []);
  assert.match(productionInput.songText, /cowboy et le shérif/i);
  assert.match(productionInput.songText, /Palette western/i);
  assert.match(productionInput.songMood, /no vocals/i);
  assert.match(productionInput.songMood, /foley/i);
  assert.match(updates.map((entry) => entry.message || '').join('\n'), /scène instrumentale/i);
});

test('Twitch NOSSEN runner waits for a local asset instead of publishing a provider URL', async () => {
  const updates = [];
  let pollCount = 0;
  const runner = createVivyStreamNossenRunner({
    routeComposition: async () => ({
      artists: ['vivy'],
      songMood: 'anime rock héroïque, batterie vive, guitares claires',
    }),
    writeLyrics: async () => ({
      publicLyrics: '[Intro]\nAincrad fend le ciel.\n[Verse]\nKirito court dans le code avec Asuna.\n[Chorus]\nSAO nous tient mais la lame ouvre la sortie.\n'.repeat(2),
    }),
    startMusic: async () => ({ state: 'processing', taskId: 'task-live-local' }),
    pollMusic: async () => {
      pollCount += 1;
      if (pollCount === 1) {
        return {
          state: 'done',
          taskId: 'task-live-local',
          media: { url: 'https://musicfile.removeai.ai/raw-provider-song', durationSeconds: 300 },
        };
      }
      if (pollCount === 2) {
        return {
          state: 'processing',
          taskId: 'task-live-local',
          status: 'suno_audio_localizing',
        };
      }
      return {
        state: 'done',
        taskId: 'task-live-local',
        media: {
          url: '/api/vivy/studio/assets/vivy-music-suno-local.mp3',
          durationSeconds: 300,
        },
      };
    },
    probeDuration: async () => 300,
    updateLive: (input) => updates.push(input),
    sleep: async () => {},
    pollAttempts: 4,
    pollIntervalMs: 10,
  });

  const result = await runner.run({
    roundId: 'round-live-local',
    winner: {
      id: 'S1',
      text: 'SAO opening Kirito Asuna dans Aincrad',
      author: 'chat',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(pollCount, 3);
  assert.equal(updates.at(-1).action, 'ready');
  assert.equal(updates.at(-1).trackUrl, '/api/vivy/studio/assets/vivy-music-suno-local.mp3');
  assert.ok(!updates.some((entry) => entry.action === 'ready' && /^https:\/\/musicfile\.removeai\.ai/i.test(entry.trackUrl || '')));
});

test('Twitch NOSSEN runner strips live and stale vehicle filler before Suno', async () => {
  let productionInput = null;
  const leakedLyrics = [
    '[Intro]',
    'Le chat qui clignote, le live qui pulse',
    'Le soleil tape déjà derrière les stores',
    '[Verse]',
    'Notifications qui grésillent, mod qui relance',
    'La valise attend près de la porte ouverte',
    'Le casque encore chaud, les yeux qui brûlent',
    'Le guidon attend, la visière est prête',
    '[Chorus]',
    'NOSSEN Twitch Live, on coupe le fil',
    'L’appel des vacances hurle dans la rue',
    'Guitare qui crie, batterie qui tape',
    '[Bridge]',
    'Plus de ban, plus de sub, plus de raid qui attend',
    'Juste le ciel qui s’ouvre grand',
    '[Final Chorus]',
    'L’appel des vacances revient dans nos voix',
    'On file vers le départ sous le soleil',
    '[Outro]',
    'On est déjà loin',
  ].join('\n');
  const runner = createVivyStreamNossenRunner({
    routeComposition: async () => ({
      artists: ['vivy'],
      songMood: 'rock hit summer, guitares accrocheuses, refrain solaire',
    }),
    writeLyrics: async () => ({ publicLyrics: leakedLyrics }),
    startMusic: async (_mode, input) => {
      productionInput = input;
      return {
        url: '/api/vivy/studio/assets/vacances.mp3',
        durationSeconds: 190,
      };
    },
    probeDuration: async () => 190,
    updateLive: () => {},
    sleep: async () => {},
    revealDelayMs: 0,
  });

  await runner.run({
    roundId: 'round-vacances-clean',
    winner: {
      id: 'S1',
      text: "l'appel des vacances, ambiance rock hit summer",
      author: 'chat',
    },
  });

  assert.match(productionInput.lyrics, /L’appel des vacances/i);
  assert.match(productionInput.lyrics, /valise/i);
  assert.doesNotMatch(productionInput.lyrics, /\b(NOSSEN|Twitch|chat|live|raid|sub|mod|notification|notifications|casque|guidon|visière)\b/i);
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

test('Vivy stream recovers from production error when a new Twitch suggestion arrives', async () => {
  await withServer({ stateName: 'error-recovery.json' }, async (baseUrl) => {
    await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'funeste38',
      message: '!nossen Bleach avec Ichigo, opening anime sombre',
    });
    await postJson(baseUrl, '/api/vivy/stream/round/lock', {});
    let result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'error',
      message: 'NOSSEN Twitch arrêté: Suno a rejeté la génération.',
    });
    assert.equal(result.json.state.current.phase, 'error');
    assert.equal(result.json.state.round.status, 'locked');

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'funeste38',
      message: '!nossen Handicap invisible, pop-rock émotionnel, refrain mémorable',
    });
    assert.equal(result.json.action, 'suggestion_recovered');
    assert.equal(result.json.recovered, true);
    assert.equal(result.json.state.round.status, 'open');
    assert.equal(result.json.state.current.phase, 'voting');
    assert.equal(result.json.state.round.suggestions.length, 1);
    assert.match(result.json.state.round.suggestions[0].text, /Handicap invisible/);
    assert.equal(result.json.state.pendingSuggestions.length, 0);
  });
});

test('A11 production Caddy routes Vivy and TTS APIs to the A11 backend', () => {
  const deployScript = fs.readFileSync(
    path.join(__dirname, '../../../../ops/deploy-a11-prod-finland-2.ps1'),
    'utf8'
  );
  const a11PathLine = deployScript.split(/\r?\n/).find((line) => line.includes('@a11Path path')) || '';
  assert.match(a11PathLine, /\/api\/vivy(?:\s|$)/);
  assert.match(a11PathLine, /\/api\/vivy\/\*/);
  assert.match(a11PathLine, /\/api\/tts(?:\s|$)/);
  assert.match(a11PathLine, /\/api\/tts\/\*/);
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

test('Twitch live monitor resets the session when OBS cuts the stream after IRC joined', async () => {
  const offlineEvents = [];
  let connected = false;
  let scheduled = null;
  let cleared = null;
  let fetchCount = 0;
  const monitor = createTwitchLiveStatusMonitor({
    intervalMs: 15000,
    isConnected: () => connected,
    fetchStatus: async () => {
      fetchCount += 1;
      return fetchCount === 1
        ? { ok: true, live: true, streamId: 'stream-1' }
        : { ok: true, live: false, reason: 'offline' };
    },
    onOffline: async (status) => offlineEvents.push(status),
    setIntervalFn: (callback, intervalMs) => {
      scheduled = { callback, intervalMs, unref() {} };
      return scheduled;
    },
    clearIntervalFn: (timer) => {
      cleared = timer;
    },
  });

  assert.equal(monitor.intervalMs, 15000);
  assert.equal(monitor.start(), true);
  assert.equal(scheduled.intervalMs, 15000);
  assert.equal(await monitor.tick(), false);
  assert.equal(fetchCount, 0);

  connected = true;
  assert.equal(await monitor.tick(), false);
  assert.equal(await monitor.tick(), true);
  assert.equal(await monitor.tick(), false);
  assert.equal(fetchCount, 2);
  assert.equal(offlineEvents.length, 1);
  assert.deepEqual(offlineEvents[0], { ok: true, live: false, reason: 'offline' });
  assert.equal(monitor.stop(), true);
  assert.equal(cleared, scheduled);
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
