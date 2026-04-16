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

test('buildImageHintLookupQuery avoids volatile fire bias for animal subjects', () => {
  const query = buildImageHintLookupQuery({
    raw: 'genere une image de cheval en feu',
    meta: {
      subjectProfile: {
        type: 'single_animal',
        canonicalSubject: 'cheval',
      },
      semantic: {
        elements: [{ label: 'feu', family: 'fire' }],
      },
      imageScratchpad: {
        entityType: 'animal',
      },
    },
    inputs: {
      subject: ['cheval'],
    },
  });

  assert.equal(query, 'cheval');
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

test('resolveImageWebDraft skips transformed reference-character prompts and keeps web only as context', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de zelda en bikini',
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Princesse Zelda',
        },
        semantic: {
          accessories: [{ label: 'bikini', family: 'wearable' }],
        },
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://images.example.com/zelda-ref.png',
      imageTitle: 'Princess Zelda character art',
      sourceUrl: 'https://example.com/zelda',
      sourceDomain: 'example.com',
    },
  });

  assert.equal(result, null);
});

test('resolveImageWebDraft skips volatile fire transforms for animal subjects even when a web image exists', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de cheval en feu',
      meta: {
        subjectProfile: {
          type: 'single_animal',
          canonicalSubject: 'cheval',
        },
        semantic: {
          elements: [{ label: 'feu', family: 'fire' }],
        },
        imageScratchpad: {
          entityType: 'animal',
        },
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://images.example.com/fire-horse.webp',
      imageTitle: 'Fire Horse 2026',
      sourceUrl: 'https://example.com/fire-horse',
      sourceDomain: 'example.com',
    },
  });

  assert.equal(result, null);
});

test('resolveImageWebDraft skips automatic web draft anchoring for explicit two-character prompts', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de batman et catwoman',
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Batman',
        },
      },
      inputs: {
        subject: ['Batman', 'Catwoman'],
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://images.example.com/batman-ref.png',
      imageTitle: 'Batman character art',
      sourceUrl: 'https://example.com/batman',
      sourceDomain: 'example.com',
    },
  });

  assert.equal(result, null);
});
