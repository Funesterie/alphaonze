const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImageReferenceQueries,
  extractBodyAnchors,
  resolveImageReferencePack,
  shouldResolveImageReferencePack,
} = require('../src/knowledge/image-reference-pack.cjs');

test('extractBodyAnchors detects mouth, hand and head placement hints', () => {
  const anchors = extractBodyAnchors({
    raw: 'genere une image de luffy avec un sombrero mexicain et une cigarette visible près de la bouche dans la main',
  });

  assert.deepEqual(
    anchors.map((entry) => entry.key),
    ['mouth', 'hand', 'head']
  );
});

test('buildImageReferenceQueries creates subject and accessory reference searches for smoking and wearable prompts', () => {
  const queries = buildImageReferenceQueries({
    intent: 'image.generate',
    raw: 'genere une image de luffy avec un grand sombrero mexicain et une cigarette',
    inputs: {
      subject: ['Luffy'],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
      },
      imageScratchpad: {
        canonicalSubject: 'Luffy',
        universe: 'One Piece',
      },
      semantic: {
        accessories: [
          { label: 'grand sombrero mexicain', family: 'wearable' },
          { label: 'cigarette', family: 'smoking_prop' },
        ],
        elements: [],
        scenes: [],
      },
      promptInstructions: [
        'Montrer clairement le sujet principal en train de fumer avec cigarette visible près de la bouche.',
      ],
    },
  });

  assert.equal(queries[0]?.role, 'subject');
  assert.match(String(queries[0]?.query || ''), /Luffy One Piece character art/i);
  assert.ok(queries.some((entry) => /sombrero mexicain/i.test(String(entry.query))));
  assert.ok(queries.some((entry) => /mouth smoking pose anime/i.test(String(entry.query))));
});

test('shouldResolveImageReferencePack stays off for simple plain single-subject prompts', () => {
  assert.equal(shouldResolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de sanji',
      inputs: { subject: ['Sanji'] },
      meta: {
        subjectProfile: { type: 'reference_character' },
        semantic: {
          accessories: [],
          elements: [],
          scenes: [],
        },
      },
    },
    selection: { candidate: false },
  }), false);
});

test('resolveImageReferencePack collects multi-part web references for subject and accessories', async () => {
  const calls = [];

  const result = await resolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de boruto en train de fumer avec un manteau noir',
      inputs: { subject: ['Boruto'] },
      meta: {
        subjectProfile: { type: 'reference_character' },
        imageScratchpad: {
          canonicalSubject: 'Boruto Uzumaki',
          universe: 'Boruto',
        },
        semantic: {
          accessories: [
            { label: 'cigarette', family: 'smoking_prop' },
            { label: 'manteau noir', family: 'wearable' },
          ],
          elements: [],
          scenes: [],
        },
      },
    },
    selection: { candidate: true },
    duckduckgoImageSearch: async (query) => {
      calls.push(query);
      return {
        title: `${query} ref`,
        image_url: `https://images.example.com/${calls.length}.png`,
        source_url: 'https://example.com/source',
        source_domain: 'example.com',
        selection_score: 9,
        width: 1024,
        height: 1024,
      };
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(result.references.length, 3);
  assert.ok(result.summaryFacts.some((entry) => /Référence accessory cigarette/i.test(String(entry))));
  assert.ok(result.references.some((entry) => entry.role === 'subject'));
  assert.ok(result.references.some((entry) => entry.label === 'manteau noir'));
});
