const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const createChatRouter = require('../src/routes/chat.cjs');
const createProtectedChatProxyRouter = require('../src/routes/protected-chat-proxy.cjs');
const maskRouter = require('../src/routes/mask.cjs');
const createDecommissionedDevRoutesRouter = require('../src/routes/decommissioned-dev-routes.cjs');
const compileMaskToSD = require('../src/mask/compile-mask-to-sd.cjs');
const adaptMaskToFreelandValue = require('../src/mask/adapt-mask-to-freeland-value.cjs');
const normalizeMaskImageGenerate = require('../src/mask/normalize-mask-image-generate.cjs');

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
      server.close((error_) => (error_ ? reject(error_) : resolve()));
    });
  }
}

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
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

test('POST /api/mask/compile returns 200 for a valid mask', async () => {
  await withServer(
    (app) => {
      app.use('/api/mask', maskRouter);
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/mask/compile', {
        version: 'mask-1',
        intent: 'code.python.generate',
        task: { domain: 'filesystem', action: 'sort_images' },
        compiler: { target: 'python', version: '1.0' },
        inputs: { path: '.', extensions: ['png'] },
        options: { sort_by: 'date', recursive: false },
        constraints: { safe_mode: true, no_delete: true },
      });

      assert.equal(response.status, 200);
      assert.equal(typeof json.code, 'string');
      assert.match(json.code, /import os|from pathlib import Path/);
    }
  );
});

test('POST /api/mask/compile returns 400 for invalid masks and compiles image masks through the unified dispatcher', async () => {
  await withServer(
    (app) => {
      app.use('/api/mask', maskRouter);
    },
    async (baseUrl) => {
      const invalid = await postJson(baseUrl, '/api/mask/compile', { foo: 'bar' });
      assert.equal(invalid.response.status, 400);
      assert.equal(typeof invalid.json.error, 'string');

      const imageMask = await postJson(baseUrl, '/api/mask/compile', {
        version: 'mask-1',
        intent: 'image.generate',
        task: { domain: 'image', action: 'generate' },
        compiler: { target: 'sd-payload', version: '1.0' },
        inputs: {
          subject: ['orange cat'],
          environment: [],
          style: ['high quality'],
          composition: [],
          lighting: [],
          palette: [],
        },
        options: { width: 768, height: 768, steps: 30, guidance_scale: 7.5 },
        constraints: { safe_mode: true, no_text: true },
        ambiguities: [],
        raw: 'genere une image de chat orange',
      });
      assert.equal(imageMask.response.status, 200);
      assert.equal(imageMask.json.target, 'sd-payload');
      assert.equal(typeof imageMask.json.compiled?.prompt, 'string');
      assert.equal(typeof imageMask.json.compiled?.negative_prompt, 'string');
    }
  );
});

test('POST /api/mask/from-text validates missing, empty, recognized, and unknown inputs', async () => {
  await withServer(
    (app) => {
      app.use('/api/mask', maskRouter);
    },
    async (baseUrl) => {
      const missing = await postJson(baseUrl, '/api/mask/from-text', {});
      assert.equal(missing.response.status, 400);
      assert.equal(missing.json.error, 'missing_message');

      const empty = await postJson(baseUrl, '/api/mask/from-text', { text: '' });
      assert.equal(empty.response.status, 400);
      assert.equal(empty.json.error, 'missing_message');

      const recognized = await postJson(baseUrl, '/api/mask/from-text', {
        text: 'trie les png de ce dossier par date',
      });
      assert.equal(recognized.response.status, 200);
      assert.equal(recognized.json.ok, true);
      assert.equal(recognized.json.mask.intent, 'code.python.generate');

      const unknown = await postJson(baseUrl, '/api/mask/from-text', {
        text: 'fais un truc bizarre',
      });
      assert.equal(unknown.response.status, 400);
      assert.equal(unknown.json.error, 'no_mask_match');

    }
  );
});

