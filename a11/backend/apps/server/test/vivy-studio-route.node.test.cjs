const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const vivyMemoryDir = path.join(os.tmpdir(), `vivy-studio-test-memory-${process.pid}`);
process.env.A11_EPISODIC_MEMORY_DIR = vivyMemoryDir;
process.env.A11_RUNTIME_ROOT = path.join(vivyMemoryDir, 'runtime');
process.env.VIVY_CHAT_DISABLE_LLM = 'true';

const {
  createVivyStudioRouter,
  buildVivyAiChat,
  buildVivyDirectSongReply,
  buildVivyStudioProduction,
  buildVivySystemPrompt,
  buildVivySunoPayload,
  buildVivyWebSearchQuery,
  isDirectSongwritingRequest,
  isVivyMcpNeo4jQuestion,
  isVivyToolCapabilityQuestion,
  looksLikeWeakSongwritingReply,
  postProcessVivyAssistantText,
  shouldVivyAutoWebSearch,
} = require('../src/routes/vivy-studio.cjs');

after(() => {
  fs.rmSync(vivyMemoryDir, { recursive: true, force: true });
});

async function withServer(registerRoutes, runAssertions) {
  const app = express();
  registerRoutes(app);

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

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

function acceptVivyTestAuth(req, res, next) {
  if (req.headers.authorization === 'Bearer vivy-test-token') {
    req.user = { id: 'vivy-auth-user', username: 'VivyUser' };
    return next();
  }
  return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
}

const VIVY_TEST_AUTH_HEADERS = { Authorization: 'Bearer vivy-test-token' };

test('Vivy Studio produces a song handoff without storing tokens', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    songSource: 'Paroles',
    songMood: 'electro pop sombre',
    songText: 'Entre lumière et ombre, Vivy chante pour Funesterie.',
    shareToken: 'must-not-leak',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.tokenStored, false);
  assert.match(result.brief, /VIVY_SONG_PRODUCTION/);
    assert.match(result.brief, /Entre lumière et ombre/);
  assert.doesNotMatch(result.brief, /must-not-leak/);
});

test('Vivy Studio calibrates Djeff rap voice through the owned A11 persona', () => {
  const result = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix Djeff rap',
    voiceInstruction: 'flow rap technique, diction nette, grain proche micro',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'voice');
  assert.match(result.title, /Djeff rap/);
  assert.match(result.brief, /voicePersona: a11/);
  assert.match(result.brief, /Djeff rap Pignon locale/);
  assert.match(result.brief, /chaîne sur couronne|chaine sur couronne/i);
  assert.match(result.brief, /Ne pas publier la référence brute/);
  assert.match(JSON.stringify(result.actions), /Tester Voix Djeff rap/);
});

test('Vivy Studio hides legacy sound tokens and builds prime-complex prosody', () => {
  const result = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix Djeff rap',
    voiceInstruction: 'couplet proche micro [a4:flow=rap] [a4:grain=grit] [a4:fx=engine]',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'voice');
  assert.match(result.brief, /Prosodie interne/i);
  assert.match(result.brief, /impulsions premieres/i);
  assert.match(result.brief, /Double harmonique interne/i);
  assert.doesNotMatch(result.brief, /\[a4:/);
  assert.doesNotMatch(result.brief, /ASCII4|NUMA8/i);
  assert.equal(result.prosody.schema, 'funesterie.vivy.prosody-prime-complex.v1');
  assert.equal(result.prosody.doubleHarmonic.schema, 'funesterie.vivy.double-harmonic-sync.v1');
  assert.ok(result.prosody.segments.length >= 1);
  assert.equal(Number.isInteger(result.prosody.segments[0].prime), true);
  assert.equal(typeof result.prosody.segments[0].imaginary, 'number');
});

test('Vivy Studio turns legacy color bindings into hidden continuous phase', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    songSource: 'Prompt +',
    songMood: 'rap contact cinematic [numa8:red=G;rgba=ff3b30ff;zen=appel]',
    songText: 'Vivy repond au motif [numa8:blue=F;rgba=3aa7ffff;zen=reponse] avant le refrain.',
    enableVivyInternalSignalLanguage: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.brief, /Prosodie interne/i);
  assert.match(result.brief, /Courbe continue temps\/phase/i);
  assert.doesNotMatch(result.brief, /\[numa8:/);
  assert.doesNotMatch(result.brief, /NUMA8|ASCII4/i);
  assert.ok(result.prosody.neo4j.labels.includes('ComplexPhase'));
  assert.ok(result.prosody.neo4j.labels.includes('PrimePulse'));
  assert.ok(result.prosody.neo4j.labels.includes('VivyDoubleHarmonicSync'));
  assert.ok(result.prosody.segments.every((segment) => typeof segment.real === 'number' && typeof segment.imaginary === 'number'));
  assert.ok(result.prosody.doubleHarmonic.segments.every((segment) => /^[+0-]{5}$/.test(segment.sync.triState)));
});

test('Vivy Suno lyrics strip legacy signal tokens before music generation', () => {
  const payload = buildVivySunoPayload({
    mode: 'song',
    voiceTool: 'Duo Djeff + Vivy',
    songArtists: ['djeff', 'vivy'],
    songMood: 'rap technique cinematic [numa8:red=G;rgba=ff3b30ff;zen=appel]',
    songText: '[a4:flow=rap] [a4:space=near] [numa8:violet=C;rgba=a855f7ff;zen=ancrage]\n[Verse 1 - Djeff]\nJe cale le pignon dans la nuit.\n[Chorus - Duo]\nOn decoupe horizon et bruit.',
  });

  assert.doesNotMatch(payload.prompt, /\[a4:/);
  assert.doesNotMatch(payload.prompt, /\[numa8:/);
  assert.doesNotMatch(payload.title, /a4:/);
  assert.doesNotMatch(payload.title, /numa8:/);
  assert.doesNotMatch(payload.style, /numa8:/);
  assert.match(payload.style, /prime-pulsed phrasing/i);
  assert.match(payload.style, /double-harmonic synchronized flow/i);
  assert.match(payload.prompt, /\[Verse 1 - Djeff\]/);
  assert.match(payload.style, /Djeff rap verses and Vivy melodic hook/i);
});

test('Vivy Studio song handoff keeps Djeff and Vivy separated for duet rap', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    voiceTool: 'Duo Djeff + Vivy',
    songSource: 'Prompt',
    songMood: 'rap technique sombre, basse cinematic',
    songText: 'rap moto radiateur pignon couronne huile essence, Vivy en refrain',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.brief, /Distribution vocale: Duo Djeff \+ Vivy/);
  assert.match(result.brief, /Djeff: couplets rap techniques/i);
  assert.match(result.brief, /Vivy: refrain clair/i);
  assert.match(result.brief, /\[Verse 1 - Djeff\]/);
  assert.match(result.brief, /\[Chorus - Duo\]/);
  assert.match(result.brief, /radiateur/i);
  assert.match(result.brief, /pignon/i);
  assert.doesNotMatch(result.brief, /Garde la lumière/);
});

