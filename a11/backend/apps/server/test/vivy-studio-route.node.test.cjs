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
  isDirectSongwritingRequest,
  isVivyMcpNeo4jQuestion,
  looksLikeWeakSongwritingReply,
  postProcessVivyAssistantText,
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
  assert.match(result.brief, /Djeff\/A11 officielle/);
  assert.match(result.brief, /chaîne sur couronne|chaine sur couronne/i);
  assert.match(result.brief, /Ne pas publier la référence brute/);
  assert.match(JSON.stringify(result.actions), /Tester Voix Djeff rap/);
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

test('POST /api/vivy/studio/produce can generate real ElevenLabs music for founder accounts', async () => {
  const previousEnv = {
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_BASE_URL: process.env.VIVY_ELEVENLABS_BASE_URL,
    VIVY_ELEVENLABS_MUSIC_MODEL: process.env.VIVY_ELEVENLABS_MUSIC_MODEL,
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
  process.env.VIVY_ELEVENLABS_BASE_URL = 'https://api.elevenlabs.test/v1';
  process.env.VIVY_ELEVENLABS_MUSIC_MODEL = 'music_v1';
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
  assert.match(prompt, /tutoyant/i);
  assert.match(prompt, /fin de ligne/i);
  assert.match(prompt, /autorisé\/licencié\/consenti/i);
  assert.doesNotMatch(prompt, /clone Kairi/i);
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
