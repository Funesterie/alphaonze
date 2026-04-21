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
  assert.match(String(queries[0]?.query || ''), /Luffy One Piece solo character art/i);
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

test('shouldResolveImageReferencePack can force a canonical subject lookup for video bootstrap', () => {
  assert.equal(shouldResolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de goku',
      inputs: { subject: ['Goku'] },
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Goku',
        },
        imageScratchpad: {
          canonicalSubject: 'Goku',
          universe: 'Dragon Ball',
        },
        semantic: {
          accessories: [],
          elements: [],
          scenes: [],
        },
      },
    },
    selection: { candidate: false },
    forceSubjectLookup: true,
  }), true);
});

test('resolveImageReferencePack can collapse to a subject-only canonical lookup when forced', async () => {
  const calls = [];

  const result = await resolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de goku',
      inputs: { subject: ['Goku'] },
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Goku',
        },
        imageScratchpad: {
          canonicalSubject: 'Goku',
          universe: 'Dragon Ball',
        },
        semantic: {
          accessories: [
            { label: 'baton', family: 'weapon' },
          ],
          elements: [],
          scenes: [],
        },
      },
    },
    selection: { candidate: false },
    forceSubjectLookup: true,
    subjectOnly: true,
    duckduckgoImageSearch: async (query) => {
      calls.push(query);
      return {
        title: `${query} ref`,
        image_url: 'https://images.example.com/goku-ref.png',
        source_url: 'https://example.com/goku-ref',
        source_domain: 'example.com',
        selection_score: 12,
        width: 1024,
        height: 1024,
      };
    },
  });

  assert.deepEqual(calls, ['Goku Dragon Ball solo character art']);
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].role, 'subject');
  assert.equal(result.references[0].imageUrl, 'https://images.example.com/goku-ref.png');
});

test('resolveImageReferencePack can request a motion-aware subject bootstrap for archery videos', async () => {
  const calls = [];

  const result = await resolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'zelda tirant une fleche avec son arc',
      inputs: { subject: ['Princesse Zelda'] },
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Princesse Zelda',
        },
        imageScratchpad: {
          canonicalSubject: 'Princesse Zelda',
        },
        semantic: {
          accessories: [
            { label: 'arc', family: 'weapon' },
          ],
          elements: [],
          scenes: [],
        },
      },
    },
    selection: { candidate: false },
    forceSubjectLookup: true,
    subjectOnly: true,
    motionProfile: 'archery_shot',
    duckduckgoImageSearch: async (query) => {
      calls.push(query);
      return {
        title: `${query} ref`,
        image_url: 'https://images.example.com/zelda-archer-ref.png',
        source_url: 'https://example.com/zelda-archer-ref',
        source_domain: 'example.com',
        selection_score: 12,
        width: 1024,
        height: 1024,
      };
    },
  });

  assert.deepEqual(calls, ['Princesse Zelda Nintendo archer pose full body character art']);
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].imageUrl, 'https://images.example.com/zelda-archer-ref.png');
});

test('resolveImageReferencePack enriches Mario video bootstraps with the Nintendo universe hint', async () => {
  const calls = [];

  const result = await resolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'mario marchant devant un chateau',
      inputs: { subject: ['Mario'] },
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Mario',
        },
        semantic: {
          accessories: [],
          elements: [],
          scenes: [
            { label: 'chateau', family: 'architecture' },
          ],
        },
      },
    },
    selection: { candidate: false },
    forceSubjectLookup: true,
    subjectOnly: true,
    motionProfile: 'walk_cycle',
    duckduckgoImageSearch: async (query) => {
      calls.push(query);
      return {
        title: 'Super Mario Nintendo full body character art',
        image_url: 'https://images.example.com/mario-ref.png',
        source_url: 'https://example.com/mario-ref',
        source_domain: 'example.com',
        selection_score: 12,
        width: 1024,
        height: 1024,
      };
    },
  });

  assert.deepEqual(calls, ['Mario Nintendo full body pose character art']);
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].imageUrl, 'https://images.example.com/mario-ref.png');
});

