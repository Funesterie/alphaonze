const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const createAdminRunRouter = require('../src/routes/admin-run.cjs');
const createProtectedChatProxyRouter = require('../src/routes/protected-chat-proxy.cjs');

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
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

async function getJson(baseUrl, urlPath, headers = {}) {
  const response = await fetch(baseUrl + urlPath, {
    method: 'GET',
    headers,
  });

  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

function buildImageStructuredLlmStub() {
  return async ({ systemPrompt, text }) => {
    const prompt = String(systemPrompt || '');
    const sourceText = String(text || '');

    if (/canonical request normalizer for A11 image\.generate/i.test(prompt)) {
      if (/lapin|rabbit/i.test(sourceText)) {
        return {
          canonicalEnglishInput: 'a rabbit with a carrot in the mouth',
          structuredFields: {
            subject: ['rabbit'],
            environment: ['simple natural setting'],
            style: ['high quality'],
            composition: ['single well-framed subject', 'accessory clearly visible'],
            lighting: [],
            palette: [],
            constraints: {
              promptInstructions: ['show clearly the carrot attached to the main subject'],
              negativeHints: [],
              noText: true,
              safeMode: true,
            },
          },
          scenePolicy: {
            subjectMode: 'single',
            explicitSubjectCount: 1,
          },
        };
      }

      return {
        canonicalEnglishInput: 'an apple',
        structuredFields: {
          subject: ['apple'],
          environment: ['simple background'],
          style: ['high quality'],
          composition: ['single well-framed subject'],
          lighting: [],
          palette: [],
          constraints: {
            promptInstructions: [],
            negativeHints: [],
            noText: true,
            safeMode: true,
          },
        },
        scenePolicy: {
          subjectMode: 'single',
          explicitSubjectCount: 1,
        },
      };
    }

    if (/raffineur de compilateur image/i.test(prompt)) {
      return {
        composition_hints: ['accessoire bien visible'],
        environment_hints: ['décor simple et lisible'],
        style_hints: [],
        prompt_instructions: ['Montrer clairement une carotte dans la bouche du sujet principal.'],
      };
    }

    return null;
  };
}

test('protected chat proxy returns requestId in header and body when upstream throws', async () => {
  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(_req, _res, next) {
          next();
        },
        proxyChatToOpenAI() {
          throw new Error('boom');
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
        messages: [{ role: 'user', content: 'hello' }],
      }, {
        'X-Request-Id': 'req-proxy-1',
      });

      assert.equal(response.status, 502);
      assert.equal(response.headers.get('x-request-id'), 'req-proxy-1');
      assert.equal(json.requestId, 'req-proxy-1');
      assert.equal(json.error, 'proxy_error');
      assert.equal(json.message, 'boom');
    }
  );
});

test('protected chat proxy sanitizes upstream html timeout pages', async () => {
  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(_req, _res, next) {
          next();
        },
        proxyChatToOpenAI() {
          const error = new Error('<!DOCTYPE html><html><head><title>funesterie.me | 524: A timeout occurred</title></head><body>Error code 524</body></html>');
          error.status = 504;
          error.upstream = {
            url: 'https://sd.funesterie.me/v1/chat/completions',
            status: 524,
            body: '<!DOCTYPE html><html><head><title>funesterie.me | 524: A timeout occurred</title></head><body>Error code 524</body></html>',
          };
          throw error;
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
        messages: [{ role: 'user', content: 'hello' }],
      }, {
        'X-Request-Id': 'req-proxy-html-1',
      });

      assert.equal(response.status, 504);
      assert.equal(json.requestId, 'req-proxy-html-1');
      assert.equal(json.message, 'Upstream timeout (Cloudflare 524)');
      assert.equal(json.upstream.status, 524);
      assert.equal(json.upstream.body, 'Upstream timeout (Cloudflare 524)');
    }
  );
});

