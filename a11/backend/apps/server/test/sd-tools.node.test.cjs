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

test('generateSdInternal forwards only strong admin headers to the SD proxy', async () => {
  const previousEnv = {
    NEZ_ADMIN_TOKEN: process.env.NEZ_ADMIN_TOKEN,
    A11_NEZ_ADMIN_TOKEN: process.env.A11_NEZ_ADMIN_TOKEN,
    NEZ_SERVICE_TOKEN: process.env.NEZ_SERVICE_TOKEN,
    A11_NEZ_SERVICE_TOKEN: process.env.A11_NEZ_SERVICE_TOKEN,
    NEZ_ALLOWED_TOKEN: process.env.NEZ_ALLOWED_TOKEN,
    NEZ_ALLOWED_TOKENS: process.env.NEZ_ALLOWED_TOKENS,
    NEZ_TOKENS: process.env.NEZ_TOKENS,
    NEZ_TOKEN: process.env.NEZ_TOKEN,
    A11_NEZ_TOKEN: process.env.A11_NEZ_TOKEN,
  };
  process.env.NEZ_ADMIN_TOKEN = 'server-admin-token';
  for (const key of Object.keys(previousEnv)) {
    if (key !== 'NEZ_ADMIN_TOKEN') delete process.env[key];
  }

  let capturedHeaders = null;
  const { generateSdInternal } = createSdToolsRouter({
    fetch: async (_url, options = {}) => {
      capturedHeaders = options.headers || {};
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            image_url: 'https://files.example.com/secure-proxy.png',
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
  });

  try {
    const response = await generateSdInternal({
      req: {
        headers: {
          authorization: 'Bearer user-jwt-token',
          'x-nez-admin': 'true',
          'x-nez-token': 'legacy-client-token',
          'x-nez-admin-token': 'client-admin-token',
        },
      },
      prompt: 'cinematic knight frame',
      body: {
        prompt: 'cinematic knight frame',
        prompt_prebuilt: true,
      },
    });

    assert.equal(response.ok, true);
    assert.equal(Object.hasOwn(capturedHeaders, 'authorization'), false);
    assert.equal(capturedHeaders['x-nez-admin-token'], 'server-admin-token');
    assert.equal(capturedHeaders['x-nez-token'], 'server-admin-token');
    assert.equal(Object.hasOwn(capturedHeaders, 'x-nez-admin'), false);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('generateSdInternal preserves SD3 multi-prompt payload layers', async () => {
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
            image_url: 'https://files.example.com/sd3-multiprompt.png',
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
  });

  const response = await generateSdInternal({
    req: { headers: {} },
    prompt: 'main subject pose continuity: vegeta, stable upright pose',
    body: {
      prompt: 'main subject pose continuity: vegeta, stable upright pose',
      prompt_2: 'scene camera decor continuity: same face, same outfit, simple background',
      prompt_3: 'visible frame delta anatomy prop detail: hair rises, red aura appears',
      negative_prompt: 'low quality',
      negative_prompt_2: 'drift identitaire',
      negative_prompt_3: 'variation insuffisante',
      prompt_prebuilt: true,
      width: 1536,
      height: 896,
    },
  });

  assert.equal(response.ok, true);
  assert.equal(capturedBody?.prompt, 'main subject pose continuity: vegeta, stable upright pose');
  assert.equal(capturedBody?.prompt_2, 'scene camera decor continuity: same face, same outfit, simple background');
  assert.equal(capturedBody?.prompt_3, 'visible frame delta anatomy prop detail: hair rises, red aura appears');
  assert.equal(capturedBody?.prompt_prebuilt, true);
  assert.equal(capturedBody?.prompt_2_prebuilt, true);
  assert.equal(capturedBody?.prompt_3_prebuilt, true);
  assert.equal(capturedBody?.negative_prompt, 'low quality');
  assert.equal(capturedBody?.negative_prompt_2, 'drift identitaire');
  assert.equal(capturedBody?.negative_prompt_3, 'variation insuffisante');
  assert.equal(capturedBody?.negative_prompt_2_prebuilt, true);
  assert.equal(capturedBody?.negative_prompt_3_prebuilt, true);
  assert.equal(capturedBody?.width, 1536);
  assert.equal(capturedBody?.height, 896);
});

test('generateSdInternal aligns requested render dimensions to the SD latent grid', async () => {
  let capturedBody = null;
  const previousEnv = {
    SD_DIMENSION_MULTIPLE: process.env.SD_DIMENSION_MULTIPLE,
    A11_SD_DIMENSION_MULTIPLE: process.env.A11_SD_DIMENSION_MULTIPLE,
    A11_IMAGE_MAX_SIZE: process.env.A11_IMAGE_MAX_SIZE,
    A11_IMAGE_MAX_PIXELS: process.env.A11_IMAGE_MAX_PIXELS,
  };

  process.env.SD_DIMENSION_MULTIPLE = '8';
  process.env.A11_IMAGE_MAX_SIZE = '2048';
  delete process.env.A11_SD_DIMENSION_MULTIPLE;
  delete process.env.A11_IMAGE_MAX_PIXELS;

  const { generateSdInternal } = createSdToolsRouter({
    fetch: async (_url, options = {}) => {
      capturedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            image_url: 'https://files.example.com/aligned.png',
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
  });

  try {
    const response = await generateSdInternal({
      req: { headers: {} },
      prompt: 'cinematic knight frame',
      body: {
        prompt: 'cinematic knight frame',
        prompt_prebuilt: true,
        width: 682,
        height: 1024,
      },
    });

    assert.equal(response.ok, true);
    assert.equal(capturedBody?.width, 680);
    assert.equal(capturedBody?.height, 1024);
    assert.equal(capturedBody?.requested_width, 682);
    assert.equal(capturedBody?.requested_height, 1024);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

test('generateSdInternal defaults img2img strength to auto and forwards the resolved plan to the SD proxy', async () => {
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
            image_url: 'https://files.example.com/zelda-auto.png',
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
    prompt: 'princesse zelda heroique avec une couronne differente',
    body: {
      prompt: 'princesse zelda heroique avec une couronne differente',
      prompt_prebuilt: true,
      init_image_url: 'https://images.example.com/zelda-ref.png',
    },
  });

  assert.equal(response.ok, true);
  assert.equal(capturedBody?.init_image_url, 'https://images.example.com/zelda-ref.png');
  assert.equal(capturedBody?.strength_mode, 'auto');
  assert.equal(capturedBody?.strength_profile, 'preserve');
  assert.ok(Number(capturedBody?.strength_value || 0) >= 0.22);
  assert.ok(Number(capturedBody?.strength_value || 0) <= 0.38);
  assert.equal(capturedBody?.strength, capturedBody?.strength_value);
  assert.equal(capturedBody?.strength_components?.identity?.profile, 'preserve');
  assert.equal(capturedBody?.strength_components?.background?.profile, 'preserve');
});

test('generateSdInternal keeps img2img strength in preserve mode for identity-locked reference scene rewrites', async () => {
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
            image_url: 'https://files.example.com/bond-rewrite.png',
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
    prompt: 'keep the same face and hairstyle, James Bond 007 style, equipped with a silenced pistol, 007 movie introduction decor',
    body: {
      prompt: 'keep the same face and hairstyle, James Bond 007 style, equipped with a silenced pistol, 007 movie introduction decor',
      prompt_prebuilt: true,
      init_image_url: 'https://images.example.com/portrait-ref.png',
    },
  });

  assert.equal(response.ok, true);
  assert.equal(capturedBody?.init_image_url, 'https://images.example.com/portrait-ref.png');
  assert.equal(capturedBody?.strength_mode, 'auto');
  assert.equal(capturedBody?.strength_profile, 'preserve');
  assert.equal(capturedBody?.strength_reason, 'reference_subject_identity_lock');
  assert.ok(Number(capturedBody?.strength_value || 0) >= 0.24);
  assert.ok(Number(capturedBody?.strength_value || 0) <= 0.26);
  assert.equal(capturedBody?.strength, capturedBody?.strength_value);
  assert.equal(capturedBody?.strength_components?.identity?.profile, 'preserve');
  assert.equal(capturedBody?.strength_components?.background?.profile, 'restyle');
});

test('generateSdInternal raises Joker-style img2img rewrites into balanced transform strength', async () => {
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
            image_url: 'https://files.example.com/joker-rewrite.png',
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
    prompt: 'the exact same person from the reference image in a Joker-style transformation, keep exactly the same face and identity, custom bat clearly visible, Harlem-inspired street',
    body: {
      prompt: 'the exact same person from the reference image in a Joker-style transformation, keep exactly the same face and identity, custom bat clearly visible, Harlem-inspired street',
      prompt_prebuilt: true,
      init_image_url: 'https://images.example.com/joker-ref.png',
    },
  });

  assert.equal(response.ok, true);
  assert.equal(capturedBody?.strength_mode, 'auto');
  assert.equal(capturedBody?.strength_profile, 'balanced');
  assert.equal(capturedBody?.strength_reason, 'reference_subject_joker_transformation');
  assert.ok(Number(capturedBody?.strength_value || 0) >= 0.48);
  assert.ok(Number(capturedBody?.strength_value || 0) <= 0.5);
  assert.equal(capturedBody?.strength_components?.identity?.profile, 'preserve');
  assert.equal(capturedBody?.strength_components?.background?.profile, 'restyle');
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
  assert.match(String(capturedBody?.prompt || ''), /rabbit pink/i);
  assert.match(String(capturedBody?.prompt || ''), /colors pink/i);
  assert.match(String(capturedBody?.prompt || ''), /single main subject/i);
  assert.doesNotMatch(String(capturedBody?.prompt || ''), /\bNe pas\b|\bdo not\b|literal interpretation/i);
  assert.match(String(capturedBody?.negative_prompt || ''), /multiple subjects/i);
  assert.match(String(capturedBody?.negative_prompt || ''), /watermark/i);
});