test('deprecated dev routes return 410 Gone', async () => {
  await withServer(
    (app) => {
      app.use('/api', createDecommissionedDevRoutesRouter());
    },
    async (baseUrl) => {
      const chatDev = await postJson(baseUrl, '/api/chat/dev', { message: 'hello' });
      assert.equal(chatDev.response.status, 410);
      assert.equal(chatDev.json.error, 'gone');

      const chatMask = await postJson(baseUrl, '/api/chat/mask', { text: 'trie les png' });
      assert.equal(chatMask.response.status, 410);
      assert.equal(chatMask.json.error, 'gone');

      const editHealth = await fetch(baseUrl + '/api/edit/health');
      assert.equal(editHealth.status, 410);

      const vsStatus = await fetch(baseUrl + '/api/v1/vs/status');
      assert.equal(vsStatus.status, 410);
    }
  );
});

test('POST /api/llm/chat returns an image completion payload for authenticated image requests', async () => {
  const jwtSecret = 'test-secret';
  const token = jwt.sign({ id: 'user-1', username: 'user-1' }, jwtSecret, { expiresIn: '1h' });

  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(req, res, next) {
          try {
            const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
            req.user = jwt.verify(bearer, jwtSecret);
            next();
          } catch (error_) {
            res.status(401).json({ ok: false, error: 'invalid_jwt', message: String(error_?.message || error_) });
          }
        },
        proxyChatToOpenAI(_req, res) {
          return res.json({
            choices: [{ message: { role: 'assistant', content: 'fallback llm' } }],
          });
        },
        detectImageIntent: () => true,
        detectWebImageIntent: () => false,
        hasLocalChatUpstreamConfigured: () => true,
        generateSd: async () => ({
          ok: true,
          artifact_type: 'image',
          image_url: 'https://files.example.com/generated.png',
          filename: 'generated.png',
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        a11Dev: true,
        messages: [{ role: 'user', content: 'genere une image de chat orange' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'generate_sd');
      assert.equal(json.artifact_type, 'image');
      assert.equal(json.imagePath, 'https://files.example.com/generated.png');
      assert.equal(json.a11Agent.imagePath, 'https://files.example.com/generated.png');
      assert.match(String(json.choices?.[0]?.message?.content || ''), /image est pr[êe]te/i);
    }
  );
});

test('POST /api/llm/chat reuses a recent identical image request instead of generating twice', async () => {
  const jwtSecret = 'test-secret';
  const token = jwt.sign({ id: 'user-1', username: 'user-1' }, jwtSecret, { expiresIn: '1h' });
  let generateCalls = 0;

  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(req, res, next) {
          try {
            const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
            req.user = jwt.verify(bearer, jwtSecret);
            next();
          } catch (error_) {
            res.status(401).json({ ok: false, error: 'invalid_jwt', message: String(error_?.message || error_) });
          }
        },
        proxyChatToOpenAI(_req, res) {
          return res.json({
            choices: [{ message: { role: 'assistant', content: 'fallback llm' } }],
          });
        },
        detectImageIntent: () => true,
        detectWebImageIntent: () => false,
        hasLocalChatUpstreamConfigured: () => true,
        generateSd: async () => {
          generateCalls += 1;
          return {
            ok: true,
            artifact_type: 'image',
            image_url: `https://files.example.com/generated-${generateCalls}.png`,
            filename: `generated-${generateCalls}.png`,
          };
        },
      }));
    },
    async (baseUrl) => {
      const body = {
        a11Dev: true,
        conversationId: 'conv-1',
        messages: [{ role: 'user', content: 'genere une image de lapin rose' }],
      };

      const first = await postJson(baseUrl, '/api/llm/chat', body, {
        authorization: `Bearer ${token}`,
      });
      const second = await postJson(baseUrl, '/api/llm/chat', body, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(first.response.status, 200);
      assert.equal(second.response.status, 200);
      assert.equal(first.json.imagePath, 'https://files.example.com/generated-1.png');
      assert.equal(second.json.imagePath, 'https://files.example.com/generated-1.png');
      assert.equal(generateCalls, 1);
    }
  );
});

