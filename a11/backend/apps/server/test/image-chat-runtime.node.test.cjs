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
      prompt_language: 'fr',
      negative_prompt: 'duplicate rabbits, crowd',
      width: 1024,
      height: 1024,
      steps: 40,
      guidance_scale: 8,
    }
  );

  assert.equal(sdBody.prompt_prebuilt, true);
  assert.equal(sdBody.prompt, 'a pink rabbit, exactly one pink rabbit only');
  assert.equal(sdBody.prompt_language, 'fr');
  assert.equal(sdBody.negative_prompt, 'duplicate rabbits, crowd');
  assert.equal(sdBody.negative_prompt_prebuilt, true);
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
  assert.equal(payload.mode, 'generate_image');
  assert.equal(payload.tool, 'generate_image');
  assert.match(String(payload.choices?.[0]?.message?.content || ''), /\[ouvrir l'image\]/i);
});

test('generateImageFromMask compiles canonical masks into a french image prompt by default', async () => {
  const calls = [];

  const result = await generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      inputs: {
        subject: ['herisson'],
        environment: [],
        style: ['high quality', 'detailed'],
        composition: ['single main subject', 'clear centered composition', 'simple clean background'],
        lighting: [],
        palette: ['green'],
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
      raw: 'genere un herisson vert',
    },
    generateImage: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/herisson.png',
        filename: 'herisson.png',
        mode: 'openai-image',
        tool: 'generate_image',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
  });

  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.prompt || ''), /genere un herisson vert/i);
  assert.match(String(calls[0]?.prompt || ''), /Sujet principal : herisson/i);
  assert.match(String(calls[0]?.prompt || ''), /Style : high quality, detailed/i);
  assert.match(String(calls[0]?.prompt || ''), /Composition : single main subject, clear centered composition, simple clean background/i);
  assert.match(String(calls[0]?.prompt || ''), /Couleurs : green/i);
  assert.match(String(calls[0]?.prompt || ''), /Créer une image fidèle à la demande/i);
  assert.match(String(calls[0]?.negative_prompt || ''), /plusieurs sujets/i);
  assert.match(String(calls[0]?.negative_prompt || ''), /watermark/i);
  assert.doesNotMatch(String(calls[0]?.prompt || ''), /\bNe pas\b|\bdo not\b/i);
  assert.equal(calls[0]?.prompt_language, 'fr');
  assert.equal(result.sdResult.mode, 'openai-image');
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
        has_negative_prompt: Object.prototype.hasOwnProperty.call(body, 'negative_prompt'),
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
          expected: { subject_count: 1, subject_type: 'lapin', subject_label: 'lapin', allow_group: false },
          observed: { subject_count: 2, duplicate_subjects: true, fusion_detected: false, subject_match: true, confidence: 0.91 },
          decision: { retry: true, reason: 'multiple_subjects_detected', notes: '' },
        };
      }
      return {
        ok: true,
        expected: { subject_count: 1, subject_type: 'lapin', subject_label: 'lapin', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.94 },
        decision: { retry: false, reason: 'ok', notes: '' },
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.match(String(calls[1]?.prompt || ''), /montrer un seul lapin/i);
  assert.match(String(calls[1]?.prompt || ''), /silhouette claire et lisible/i);
  assert.equal(calls[1]?.has_negative_prompt, true);
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

test('generateImageFromMask enables image cardinality verification by default', async () => {
  let verificationCalls = 0;

  const result = await generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['lapin bleu'],
        environment: [],
        style: ['high quality'],
        composition: [],
        lighting: [],
        palette: ['blue'],
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
      raw: "genere une image d'un lapin bleu",
    },
    generateSd: async () => ({
      ok: true,
      image_url: 'https://files.example.com/blue-rabbit.png',
      filename: 'blue-rabbit.png',
    }),
    verifyImageCardinality: async () => {
      verificationCalls += 1;
      return {
        ok: true,
        expected: { subject_count: 1, subject_type: 'rabbit', subject_label: 'rabbit', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.93 },
        decision: { retry: false, reason: 'ok', notes: '' },
      };
    },
  });

  assert.equal(verificationCalls, 1);
  assert.equal(result.imageGuard?.enabled, true);
  assert.equal(result.imageGuard?.verification?.decision?.retry, false);
});

test('generateImageFromMask rejects invalid solid-black generations before returning success', async () => {
  await assert.rejects(
    () => generateImageFromMask({
      req: { headers: {} },
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        task: { domain: 'image', action: 'generate' },
        compiler: { target: 'sd-payload', version: '1.0' },
        inputs: {
          subject: ['vegeta'],
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
        },
        constraints: {
          safe_mode: true,
          no_text: true,
        },
        ambiguities: [],
        raw: "genere une image de vegeta",
      },
      generateSd: async () => ({
        ok: true,
        image_url: 'https://files.example.com/black.png',
        filename: 'black.png',
      }),
      inspectGeneratedImageResult: async () => ({
        ok: false,
        reason: 'solid_black_image_detected',
        imageUrl: 'https://files.example.com/black.png',
        metadata: { width: 768, height: 768, channels: 4, sizeBytes: 1795 },
      }),
    }),
    (error) => {
      assert.equal(error?.statusCode, 502);
      assert.equal(error?.payload?.error, 'image_generation_invalid');
      assert.equal(error?.payload?.details?.reason, 'solid_black_image_detected');
      return true;
    }
  );
});
