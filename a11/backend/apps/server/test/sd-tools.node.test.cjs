const test = require('node:test');
const assert = require('node:assert/strict');

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
  assert.equal(capturedBody?.negative_prompt, 'duplicate rabbits, crowd');
  assert.equal(capturedBody?.prompt_prebuilt, true);
  assert.equal(capturedBody?.negative_prompt_prebuilt, true);
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
  assert.match(String(capturedBody?.prompt || ''), /\bone rabbit with pink fur\b/i);
  assert.doesNotMatch(String(capturedBody?.prompt || ''), /\bimage rabbit\b/i);

  const negativeParts = String(capturedBody?.negative_prompt || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  assert.equal(negativeParts.filter((entry) => entry === 'blurry').length, 1);
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
  assert.doesNotMatch(String(capturedBody?.prompt || ''), /\bone one rabbit\b/i);
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
  assert.doesNotMatch(String(capturedBody?.negative_prompt || ''), /\bimage rabbit\b/i);
});
