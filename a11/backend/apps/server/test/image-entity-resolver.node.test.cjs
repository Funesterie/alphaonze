const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImageEntityLookupQuery,
  resolveImageEntityContext,
} = require('../src/knowledge/image-entity-resolver.cjs');
const {
  buildImageScratchpad,
  enrichImageMaskWithScratchpad,
} = require('../src/mask/image-scratchpad.cjs');

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

test('buildImageEntityLookupQuery prefers the canonical subject already known by the mask', () => {
  const query = buildImageEntityLookupQuery({
    intent: 'image.generate',
    raw: 'genere une image de john 117',
    meta: {
      canonicalSubject: 'Master Chief',
    },
    inputs: {
      subject: ['john 117'],
    },
  });

  assert.equal(query, 'Master Chief');
});

test('resolveImageEntityContext returns a structured wikidata-backed entity context for named references', async () => {
  const context = await resolveImageEntityContext({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de john 117 en armure bleue',
      inputs: {
        subject: ['Master Chief'],
      },
      meta: {
        canonicalSubject: 'Master Chief',
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Master Chief',
        },
        semantic: {
          confidence: 0.46,
        },
      },
    },
    fetch: async (url) => {
      if (String(url).includes('wbsearchentities')) {
        return jsonResponse({
          search: [
            {
              id: 'Q652022',
              label: 'Spartan John-117',
              description: "personnage de fiction de l'univers Halo",
              aliases: ['Master Chief'],
              url: '//www.wikidata.org/wiki/Q652022',
            },
          ],
        });
      }

      if (String(url).includes('Special:EntityData/Q652022.json')) {
        return jsonResponse({
          entities: {
            Q652022: {
              id: 'Q652022',
              labels: {
                fr: { value: 'Spartan John-117' },
              },
              descriptions: {
                fr: { value: "personnage de fiction de l'univers Halo" },
              },
              aliases: {
                fr: [{ value: 'Master Chief' }],
              },
              sitelinks: {
                enwiki: {
                  title: 'Master Chief (Halo)',
                  url: 'https://en.wikipedia.org/wiki/Master_Chief_(Halo)',
                },
              },
            },
          },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    },
    lookupDefinitionContext: async () => ({
      title: 'Master Chief',
      summary: 'Super-soldat fictif de la franchise Halo.',
      url: 'https://example.com/master-chief',
    }),
  });

  assert.equal(context?.canonicalSubject, 'Master Chief');
  assert.equal(context?.wikidataId, 'Q652022');
  assert.equal(context?.entityType, 'fictional_character');
  assert.equal(context?.universe, 'Halo');
  assert.match(String(context?.summary || ''), /Halo/i);
});

test('enrichImageMaskWithScratchpad keeps a temporary scratchpad and promotes the canonical entity subject when useful', () => {
  const enriched = enrichImageMaskWithScratchpad({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    inputs: {
      subject: ['john 117'],
      environment: [],
      style: ['haute qualité'],
      composition: ['un seul personnage complet'],
      lighting: [],
      palette: [],
    },
    options: {
      width: 768,
      height: 768,
      steps: 40,
      guidance_scale: 8,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
      },
      semantic: {
        accessories: [{ label: 'armure' }],
      },
    },
    raw: 'genere une image de john 117 en armure bleue',
  }, {
    entityContext: {
      canonicalSubject: 'Master Chief',
      description: "personnage de fiction de l'univers Halo",
      summary: 'Super-soldat fictif de la franchise Halo.',
      universe: 'Halo',
      entityType: 'fictional_character',
    },
  });

  const scratchpad = buildImageScratchpad(enriched, enriched.meta.imageEntityContext);

  assert.equal(enriched.inputs.subject[0], 'Master Chief');
  assert.equal(enriched.meta.canonicalSubject, 'Master Chief');
  assert.ok(Array.isArray(enriched.meta.imageScratchpad?.facts));
  assert.ok(enriched.meta.imageScratchpad.facts.some((entry) => /Halo/i.test(String(entry))));
  assert.ok(enriched.meta.promptInstructions.some((entry) => /Master Chief|Halo/i.test(String(entry))));
  assert.equal(scratchpad.canonicalSubject, 'Master Chief');
});

test('buildImageScratchpad creates a gentle racing embellishment for very basic mario kart prompts', () => {
  const enriched = enrichImageMaskWithScratchpad({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    inputs: {
      subject: ['Mario'],
      environment: ['fond simple cohérent avec le personnage'],
      style: ['illustration nette'],
      composition: ['un seul personnage complet'],
      lighting: [],
      palette: [],
    },
    options: {
      width: 768,
      height: 768,
      steps: 40,
      guidance_scale: 8,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
        canonicalSubject: 'Mario',
      },
      semantic: {
        confidence: 0.89,
        accessories: [],
        elements: [],
        metiers: [],
        scenes: [],
      },
    },
    raw: 'genere une image de mario kart',
  }, {
    entityContext: {
      canonicalSubject: 'Mario',
      description: 'personnage de jeu vidéo Nintendo',
      summary: 'Pilote emblématique de la série Mario Kart.',
      universe: 'Mario Kart',
      entityType: 'fictional_character',
    },
  });

  assert.equal(enriched.meta.imageScratchpad?.embellishment?.family, 'racing_arcade');
  assert.ok(enriched.inputs.composition.includes('dérapage visible'));
  assert.ok(enriched.inputs.environment.includes('virage de circuit lisible'));
  assert.ok(enriched.inputs.style.includes('énergie arcade nette'));
  assert.ok(enriched.meta.promptInstructions.some((entry) => /pleine course|dérapage visible/i.test(String(entry))));
});