test('admin run returns requestId and upstream diagnostics on remote failures', async () => {
  await withServer(
    (app) => {
      app.use('/api', createAdminRunRouter({
        isAdminRequest: () => true,
        async runQflushFlow() {
          const error = new Error('Remote flow unreachable');
          error.status = 502;
          error.error = 'qflush_unreachable';
          error.upstream = {
            url: 'https://qflush.example.com/api/admin/run',
            status: 503,
            body: '{"ok":false,"message":"upstream failed"}',
          };
          throw error;
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/admin/run', {
        flow: 'a11.chat.v1',
        payload: { prompt: 'ping' },
      }, {
        'X-Request-Id': 'req-admin-1',
      });

      assert.equal(response.status, 502);
      assert.equal(response.headers.get('x-request-id'), 'req-admin-1');
      assert.equal(json.requestId, 'req-admin-1');
      assert.equal(json.error, 'qflush_unreachable');
      assert.equal(json.upstream.url, 'https://qflush.example.com/api/admin/run');
      assert.equal(json.upstream.status, 503);
      assert.match(String(json.upstream.body || ''), /upstream failed/);
    }
  );
});

test('protected chat proxy reuses short cache for standard image requests', async () => {
  const previousGuard = process.env.A11_IMAGE_CARDINALITY_GUARD;
  process.env.A11_IMAGE_CARDINALITY_GUARD = 'false';
  let callCount = 0;
  const structuredLlmStub = buildImageStructuredLlmStub();

  try {
    await withServer(
      (app) => {
        app.use('/api', createProtectedChatProxyRouter({
          verifyJWT(_req, _res, next) {
            next();
          },
          proxyChatToOpenAI() {
            throw new Error('should_not_hit_openai_proxy');
          },
          specialCompilerCallStructuredLlmJson: structuredLlmStub,
          generateSd: async () => {
            callCount += 1;
            return {
              ok: true,
              image_url: '',
              filename: 'apple.png',
            };
          },
        }));
      },
      async (baseUrl) => {
        const body = {
          messages: [{ role: 'user', content: 'genere une image de pomme' }],
        };

        const first = await postJson(baseUrl, '/api/llm/chat', body, {
          'X-Request-Id': 'req-proxy-cache-1',
        });
        const second = await postJson(baseUrl, '/api/llm/chat', body, {
          'X-Request-Id': 'req-proxy-cache-2',
        });

        assert.equal(first.response.status, 200);
        assert.equal(second.response.status, 200);
        assert.equal(callCount, 1);
      }
    );
  } finally {
    if (previousGuard === undefined) delete process.env.A11_IMAGE_CARDINALITY_GUARD;
    else process.env.A11_IMAGE_CARDINALITY_GUARD = previousGuard;
  }
});

test('protected chat proxy bypasses short cache for special compiler image requests', async () => {
  const previousGuard = process.env.A11_IMAGE_CARDINALITY_GUARD;
  process.env.A11_IMAGE_CARDINALITY_GUARD = 'false';
  let callCount = 0;
  const structuredLlmStub = buildImageStructuredLlmStub();

  try {
    await withServer(
      (app) => {
        app.use('/api', createProtectedChatProxyRouter({
          verifyJWT(_req, _res, next) {
            next();
          },
          proxyChatToOpenAI() {
            throw new Error('should_not_hit_openai_proxy');
          },
          specialCompilerCallStructuredLlmJson: structuredLlmStub,
          generateSd: async () => {
            callCount += 1;
            return {
              ok: true,
              image_url: '',
              filename: 'rabbit.png',
            };
          },
        }));
      },
      async (baseUrl) => {
        const body = {
          messages: [{ role: 'user', content: 'genere une image d un lapin avec une carotte dans la bouche' }],
        };

        const first = await postJson(baseUrl, '/api/llm/chat', body, {
          'X-Request-Id': 'req-proxy-special-1',
        });
        const second = await postJson(baseUrl, '/api/llm/chat', body, {
          'X-Request-Id': 'req-proxy-special-2',
        });

        assert.equal(first.response.status, 200);
        assert.equal(second.response.status, 200);
        assert.equal(callCount, 2);
      }
    );
  } finally {
    if (previousGuard === undefined) delete process.env.A11_IMAGE_CARDINALITY_GUARD;
    else process.env.A11_IMAGE_CARDINALITY_GUARD = previousGuard;
  }
});

test('protected chat proxy honors statusCode from structured image canonicalization failures', async () => {
  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(_req, _res, next) {
          next();
        },
        proxyChatToOpenAI() {
          throw new Error('should_not_hit_openai_proxy');
        },
        specialCompilerCallStructuredLlmJson: async ({ systemPrompt }) => {
          if (/canonical request normalizer for A11 image\.generate/i.test(String(systemPrompt || ''))) {
            const error = new Error('Structured LLM is not configured for this environment.');
            error.code = 'structured_llm_unconfigured';
            error.statusCode = 503;
            error.upstream = {
              url: 'http://127.0.0.1:4545/v1/chat/completions',
              status: null,
              body: 'Structured LLM is not configured for this environment.',
            };
            throw error;
          }
          return null;
        },
        generateSd: async () => {
          throw new Error('should_not_generate');
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        messages: [{ role: 'user', content: 'genere une image de pomme' }],
      }, {
        'X-Request-Id': 'req-proxy-canon-1',
      });

      assert.equal(response.status, 503);
      assert.equal(response.headers.get('x-request-id'), 'req-proxy-canon-1');
      assert.equal(json.requestId, 'req-proxy-canon-1');
      assert.equal(json.error, 'image_request_canonicalizer_failed');
      assert.deepEqual(json.details?.reasons, ['provided_structured_llm:structured_llm_unconfigured']);
      assert.equal(json.details?.upstream?.status, null);
    }
  );
});