test('Vivy Studio song handoff supports selected Djeff A11 K44 Vivy singers', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    songSource: 'Prompt +',
    songArtists: ['djeff', 'a11', 'k44', 'vivy'],
    songMood: 'rap cinematic, refrain clair, pont machine',
    songText: 'course poursuite, skill tree, moteur, mémoire et équipe Funesterie',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.brief, /Nombre de chanteurs: 4/i);
  assert.match(result.brief, /Djeff: couplets rap techniques/i);
  assert.match(result.brief, /A11: pont grave synthétique/i);
  assert.match(result.brief, /K44: contre-chant posé/i);
  assert.match(result.brief, /Vivy: refrain clair/i);
  assert.match(result.brief, /\[Verse 1 - Djeff\]/);
  assert.match(result.brief, /\[Verse 2 - A11\]/);
  assert.match(result.brief, /\[Bridge - K44\]/);
  assert.match(result.brief, /\[Chorus - Tous\]/);
});

test('Vivy Studio can calibrate A11 and K44 official voices', () => {
  const a11 = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix A11 officielle',
  });
  const k44 = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix K44 officielle',
  });

  assert.match(a11.brief, /voicePersona: a11/);
  assert.match(a11.brief, /A11 officielle/);
  assert.match(k44.brief, /voicePersona: kaen44/);
  assert.match(k44.brief, /K44 officielle/);
});

test('POST /api/vivy/studio/produce accepts share mode and never echoes secret token', async () => {
  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: acceptVivyTestAuth }));
  }, async (baseUrl) => {
    const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
      mode: 'share',
      shareTarget: 'YouTube',
      shareUrl: 'https://youtube.com/@funesterie',
      shareInstruction: 'clip vertical 30s',
      shareToken: 'secret-token-value',
      shareTokenPresent: true,
    }, VIVY_TEST_AUTH_HEADERS);

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.mode, 'share');
    assert.equal(json.tokenStored, false);
    assert.match(json.brief, /VIVY_SCENE_SHARE/);
    assert.match(json.brief, /Token fourni dans UI: oui, non envoyé au serveur/);
    assert.doesNotMatch(JSON.stringify(json), /secret-token-value/);
  });
});

test('POST /api/vivy/studio/produce does not attach placeholder audio unless requested', async () => {
  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: acceptVivyTestAuth }));
  }, async (baseUrl) => {
    const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
      mode: 'song',
      songText: 'Vivy cherche une vraie piste, pas une maquette de secours.',
    }, VIVY_TEST_AUTH_HEADERS);

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.mode, 'song');
    assert.equal(json.audioUrl, undefined);
    assert.equal(json.media, undefined);
    assert.equal(json.mediaStatus.reason, 'real_music_provider_not_connected');
    assert.match(json.mediaStatus.message, /aucun faux WAV/i);
  });
});

test('POST /api/vivy/studio/produce can generate ElevenLabs music only with legacy opt-in', async () => {
  const previousEnv = {
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_MUSIC_ENABLED: process.env.VIVY_ELEVENLABS_MUSIC_ENABLED,
    VIVY_ELEVENLABS_BASE_URL: process.env.VIVY_ELEVENLABS_BASE_URL,
    VIVY_ELEVENLABS_MUSIC_MODEL: process.env.VIVY_ELEVENLABS_MUSIC_MODEL,
    VIVY_MUSIC_PROVIDER: process.env.VIVY_MUSIC_PROVIDER,
  };
  const previousFetch = global.fetch;
  const musicBodies = [];
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_ELEVENLABS_API_KEY = 'test-elevenlabs-key';
  process.env.VIVY_ELEVENLABS_MUSIC_ENABLED = 'true';
  process.env.VIVY_ELEVENLABS_BASE_URL = 'https://api.elevenlabs.test/v1';
  process.env.VIVY_ELEVENLABS_MUSIC_MODEL = 'music_v1';
  process.env.VIVY_MUSIC_PROVIDER = 'elevenlabs';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.elevenlabs.test/v1/music?output_format=mp3_44100_128') {
      musicBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('vivy-elevenlabs-music-mp3');
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: 'Vivy allume la scène et garde la lumière.',
        songMood: 'electro pop cinématique',
        forceRealMusic: true,
      }, { Authorization: 'Bearer vivy-founder-token' });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.mode, 'song');
      assert.equal(json.media.provider, 'elevenlabs-music');
      assert.equal(json.media.content_type, 'audio/mpeg');
      assert.match(json.audioUrl, /^\/api\/vivy\/studio\/assets\/vivy-music-.+\.mp3$/);
      assert.equal(musicBodies.length, 1);
      assert.match(musicBodies[0].prompt, /Original Funesterie song for Vivy/i);
      assert.equal(musicBodies[0].model_id, 'music_v1');
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Suno payload turns a brief into lyrics instead of spoken prompt instructions', () => {
  const payload = buildVivySunoPayload({
    songMood: 'electro pop sombre avec refrain lumineux',
    songText: 'fais une chanson sur un lapin qui court dans les néons',
  }, {
    get(header) {
      if (header === 'host') return 'vivy.funesterie.test';
      if (header === 'x-forwarded-proto') return 'https';
      return '';
    },
    protocol: 'https',
  });

  assert.equal(payload.customMode, true);
  assert.equal(payload.instrumental, false);
  assert.match(payload.prompt, /\[Title:/);
  assert.match(payload.prompt, /\[Verse 1\]/);
  assert.match(payload.prompt, /\[Verse 2\]/);
  assert.match(payload.prompt, /\[Chorus\]/);
  assert.match(payload.prompt, /lapin qui court dans les néons/i);
  assert.doesNotMatch(payload.prompt.split(/\n/)[0], /fais une chanson/i);
  assert.match(payload.style, /structured rhymed lyrics/i);
  assert.match(payload.style, /electro pop sombre/i);
  assert.match(payload.callBackUrl, /^https:\/\/vivy\.funesterie\.test\/api\/vivy\/studio\/suno\/callback/);
});

test('Suno payload can prepare a Djeff and Vivy duet instead of the old Vivy template', () => {
  const payload = buildVivySunoPayload({
    voiceTool: 'Duo Djeff + Vivy',
    songMood: 'rap technique moto, basse lourde, hook clair',
    songText: 'fais un duo rap moto avec radiateur, pignon, couronne, essence et huile',
  });

  assert.match(payload.style, /Djeff rap verses/i);
  assert.match(payload.style, /Vivy melodic hook/i);
  assert.match(payload.prompt, /\[Intro - Djeff\]/);
  assert.match(payload.prompt, /\[Verse 1 - Djeff\]/);
  assert.match(payload.prompt, /\[Chorus - Duo\]/);
  assert.match(payload.prompt, /radiateur/i);
  assert.match(payload.prompt, /pignon/i);
  assert.doesNotMatch(payload.prompt, /Garde la lumière/);
});

