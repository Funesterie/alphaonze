const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSdRequestBody,
  generateImageFromMask,
  toImageChatProxyPayload,
} = require('../src/mask/image-chat-runtime.cjs');

test('buildSdRequestBody marks compiled prompts as prebuilt to avoid double enrichment', () => {
  const sdBody = buildSdRequestBody(
    {
      raw: "genere une image d'un lapin rose",
      options: { width: 768, height: 768, steps: 30, guidance_scale: 7.5 },
    },
    {
      prompt: 'a pink rabbit, exactly one pink rabbit only',
      negative_prompt: 'duplicate rabbits, crowd',
      width: 1024,
      height: 1024,
      steps: 40,
      guidance_scale: 8,
    }
  );

  assert.equal(sdBody.prompt_prebuilt, true);
  assert.equal(sdBody.negative_prompt_prebuilt, true);
  assert.equal(sdBody.prompt, 'a pink rabbit, exactly one pink rabbit only');
  assert.equal(sdBody.negative_prompt, 'duplicate rabbits, crowd');
});

test('toImageChatProxyPayload synthesizes a png filename when the image URL has no extension', () => {
  const payload = toImageChatProxyPayload({
    sdResult: {
      ok: true,
      artifact_type: 'image',
      image_url: 'https://files.example.com/generated/linux-image',
      contentType: 'image/png',
    },
    mask: { intent: 'image.generate' },
    compiled: {},
    sdBody: {},
  });

  assert.equal(payload.imagePath, 'https://files.example.com/generated/linux-image');
  assert.match(String(payload.choices?.[0]?.message?.content || ''), /\[ouvrir l'image\]/i);
});

test('generateImageFromMask retries once when the verifier detects multiple subjects', async () => {
  const calls = [];
  const rawMask = {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'sd-payload', version: '1.0' },
    inputs: {
      subject: ['lapin rose'],
      environment: [],
      style: ['high quality'],
      composition: [],
      lighting: [],
      palette: ['pink'],
    },
    options: {
      width: 768,
      height: 768,
      steps: 30,
      guidance_scale: 7.5,
      seed: 100,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    ambiguities: [],
    raw: "genere une image d'un lapin rose",
  };

  const result = await generateImageFromMask({
    req: { headers: {} },
    rawMask,
    imageVerificationEnabled: true,
    generateSd: async ({ body }) => {
      calls.push({
        prompt: body.prompt,
        negative_prompt: body.negative_prompt,
        seed: body.seed,
      });
      return {
        ok: true,
        image_url: `https://files.example.com/rabbit-${calls.length}.png`,
        filename: `rabbit-${calls.length}.png`,
      };
    },
    verifyImageCardinality: async ({ imageUrl }) => {
      if (String(imageUrl).includes('rabbit-1.png')) {
        return {
          ok: true,
          expected: { subject_count: 1, subject_type: 'rabbit', subject_label: 'rabbit', allow_group: false },
          observed: { subject_count: 2, duplicate_subjects: true, fusion_detected: false, subject_match: true, confidence: 0.91 },
          decision: { retry: true, reason: 'multiple_subjects_detected', notes: '' },
        };
      }
      return {
        ok: true,
        expected: { subject_count: 1, subject_type: 'rabbit', subject_label: 'rabbit', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.94 },
        decision: { retry: false, reason: 'ok', notes: '' },
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.match(String(calls[1]?.prompt || ''), /exactly one rabbit/i);
  assert.match(String(calls[1]?.negative_prompt || ''), /duplicate rabbit|multiple rabbit|second animal/i);
  assert.equal(calls[1]?.seed, 197);
  assert.equal(result.sdResult.image_url, 'https://files.example.com/rabbit-2.png');
  assert.equal(result.imageGuard?.retries?.length, 1);
  assert.equal(result.imageGuard?.verification?.decision?.retry, false);
});

test('generateImageFromMask skips retry when image verification is unavailable', async () => {
  let callCount = 0;
  const rawMask = {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'sd-payload', version: '1.0' },
    inputs: {
      subject: ['ours jaune'],
      environment: [],
      style: ['high quality'],
      composition: [],
      lighting: [],
      palette: ['yellow'],
    },
    options: {
      width: 768,
      height: 768,
      steps: 30,
      guidance_scale: 7.5,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    ambiguities: [],
    raw: "genere une image d'un ours jaune",
  };

  const result = await generateImageFromMask({
    req: { headers: {} },
    rawMask,
    imageVerificationEnabled: true,
    generateSd: async () => {
      callCount += 1;
      return {
        ok: true,
        image_url: 'https://files.example.com/bear-1.png',
        filename: 'bear-1.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
  });

  assert.equal(callCount, 1);
  assert.equal(result.imageGuard?.verification?.reason, 'vision_unavailable');
  assert.equal(result.imageGuard?.retries?.length, 0);
});
