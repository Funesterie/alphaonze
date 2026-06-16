const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  createGenerateVideoHandler,
} = require('../src/video/video-generate-runtime.cjs');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=',
  'base64'
);

test('video runtime attaches A11 Director metadata before sequence planning without real video generation', async () => {
  const previousPlannerEnv = process.env.A11_VIDEO_SEQUENCE_PLANNER;
  process.env.A11_VIDEO_SEQUENCE_PLANNER = 'heuristic';

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => ({
        ok: true,
        image_url: `https://files.example.com/frame-${body.width}x${body.height}.png`,
      }),
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: '50cc AM6 OKO',
        },
      }),
      compileMaskImageGenerateRuntime: async () => ({
        sdBody: {
          prompt: '50cc AM6 OKO powerjet Metrakit passage bas radiateurs lateraux plaque phare',
        },
      }),
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: '50cc AM6 OKO powerjet Metrakit passage bas radiateurs lateraux plaque phare',
      body: {
        prompt: '50cc AM6 OKO powerjet Metrakit passage bas radiateurs lateraux plaque phare',
        durationSeconds: 1,
        fps: 2,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sequencePlanning.providerUsed, 'heuristic');
    assert.equal(result.sequencePlanning.a11Director.enabled, true);
    assert.ok(result.sequencePlanning.a11Director.objectCards.some((card) => /OKO/i.test(card.term)));
    assert.ok(result.sequencePlanning.a11Director.spatialLocks.some((lock) => /adult-size|50cc|supermoto/i.test(lock.positiveModel)));
    assert.ok(result.sequencePlanning.a11Director.referenceBoard.roleSeparationRules.some((rule) => /style references never replace/i.test(rule)));
    assert.ok(result.sequencePlanning.a11Director.regenerationPolicy.positiveRestatementOrder.join(' ').includes('vehicle identity'));
    assert.ok(result.sequencePlanning.a11Director.verificationChecklist.rejectIf.some((entry) => /front radiator|radiateur frontal/i.test(entry)));
  } finally {
    if (previousPlannerEnv === undefined) delete process.env.A11_VIDEO_SEQUENCE_PLANNER;
    else process.env.A11_VIDEO_SEQUENCE_PLANNER = previousPlannerEnv;
  }
});