test('resolveImageReferencePack lets known Zelda hints override a noisy extracted universe string', async () => {
  const calls = [];

  const result = await resolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'zelda marchant sur un sentier dans la foret',
      inputs: { subject: ['Princesse Zelda'] },
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Princesse Zelda',
        },
        imageScratchpad: {
          canonicalSubject: 'Princesse Zelda',
          universe: 'The Legend Of Zelda Creee Par Shigeru Miy',
        },
        semantic: {
          accessories: [],
          elements: [],
          scenes: [
            { label: 'foret', family: 'natural' },
          ],
        },
      },
    },
    selection: { candidate: false },
    forceSubjectLookup: true,
    subjectOnly: true,
    motionProfile: 'walk_cycle',
    duckduckgoImageSearch: async (query) => {
      calls.push(query);
      return {
        title: 'Princesse Zelda Nintendo full body character art',
        image_url: 'https://images.example.com/zelda-ref.png',
        source_url: 'https://example.com/zelda-ref',
        source_domain: 'example.com',
        selection_score: 12,
        width: 1024,
        height: 1024,
      };
    },
  });

  assert.deepEqual(calls, ['Princesse Zelda Nintendo full body pose character art']);
  assert.equal(result.references.length, 1);
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

test('resolveImageReferencePack rejects poster-like solo subject references when nothing usable remains', async () => {
  const result = await resolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de zelda',
      inputs: { subject: ['Zelda'] },
      meta: {
        subjectProfile: { type: 'reference_character' },
        imageScratchpad: {
          canonicalSubject: 'Princess Zelda',
          universe: 'Nintendo',
        },
        semantic: {
          accessories: [],
          elements: [],
          scenes: [],
        },
      },
    },
    selection: { candidate: true },
    duckduckgoImageSearch: async () => ({
      title: 'The Legend of Zelda poster all characters collage',
      image_url: 'https://yourartpath.com/wp-content/uploads/2018/05/Harry-Potter-2.png',
      source_url: 'https://yourartpath.com/legend-of-zelda-fan-art',
      source_domain: 'yourartpath.com',
      selection_score: 11,
      width: 1200,
      height: 900,
    }),
  });

  assert.equal(result, null);
});

test('resolveImageReferencePack rejects unrelated strict subject bootstraps for Mario videos', async () => {
  const result = await resolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'mario marchant devant un chateau',
      inputs: { subject: ['Mario'] },
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Mario',
        },
        semantic: {
          accessories: [],
          elements: [],
          scenes: [
            { label: 'chateau', family: 'architecture' },
          ],
        },
      },
    },
    selection: { candidate: false },
    forceSubjectLookup: true,
    subjectOnly: true,
    motionProfile: 'walk_cycle',
    duckduckgoImageSearch: async () => ({
      title: 'Historical rider full body pose illustration with horse',
      image_url: 'https://images.example.com/historical-rider.png',
      source_url: 'https://example.org/historical-rider',
      source_domain: 'example.org',
      selection_score: 13,
      width: 1024,
      height: 1024,
    }),
  });

  assert.equal(result, null);
});

test('resolveImageReferencePack rejects birthday-style Zelda subject references for videos', async () => {
  const result = await resolveImageReferencePack({
    mask: {
      intent: 'image.generate',
      raw: 'zelda marchant sur un sentier dans la foret',
      inputs: { subject: ['Princesse Zelda'] },
      meta: {
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Princesse Zelda',
        },
        semantic: {
          accessories: [],
          elements: [],
          scenes: [
            { label: 'foret', family: 'natural' },
          ],
        },
      },
    },
    selection: { candidate: false },
    forceSubjectLookup: true,
    subjectOnly: true,
    motionProfile: 'walk_cycle',
    duckduckgoImageSearch: async () => ({
      title: 'Princesse Zelda a 39 ans, anniversaire le 21 fevrier',
      image_url: 'https://mail.anniversaire-celebrite.com/upload/250x333/princesse-zelda-250.jpg',
      source_url: 'https://mail.anniversaire-celebrite.com/celebrite/princesse-zelda',
      source_domain: 'mail.anniversaire-celebrite.com',
      selection_score: 23,
      width: 250,
      height: 333,
    }),
  });

  assert.equal(result, null);
});