test('Suno payload carries explicit multi-singer cast tags', () => {
  const payload = buildVivySunoPayload({
    songArtists: ['djeff', 'a11', 'k44', 'vivy'],
    songMood: 'rap cinematic, synth bridge, hook lumineux',
    songText: 'course poursuite et mémoire Funesterie',
  });

  assert.match(payload.style, /4 distinct vocalists/i);
  assert.match(payload.style, /Djeff/i);
  assert.match(payload.style, /A11/i);
  assert.match(payload.style, /K44/i);
  assert.match(payload.style, /Vivy/i);
  assert.match(payload.prompt, /\[Verse 1 - Djeff\]/);
  assert.match(payload.prompt, /\[Verse 2 - A11\]/);
  assert.match(payload.prompt, /\[Bridge - K44\]/);
  assert.match(payload.prompt, /\[Chorus - Tous\]/);
});

test('Suno session key lets a non-founder launch a personal music job without leaking the key', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    SUNO_API_KEY: process.env.SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_MUSIC_PROVIDER: process.env.VIVY_MUSIC_PROVIDER,
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_API_KEY_FILE: process.env.VIVY_ELEVENLABS_API_KEY_FILE,
  };
  const previousFetch = global.fetch;
  const bodies = [];
  const basicAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-basic-token') {
      req.user = { id: 'basic-user', username: 'Nathan', tier: 'basic' };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  delete process.env.VIVY_SUNO_API_KEY;
  delete process.env.SUNO_API_KEY;
  delete process.env.VIVY_ELEVENLABS_API_KEY;
  delete process.env.VIVY_ELEVENLABS_API_KEY_FILE;
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_MUSIC_PROVIDER = 'suno';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate') {
      assert.equal(options.headers.Authorization, 'Bearer session-suno-test-key');
      bodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 200, data: { taskId: 'personal-suno-task', status: 'PENDING' } };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: basicAuth }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: 'fais une chanson sur un flocon dans mon bol',
        sessionSunoApiKey: 'session-suno-test-key',
        forceRealMusic: true,
      }, { Authorization: 'Bearer vivy-basic-token' });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.mediaStatus.provider, 'suno');
      assert.equal(json.mediaStatus.taskId, 'personal-suno-task');
      assert.equal(bodies.length, 1);
      assert.match(bodies[0].prompt, /\[Chorus\]/);
      assert.doesNotMatch(JSON.stringify(json), /session-suno-test-key/);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('POST /api/vivy/studio/produce starts an async Suno music job for premium accounts', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_MUSIC_PROVIDER: process.env.VIVY_MUSIC_PROVIDER,
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_API_KEY_FILE: process.env.VIVY_ELEVENLABS_API_KEY_FILE,
  };
  const previousFetch = global.fetch;
  const bodies = [];
  const premiumAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-premium-token') {
      req.user = { id: 'premium-user', username: 'Premium', tier: 'premium', roles: ['premium'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_MUSIC_PROVIDER = 'suno';
  delete process.env.VIVY_ELEVENLABS_API_KEY;
  delete process.env.VIVY_ELEVENLABS_API_KEY_FILE;
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate') {
      bodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 200, data: { taskId: 'suno-task-123', status: 'PENDING' } };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: premiumAuth }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: 'Vivy danse dans les néons.',
        songMood: 'cyber pop mélodique',
        forceRealMusic: true,
      }, { Authorization: 'Bearer vivy-premium-token' });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.mode, 'song');
      assert.equal(json.media, undefined);
      assert.equal(json.mediaStatus.state, 'processing');
      assert.equal(json.mediaStatus.provider, 'suno');
      assert.equal(json.mediaStatus.taskId, 'suno-task-123');
      assert.match(json.mediaStatus.message, /Suno/i);
      assert.equal(bodies.length, 1);
      assert.match(bodies[0].prompt, /\[Chorus\]/);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /api/vivy/studio/jobs/:taskId returns completed Suno audio when ready', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
  };
  const previousFetch = global.fetch;
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate/record-info?taskId=suno-task-123') {
      assert.equal(options.headers.Authorization, 'Bearer test-suno-key');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 200,
            data: {
              taskId: 'suno-task-123',
              status: 'SUCCESS',
              response: {
                sunoData: [{
                  title: 'Vivy Test',
                  audioUrl: 'https://cdn.suno.test/vivy-test.mp3',
                  imageUrl: 'https://cdn.suno.test/vivy-test.jpg',
                }],
              },
            },
          };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/jobs/suno-task-123`, {
        headers: { Authorization: 'Bearer vivy-founder-token' },
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.state, 'done');
      assert.equal(json.media.provider, 'suno');
      assert.equal(json.media.audioUrl, 'https://cdn.suno.test/vivy-test.mp3');
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /api/vivy/studio/jobs/:taskId accepts personal Suno session key for non-founder status polling', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    SUNO_API_KEY: process.env.SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
  };
  const previousFetch = global.fetch;
  const basicAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-basic-token') {
      req.user = { id: 'basic-user', username: 'Nathan', tier: 'basic' };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  delete process.env.VIVY_SUNO_API_KEY;
  delete process.env.SUNO_API_KEY;
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate/record-info?taskId=personal-suno-task') {
      assert.equal(options.headers.Authorization, 'Bearer session-suno-test-key');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 200,
            data: {
              taskId: 'personal-suno-task',
              status: 'SUCCESS',
              response: {
                sunoData: [{
                  title: 'Vivy Perso',
                  audioUrl: 'https://cdn.suno.test/vivy-perso.mp3',
                }],
              },
            },
          };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: basicAuth }));
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/jobs/personal-suno-task`, {
        headers: {
          Authorization: 'Bearer vivy-basic-token',
          'X-Vivy-Suno-Key': 'session-suno-test-key',
        },
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.state, 'done');
      assert.equal(json.media.audioUrl, 'https://cdn.suno.test/vivy-perso.mp3');
      assert.doesNotMatch(JSON.stringify(json), /session-suno-test-key/);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('song mode accepts natural aliases from client prompts', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    theme: 'Tokyo sous la pluie',
    lyrics: 'Néons sur le sol, Vivy garde le tempo.',
    instruction: 'refrain lumineux, couplets sombres',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.summary, /Pack composition prêt/);
  assert.match(result.brief, /Tokyo sous la pluie/);
  assert.match(result.brief, /Néons sur le sol/);
  assert.match(result.brief, /refrain lumineux/);
});