test('generateSdInternal uses the image runtime compiler for rich init-image prompts instead of the legacy compact compiler', async () => {
  let capturedBody = null;
  let runtimeCompilerCalls = 0;
  let legacyCompilerCalls = 0;

  const { generateSdInternal } = createSdToolsRouter({
    fetch: async (_url, options = {}) => {
      capturedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            image_url: 'https://files.example.com/joker-runtime.png',
          });
        },
      };
    },
    resolveSdProxyUrl: () => 'http://proxy.test/generate',
    resolveSdScriptPath: () => '',
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        task: { domain: 'image', action: 'generate' },
        compiler: { target: 'image-prompt-en', version: '1.0' },
        inputs: {
          subject: ['portrait homme'],
          environment: ['rue urbaine sale'],
          style: ['haute qualité'],
          composition: ['personnage entier visible'],
          lighting: ['lumiere cinematographique'],
          palette: ['violet', 'vert', 'rouge'],
        },
        options: { width: 1024, height: 1024, steps: 35, guidance_scale: 8 },
        constraints: { safe_mode: true, no_text: true },
        ambiguities: [],
        raw: 'Utilise l image d entree comme reference d identite, de pose et de cadrage. Transforme la personne en personnage inspire du Joker avec costume complet, maquillage inquietant, batte custom menaceante et decor urbain de Harlem.',
        meta: {},
      },
    }),
    compileMaskImageGenerateRuntime: async () => {
      runtimeCompilerCalls += 1;
      return {
        mask: {},
        compiledPayload: {},
        compiled: {},
        sdBody: {
          prompt: 'Use the input image as the identity, pose, and framing reference. Transform the person into a Joker-inspired character with a complete chaotic purple and green suit, unsettling detailed clown makeup, a custom threatening decorated bat, and a gritty Harlem-inspired street environment with graffiti, dirty pavement, dramatic cinematic lighting, and strong neon reflections. Keep a single full-body subject, a faithful face, a clearly visible bat, a readable outfit, and a powerful dark live-action comic-book atmosphere.',
          prompt_language: 'en',
          negative_prompt: 'blur, low quality, deformed face, bad hands, extra fingers, incorrect anatomy, multiple characters, duplicated bat, cropped head, cropped feet, empty background, flat lighting, weak makeup, unreadable costume, text, watermark, logo, badly generated background',
        },
      };
    },
    compileMaskImageGenerate: () => {
      legacyCompilerCalls += 1;
      return {
        sdBody: {
          prompt: 'joker cinematographique, garder le meme visage et la meme identite',
          negative_prompt: 'plusieurs personnages, texte',
        },
      };
    },
  });

  const response = await generateSdInternal({
    req: { headers: {} },
    prompt: 'Utilise l image d entree comme reference d identite, de pose et de cadrage. Transforme la personne en personnage inspire du Joker dans un style sombre, cinematographique et realiste, avec costume complet, maquillage inquietant, batte custom menaceante et decor urbain de Harlem.',
    body: {
      prompt: 'Utilise l image d entree comme reference d identite, de pose et de cadrage. Transforme la personne en personnage inspire du Joker dans un style sombre, cinematographique et realiste, avec costume complet, maquillage inquietant, batte custom menaceante et decor urbain de Harlem.',
      init_image_url: 'https://images.example.com/joker-ref.png',
      negative_prompt: 'flou, basse qualite, visage deforme, texte',
    },
  });

  assert.equal(response.ok, true);
  assert.equal(runtimeCompilerCalls, 1);
  assert.equal(legacyCompilerCalls, 0);
  assert.equal(capturedBody?.prompt_prebuilt, true);
  assert.equal(capturedBody?.prompt_language, 'en');
  assert.match(String(capturedBody?.prompt || ''), /identity, pose, and framing reference/i);
  assert.match(String(capturedBody?.prompt || ''), /custom threatening decorated bat/i);
  assert.match(String(capturedBody?.prompt || ''), /Harlem-inspired street environment/i);
  assert.doesNotMatch(String(capturedBody?.prompt || ''), /garder le meme visage|joker cinematographique/i);
  assert.match(String(capturedBody?.negative_prompt || ''), /deformed face/i);
  assert.match(String(capturedBody?.negative_prompt || ''), /text, watermark/i);
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

