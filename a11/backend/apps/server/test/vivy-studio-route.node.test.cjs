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
  buildVivyStudioProduction,
  buildVivySystemPrompt,
  buildVivySunoPayload,
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

test('POST /api/vivy/studio/produce starts an async Suno music job for founder accounts', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_MUSIC_PROVIDER: process.env.VIVY_MUSIC_PROVIDER,
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_API_KEY_FILE: process.env.VIVY_ELEVENLABS_API_KEY_FILE,
  };
  const previousFetch = global.fetch;
  const bodies = [];
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
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
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: 'Vivy danse dans les néons.',
        songMood: 'cyber pop mélodique',
        forceRealMusic: true,
      }, { Authorization: 'Bearer vivy-founder-token' });

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
  assert.match(prompt, /pas de réponse toute faite/i);
  assert.match(prompt, /Module Vivy Songcraft actif/i);
  assert.match(prompt, /rimes audibles/i);
  assert.match(prompt, /autorisé\/licencié\/consenti/i);
  assert.doesNotMatch(prompt, /clone Kairi/i);
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