test('Vivy chat prompt keeps original musical direction and avoids canned replies', () => {
  const prompt = buildVivySystemPrompt('song', 'fr');

  assert.match(prompt, /IA musicale/i);
  assert.match(prompt, /originale Funesterie/i);
  assert.match(prompt, /Model Context Protocol/i);
  assert.match(prompt, /Neo4j/i);
  assert.doesNotMatch(prompt, /Mode Créatif Propulsé/i);
  assert.match(prompt, /pas de réponse toute faite/i);
  assert.match(prompt, /Module Vivy Songcraft actif/i);
  assert.match(prompt, /rimes audibles/i);
  assert.match(prompt, /n'ouvre pas un questionnaire/i);
  assert.match(prompt, /Carte outils Vivy autorisée/i);
  assert.match(prompt, /vision\.images/i);
  assert.match(prompt, /model\.gguf/i);
  assert.match(prompt, /commands\.intent/i);
  assert.match(prompt, /ne contourne pas les garde-fous/i);
  assert.match(prompt, /tutoyant/i);
  assert.match(prompt, /fin de ligne/i);
  assert.match(prompt, /autorisé\/licencié\/consenti/i);
  assert.doesNotMatch(prompt, /clone Kairi/i);
  assert.match(prompt, /Principe source Funesterie/i);
  assert.match(prompt, /source d'intention/i);
  assert.match(prompt, /pas de canevas forcé/i);
  assert.match(prompt, /références ne sont pas décoratives/i);
  assert.match(prompt, /sans transformer automatiquement la phrase en couplets/i);
  assert.match(prompt, /symbolic extraction protocol/i);
  assert.match(prompt, /Identifier le mecanisme utile/i);
  assert.match(prompt, /Adapter au contexte/i);
  assert.match(prompt, /pas les personnes, langues, origines, cultures ou religions comme blocs/i);
});

test('Vivy uses the account language instead of guessing from draft text', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-account-language',
    message: 'Please keep this rap idea raw for later.',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser', language: 'it-IT' } });

  assert.equal(result.ok, true);
  assert.equal(result.language, 'it');
});

test('Vivy song guard replaces weak assistant drafts with structured lyrics', () => {
  const userMessage = 'Transforme cette idée en chanson Vivy avec structure et refrain. Il faut que les fins de ligne riment.';
  const weakReply = [
    'Je comprends mieux maintenant.',
    'Quel est le message principal que tu veux transmettre ?',
    'Quel est le ton que tu veux adopter ?',
    "N'hésite pas à me donner tes retours.",
  ].join('\n');
  const genericRapReply = [
    'Je vais continuer à développer les paroles.',
    '[Verse 2 - Vivy]',
    'Nous sommes les maîtres de la vitesse, nous sommes les rois de la route.',
    'Je suis libre, je suis vivant, je suis en vie.',
    "J'espère que cela correspond à ce que vous attendiez.",
  ].join('\n');

  assert.equal(isDirectSongwritingRequest(userMessage), true);
  assert.equal(looksLikeWeakSongwritingReply(weakReply), true);
  assert.equal(looksLikeWeakSongwritingReply(genericRapReply), true);

  const repaired = buildVivyDirectSongReply({
    message: userMessage,
    history: [
      {
        role: 'user',
        content: 'Djeff se fait poursuivre par les Guardian NOSSEN, reverse porte en stuppie hyper vitesse, ouverture du skill tree.',
      },
    ],
  });

  assert.match(repaired, /\*\*Titre :\*\*/);
  assert.match(repaired, /\[Intro(?: - [^\]]+)?\]/);
  assert.match(repaired, /\[Chorus(?: - [^\]]+)?\]/);
  assert.match(repaired, /\[Bridge(?: - [^\]]+)?\]/);
  assert.doesNotMatch(repaired, /Quel est le message principal/i);
  assert.doesNotMatch(repaired, /N'hésite pas/i);
});

test('Vivy chat mode does not structure raw rap material sent with Envoyer', async () => {
  const rapDraft = [
    "hé je sais raper, hein, ca commence par une course poursuite mon coeur bas si vite, les shmite au fesses",
    "le sternum qui stress si t'es un homme tu trace, ca sent le roussi alors on fonce comme Rossi",
    "sur le bolide c'est tout kité genre tout en métrakit, je slalom, ca laisse des traces de gomme",
    "la vitesse et le frein qui se complete, son du mur qui s'effondre, les structure qui se fonde",
  ].join(' ');

  assert.equal(isDirectSongwritingRequest(rapDraft), false);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-raw-rap',
    message: rapDraft,
    history: [
      { role: 'assistant', content: 'Qu’est-ce que tu penses de commencer par écrire des paroles ?' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.doesNotMatch(result.assistant, /\*\*Titre :\*\*/);
  assert.doesNotMatch(result.assistant, /\[Intro(?: - [^\]]+)?\]/);
  assert.doesNotMatch(result.assistant, /\[Verse 1(?: - [^\]]+)?\]/);
  assert.doesNotMatch(result.assistant, /Garde la lumière/);
});