test('generateSdInternal drains local GPU pressure before invoking the local SD script', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-drain-'));
  const outputPath = path.join(tempDir, 'result.png');
  fs.writeFileSync(outputPath, Buffer.from('png'));
  const events = [];

  try {
    const { generateSdInternal } = createSdToolsRouter({
      resolveSdProxyUrl: () => '',
      resolveSdScriptPath: () => __filename,
      isAdminRequest: () => true,
      drainLocalGpuBeforeSd: async () => {
        events.push('drain');
      },
      runSdScript: async () => {
        events.push('run');
        return {
          ok: true,
          output_path: outputPath,
          device: 'cuda',
          model_id: 'stabilityai/stable-diffusion-3.5-medium',
          torch_dtype: 'float16',
          cuda_available: true,
          cuda_device_name: 'NVIDIA GeForce RTX 5070',
          xformers_enabled: false,
        };
      },
      uploadBufferToR2: async () => ({
        url: 'https://files.example.com/result.png',
      }),
    });

    const result = await generateSdInternal({
      req: { headers: {} },
      prompt: 'generate a knight portrait',
      body: { prompt: 'generate a knight portrait', prompt_prebuilt: true },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(events, ['drain', 'run']);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
});

test('generateSdInternal returns an absolute local-file URL when upload falls back to local storage', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_SD: process.env.ENABLE_SD,
    A11_SD_PROXY_URL: process.env.A11_SD_PROXY_URL,
    A11_SD_ALLOW_LOCAL_FALLBACK: process.env.A11_SD_ALLOW_LOCAL_FALLBACK,
    A11_WORKSPACE_ROOT: process.env.A11_WORKSPACE_ROOT,
  };
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_SD = 'true';
  process.env.A11_SD_PROXY_URL = 'https://sd.example.com/api/tools/generate_sd';
  process.env.A11_SD_ALLOW_LOCAL_FALLBACK = 'true';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-sd-local-file-'));
  process.env.A11_WORKSPACE_ROOT = tempDir;
  const outputDir = path.join(tempDir, 'backend', 'apps', 'server', 'tmp', 'generated');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'ballon.png');
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
      uploadBufferToR2: async () => {
        throw new Error('R2 is not configured');
      },
    });

    const result = await generateSdInternal({
      req: {
        headers: {
          host: 'sd.funesterie.me',
          'x-forwarded-proto': 'https',
        },
        user: { id: 'user-1' },
      },
      prompt: 'genere un ballon noir et jaune',
      body: { prompt: 'genere un ballon noir et jaune' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.storage, 'local-file');
    assert.equal(
      result.image_url,
      'https://sd.funesterie.me/files/backend/apps/server/tmp/generated/ballon.png'
    );
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
  assert.match(String(capturedBody?.prompt || ''), /rabbit pink/i);
  assert.match(String(capturedBody?.negative_prompt || ''), /multiple subjects/i);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('generateImageInternal can produce an emergency synthetic image when requested', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-emergency-image-'));
  const previous = {
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    PUBLIC_API_URL: process.env.PUBLIC_API_URL,
    A11_IMAGE_PROVIDER_ORDER: process.env.A11_IMAGE_PROVIDER_ORDER,
    A11_ENABLE_EMERGENCY_IMAGE_FALLBACK: process.env.A11_ENABLE_EMERGENCY_IMAGE_FALLBACK,
  };

  process.env.A11_RUNTIME_ROOT = tempRoot;
  process.env.PUBLIC_API_URL = 'https://a11.example.test';
  process.env.A11_IMAGE_PROVIDER_ORDER = 'synthetic';
  process.env.A11_ENABLE_EMERGENCY_IMAGE_FALLBACK = 'true';

  try {
    const { generateImageInternal } = createSdToolsRouter({
      resolveSdProxyUrl: () => '',
      resolveSdScriptPath: () => '',
    });

    const response = await generateImageInternal({
      req: { headers: {} },
      prompt: 'symbole A11 violet et vert',
      body: { prompt: 'symbole A11 violet et vert', width: 512, height: 512 },
    });

    assert.equal(response.ok, true);
    assert.equal(response.mode, 'synthetic-frame');
    assert.equal(response.content_type, 'image/svg+xml');
    assert.match(String(response.image_url || ''), /^https:\/\/a11\.example\.test\/files\/runtime\/files\/generated\/images\//);
    assert.equal(fs.existsSync(response.output_path), true);
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
