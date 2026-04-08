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
  assert.equal('negative_prompt' in capturedBody, false);
  assert.equal('negative_prompt_prebuilt' in capturedBody, false);
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
  assert.equal('negative_prompt_prebuilt' in capturedBody, false);
  assert.match(String(capturedBody?.prompt || ''), /Demande utilisateur : genere une image lapin rose/i);
  assert.match(String(capturedBody?.prompt || ''), /Sujet principal : lapin/i);
  assert.match(String(capturedBody?.prompt || ''), /Palette : rose/i);
  assert.match(String(capturedBody?.prompt || ''), /Interprétation littérale/i);
  assert.doesNotMatch(String(capturedBody?.prompt || ''), /\brabbit\b|\bpink\b|literal interpretation/i);
  assert.equal('negative_prompt' in capturedBody, false);
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
  assert.equal('negative_prompt_prebuilt' in capturedBody, false);
  assert.equal('negative_prompt' in capturedBody, false);
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
    'Demande utilisateur : genere un lapin rose',
    'Sujet principal : lapin rose',
    'Style : haute qualité, détaillé',
    'Composition : composition solo, fond simple et propre',
    'Interprétation littérale de la demande',
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
  assert.equal('negative_prompt_prebuilt' in capturedBody, false);
  assert.equal('negative_prompt' in capturedBody, false);
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
  assert.equal('negative_prompt' in capturedBody, false);
});

test('generateSdInternal blocks local-only fallback in production when proxy fails', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

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
        return true;
      }
    );
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('generateSdInternal falls back to local SD in production when ENABLE_SD is true', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_SD: process.env.ENABLE_SD,
  };
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_SD = 'true';

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
    assert.equal(result.device, 'cuda');
    assert.equal(result.model_id, 'runwayml/stable-diffusion-v1-5');
    assert.equal(result.torch_dtype, 'float16');
    assert.equal(result.cuda_available, true);
    assert.equal(result.cuda_device_name, 'NVIDIA GeForce RTX 5070');
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
    assert.match(String(capturedBody?.prompt || ''), /Demande utilisateur : genere une image lapin rose/i);
    assert.equal('negative_prompt' in capturedBody, false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