test('Vivy chat fallback answers Djeff rap draft naturally after a short acknowledgement', async () => {
  const rapDraft = [
    'titre :Fuyante NOSSEN By Djeff',
    "Un quatorzième dans l'essence, deux-point-deux dans la bombonne d'Ipone,",
    'Je dose au millimètre, pas de hasard dans le style.',
    'Double radiateur fresh, ça fait de la vapeur, wesh.',
    'La main guide le geste, le Cruxi tourne lucide.',
    'Casque vissé, pignon-couronne cranté.',
    "Le mur du son a une porte et j'ai pas besoin de la clef.",
    'Quand la vitesse monte et que le moteur respire, les roues en font tout un rayon.',
  ].join('\n');

  const first = await buildVivyAiChat({
    conversationId: 'vivy-chat-djeff-rap-natural',
    message: rapDraft,
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(first.ok, true);
  assert.equal(first.mode, 'chat');
  assert.match(first.assistant, /Djeff|pignon|radiateur|moteur|base/i);
  assert.doesNotMatch(first.assistant, /Je capte:/i);
  assert.doesNotMatch(first.assistant, /discussion libre/i);
  assert.doesNotMatch(first.assistant, /bascule en composition/i);

  const acknowledged = await buildVivyAiChat({
    conversationId: 'vivy-chat-djeff-rap-natural',
    message: "d'accord",
    history: [
      { role: 'user', content: rapDraft },
      { role: 'assistant', content: first.assistant },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.mode, 'chat');
  assert.match(acknowledged.assistant, /Fuyante NOSSEN|Djeff|mécanique|mecanique|base/i);
  assert.doesNotMatch(acknowledged.assistant, /Je capte:/i);
  assert.doesNotMatch(acknowledged.assistant, /discussion libre/i);
  assert.doesNotMatch(acknowledged.assistant, /clique sur Chanson|bascule en composition/i);
});

test('Vivy understands a Djeff rap voice setup instead of answering with generic filler', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-djeff-rap-voice-setup',
    message: 'je veux faire un rp avec la voix de djeff',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /Djeff|rap|voix/i);
  assert.match(result.assistant, /mati[èe]re|couplet|texte|paroles|base/i);
  assert.doesNotMatch(result.assistant, /Je vois l'idée/i);
  assert.doesNotMatch(result.assistant, /Ce que je prends surtout/i);
});

test('Vivy chat fallback answers simple greetings naturally', async () => {
  const greeting = await buildVivyAiChat({
    conversationId: 'vivy-smalltalk-greeting',
    message: 'salut',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(greeting.ok, true);
  assert.equal(greeting.mode, 'chat');
  assert.match(greeting.assistant, /Salut Djeff|je suis là/i);
  assert.doesNotMatch(greeting.assistant, /Je vois l'idée/i);
  assert.doesNotMatch(greeting.assistant, /Ce que je prends surtout/i);
  assert.doesNotMatch(greeting.assistant, /Je réponds au fond/i);

  const checkIn = await buildVivyAiChat({
    conversationId: 'vivy-smalltalk-checkin',
    message: 'ça va ?',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(checkIn.ok, true);
  assert.equal(checkIn.mode, 'chat');
  assert.match(checkIn.assistant, /je suis là|je te suis/i);
  assert.doesNotMatch(checkIn.assistant, /Ce que je prends surtout/i);
});

test('Vivy chat fallback treats parle normalement as style correction', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-normal-speech',
    message: 'parle normalement',
    history: [
      { role: 'assistant', content: 'Salut Djeff, je suis là.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /reprends normal|réponds directement/i);
  assert.doesNotMatch(result.assistant, /Côté voix/i);
  assert.doesNotMatch(result.assistant, /synthèse audio|référence vocale|trois choses/i);
});

test('Vivy chat fallback answers meta complaints instead of acting like a wall', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-not-a-wall',
    message: 'vivy est une ia ou un mur ?',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /IA|mur|chat vivant|répondre directement/i);
  assert.doesNotMatch(result.assistant, /Je vois l'idée/i);
  assert.doesNotMatch(result.assistant, /Ce que je prends surtout/i);
  assert.doesNotMatch(result.assistant, /Je réponds au fond/i);
});

test('Vivy routes continue les paroles to songcraft and cleans UI/brief contamination', async () => {
  const rawDraft = [
    "Un quatorzième dans l'essence, deux-point-deux dans la bombonne d'Ipone,",
    'Je dose au millimètre, pas de hasard dans le style.',
    'Double radiateur fresh, ça fait de la vapeur, wesh.',
    'La main guide le geste, le Cruxi tourne lucide.',
    'Casque vissé, pignon-couronne cranté.',
    "Le mur du son a une porte et j'ai pas besoin de la clef.",
    'Quand la vitesse monte et que le moteur respire,',
    'Les pneus en guise de crayon.',
  ].join('\n');
  const contaminatedPrompt = [
    'Je suis Vivy. Parle-moi d’une voix, d’une chanson, d’une ambiance ou d’une scène à publier.',
    'Vivy',
    'Oui, je reste en discussion libre.',
    'Je capte: ancien message',
    'VIVY_SONG_PRODUCTION',
    'Source: Conversation',
    'Paroles guide:',
    '[Verse 1 - Djeff]',
    'VIVY_SONG_PRODUCTION',
    'Source: Conversation',
    rawDraft,
    '',
    'VIVY_PRODUCTION',
    'Mix D40 V9 Turbo k 3x · turbo 99 ms · pivot 0.292 · 1024 Même format prêt: https://vivy.funesterie.me/api/double-harmonic/out/example.wav?token=must-not-leak',
    '',
    'continue les paroles',
  ].join('\n');

  assert.equal(isDirectSongwritingRequest(contaminatedPrompt), true);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-continue-djeff-lyrics-clean',
    message: contaminatedPrompt,
    history: [
      { role: 'assistant', content: 'Carte active:\n- audio.voice: pipeline audio A11.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.match(result.assistant, /\[Verse 1 - Djeff\]/);
  assert.match(result.assistant, /quatorzi[èe]me dans l'essence/i);
  assert.doesNotMatch(result.assistant, /Carte active|audio\.voice/i);
  assert.doesNotMatch(result.assistant, /Je suis Vivy|Je capte:/i);
  assert.doesNotMatch(result.assistant, /\[Verse 1 - Djeff\]\s*VIVY_SONG_PRODUCTION/i);
  assert.doesNotMatch(result.assistant, /Mix D40|double-harmonic|must-not-leak|token=/i);
});

test('Vivy chat fallback answers philosophical follow-ups instead of canned notebook text', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-freeform-philosophy',
    message: "et toi qu'en penses tu ?",
    history: [
      {
        role: 'user',
        content: "vivy je vais te poser, une question c'est avec les yeux qu'on voit, avec les oreilles qu'on entend avec la bouche qu'on parle ?",
      },
      {
        role: 'user',
        content: "et bien tout n'est qu'interpretation de donnée par le cerveau",
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /cerveau|interpr[ée]tation|signaux|donn[ée]es/i);
  assert.doesNotMatch(result.assistant, /^Je te suis\./);
  assert.doesNotMatch(result.assistant, /clique sur Chanson/i);
  assert.doesNotMatch(result.assistant, /\*\*Titre :\*\*/);
});

test('Vivy can lower internal intent sensitivity from user feedback', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-internal-tuning',
    message: 'TON INTENT EST R2GL2 TROP HAUT tu peux l ajuster ?',
    history: [
      { role: 'user', content: "et bien tout n'est qu'interpretation de donnée par le cerveau" },
      { role: 'assistant', content: 'Je te suis. Ce que je comprends: et toi qu en penses tu ?' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_internal_tuning');
  assert.equal(result.settings?.chatIntentSensitivity, 'lowered');
  assert.equal(result.settings?.songStructureMode, 'explicit_only');
  assert.match(result.assistant, /intent|r[ée]glage|sensibilit[ée]/i);
  assert.match(result.assistant, /chanson|structure/i);
  assert.doesNotMatch(result.assistant, /^Je te suis\./);
  assert.doesNotMatch(result.assistant, /clique sur Chanson/i);
});

test('Vivy song mode structures the same rap draft when Chanson is explicit', async () => {
  const rapDraft = "course poursuite, shmite aux fesses, métrakit, traces de gomme, giro derrière, skill tree qui se dévoile";

  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-raw-rap',
    mode: 'song',
    message: rapDraft,
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.assistant, /\*\*Titre :\*\*/);
  assert.match(result.assistant, /\[Intro(?: - [^\]]+)?\]/);
  assert.match(result.assistant, /\[Chorus(?: - [^\]]+)?\]/);
});

test('Vivy song fallback extracts a clean summer theme instead of pasting the whole prompt', async () => {
  const summerPrompt = "salut tu as une idée de chanson sur la nature et le soleil, un son d'ambiance pour cet été qui ferait de la techno dance un super tube de crème solaire sous le sable chaud";

  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-summer-theme-clean',
    mode: 'song',
    message: summerPrompt,
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.match(result.assistant, /\[Verse 1(?: - [^\]]+)?\]/);
  assert.match(result.assistant, /nature|soleil|été|ete|sable|techno/i);
  assert.doesNotMatch(result.assistant, /Tout semble petit:/i);
  assert.doesNotMatch(result.assistant, /salut tu as une idée de chanson/i);
  assert.doesNotMatch(result.assistant, /tu as une idée/i);
});

test('Vivy intent header routes Chanson to Djeff songcraft while preserving raw rap grain', async () => {
  const rawDjeffDraft = [
    'VIVY_INTENT',
    'Instruction: Transforme cette idée en chanson Vivy avec structure et refrain.',
    '',
    "un quatorzieme dans la bombonne, 2point 2 dans l'ipone",
    'je dose au millimietre pas de hasard dans le style',
    'double radiateur freshh, pas de ca va salam wesh',
    'la main qui guide les geste le cruxi tourne lucide',
    'Je retoune le temps, la vision sur le pendule',
    'casque vissé, pignon couronne cranté,',
    "Le mur du son a eu porte et j'ai pas besoin de la clef",
    "quand la vitesse monte et et que l'e moteur respire,",
    'les roues en fond tout un rayon, les pneus en guise de crayon',
    "c'est dans ce style la qu'il faut t'écrive",
  ].join('\n');

  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-intent-header-djeff-rap',
    message: rawDjeffDraft,
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(isDirectSongwritingRequest(rawDjeffDraft), true);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.match(result.assistant, /\*\*Titre :\*\*/);
  assert.match(result.assistant, /\[Verse 1 - Djeff\]/);
  assert.match(result.assistant, /quatorzieme dans la bombonne/i);
  assert.match(result.assistant, /2point 2/i);
  assert.match(result.assistant, /freshh/i);
  assert.match(result.assistant, /cruxi/i);
  assert.match(result.assistant, /pneus en guise de crayon/i);
  assert.doesNotMatch(result.assistant, /VIVY_INTENT|Transforme cette idée/i);
  assert.doesNotMatch(result.assistant, /ma[îi]tres? de la vitesse|rois? de la route|je suis libre|je suis en vie/i);
  assert.doesNotMatch(result.assistant, /J'espère que cela correspond|N'hésitez pas/i);
});

test('Vivy song guard writes a fresh Djeff rap duet when the context asks for moto technique', () => {
  const repaired = buildVivyDirectSongReply({
    message: 'Fais une chanson rap technique moto en duo Djeff et Vivy, radiateur pignon couronne essence huile.',
    history: [
      {
        role: 'assistant',
        content: 'Ancien brouillon: Vois Raison Fraiyeur Son.',
      },
    ],
  });

  assert.match(repaired, /Djeff/i);
  assert.match(repaired, /Vivy/i);
  assert.match(repaired, /\[Verse 1 - Djeff\]/);
  assert.match(repaired, /\[Chorus - Duo\]/);
  assert.match(repaired, /radiateur/i);
  assert.match(repaired, /pignon/i);
  assert.doesNotMatch(repaired, /Garde la lumière/);
  assert.doesNotMatch(repaired, /Vois Raison Fraiyeur Son/i);
});

test('Vivy chat post-process removes leaked draft placeholders without over-restricting', () => {
  const result = postProcessVivyAssistantText({
    text: "Sure, here's a short reply to the last message.",
    userMessage: 'pour faire quoi ?',
    systemPrompt: buildVivySystemPrompt('song', 'fr'),
  });

  assert.equal(result.rewritten, true);
  assert.match(result.content, /Pardon|bugué|dernier message/i);
  assert.doesNotMatch(result.content, /short reply/i);
  assert.doesNotMatch(result.content, /Sure/i);
  assert.doesNotMatch(result.content, /The user wants/i);
});

test('Vivy recognizes MCP/Neo4j follow-up without inventing Mode Creatif Propulse', async () => {
  assert.equal(isVivyMcpNeo4jQuestion({
    history: [{ role: 'user', content: 'tu peux utiliser Neo4j pour cette chanson ?' }],
  }, 'avec le mcp'), true);
  assert.equal(isVivyToolCapabilityQuestion({
    history: [{ role: 'user', content: 'tu peux utiliser Neo4j pour cette chanson ?' }],
  }, 'avec le mcp'), false);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-mcp-test',
    message: 'avec le mcp',
    history: [
      { role: 'user', content: 'tu peux utiliser Neo4j pour cette chanson ?' },
      { role: 'assistant', content: "Je n'ai pas d'accès direct à Neo4j." },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.aiMode, 'deterministic_mcp');
  assert.match(result.assistant, /Model Context Protocol/i);
  assert.match(result.assistant, /pont A11\/Codex/i);
  assert.match(result.assistant, /Neo4j/i);
  assert.doesNotMatch(result.assistant, /Mode Créatif Propulsé/i);
  assert.doesNotMatch(result.assistant, /IA isolée/i);
  assert.doesNotMatch(result.assistant, /aucun accès/i);
});

test('Vivy maps authorized tools and Zen GGUF without bypassing safeguards', async () => {
  const message = 'oui fais ca pour tout les outils et commande interne, avec zen on peut acceder au uggf et decortiqer la crevette';

  assert.equal(isVivyToolCapabilityQuestion({
    history: [{ role: 'assistant', content: 'Je peux router les outils autorisés.' }],
  }, message), true);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-tool-capability-test',
    message,
    history: [
      { role: 'assistant', content: 'Je peux router les outils autorisés.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_tool_capabilities');
  assert.match(result.assistant, /outils autorisés|carte d'outils/i);
  assert.match(result.assistant, /Zen|\.zen|@funeste\/zen/i);
  assert.match(result.assistant, /GGUF|uggf/i);
  assert.match(result.assistant, /metadata-only|métadonnées|metadata/i);
  assert.match(result.assistant, /pas de shell arbitraire|commande devient un intent/i);
  assert.doesNotMatch(result.assistant, /désactiver les garde-fous|faire sauter les garde-fous/i);
  assert.ok(result.localContext);
  assert.ok(Array.isArray(result.localContext.artifacts));
  assert.match(JSON.stringify(result.actions), /gguf_inventory|zen_inspect|tool_capability_map/);
});

test('POST /api/vivy/studio/chat stores semantic context and accepts file metadata', async () => {
  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: acceptVivyTestAuth }));
  }, async (baseUrl) => {
    const { response, json } = await postJson(baseUrl, '/api/vivy/studio/chat', {
      conversationId: 'vivy-test-conversation',
      message: 'Garde cette idée de chanson intime pour Vivy.',
      files: [{
        filename: 'idée-vivy.txt',
        contentType: 'text/plain',
        sizeBytes: 54,
        textPreview: 'Nossen sous la pluie, voix proche, refrain doux.',
      }],
    }, VIVY_TEST_AUTH_HEADERS);

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.service, 'vivy-chat');
    assert.equal(json.language, 'fr');
    assert.equal(json.memoryStored, true);
    assert.equal(json.semanticMemory.stored, true);
    assert.match(json.assistant, /Vivy|idée/i);
    assert.doesNotMatch(JSON.stringify(json), /secret-token-value/);
    assert.doesNotMatch(JSON.stringify(json), /Ã|Â|â€|�/);
  });
});

test('Vivy answers image inspection from attached images instead of continuing lyrics', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-image-context-test',
    message: "non ca c'est les titres mais ce sont des fichiers image, que vois tu dedan ?",
    history: [
      { role: 'user', content: "mais NOSSEN c'est la liaison entre le monde réel et le monde Funesterie" },
      { role: 'assistant', content: '[Verse 3 - Djeff]\nJe roule dans les deux mondes.' },
    ],
    files: [
      {
        filename: 'beta 1ere transfo.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 94 * 1024,
        description: 'On voit une vraie base scooter/moto Beta en transformation, référence mécanique réelle pour NOSSEN.',
        uploaded: true,
      },
      {
        filename: 'beta neuve poignée.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 70 * 1024,
        visualDescription: 'Image de poignée neuve et détails de poste de pilotage, pas un décor virtuel.',
        uploaded: true,
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_image_context');
  assert.match(result.assistant, /images réelles jointes/i);
  assert.match(result.assistant, /beta 1ere transfo\.jpg/i);
  assert.match(result.assistant, /scooter|moto|Beta/i);
  assert.match(result.assistant, /poignée neuve|poste de pilotage/i);
  assert.doesNotMatch(result.assistant, /\[Verse|\[Refrain|\[Chorus/i);
  assert.doesNotMatch(result.assistant, /je vais continuer|modèle de langage|capacité de visualiser/i);
});

test('Vivy hides technical vision fallback garbage from image answers', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-image-fallback-clean-test',
    message: 'que vois tu ?',
    files: [
      {
        filename: 'boosters 5.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 42 * 1024,
        description: 'Vision avancée indisponible; lecture locale de secours uniquement: 453x604px, format jpeg, 42 Ko. OCR texte lisible: PE. all & 4% A. Ne deduis pas le sujet visuel de ce fallback.',
        visualDescription: 'Image reçue par A11 (jpeg, 453x604, 42 Ko). Vision détaillée disponible côté chat.',
        analysis: {
          width: 453,
          height: 604,
          format: 'jpeg',
          originalBytes: 42 * 1024,
          readableInChatContext: true,
        },
        uploaded: true,
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_image_context');
  assert.match(result.assistant, /boosters 5\.jpg/i);
  assert.match(result.assistant, /453x604|42 Ko|image reçue/i);
  assert.doesNotMatch(result.assistant, /Vision avancée indisponible|lecture locale de secours|OCR texte lisible|Ne deduis|Ne déduis/i);
  assert.doesNotMatch(result.assistant, /\[Verse|\[Refrain|\[Chorus/i);
});

test('Vivy can use the vision LLM fallback when Janus returns only local metadata', async () => {
  const previousProvider = process.env.A11_VISION_PROVIDER;
  const previousFixture = process.env.VIVY_IMAGE_VISION_FIXTURE;
  const previousDisableLlm = process.env.VIVY_CHAT_DISABLE_LLM;
  const previousOcrEnabled = process.env.IMAGE_OCR_ENABLED;
  process.env.A11_VISION_PROVIDER = 'none';
  process.env.VIVY_CHAT_DISABLE_LLM = 'true';
  process.env.IMAGE_OCR_ENABLED = 'false';
  process.env.VIVY_IMAGE_VISION_FIXTURE = 'On voit un booster/scooter photographié en extérieur, avec une carrosserie bleue et des détails mécaniques visibles.';
  try {
    const result = await buildVivyAiChat({
      conversationId: 'vivy-image-vision-llm-fallback-test',
      message: 'que vois tu ?',
      files: [
        {
          filename: 'boosters 5.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 42 * 1024,
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYdX3wAAAABJRU5ErkJggg==',
          uploaded: true,
        },
      ],
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'chat');
    assert.equal(result.aiMode, 'deterministic_image_context');
    assert.match(result.assistant, /booster\/scooter|carrosserie bleue|détails mécaniques/i);
    assert.doesNotMatch(result.assistant, /Vision avancée indisponible|lecture locale de secours|OCR texte lisible|Ne deduis|Ne déduis/i);
  } finally {
    if (previousProvider == null) delete process.env.A11_VISION_PROVIDER;
    else process.env.A11_VISION_PROVIDER = previousProvider;
    if (previousFixture == null) delete process.env.VIVY_IMAGE_VISION_FIXTURE;
    else process.env.VIVY_IMAGE_VISION_FIXTURE = previousFixture;
    if (previousDisableLlm == null) delete process.env.VIVY_CHAT_DISABLE_LLM;
    else process.env.VIVY_CHAT_DISABLE_LLM = previousDisableLlm;
    if (previousOcrEnabled == null) delete process.env.IMAGE_OCR_ENABLED;
    else process.env.IMAGE_OCR_ENABLED = previousOcrEnabled;
  }
});

test('Vivy auto-analyzes readable attached files when the message points at them', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-file-context-test',
    message: 'voici le corpus, tu en penses quoi ?',
    history: [
      { role: 'assistant', content: '[Verse 1]\nJe repars en chanson.' },
    ],
    files: [
      {
        filename: 'corpus-nossen.zen',
        contentType: 'text/plain',
        sizeBytes: 420,
        textPreview: 'NOSSEN = liaison entre monde réel et monde Funesterie. Les pièces réelles ancrent le graphe.',
        uploaded: true,
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_file_context');
  assert.match(result.assistant, /analyse de fichiers joints/i);
  assert.match(result.assistant, /corpus-nossen\.zen/i);
  assert.match(result.assistant, /liaison entre monde réel et monde Funesterie/i);
  assert.doesNotMatch(result.assistant, /\[Verse|\[Refrain|\[Chorus/i);
});

test('Vivy uses safe local context for Janus runtime and code questions', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-local-context-test',
    message: "janus vision runtime local, tu peux regarder ton code et tes dossiers ?",
    history: [
      { role: 'assistant', content: "Je ne peux pas accéder aux fichiers locaux." },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_local_context');
  assert.match(result.assistant, /contexte local/i);
  assert.match(result.assistant, /Janus Vision/i);
  assert.match(result.assistant, /Runtime canonique/i);
  assert.ok(result.localContext);
  assert.ok(Array.isArray(result.localContext.runtimeDirs));
  assert.doesNotMatch(JSON.stringify(result), /\.env|secret-token-value|private key/i);
});

test('Vivy web research query strips chat filler and keeps film context', () => {
  const query = buildVivyWebSearchQuery(
    "non j'ai cherché sur internet et puis je l'ai pas vu en entier juste quelques extrait, mais il a l'air trop bien on dirait echiro oda dedans",
    [],
    [
      { role: 'user', content: "je crois que c'est REAL de Kiyoshi Kurosawa" },
      { role: 'assistant', content: "Oui, c'est REAL." },
    ]
  );

  assert.match(query, /REAL/i);
  assert.match(query, /Kiyoshi Kurosawa/i);
  assert.match(query, /Eiichiro Oda/i);
  assert.doesNotMatch(query, /j['’]?ai|cherch|pas vu|quelques extrait|trop bien/i);
});

test('Vivy web research ignores Codex operator transcript lines', async () => {
  const operatorTranscript = "codex : Je reprends le fil: le texte collé montre surtout que Vivy a cherché la phrase entière au lieu d'extraire le vrai sujet. Je vais verrouiller ça côté serveur: requête web plus propre, contexte historique pris en compte, puis test et déploiement si tout";

  assert.equal(shouldVivyAutoWebSearch(operatorTranscript, 'chat'), false);

  const query = buildVivyWebSearchQuery(operatorTranscript, [], []);
  assert.equal(query, 'Funesterie Vivy');
  assert.doesNotMatch(query, /codex|requ[eê]te web|déploiement|deploiement|Je reprends/i);

  const previousFixture = process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE;
  process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE = JSON.stringify({
    ok: true,
    results: [{ title: 'Should not be used', url: 'https://example.test/nope', snippet: 'not used' }],
  });
  try {
    const result = await buildVivyAiChat({
      conversationId: 'vivy-codex-transcript-test',
      message: operatorTranscript,
      history: [],
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'chat');
    assert.notEqual(result.aiMode, 'deterministic_web_research');
    assert.doesNotMatch(result.assistant, /Je déclenche une recherche web|Should not be used/i);
  } finally {
    if (previousFixture === undefined) {
      delete process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE;
    } else {
      process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE = previousFixture;
    }
  }
});

test('Vivy does not recurse on its own rendered web research answer', () => {
  const renderedResearch = [
    "Je déclenche une recherche web parce que ta demande dépend probablement d'une info externe ou récente.",
    "Recherche: codex : Je reprends le fil: requête web plus propre, contexte historique pris en compte.",
    '',
    'Résultats utiles:',
    '- Analyseur de phrases françaises - Lexis Rex (https://www.lexisrex.com/Français/Étude-de-la-Phrase)',
    '- Comment utiliser OpenAI Codex (https://example.test/codex)',
    '',
    "Je m'appuie sur ces sources plutôt que d'inventer une certitude de tête.",
  ].join('\n');

  assert.equal(shouldVivyAutoWebSearch(renderedResearch, 'chat'), false);
  assert.equal(buildVivyWebSearchQuery(renderedResearch, [], []), 'Funesterie Vivy');
});

test('Vivy triggers web research for current external information instead of guessing', async () => {
  const previousFixture = process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE;
  process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE = JSON.stringify({
    ok: true,
    results: [
      {
        title: '@nossen/all-in-one - npm',
        url: 'https://www.npmjs.com/package/@nossen/all-in-one',
        snippet: 'Package page with the latest published version and metadata.',
      },
    ],
  });
  try {
    const result = await buildVivyAiChat({
      conversationId: 'vivy-web-research-test',
      message: "c'est quoi la dernière version de @nossen/all-in-one sur npm ?",
      history: [
        { role: 'assistant', content: 'Je crois que je sais de mémoire.' },
      ],
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'chat');
    assert.equal(result.aiMode, 'deterministic_web_research');
    assert.equal(result.webSearch.ok, true);
    assert.match(result.assistant, /recherche web/i);
    assert.match(result.assistant, /@nossen\/all-in-one - npm/i);
    assert.match(result.assistant, /https:\/\/www\.npmjs\.com\/package\/@nossen\/all-in-one/i);
    assert.doesNotMatch(result.assistant, /je crois|de mémoire/i);
  } finally {
    if (previousFixture === undefined) {
      delete process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE;
    } else {
      process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE = previousFixture;
    }
  }
});

test('POST /api/vivy/studio/chat requires a logged-in user when auth is configured', async () => {
  const verifyJWT = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-test-token') {
      req.user = { id: 'vivy-auth-user', username: 'VivyUser' };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT }));
  }, async (baseUrl) => {
    const missingAuth = await postJson(baseUrl, '/api/vivy/studio/chat', {
      message: 'Garde cette idée privée.',
    });
    assert.equal(missingAuth.response.status, 401);
    assert.equal(missingAuth.json.error, 'A11_JWT_Missing');

    const authenticated = await postJson(baseUrl, '/api/vivy/studio/chat', {
      message: 'Garde cette idée privée.',
    }, {
      Authorization: 'Bearer vivy-test-token',
    });
    assert.equal(authenticated.response.status, 200);
    assert.equal(authenticated.json.ok, true);
    assert.equal(authenticated.json.memoryStored, true);
  });
});

test('POST /api/vivy/studio/produce requires a logged-in user when auth is configured', async () => {
  const verifyJWT = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-test-token') {
      req.user = { id: 'vivy-auth-user', username: 'VivyUser' };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT }));
  }, async (baseUrl) => {
    const missingAuth = await postJson(baseUrl, '/api/vivy/studio/produce', {
      mode: 'song',
      theme: 'Nossen sous la pluie',
    });
    assert.equal(missingAuth.response.status, 401);
    assert.equal(missingAuth.json.error, 'A11_JWT_Missing');

    const authenticated = await postJson(baseUrl, '/api/vivy/studio/produce', {
      mode: 'song',
      theme: 'Nossen sous la pluie',
    }, {
      Authorization: 'Bearer vivy-test-token',
    });
    assert.equal(authenticated.response.status, 200);
    assert.equal(authenticated.json.ok, true);
    assert.equal(authenticated.json.mode, 'song');
  });
});
