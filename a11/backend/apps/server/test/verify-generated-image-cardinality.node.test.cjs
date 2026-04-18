const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const sharp = require('sharp');

const {
  inferExpectedImageContract,
  resolveVisionConfig,
  verifyGeneratedImageCardinality,
} = require('../src/image/verify-generated-image-cardinality.cjs');

async function withImageServer(buffer, run) {
  const server = http.createServer((req, res) => {
    if (req.url === '/image.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(buffer);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const imageUrl = `http://127.0.0.1:${address.port}/image.png`;

  try {
    await run(imageUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function buildPng(svg) {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('resolveVisionConfig enables the local classifier without external API keys', () => {
  const config = resolveVisionConfig();

  assert.equal(config.provider, 'local');
  assert.equal(config.classifier, 'local_heuristic');
  assert.equal(typeof config.available, 'boolean');
});

test('verifyGeneratedImageCardinality accepts a single local subject without remote vision', async () => {
  const image = await buildPng(`
    <svg width="160" height="160" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="160" fill="white"/>
      <circle cx="80" cy="80" r="34" fill="#e11d48"/>
    </svg>
  `);

  await withImageServer(image, async (imageUrl) => {
    const result = await verifyGeneratedImageCardinality({
      imageUrl,
      expected: {
        enabled: true,
        subjectCount: 1,
        subjectType: 'subject',
        subjectLabel: 'subject',
        allowGroup: false,
      },
      requestId: 'single-local',
      prompt: 'exactly one subject',
    });

    assert.equal(result.ok, true);
    assert.equal(result.expected.subject_count, 1);
    assert.equal(result.observed.subject_count, 1);
    assert.equal(result.decision.retry, false);
    assert.equal(result.observed.duplicate_subjects, false);
    assert.equal(result.observed.fusion_detected, false);
    assert.ok(result.observed.confidence >= 0.55);
  });
});

test('verifyGeneratedImageCardinality requests a retry when the local classifier sees two subjects', async () => {
  const image = await buildPng(`
    <svg width="180" height="160" xmlns="http://www.w3.org/2000/svg">
      <rect width="180" height="160" fill="white"/>
      <circle cx="58" cy="82" r="28" fill="#2563eb"/>
      <circle cx="122" cy="82" r="28" fill="#2563eb"/>
    </svg>
  `);

  await withImageServer(image, async (imageUrl) => {
    const result = await verifyGeneratedImageCardinality({
      imageUrl,
      expected: {
        enabled: true,
        subjectCount: 1,
        subjectType: 'subject',
        subjectLabel: 'subject',
        allowGroup: false,
      },
      requestId: 'double-local',
      prompt: 'exactly one subject',
    });

    assert.equal(result.ok, true);
    assert.equal(result.observed.subject_count, 2);
    assert.equal(result.observed.duplicate_subjects, true);
    assert.equal(result.decision.retry, true);
    assert.match(String(result.decision.reason || ''), /multiple_subjects_detected/i);
  });
});

test('verifyGeneratedImageCardinality requests a retry when a pair prompt produces too many subjects', async () => {
  const image = await buildPng(`
    <svg width="240" height="160" xmlns="http://www.w3.org/2000/svg">
      <rect width="240" height="160" fill="white"/>
      <circle cx="50" cy="82" r="24" fill="#ef4444"/>
      <circle cx="120" cy="82" r="24" fill="#22c55e"/>
      <circle cx="190" cy="82" r="24" fill="#3b82f6"/>
    </svg>
  `);

  await withImageServer(image, async (imageUrl) => {
    const result = await verifyGeneratedImageCardinality({
      imageUrl,
      expected: {
        enabled: true,
        subjectCount: 2,
        subjectType: 'character',
        subjectLabel: 'Zelda et Mario',
        allowGroup: false,
      },
      requestId: 'pair-overflow-local',
      prompt: 'exactly two characters: Zelda et Mario',
    });

    assert.equal(result.ok, true);
    assert.equal(result.expected.subject_count, 2);
    assert.equal(result.observed.subject_count, 3);
    assert.equal(result.observed.duplicate_subjects, true);
    assert.equal(result.decision.retry, true);
    assert.match(String(result.decision.reason || ''), /multiple_subjects_detected/i);
  });
});

test('inferExpectedImageContract disables strict single-subject counting for named teams like avengers', () => {
  const result = inferExpectedImageContract({
    mask: {
      raw: 'les avengers',
    },
  });

  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'no_clear_cardinality');
});

test('inferExpectedImageContract preserves pair prompts as exactly two subjects', () => {
  const result = inferExpectedImageContract({
    mask: {
      raw: 'crée une image de Zelda et Mario',
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.subjectCount, 2);
  assert.equal(result.mode, 'pair');
  assert.equal(result.subjectLabel, 'Zelda et Mario');
});

test('inferExpectedImageContract does not confuse accessory detail phrases with a second subject', () => {
  const result = inferExpectedImageContract({
    mask: {
      raw: 'génère une image de luffy avec un grand sombrero mexicain et une cigarette visible près de la bouche',
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.subjectCount, 1);
  assert.equal(result.mode, 'single');
  assert.equal(result.subjectLabel, 'luffy');
});
