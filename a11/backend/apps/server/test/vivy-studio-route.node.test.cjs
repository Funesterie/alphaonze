const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const vivyMemoryDir = path.join(os.tmpdir(), `vivy-studio-test-memory-${process.pid}`);
process.env.A11_EPISODIC_MEMORY_DIR = vivyMemoryDir;
process.env.VIVY_CHAT_DISABLE_LLM = 'true';

const { createVivyStudioRouter, buildVivyStudioProduction } = require('../src/routes/vivy-studio.cjs');

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
    app.use('/api/vivy/studio', createVivyStudioRouter());
  }, async (baseUrl) => {
    const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
      mode: 'share',
      shareTarget: 'YouTube',
      shareUrl: 'https://youtube.com/@funesterie',
      shareInstruction: 'clip vertical 30s',
      shareToken: 'secret-token-value',
      shareTokenPresent: true,
    });

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.mode, 'share');
    assert.equal(json.tokenStored, false);
    assert.match(json.brief, /VIVY_SCENE_SHARE/);
    assert.match(json.brief, /Token fourni dans UI: oui, non envoyé au serveur/);
    assert.doesNotMatch(JSON.stringify(json), /secret-token-value/);
  });
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

test('POST /api/vivy/studio/chat stores semantic context and accepts file metadata', async () => {
  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter());
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
    });

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
