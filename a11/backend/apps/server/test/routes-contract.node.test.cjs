const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const createChatRouter = require('../src/routes/chat.cjs');
const createProtectedChatProxyRouter = require('../src/routes/protected-chat-proxy.cjs');
const createVideoGenerateRouter = require('../src/routes/video-generate.cjs');
const createImageCardinalityDebugRouter = require('../src/routes/image-cardinality-debug.cjs');
const createImageAtelierRouter = require('../src/routes/image-atelier.cjs');
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
        compiler: { target: 'image-prompt-fr', version: '1.0' },
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
      assert.equal(imageMask.json.target, 'image-prompt-fr');
      assert.equal(typeof imageMask.json.compiled?.prompt, 'string');
      assert.match(String(imageMask.json.compiled?.negative_prompt || ''), /plusieurs sujets/i);
      assert.match(String(imageMask.json.compiled?.prompt || ''), /Demande utilisateur|Sujet principal/i);
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

test('POST /api/image/atelier rejects requests without message or mask', async () => {
  await withServer(
    (app) => {
      app.use('/api', createImageAtelierRouter({
        runImageAtelier: async () => {
          throw new Error('should_not_be_called');
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/image/atelier', {});
      assert.equal(response.status, 400);
      assert.equal(json.error, 'missing_image_input');
    }
  );
});

test('POST /api/image/atelier supports message-only requests and returns atelier metadata', async () => {
  await withServer(
    (app) => {
      app.use('/api', createImageAtelierRouter({
        runImageAtelier: async ({ message }) => {
          assert.equal(message, 'genere une image de pomme');
          return {
            sdResult: {
              ok: true,
              tool: 'generate_image',
              artifact_type: 'image',
              image_url: 'https://files.example.com/atelier-apple.png',
              filename: 'atelier-apple.png',
            },
            mask: {
              intent: 'image.generate',
              raw: 'genere une image de pomme',
            },
            compiled: { kind: 'image.generate', state: 'ready', value: {} },
            sdBody: { prompt: 'Prompt atelier pomme', prompt_language: 'fr' },
            atelier: {
              mode: 'assisted',
              request_id: 'atelier-1',
              rounds: 1,
              final_round: 1,
              stop_reason: 'accepted',
              summary: {
                accepted_round: 1,
                stop_reason: 'accepted',
                profile_type: 'simple_food_object',
                round_count: 1,
              },
              trace: {
                summary: {
                  accepted_round: 1,
                  stop_reason: 'accepted',
                  profile_type: 'simple_food_object',
                  round_count: 1,
                },
                rounds: [],
              },
            },
          };
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/image/atelier', {
        message: 'genere une image de pomme',
      });
      assert.equal(response.status, 200);
      assert.equal(json.mode, 'generate_image');
      assert.equal(json.imagePath, 'https://files.example.com/atelier-apple.png');
      assert.equal(json.atelier.mode, 'assisted');
      assert.equal(json.atelier.summary.profile_type, 'simple_food_object');
    }
  );
});

test('POST /api/image/atelier supports mask-only requests and can hide trace rounds', async () => {
  await withServer(
    (app) => {
      app.use('/api', createImageAtelierRouter({
        runImageAtelier: async ({ rawMask, return_trace }) => {
          assert.equal(rawMask.intent, 'image.generate');
          assert.equal(return_trace, false);
          return {
            sdResult: {
              ok: true,
              tool: 'generate_image',
              artifact_type: 'image',
              image_url: 'https://files.example.com/atelier-gohan.png',
              filename: 'atelier-gohan.png',
            },
            mask: rawMask,
            compiled: { kind: 'image.generate', state: 'ready', value: {} },
            sdBody: { prompt: 'Prompt atelier gohan', prompt_language: 'fr' },
            atelier: {
              mode: 'assisted',
              request_id: 'atelier-2',
              rounds: 2,
              final_round: 2,
              stop_reason: 'accepted',
              summary: {
                accepted_round: 2,
                stop_reason: 'accepted',
                profile_type: 'reference_character',
                round_count: 2,
              },
              trace: {
                summary: {
                  accepted_round: 2,
                  stop_reason: 'accepted',
                  profile_type: 'reference_character',
                  round_count: 2,
                },
              },
            },
          };
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/image/atelier', {
        mask: {
          version: 'mask-1',
          intent: 'image.generate',
          task: { domain: 'image', action: 'generate' },
          compiler: { target: 'image-prompt-fr', version: '1.0' },
          inputs: {
            subject: ['gohan'],
            environment: [],
            style: ['haute qualité'],
            composition: [],
            lighting: [],
            palette: [],
          },
          options: { width: 768, height: 768, steps: 40, guidance_scale: 8 },
          constraints: { safe_mode: true, no_text: true },
          ambiguities: [],
          raw: 'genere une image de gohan',
        },
        return_trace: false,
      });
      assert.equal(response.status, 200);
      assert.equal(json.atelier.summary.profile_type, 'reference_character');
      assert.equal(Object.prototype.hasOwnProperty.call(json.atelier.trace || {}, 'rounds'), false);
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
      assert.equal(json.mode, 'generate_image');
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
      assert.equal(json.mode, 'generate_image');
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

test('POST /api/llm/chat returns a video payload for explicit video requests', async () => {
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
        generateVideo: async ({ prompt, body }) => ({
          ok: true,
          tool: 'generate_video',
          artifact_type: 'video',
          prompt,
          format: body.format || 'mp4',
          durationSeconds: body.durationSeconds || 3,
          fps: body.fps || 6,
          frameCount: 18,
          video_url: 'https://files.example.com/generated-video.mp4',
          filename: 'generated-video.mp4',
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        a11Dev: true,
        messages: [{ role: 'user', content: 'genere une video de kurosaki en combat' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.artifact_type, 'video');
      assert.equal(json.video_url, 'https://files.example.com/generated-video.mp4');
      assert.equal(json.kind, 'video.generate');
      assert.match(String(json.choices?.[0]?.message?.content || ''), /ouvrir la video/i);
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
      assert.equal(json.mode, 'generate_image');
      assert.equal(json.imagePath, 'https://files.example.com/generated-without-dev.png');
      assert.equal(json.pipeline, 'intent-router-v2');
    }
  );
});

test('POST /api/llm/chat executes compound mail plus latest image requests', async () => {
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
        emailLatestResource: async ({ to, kind, attachToEmail, conversationId }) => ({
          ok: true,
          to,
          latest: true,
          resource: {
            id: 42,
            kind,
            url: 'https://files.example.com/latest-image.png',
          },
          mail: {
            ok: true,
            attachToEmail,
            conversationId,
          },
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        conversationId: 'conv-mail',
        messages: [{ role: 'user', content: "envoi un mail à cellaurojeffrey@gmail.com avec l'image de dragon" }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'compound_action');
      assert.equal(json.artifact_type, 'email');
      assert.equal(json.kind, 'compound.mail_with_latest_image');
      assert.equal(Array.isArray(json.recipients), true);
      assert.equal(json.recipients[0], 'cellaurojeffrey@gmail.com');
      assert.match(String(json.content || ''), /mail a ete envoye/i);
      assert.match(String(json.resource?.url || ''), /latest-image\.png/i);
    }
  );
});

test('POST /api/llm/chat executes simple text email requests without falling back to the LLM', async () => {
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
        sendEmail: async ({ to, message, subject, conversationId }) => ({
          ok: true,
          to,
          subject,
          conversationId,
          mail: {
            ok: true,
            provider: 'resend',
            to,
          },
          echoedMessage: message,
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        conversationId: 'conv-simple-mail',
        messages: [{ role: 'user', content: 'envois un mail a cellaurojeffrey@gmail.com en disant salut bg' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'compound_action');
      assert.equal(json.artifact_type, 'email');
      assert.equal(json.kind, 'compound.simple_email');
      assert.equal(Array.isArray(json.recipients), true);
      assert.equal(json.recipients[0], 'cellaurojeffrey@gmail.com');
      assert.match(String(json.content || ''), /mail a bien ete envoye/i);
    }
  );
});

test('POST /api/llm/chat generates a PDF then sends it by mail without falling back to the LLM', async () => {
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
        generateSd: async ({ body }) => ({
          ok: true,
          artifact_type: 'image',
          image_url: 'https://files.example.com/tmnt-cover.png',
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\tmp\\generated\\tmnt-cover.png',
          filename: 'tmnt-cover.png',
          prompt: body?.prompt,
        }),
        generatePdf: async ({ title, sections }) => ({
          ok: true,
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\data\\generated\\tmnt.pdf',
          filename: 'tmnt.pdf',
          title,
          sections,
        }),
        shareFile: async ({ emailTo }) => ({
          ok: true,
          url: 'https://files.example.com/tmnt.pdf',
          mail: {
            ok: true,
            provider: 'resend',
            to: emailTo,
          },
          conversationResource: {
            id: 131,
            filename: 'tmnt.pdf',
            downloadUrl: 'https://files.example.com/tmnt.pdf',
          },
        }),
        sendEmail: async () => ({
          ok: true,
          mail: { ok: true, provider: 'resend' },
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        conversationId: 'conv-pdf-mail',
        messages: [{ role: 'user', content: 'genere un pdf sur les tortues ninja et envois le par mail à cellaurojeffrey@gmail.com' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'compound_action');
      assert.equal(json.kind, 'compound.pdf_email');
      assert.equal(json.artifact_type, 'email');
      assert.equal(Array.isArray(json.recipients), true);
      assert.equal(json.recipients[0], 'cellaurojeffrey@gmail.com');
      assert.match(String(json.file_url || ''), /tmnt\.pdf/i);
      assert.match(String(json.content || ''), /pdf a ete genere puis envoye par mail/i);
      assert.equal(Array.isArray(json.pdf?.sections), true);
      assert.equal(json.pdf.sections.some((section) => Array.isArray(section.images) && section.images.length > 0), true);
      assert.equal(Array.isArray(json.generatedIllustrations), true);
      assert.equal(json.generatedIllustrations.length >= 1, true);
    }
  );
});

test('POST /api/llm/chat executes compound pdf with latest images requests', async () => {
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
        listResources: async () => ({
          ok: true,
          resources: [
            { id: 7, filename: 'dragon.png', contentType: 'image/png', url: 'https://files.example.com/dragon.png' },
            { id: 8, filename: 'castle.jpg', contentType: 'image/jpeg', url: 'https://files.example.com/castle.jpg' },
          ],
        }),
        generatePdf: async ({ sections }) => ({
          ok: true,
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\data\\generated\\a11-images.pdf',
          filename: 'a11-images.pdf',
          sections,
        }),
        shareFile: async () => ({
          ok: true,
          url: 'https://files.example.com/a11-images.pdf',
          conversationResource: {
            id: 99,
            filename: 'a11-images.pdf',
            url: 'https://files.example.com/a11-images.pdf',
          },
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        conversationId: 'conv-pdf',
        messages: [{ role: 'user', content: 'fais un pdf avec les images de cette conversation' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'compound_action');
      assert.equal(json.artifact_type, 'pdf');
      assert.equal(json.kind, 'compound.pdf_with_latest_images');
      assert.match(String(json.file_url || ''), /a11-images\.pdf/i);
      assert.match(String(json.content || ''), /ouvrir le PDF/i);
    }
  );
});

test('POST /api/llm/chat falls back to a generated illustration when an illustrated PDF request has no recent conversation images', async () => {
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
        listResources: async () => ({
          ok: true,
          resources: [],
        }),
        generateSd: async ({ body }) => ({
          ok: true,
          artifact_type: 'image',
          image_url: 'https://files.example.com/dbz-cover.png',
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\tmp\\generated\\dbz-cover.png',
          filename: 'dbz-cover.png',
          prompt: body?.prompt,
        }),
        generatePdf: async ({ title, sections }) => ({
          ok: true,
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\data\\generated\\dbz.pdf',
          filename: 'dbz.pdf',
          title,
          sections,
        }),
        shareFile: async () => ({
          ok: true,
          url: 'https://files.example.com/dbz.pdf',
          conversationResource: {
            id: 109,
            filename: 'dbz.pdf',
            url: 'https://files.example.com/dbz.pdf',
          },
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        conversationId: 'conv-pdf-fallback',
        messages: [{ role: 'user', content: 'genere un pdf de dbz avec des images' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'compound_action');
      assert.equal(json.kind, 'compound.pdf_with_latest_images');
      assert.equal(json.artifact_type, 'pdf');
      assert.equal(json.imageFallback, 'generated_image');
      assert.match(String(json.file_url || ''), /dbz\.pdf/i);
      assert.match(String(json.source_image?.image_url || ''), /dbz-cover\.png/i);
    }
  );
});

test('POST /api/llm/chat cleans giraffe illustrated PDF topics and injects relevant generated images', async () => {
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
        listResources: async () => ({
          ok: true,
          resources: [],
        }),
        generateSd: async ({ body }) => ({
          ok: true,
          artifact_type: 'image',
          image_url: `https://files.example.com/${String(body?.prompt || '').includes('plusieurs girafes') ? 'giraffes-group' : 'giraffe-cover'}.png`,
          outputPath: `D:\\funesterie\\a11\\backend\\apps\\server\\tmp\\generated\\${String(body?.prompt || '').includes('plusieurs girafes') ? 'giraffes-group' : 'giraffe-cover'}.png`,
          filename: `${String(body?.prompt || '').includes('plusieurs girafes') ? 'giraffes-group' : 'giraffe-cover'}.png`,
          prompt: body?.prompt,
        }),
        generatePdf: async ({ title, sections }) => ({
          ok: true,
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\data\\generated\\giraffes.pdf',
          filename: 'giraffes.pdf',
          title,
          sections,
        }),
        shareFile: async () => ({
          ok: true,
          url: 'https://files.example.com/giraffes.pdf',
          conversationResource: {
            id: 111,
            filename: 'giraffes.pdf',
            url: 'https://files.example.com/giraffes.pdf',
          },
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        conversationId: 'conv-giraffes-pdf',
        messages: [{ role: 'user', content: 'genere un pdf sur les giraffes avec des images,' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'compound_action');
      assert.equal(json.kind, 'compound.pdf_with_latest_images');
      assert.equal(json.pdf?.title, 'Document A11 - Les giraffes');
      assert.equal(Array.isArray(json.pdf?.sections), true);
      assert.equal(json.pdf.sections.some((section) => String(section.heading || '').trim() === 'Morphologie'), true);
      assert.equal(
        json.pdf.sections.filter((section) => Array.isArray(section.images) && section.images.length > 0).length >= 2,
        true
      );
      assert.equal(Array.isArray(json.generatedIllustrations), true);
      assert.equal(json.generatedIllustrations.length >= 1, true);
      assert.match(String(json.file_url || ''), /giraffes\.pdf/i);
    }
  );
});

test('POST /api/llm/chat generates an image then sends it by mail in one request', async () => {
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
        generateSd: async () => ({
          ok: true,
          artifact_type: 'image',
          image_url: 'https://files.example.com/generated-dragon.png',
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\tmp\\generated\\generated-dragon.png',
          filename: 'generated-dragon.png',
        }),
        sendEmail: async ({ to, path }) => ({
          ok: true,
          to,
          path,
          mail: { ok: true },
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        conversationId: 'conv-chain-mail',
        messages: [{ role: 'user', content: 'genere une image de dragon puis envoie-la par mail à cellaurojeffrey@gmail.com' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'compound_action');
      assert.equal(json.kind, 'compound.generate_image_then_mail');
      assert.equal(json.artifact_type, 'email');
      assert.match(String(json.image_url || ''), /generated-dragon\.png/i);
      assert.match(String(json.content || ''), /image a ete generee puis envoyee par mail/i);
      assert.match(String(json.attachmentPath || ''), /generated-dragon\.png/i);
    }
  );
});

test('POST /api/llm/chat generates a simple PDF request without falling back to the LLM', async () => {
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
        generateSd: async ({ body }) => ({
          ok: true,
          artifact_type: 'image',
          image_url: 'https://files.example.com/dbz-cover.png',
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\tmp\\generated\\dbz-cover.png',
          filename: 'dbz-cover.png',
          prompt: body?.prompt,
        }),
        generatePdf: async ({ title, sections }) => ({
          ok: true,
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\data\\generated\\dbz.pdf',
          filename: 'dbz.pdf',
          title,
          sections,
        }),
        shareFile: async () => ({
          ok: true,
          url: 'https://files.example.com/dbz.pdf',
          conversationResource: {
            id: 101,
            filename: 'dbz.pdf',
            url: 'https://files.example.com/dbz.pdf',
          },
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        conversationId: 'conv-simple-pdf',
        messages: [{ role: 'user', content: 'genere un pdf sur le theme dbz' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'compound_action');
      assert.equal(json.kind, 'compound.simple_pdf');
      assert.equal(json.artifact_type, 'pdf');
      assert.match(String(json.file_url || ''), /dbz\.pdf/i);
      assert.match(String(json.content || ''), /ouvrir le PDF/i);
      assert.equal(json.pdf?.title, 'DBZ');
      assert.equal(Array.isArray(json.pdf?.sections), true);
      assert.equal(json.pdf.sections.length >= 5, true);
      assert.equal(json.pdf.sections.some((section) => Array.isArray(section.images) && section.images.length > 0), true);
      assert.equal(Array.isArray(json.generatedIllustrations), true);
      assert.equal(json.generatedIllustrations.length >= 1, true);
    }
  );
});

test('POST /api/llm/chat finds a web image then creates a PDF in one request', async () => {
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
        duckduckgoImageSearch: async () => ({
          image_url: 'https://images.example.com/dragon-web.png',
          source_url: 'https://example.com/dragon',
          title: 'dragon',
        }),
        generatePdf: async ({ sections }) => ({
          ok: true,
          outputPath: 'D:\\funesterie\\a11\\backend\\apps\\server\\data\\generated\\dragon-web.pdf',
          filename: 'dragon-web.pdf',
          sections,
        }),
        shareFile: async () => ({
          ok: true,
          url: 'https://files.example.com/dragon-web.pdf',
          conversationResource: {
            id: 101,
            filename: 'dragon-web.pdf',
            url: 'https://files.example.com/dragon-web.pdf',
          },
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        conversationId: 'conv-chain-pdf',
        messages: [{ role: 'user', content: 'cherche une image de dragon sur le web puis fais-en un pdf' }],
      }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.mode, 'compound_action');
      assert.equal(json.kind, 'compound.web_image_then_pdf');
      assert.equal(json.artifact_type, 'pdf');
      assert.match(String(json.source_image_url || ''), /dragon-web\.png/i);
      assert.match(String(json.file_url || ''), /dragon-web\.pdf/i);
    }
  );
});

test('POST /api/admin/image-cardinality is admin protected and returns local debug telemetry', async () => {
  const jwtSecret = 'test-secret';
  const adminToken = jwt.sign({ id: 'admin', username: 'admin', role: 'admin', isAdmin: true }, jwtSecret, { expiresIn: '1h' });

  await withServer(
    (app) => {
      app.use('/api/admin', createImageCardinalityDebugRouter({
        verifyJWT(req, res, next) {
          try {
            const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
            req.user = jwt.verify(bearer, jwtSecret);
            next();
          } catch (error_) {
            res.status(401).json({ ok: false, error: 'invalid_jwt', message: String(error_?.message || error_) });
          }
        },
        isAdminRequest(req) {
          return req.user?.isAdmin === true || req.user?.role === 'admin';
        },
        verifyGeneratedImageCardinality: async ({ imageUrl, expected }) => ({
          ok: true,
          expected: {
            subject_count: Number(expected?.subjectCount || 0),
            subject_type: 'subject',
            subject_label: String(expected?.subjectLabel || 'subject'),
            allow_group: false,
          },
          observed: {
            subject_count: 2,
            subject_label: 'subject',
            duplicate_subjects: true,
            fusion_detected: false,
            subject_match: true,
            confidence: 0.91,
          },
          decision: {
            retry: true,
            reason: 'multiple_subjects_detected',
            notes: 'local test',
          },
          raw: {
            components: [{ area: 120 }, { area: 111 }],
          },
          imageUrl,
        }),
      }));
    },
    async (baseUrl) => {
      const unauthorized = await postJson(baseUrl, '/api/admin/image-cardinality', {
        imageUrl: 'https://images.example.com/sample.png',
        expected: { enabled: true, subjectCount: 1, subjectLabel: 'subject' },
      });
      assert.equal(unauthorized.response.status, 401);

      const { response, json } = await postJson(baseUrl, '/api/admin/image-cardinality', {
        imageUrl: 'https://images.example.com/sample.png',
        expected: { enabled: true, subjectCount: 1, subjectLabel: 'subject' },
      }, {
        authorization: `Bearer ${adminToken}`,
      });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.config.provider, 'local');
      assert.equal(json.verification.decision.retry, true);
      assert.equal(json.debug.observed_subject_count, 2);
      assert.equal(Array.isArray(json.debug.components), true);
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
  assert.match(String(compiledPayload?.negative_prompt || ''), /plusieurs sujets/i);
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

test('POST /api/video/generate returns a dedicated video payload', async () => {
  await withServer(
    (app) => {
      app.use('/api', createVideoGenerateRouter({
        generateVideo: async ({ prompt, body }) => ({
          ok: true,
          tool: 'generate_video',
          artifact_type: 'video',
          prompt,
          format: body.format,
          durationSeconds: body.durationSeconds,
          fps: body.fps,
          frameCount: 6,
          video_url: 'https://files.example.com/demo-video.mp4',
          filename: 'demo-video.mp4',
        }),
      }).router);
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/video/generate', {
        prompt: 'dragon bleu',
        durationSeconds: 3,
        fps: 6,
        format: 'mp4',
      });

      assert.equal(response.status, 200);
      assert.equal(json.artifact_type, 'video');
      assert.equal(json.video_url, 'https://files.example.com/demo-video.mp4');
      assert.equal(json.format, 'mp4');
    }
  );
});

test('POST /api/chat returns a video completion payload for explicit video requests', async () => {
  await withServer(
    (app) => {
      app.use('/api', createChatRouter({
        detectVideoIntent: () => true,
        generateVideo: async () => ({
          ok: true,
          tool: 'generate_video',
          artifact_type: 'video',
          format: 'gif',
          durationSeconds: 2,
          fps: 4,
          frameCount: 8,
          video_url: 'https://files.example.com/demo-video.gif',
          filename: 'demo-video.gif',
        }),
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/chat', {
        message: 'genere une video de dragon bleu en gif 2 secondes 4 fps',
      });

      assert.equal(response.status, 200);
      assert.equal(json.artifact_type, 'video');
      assert.equal(json.video_url, 'https://files.example.com/demo-video.gif');
      assert.equal(json.kind, 'video.generate');
      assert.match(String(json.choices?.[0]?.message?.content || ''), /ouvrir la video/i);
    }
  );
});

test('POST /api/chat forwards source images to the video runtime', async () => {
  await withServer(
    (app) => {
      app.use('/api', createChatRouter({
        detectImageIntent: () => false,
        detectVideoIntent: () => true,
        generateVideo: async ({ body }) => {
          assert.equal(body.sourceImageUrl, 'https://files.example.com/source-image.png');
          return {
            ok: true,
            tool: 'generate_video',
            artifact_type: 'video',
            format: 'mp4',
            durationSeconds: 2,
            fps: 4,
            frameCount: 8,
            video_url: 'https://files.example.com/source-video.mp4',
            filename: 'source-video.mp4',
          };
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/chat', {
        message: 'genere une video en travelling doux',
        sourceImageUrl: 'https://files.example.com/source-image.png',
        durationSeconds: 2,
        fps: 4,
        format: 'mp4',
      });

      assert.equal(response.status, 200);
      assert.equal(json.artifact_type, 'video');
      assert.equal(json.video_url, 'https://files.example.com/source-video.mp4');
    }
  );
});
