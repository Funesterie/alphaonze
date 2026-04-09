const test = require('node:test');
const assert = require('node:assert/strict');

const {
  directImageRequest,
  normalizeDirectorResult,
  shouldDirectImageRequest,
} = require('../src/knowledge/image-request-director.cjs');

test('normalizeDirectorResult keeps up to five action candidates and three web queries', () => {
  const result = normalizeDirectorResult({
    action_candidates: ['a', 'b', 'c', 'd', 'e', 'f'],
    web_queries: ['q1', 'q2', 'q3', 'q4'],
    composition_hints: ['composition 1', 'composition 2', 'composition 3', 'composition 4'],
  });

  assert.deepEqual(result.action_candidates, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(result.web_queries, ['q1', 'q2', 'q3']);
  assert.deepEqual(result.composition_hints, ['composition 1', 'composition 2', 'composition 3']);
});

test('shouldDirectImageRequest activates for complex or under-specified image prompts', () => {
  assert.equal(shouldDirectImageRequest({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de boruto en train de fumer',
      meta: {
        semantic: {
          confidence: 0.48,
          accessories: [{ label: 'cigarette' }],
        },
      },
    },
    selection: { candidate: true },
  }), true);
});

test('directImageRequest enriches the mask with llm actions and web contexts', async () => {
  const result = await directImageRequest({
    mask: {
      version: 'mask-1',
      intent: 'image.generate',
      inputs: {
        subject: ['Boruto'],
        environment: ['fond simple cohérent avec le personnage'],
        style: ['illustration nette'],
        composition: ['un seul personnage complet'],
        palette: [],
      },
      meta: {
        subjectProfile: {
          type: 'reference_character',
        },
        semantic: {
          confidence: 0.45,
          accessories: [{ label: 'cigarette', family: 'smoking_prop' }],
        },
        imageScratchpad: {
          canonicalSubject: 'Boruto Uzumaki',
          universe: 'Boruto',
          subjectProfileType: 'reference_character',
          facts: ['Sujet canonique : Boruto Uzumaki'],
        },
      },
      raw: 'genere une image de boruto en train de fumer',
    },
    selection: {
      candidate: true,
      compartment: 'special',
    },
    callStructuredLlm: async () => ({
      action_candidates: [
        'personnage unique complet',
        'cigarette visible près de la bouche',
        'gestuelle anime lisible',
        'fumée légère lisible',
      ],
      web_queries: [
        'Boruto Uzumaki character art',
        'Boruto Uzumaki anime smoking pose',
      ],
      composition_hints: ['silhouette anime bien lisible'],
      environment_hints: ['fond simple dynamique'],
      style_hints: ['illustration anime nette'],
      prompt_instructions: ['Montrer clairement Boruto en train de fumer avec cigarette visible près de la bouche.'],
    }),
    lookupDefinitionContext: async ({ query }) => ({
      title: query,
      summary: `Contexte utile pour ${query}.`,
      url: 'https://example.com/wiki',
    }),
    duckduckgoImageSearch: async (query) => ({
      title: `${query} art`,
      image_url: 'https://images.example.com/boruto.png',
      source_url: 'https://images.example.com/source',
    }),
  });

  assert.equal(result.skipped, false);
  assert.equal(result.director.web_contexts.length, 2);
  assert.ok(result.mask.meta.promptInstructions.some((entry) => /Boruto en train de fumer/i.test(String(entry))));
  assert.ok(result.mask.meta.promptInstructions.some((entry) => /cigarette visible près de la bouche/i.test(String(entry))));
  assert.ok(result.mask.meta.imageRequestDirector.summaryFacts.some((entry) => /Action utile/i.test(String(entry))));
  assert.ok(result.mask.inputs.style.includes('illustration anime nette'));
  assert.ok(result.mask.inputs.environment.includes('fond simple dynamique'));
});
