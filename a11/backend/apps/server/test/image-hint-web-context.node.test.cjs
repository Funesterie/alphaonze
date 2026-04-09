const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImageHintLookupQuery,
  resolveImageWebDraft,
} = require('../src/knowledge/image-hint-web-context.cjs');

test('buildImageHintLookupQuery biases reference character prompts toward character art', () => {
  const query = buildImageHintLookupQuery({
    raw: 'genere une image de mario en pull',
    meta: {
      subjectProfile: {
        type: 'reference_character',
        canonicalSubject: 'Mario',
      },
      semantic: {
        accessories: [{ label: 'pull' }],
      },
    },
    inputs: {
      subject: ['Mario'],
    },
  });

  assert.equal(query, 'Mario Nintendo character art');
});

test('buildImageHintLookupQuery biases master chief prompts toward halo character art', () => {
  const query = buildImageHintLookupQuery({
    raw: "génère une image de john 117 avec l'armure bleue",
    meta: {
      imageEntityContext: {
        canonicalSubject: 'Master Chief',
        universe: 'Halo',
      },
      subjectProfile: {
        type: 'reference_character',
        canonicalSubject: 'Master Chief',
      },
    },
    inputs: {
      subject: ['Master Chief'],
    },
  });

  assert.equal(query, 'Master Chief Halo character art');
});

test('resolveImageWebDraft rejects cosplay or plush-like drafts for named reference characters', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de mario',
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Mario',
        },
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://images.example.com/mario-cosplay.png',
      imageTitle: 'Mario cosplay woman costume',
      sourceUrl: 'https://example.com/mario-cosplay',
      sourceDomain: 'example.com',
    },
  });

  assert.equal(result, null);
});