test('POST /api/llm/chat uses the image brain for non-explicit but visual prompts', async () => {
  const jwtSecret = 'test-secret';
  const token = jwt.sign({ id: 'user-1', username: 'user-1' }, jwtSecret, { expiresIn: '1h' });

  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(req, res, next) {
          try {
            const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
            req.user = jwt.verify(bearer, jwtSecret);
            next();
          } catch (error_) {
            res.status(401).json({ ok: false, error: 'invalid_jwt', message: String(error_?.message || error_) });
          }
        },
        proxyChatToOpenAI(_req, res) {
          return res.json({
            choices: [{ message: { role: 'assistant', content: 'fallback llm' } }],
          });
        },
        hasLocalChatUpstreamConfigured: () => true,
        generateSd: async ({ body }) => ({
          ok: true,
          artifact_type: 'image',
          image_url: 'https://files.example.com/donkey-kong.png',
          filename: 'donkey-kong.png',
          prompt: body?.prompt,
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        a11Dev: true,
        messages: [{ role: 'user', content: 'fais-moi un donkey kong cartoon' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'generate_sd');
      assert.equal(json.imagePath, 'https://files.example.com/donkey-kong.png');
      assert.match(String(json.choices?.[0]?.message?.content || ''), /image est pr[êe]te/i);
      assert.equal(json.kind, 'image.generate');
      assert.equal(json.pipeline, 'intent-router-v2');
    }
  );
});

test('POST /api/llm/chat returns a web image payload for image search prompts', async () => {
  const jwtSecret = 'test-secret';
  const token = jwt.sign({ id: 'user-1', username: 'user-1' }, jwtSecret, { expiresIn: '1h' });

  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(req, res, next) {
          try {
            const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
            req.user = jwt.verify(bearer, jwtSecret);
            next();
          } catch (error_) {
            res.status(401).json({ ok: false, error: 'invalid_jwt', message: String(error_?.message || error_) });
          }
        },
        proxyChatToOpenAI(_req, res) {
          return res.json({
            choices: [{ message: { role: 'assistant', content: 'fallback llm' } }],
          });
        },
        hasLocalChatUpstreamConfigured: () => true,
        duckduckgoImageSearch: async (subject) => ({
          image_url: `https://images.example.com/${encodeURIComponent(subject)}.png`,
          source_url: 'https://example.com/source',
          title: subject,
        }),
        generateSd: async () => {
          throw new Error('should_not_be_called');
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        messages: [{ role: 'user', content: 'montre-moi une image de mario 64' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.artifact_type, 'web_image');
      assert.match(String(json.image_url || ''), /mario%2064\.png$/i);
      assert.match(String(json.imagePath || ''), /mario%2064\.png$/i);
      assert.match(String(json.content || json.choices?.[0]?.message?.content || ''), /ouvrir l'image/i);
    }
  );
});

test('POST /api/llm/chat returns the same image payload without requiring dev mode', async () => {
  const jwtSecret = 'test-secret';
  const token = jwt.sign({ id: 'user-1', username: 'user-1' }, jwtSecret, { expiresIn: '1h' });

  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(req, res, next) {
          try {
            const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
            req.user = jwt.verify(bearer, jwtSecret);
            next();
          } catch (error_) {
            res.status(401).json({ ok: false, error: 'invalid_jwt', message: String(error_?.message || error_) });
          }
        },
        proxyChatToOpenAI(_req, res) {
          return res.json({
            choices: [{ message: { role: 'assistant', content: 'fallback llm' } }],
          });
        },
        detectImageIntent: () => true,
        detectWebImageIntent: () => false,
        hasLocalChatUpstreamConfigured: () => true,
        generateSd: async () => ({
          ok: true,
          artifact_type: 'image',
          image_url: 'https://files.example.com/generated-without-dev.png',
          filename: 'generated-without-dev.png',
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        messages: [{ role: 'user', content: 'genere une image de chat orange' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.kind, 'image.generate');
      assert.equal(json.mode, 'generate_sd');
      assert.equal(json.imagePath, 'https://files.example.com/generated-without-dev.png');
      assert.equal(json.pipeline, 'intent-router-v2');
    }
  );
});

test('POST /api/llm/chat does not force provider=local when a remote provider is configured', async () => {
  const jwtSecret = 'test-secret';
  const token = jwt.sign({ id: 'user-1', username: 'user-1' }, jwtSecret, { expiresIn: '1h' });
  const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
  const previousOpenAiModel = process.env.OPENAI_MODEL;
  const previousLocalLlmUrl = process.env.LOCAL_LLM_URL;
  const previousLocalMode = process.env.A11_LOCAL_MODE;
  const previousRuntimeProfile = process.env.A11_RUNTIME_PROFILE;
  const previousDefaultUpstream = process.env.DEFAULT_UPSTREAM;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_MODEL = 'test-remote-model';
  process.env.LOCAL_LLM_URL = 'http://127.0.0.1:8080';
  delete process.env.A11_LOCAL_MODE;
  delete process.env.A11_RUNTIME_PROFILE;
  delete process.env.DEFAULT_UPSTREAM;

  try {
    await withServer(
      (app) => {
        app.use('/api', createProtectedChatProxyRouter({
          verifyJWT(req, res, next) {
            try {
              const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
              req.user = jwt.verify(bearer, jwtSecret);
              next();
            } catch (error_) {
              res.status(401).json({ ok: false, error: 'invalid_jwt', message: String(error_?.message || error_) });
            }
          },
          proxyChatToOpenAI(req, res) {
            return res.json({
              provider: req.body?.provider || null,
              model: req.body?.model || null,
            });
          },
          detectImageIntent: () => false,
          detectWebImageIntent: () => false,
          generateSd: async () => {
            throw new Error('should_not_be_called');
          },
        }));
      },
      async (baseUrl) => {
        const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
          messages: [{ role: 'user', content: 'ecris un petit poeme' }],
        }, {
          authorization: `Bearer ${token}`,
        });

        assert.equal(response.status, 200);
        assert.equal(json.provider, null);
        assert.equal(json.model, 'test-remote-model');
      }
    );
  } finally {
    if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    if (previousOpenAiModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousOpenAiModel;
    if (previousLocalLlmUrl === undefined) delete process.env.LOCAL_LLM_URL;
    else process.env.LOCAL_LLM_URL = previousLocalLlmUrl;
    if (previousLocalMode === undefined) delete process.env.A11_LOCAL_MODE;
    else process.env.A11_LOCAL_MODE = previousLocalMode;
    if (previousRuntimeProfile === undefined) delete process.env.A11_RUNTIME_PROFILE;
    else process.env.A11_RUNTIME_PROFILE = previousRuntimeProfile;
    if (previousDefaultUpstream === undefined) delete process.env.DEFAULT_UPSTREAM;
    else process.env.DEFAULT_UPSTREAM = previousDefaultUpstream;
  }
});

test('POST /api/chat propagates SD errors instead of returning a generic 500', async () => {
  await withServer(
    (app) => {
      app.use('/api', createChatRouter({
        openaiClient: null,
        detectImageIntent: () => true,
        detectWebImageIntent: () => false,
        extractWebImageSubject: () => null,
        duckduckgoImageSearch: async () => {
          throw new Error('should_not_be_called');
        },
        generateSd: async () => {
          const error = new Error('Stable Diffusion désactivé sur cet environnement');
          error.statusCode = 503;
          error.payload = {
            ok: false,
            error: 'sd_disabled',
            message: 'Stable Diffusion désactivé sur cet environnement',
          };
          throw error;
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/chat', {
        message: 'genere une image de chat orange',
      });

      assert.equal(response.status, 503);
      assert.equal(json.error, 'sd_disabled');
      assert.equal(json.ok, false);
    }
  );
});

test('compileMaskToSD returns a raw payload and adaptMaskToFreelandValue wraps it once', () => {
  const mask = normalizeMaskImageGenerate({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'sd-payload', version: '1.0' },
    inputs: {
      subject: ['orange cat in a rainy street'],
      environment: [],
      style: ['high quality', 'detailed'],
      composition: [],
      lighting: [],
      palette: [],
    },
    options: {
      width: 768,
      height: 768,
      steps: 40,
      guidance_scale: 8,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    ambiguities: [],
    raw: 'genere une image de chat orange dans une rue sous la pluie',
  });

  const compiledPayload = compileMaskToSD(mask);
  assert.equal(typeof compiledPayload.prompt, 'string');
  assert.equal(compiledPayload.kind, undefined);
  assert.equal(compiledPayload.value, undefined);

  const adapted = adaptMaskToFreelandValue(mask, compiledPayload);
  assert.equal(adapted.kind, 'image.generate');
  assert.equal(adapted.state, 'ready');
  assert.deepEqual(adapted.value, compiledPayload);

  const adaptedAgain = adaptMaskToFreelandValue(mask, adapted);
  assert.deepEqual(adaptedAgain.value, compiledPayload);
  assert.equal(adaptedAgain.kind, 'image.generate');
});
