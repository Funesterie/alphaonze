const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSdToolsRouter } = require('../src/routes/sd-tools.cjs');

test('generateSdInternal preserves prebuilt prompts without re-enriching them', async () => {
  let capturedBody = null;
  const { generateSdInternal } = createSdToolsRouter({
    fetch: async (_url, options = {}) => {
      capturedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            image_url: 'https://files.example.com/prebuilt-rabbit.png',
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
  });

  const response = await generateSdInternal({
    req: { headers: {} },
    prompt: 'a pink rabbit. exactly one pink rabbit only. no duplicate subjects.',
    body: {
      prompt: 'a pink rabbit. exactly one pink rabbit only. no duplicate subjects.',
      negative_prompt: 'duplicate rabbits, crowd',
      prompt_prebuilt: true,
      negative_prompt_prebuilt: true,
      width: 1024,
      height: 1024,
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.image_url, 'https://files.example.com/prebuilt-rabbit.png');
  assert.equal(
    capturedBody?.prompt,
    'a pink rabbit. exactly one pink rabbit only. no duplicate subjects.'
  );
  assert.equal(capturedBody?.prompt_prebuilt, true);
  assert.equal(capturedBody?.negative_prompt, 'duplicate rabbits, crowd');
  assert.equal(capturedBody?.negative_prompt_prebuilt, true);
});

test('generateSdInternal forwards init image draft settings to the SD proxy', async () => {
  let capturedBody = null;
  const { generateSdInternal } = createSdToolsRouter({
    fetch: async (_url, options = {}) => {
      capturedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            image_url: 'https://files.example.com/zelda-draft.png',
            init_image_used: true,
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
  });

  const response = await generateSdInternal({
    req: { headers: {} },
    prompt: 'princesse zelda heroique',
    body: {
      prompt: 'princesse zelda heroique',
      prompt_prebuilt: true,
      init_image_url: 'https://images.example.com/zelda-ref.png',
      strength: 0.41,
    },
  });

  assert.equal(response.ok, true);
  assert.equal(capturedBody?.init_image_url, 'https://images.example.com/zelda-ref.png');
  assert.equal(capturedBody?.strength, 0.41);
});

test('generateSdInternal forwards compiled proxy payloads as prebuilt and dedupes negative hints', async () => {
  let capturedBody = null;
  const { generateSdInternal } = createSdToolsRouter({
    fetch: async (_url, options = {}) => {
      capturedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            image_url: 'https://files.example.com/rabbit.png',
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
  });

  const response = await generateSdInternal({
    req: { headers: {} },
    prompt: 'genere une image lapin rose',
    body: {
      prompt: 'genere une image lapin rose',
    },
  });

  assert.equal(response.ok, true);
  assert.equal(capturedBody?.prompt_prebuilt, true);
  assert.equal(capturedBody?.negative_prompt_prebuilt, true);
  assert.match(String(capturedBody?.prompt || ''), /Demande : genere une image lapin rose/i);
  assert.match(String(capturedBody?.prompt || ''), /Sujet principal : lapin/i);
  assert.match(String(capturedBody?.prompt || ''), /Couleurs : rose/i);
  assert.match(String(capturedBody?.prompt || ''), /Créer une image fidèle à la demande/i);
  assert.doesNotMatch(String(capturedBody?.prompt || ''), /\bNe pas\b|\bdo not\b|literal interpretation/i);
  assert.match(String(capturedBody?.negative_prompt || ''), /plusieurs sujets/i);
  assert.match(String(capturedBody?.negative_prompt || ''), /watermark/i);
});

test('generateSdInternal infers prebuilt prompts when compiled SD text arrives without flags', async () => {
  let capturedBody = null;
  const { generateSdInternal } = createSdToolsRouter({
    fetch: async (_url, options = {}) => {
      capturedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            image_url: 'https://files.example.com/rabbit-prebuilt.png',
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
  });

  const compiledPrompt = [
    'one rabbit with pink fur',
    'high quality, detailed',
    'exactly one rabbit',
    'solo composition',
    'simple clean background',
    'literal interpretation',
  ].join('. ');

  await generateSdInternal({
    req: { headers: {} },
    prompt: compiledPrompt,
    body: {
      prompt: compiledPrompt,
      negative_prompt: 'duplicate subject, multiple subjects, crowd',
    },
  });

  assert.equal(capturedBody?.prompt, compiledPrompt);
  assert.equal(capturedBody?.prompt_prebuilt, true);
  assert.equal(capturedBody?.negative_prompt_prebuilt, true);
  assert.equal(capturedBody?.negative_prompt, 'duplicate subject, multiple subjects, crowd');
  assert.doesNotMatch(String(capturedBody?.prompt || ''), /\bone one rabbit\b/i);
});

test('generateSdInternal infers prebuilt prompts when compiled french image text arrives without flags', async () => {
  let capturedBody = null;
  const { generateSdInternal } = createSdToolsRouter({
    fetch: async (_url, options = {}) => {
      capturedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            image_url: 'https://files.example.com/lapin-fr-prebuilt.png',
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
  });

  const compiledPrompt = [
    'Demande : genere un lapin rose',
    'Sujet principal : lapin rose',
    'Style : haute qualité',
    'Couleurs : rose',
    'Créer une image fidèle à la demande.',
  ].join('. ');

  await generateSdInternal({
    req: { headers: {} },
    prompt: compiledPrompt,
    body: {
      prompt: compiledPrompt,
      negative_prompt: 'flou, plusieurs sujets, foule',
    },
  });

  assert.equal(capturedBody?.prompt, compiledPrompt);
  assert.equal(capturedBody?.prompt_prebuilt, true);
  assert.equal(capturedBody?.negative_prompt_prebuilt, true);
  assert.equal(capturedBody?.negative_prompt, 'flou, plusieurs sujets, foule');
});

test('generateSdInternal repairs stale compiled prompts that still contain image rabbit artifacts', async () => {
  let capturedBody = null;
  const { generateSdInternal } = createSdToolsRouter({
    fetch: async (_url, options = {}) => {
      capturedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            image_url: 'https://files.example.com/rabbit-repaired.png',
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
  });

  const staleCompiledPrompt = [
    'one image rabbit with pink fur',
    'high quality, detailed',
    'exactly one image rabbit',
    'solo composition',
    'simple clean background',
    'literal interpretation',
  ].join('. ');

  await generateSdInternal({
    req: { headers: {} },
    prompt: staleCompiledPrompt,
    body: {
      prompt: staleCompiledPrompt,
      negative_prompt: 'multiple pink image rabbit, duplicate image rabbit, crowd',
    },
  });

  assert.match(String(capturedBody?.prompt || ''), /\bone rabbit with pink fur\b/i);
  assert.doesNotMatch(String(capturedBody?.prompt || ''), /\bimage rabbit\b/i);
  assert.equal(capturedBody?.negative_prompt, 'multiple pink image rabbit, duplicate image rabbit, crowd');
});

test('generateSdInternal blocks local-only fallback in production when proxy fails', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    A11_SD_PROXY_URL: process.env.A11_SD_PROXY_URL,
  };
  process.env.NODE_ENV = 'production';
  process.env.A11_SD_PROXY_URL = 'https://sd.example.com/api/tools/generate_sd';

  try {
    const { generateSdInternal } = createSdToolsRouter({
      fetch: async () => ({
        ok: false,
        status: 503,
        async text() {
          return JSON.stringify({ ok: false, error: 'sd_proxy_failed', message: 'proxy down' });
        },
      }),
      resolveSdProxyUrl: () => 'https://sd.example.com',
      resolveSdScriptPath: () => 'D:\\funesterie\\a11\\llm\\scripts\\generate_sd_image.py',
      shouldAllowLocalSdFallback: () => false,
    });

    await assert.rejects(
      () => generateSdInternal({
        req: { headers: {} },
        prompt: 'genere un lapin rose',
        body: { prompt: 'genere un lapin rose' },
      }),
      (error) => {
        assert.equal(error.statusCode, 503);
        assert.equal(error.payload?.error, 'image_backend_unavailable');
        assert.equal(error.payload?.code, 'local_only_fallback_blocked');
        assert.equal(error.payload?.upstream?.url, 'https://sd.example.com');
        assert.equal(error.payload?.proxyOnlyMode, true);
        assert.equal(error.payload?.expectedProxyRoute, '/api/tools/generate_sd');
        assert.match(String(error.payload?.message || ''), /mode proxy-only/i);
        assert.match(String(error.payload?.message || ''), /POST \/api\/tools\/generate_sd/i);
        return true;
      }
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('generateSdInternal keeps proxy-only mode in production even when ENABLE_SD is true', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_SD: process.env.ENABLE_SD,
    A11_SD_PROXY_URL: process.env.A11_SD_PROXY_URL,
    A11_SD_ALLOW_LOCAL_FALLBACK: process.env.A11_SD_ALLOW_LOCAL_FALLBACK,
  };
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_SD = 'true';
  process.env.A11_SD_PROXY_URL = 'https://sd.example.com/api/tools/generate_sd';
  delete process.env.A11_SD_ALLOW_LOCAL_FALLBACK;

  let runSdScriptCalled = false;

  try {
    const { generateSdInternal } = createSdToolsRouter({
      fetch: async () => ({
        ok: false,
        status: 503,
        async text() {
          return JSON.stringify({ ok: false, error: 'sd_proxy_failed', message: 'proxy down' });
        },
      }),
      resolveSdProxyUrl: () => 'https://sd.example.com',
      resolveSdScriptPath: () => __filename,
      runSdScript: async () => {
        runSdScriptCalled = true;
        return { ok: true };
      },
      uploadBufferToR2: async () => ({
        url: 'https://files.example.com/rat-bleu.png',
      }),
    });

    await assert.rejects(
      () => generateSdInternal({
        req: { headers: {}, user: { id: 'user-1' } },
        prompt: 'genere un rat bleu',
        body: { prompt: 'genere un rat bleu' },
      }),
      (error) => {
        assert.equal(error.statusCode, 503);
        assert.equal(error.payload?.code, 'local_only_fallback_blocked');
        assert.equal(runSdScriptCalled, false);
        return true;
      }
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('generateSdInternal allows explicit local SD fallback override in production when requested', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_SD: process.env.ENABLE_SD,
    A11_SD_PROXY_URL: process.env.A11_SD_PROXY_URL,
    A11_SD_ALLOW_LOCAL_FALLBACK: process.env.A11_SD_ALLOW_LOCAL_FALLBACK,
  };
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_SD = 'true';
  process.env.A11_SD_PROXY_URL = 'https://sd.example.com/api/tools/generate_sd';
  process.env.A11_SD_ALLOW_LOCAL_FALLBACK = 'true';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-fallback-'));
  const outputPath = path.join(tempDir, 'rat-bleu.png');
  fs.writeFileSync(outputPath, Buffer.from('png'));

  try {
    const { generateSdInternal } = createSdToolsRouter({
      fetch: async () => ({
        ok: false,
        status: 503,
        async text() {
          return JSON.stringify({ ok: false, error: 'sd_proxy_failed', message: 'proxy down' });
        },
      }),
      resolveSdProxyUrl: () => 'https://sd.example.com',
      resolveSdScriptPath: () => __filename,
      runSdScript: async () => ({
        ok: true,
        output_path: outputPath,
        device: 'cuda',
        model_id: 'runwayml/stable-diffusion-v1-5',
        torch_dtype: 'float16',
        cuda_available: true,
        cuda_device_name: 'NVIDIA GeForce RTX 5070',
        xformers_enabled: false,
      }),
      uploadBufferToR2: async () => ({
        url: 'https://files.example.com/rat-bleu.png',
      }),
    });

    const result = await generateSdInternal({
      req: { headers: {}, user: { id: 'user-1' } },
      prompt: 'genere un rat bleu',
      body: { prompt: 'genere un rat bleu' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'stable-diffusion-local');
    assert.equal(result.image_url, 'https://files.example.com/rat-bleu.png');
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('generateImageInternal ignores stray OpenAI keys unless image OpenAI is explicitly enabled', async () => {
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    A11_ENABLE_OPENAI_IMAGE: process.env.A11_ENABLE_OPENAI_IMAGE,
    A11_IMAGE_PROVIDER_ORDER: process.env.A11_IMAGE_PROVIDER_ORDER,
  };

  let capturedBody = null;
  process.env.OPENAI_API_KEY = 'sk-stray-key';
  delete process.env.A11_ENABLE_OPENAI_IMAGE;
  process.env.A11_IMAGE_PROVIDER_ORDER = 'openai,sd';

  try {
    const { generateImageInternal } = createSdToolsRouter({
      fetch: async (_url, options = {}) => {
        capturedBody = JSON.parse(String(options.body || '{}'));
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              image_url: 'https://files.example.com/sd-only-rabbit.png',
              mode: 'stable-diffusion-proxy',
            });
          },
        };
      },
      resolveSdProxyUrl: () => 'http://proxy.test/generate',
      resolveSdScriptPath: () => '',
    });

    const response = await generateImageInternal({
      req: { headers: {} },
      prompt: 'genere une image lapin rose',
      body: { prompt: 'genere une image lapin rose' },
    });

    assert.equal(response.ok, true);
    assert.equal(response.mode, 'stable-diffusion-proxy');
    assert.match(String(capturedBody?.prompt || ''), /Demande : genere une image lapin rose/i);
    assert.match(String(capturedBody?.negative_prompt || ''), /plusieurs sujets/i);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
