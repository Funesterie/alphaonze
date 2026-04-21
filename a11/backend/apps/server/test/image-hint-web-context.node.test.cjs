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

test('resolveImageWebDraft skips automatic web draft anchoring for compositional accessory scenes', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de brook avec sa guitare electrique dans un concert rock',
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Brook',
        },
        semantic: {
          accessories: [{ label: 'guitare electrique', family: 'instrument' }],
          scenes: [{ label: 'concert rock', family: 'performance_scene' }],
        },
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://images.example.com/brook-character-art.png',
      imageTitle: 'Brook One Piece character art',
      sourceUrl: 'https://example.com/brook-character-art',
      sourceDomain: 'example.com',
      imageSelectionScore: 12,
    },
  });

  assert.equal(result, null);
});

test('resolveImageWebDraft keeps a direct chat source image pinned instead of swapping to a web accessory draft', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'utilise ma photo pour me transformer en joker avec une batte',
      meta: {
        init_image_url: 'http://127.0.0.1:3000/files/runtime/files/uploads/portrait.png',
        reference_image_url: 'http://127.0.0.1:3000/files/runtime/files/uploads/portrait.png',
        webImageDraft: {
          initImageUrl: 'http://127.0.0.1:3000/files/runtime/files/uploads/portrait.png',
          mode: 'image_url',
          fromChatSourceImage: true,
        },
        subjectProfile: {
          type: 'single_human_figure',
        },
        semantic: {
          accessories: [{ label: 'batte custom joker', family: 'weapon' }],
        },
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://stem.example.com/resources/previews/golden-and-purple-baton-with-joker-mask-free-png.png',
      imageTitle: 'golden and purple baton with joker mask free png',
      sourceUrl: 'https://stem.example.com/resources/previews/joker-baton',
      sourceDomain: 'stem.example.com',
      imageSelectionScore: 11,
    },
  });

  assert.equal(result, null);
});

test('resolveImageWebDraft skips automatic web draft anchoring for composite web images', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'genere une illustration heroique de luffy en contre plongee dramatique',
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Luffy',
        },
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://images.example.com/luffy-crew-poster.jpg',
      imageTitle: 'Luffy crew poster wallpaper',
      sourceUrl: 'https://example.com/luffy-crew-poster',
      sourceDomain: 'example.com',
      imageWidth: 1600,
      imageHeight: 900,
      imageSelectionScore: 10,
    },
  });

  assert.equal(result, null);
});

test('resolveImageWebDraft keeps explicit reference anchors even for composite web images', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'genere une variation de luffy a partir de cette reference officielle',
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Luffy',
        },
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://images.example.com/luffy-crew-poster.jpg',
      imageTitle: 'Luffy crew poster wallpaper',
      sourceUrl: 'https://example.com/luffy-crew-poster',
      sourceDomain: 'example.com',
      imageWidth: 1600,
      imageHeight: 900,
      imageSelectionScore: 10,
    },
  });

  assert.equal(result?.initImageUrl, 'https://images.example.com/luffy-crew-poster.jpg');
  assert.equal(result?.explicitReferenceAnchor, true);
  assert.equal(result?.compositeRisk, true);
});

test('resolveImageWebDraft defaults to auto strength when no explicit override is provided', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'genere une variation a partir de cette reference officielle',
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Luffy',
        },
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://images.example.com/luffy-ref.png',
      imageTitle: 'Luffy official art',
      sourceUrl: 'https://example.com/luffy-ref',
      sourceDomain: 'example.com',
      imageSelectionScore: 10,
    },
  });

  assert.equal(result?.strength, 'auto');
});

test('resolveImageWebDraft ignores numeric env defaults unless forced', () => {
  const previousStrength = process.env.A11_IMAGE_WEB_DRAFT_STRENGTH;
  const previousForce = process.env.A11_IMAGE_WEB_DRAFT_FORCE_STRENGTH;
  process.env.A11_IMAGE_WEB_DRAFT_STRENGTH = '0.31';
  delete process.env.A11_IMAGE_WEB_DRAFT_FORCE_STRENGTH;

  try {
    const result = resolveImageWebDraft({
      mask: {
        intent: 'image.generate',
        raw: 'genere une variation a partir de cette reference officielle',
        meta: {
          subjectProfile: {
            type: 'reference_character',
            canonicalSubject: 'Luffy',
          },
        },
      },
      selection: {
        compartment: 'special',
        candidate: true,
      },
      webHintContext: {
        imageUrl: 'https://images.example.com/luffy-ref.png',
        imageTitle: 'Luffy official art',
        sourceUrl: 'https://example.com/luffy-ref',
        sourceDomain: 'example.com',
        imageSelectionScore: 10,
      },
    });

    assert.equal(result?.strength, 'auto');
  } finally {
    if (previousStrength === undefined) delete process.env.A11_IMAGE_WEB_DRAFT_STRENGTH;
    else process.env.A11_IMAGE_WEB_DRAFT_STRENGTH = previousStrength;
    if (previousForce === undefined) delete process.env.A11_IMAGE_WEB_DRAFT_FORCE_STRENGTH;
    else process.env.A11_IMAGE_WEB_DRAFT_FORCE_STRENGTH = previousForce;
  }
});

test('resolveImageWebDraft honors a late techniqueAnalysisPrompt when deciding explicit reference anchoring', () => {
  const result = resolveImageWebDraft({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de luffy',
      meta: {
        techniqueAnalysisPrompt: 'variation à partir de cette référence officielle, même cadrage, même personnage',
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Luffy',
        },
      },
    },
    selection: {
      compartment: 'special',
      candidate: true,
    },
    webHintContext: {
      imageUrl: 'https://images.example.com/luffy-ref.png',
      imageTitle: 'Luffy official art',
      sourceUrl: 'https://example.com/luffy-ref',
      sourceDomain: 'example.com',
      imageSelectionScore: 10,
    },
  });

  assert.equal(result?.initImageUrl, 'https://images.example.com/luffy-ref.png');
  assert.equal(result?.explicitReferenceAnchor, true);
  assert.equal(result?.reason, 'explicit_reference_anchor');
});