test('protected chat proxy returns a visible diagnostic payload when image canonicalization fails english-only validation twice', async () => {
  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(_req, _res, next) {
          next();
        },
        proxyChatToOpenAI() {
          throw new Error('should_not_hit_openai_proxy');
        },
        specialCompilerCallStructuredLlmJson: async ({ systemPrompt }) => {
          if (/canonical request normalizer for A11 image\.generate/i.test(String(systemPrompt || ''))) {
            return {
              canonicalEnglishInput: 'femme en tenue theatrale avec une couronne, decor simple',
              structuredFields: {
                subject: ['femme en tenue theatrale'],
                environment: ['decor simple'],
                style: ['haute qualite'],
                composition: ['sujet unique bien cadre'],
                lighting: ['lumiere dramatique'],
                palette: ['violet'],
                constraints: {
                  promptInstructions: ['couronne portee par le sujet principal'],
                  negativeHints: ['texte lisible'],
                  noText: true,
                  safeMode: true,
                },
              },
              scenePolicy: {
                subjectMode: 'single',
                explicitSubjectCount: 1,
              },
            };
          }
          return null;
        },
        generateSd: async () => {
          throw new Error('should_not_generate');
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        messages: [{ role: 'user', content: 'genere une image de femme en tenue theatrale avec une couronne' }],
      }, {
        'X-Request-Id': 'req-proxy-canon-diagnostic-1',
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-request-id'), 'req-proxy-canon-diagnostic-1');
      assert.equal(json.mode, 'image_canonicalizer_diagnostic');
      assert.match(String(json.assistant || ''), /requete image a ete comprise/i);
      assert.deepEqual(json.diagnostic?.reasons, [
        'provided_structured_llm:canonicalized_request_not_english_only',
        'provided_structured_llm_retry:canonicalized_request_not_english_only',
      ]);
      assert.equal(
        json.diagnostic?.summary?.failedBecause,
        'english_only_validation_failed_after_retry'
      );
      assert.equal(
        json.diagnostic?.rejectedPayloads?.[0]?.payload?.canonicalEnglishInput,
        'femme en tenue theatrale avec une couronne, decor simple'
      );
    }
  );
});

test('protected chat proxy keeps completed async image jobs available after a router restart when the store path is shared', async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-async-job-'));
  const storePath = path.join(storeDir, 'async-image-jobs.json');
  const previousStorePath = process.env.A11_ASYNC_IMAGE_JOB_STORE_PATH;
  let jobId = '';

  process.env.A11_ASYNC_IMAGE_JOB_STORE_PATH = storePath;

  try {
    await withServer(
      (app) => {
        app.use('/api', createProtectedChatProxyRouter({
          verifyJWT(_req, _res, next) {
            next();
          },
          proxyChatToOpenAI() {
            throw new Error('should_not_hit_openai_proxy');
          },
          specialCompilerCallStructuredLlmJson: buildImageStructuredLlmStub(),
          generateSd: async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
            return {
              ok: true,
              imagePath: 'https://files.example.com/persisted-job.png',
              image_url: 'https://files.example.com/persisted-job.png',
              mode: 'generate_image',
            };
          },
        }));
      },
      async (baseUrl) => {
        const first = await postJson(baseUrl, '/api/llm/chat', {
          acceptAsyncImageJob: true,
          conversationId: 'conv-persist-1',
          messages: [{ role: 'user', content: 'genere une image de lapin rose' }],
        });

        assert.equal(first.response.status, 200);
        assert.equal(first.json.status, 'pending');
        jobId = String(first.json.asyncJob?.jobId || '').trim();
        assert.ok(jobId);

        let polled = null;
        for (let attempt = 0; attempt < 80; attempt += 1) {
          polled = await getJson(baseUrl, `/api/llm/jobs/image/${encodeURIComponent(jobId)}`);
          if (polled.json?.status === 'done') break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.ok(polled);
        assert.equal(polled.response.status, 200);
        assert.equal(polled.json.status, 'done');
        assert.equal(polled.json.result?.imagePath, 'https://files.example.com/persisted-job.png');
      }
    );

    await withServer(
      (app) => {
        app.use('/api', createProtectedChatProxyRouter({
          verifyJWT(_req, _res, next) {
            next();
          },
          proxyChatToOpenAI() {
            throw new Error('should_not_hit_openai_proxy');
          },
          specialCompilerCallStructuredLlmJson: buildImageStructuredLlmStub(),
          generateSd: async () => {
            throw new Error('should_not_regenerate');
          },
        }));
      },
      async (baseUrl) => {
        const polled = await getJson(baseUrl, `/api/llm/jobs/image/${encodeURIComponent(jobId)}`);

        assert.equal(polled.response.status, 200);
        assert.equal(polled.json.status, 'done');
        assert.equal(polled.json.result?.imagePath, 'https://files.example.com/persisted-job.png');
      }
    );
  } finally {
    if (previousStorePath === undefined) delete process.env.A11_ASYNC_IMAGE_JOB_STORE_PATH;
    else process.env.A11_ASYNC_IMAGE_JOB_STORE_PATH = previousStorePath;
    try {
      fs.rmSync(storeDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures in tests
    }
  }
});
