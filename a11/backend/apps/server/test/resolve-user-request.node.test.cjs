const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createIntentResolver,
} = require('../src/resolve-user-request.cjs');
const {
  normalizeIntentType,
} = require('../src/mask/semantic/semantic-utils.cjs');
const validateMaskUnified = require('../src/mask/validate-mask-unified.cjs');

async function withImagePipelineMode(mode, fn) {
  const previous = process.env.A11_IMAGE_PIPELINE_MODE;
  process.env.A11_IMAGE_PIPELINE_MODE = mode;
  try {
    return await fn();
  } finally {
    process.env.A11_IMAGE_PIPELINE_MODE = previous;
  }
}

test('semantic intent aliases normalize to canonical source-of-truth intents', () => {
  assert.equal(normalizeIntentType('code.generate'), 'code.python.generate');
  assert.equal(normalizeIntentType('text.answer'), 'chat.reply');
  assert.equal(normalizeIntentType('action.run'), 'chat.reply');
  assert.equal(normalizeIntentType('memory.recall'), 'chat.reply');
  assert.equal(normalizeIntentType('ui.display'), 'chat.reply');
});

test('resolveUserRequest clarifies ambiguous image requests versus web image search', async () => {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'affiche un dragon bleu',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'clarification');
  assert.equal(resolution.clarification.shouldClarify, true);
  assert.match(
    String(resolution.clarification.question || ''),
    /genere une image|cherche une image existante sur le web/i
  );
});

test('resolveUserRequest emits a valid mask-1 image.generate mask and compiles it', async () => {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de dragon bleu',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.mask.intent, 'image.generate');
  assert.equal(resolution.mask.version, 'mask-1');
  assert.equal(validateMaskUnified(resolution.mask).valid, true);
  assert.ok(Array.isArray(resolution.mask.inputs.environment));
  assert.ok(resolution.mask.inputs.environment.length >= 1);
  assert.equal(resolution.compiled.target, 'image-prompt-fr');
  assert.equal(typeof resolution.compiled.value.prompt, 'string');
  assert.match(String(resolution.compiled.value.prompt || ''), /Environnement :/i);
});

test('resolveUserRequest emits canonical code.python.generate masks that compile to python', async () => {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'ecris un script python qui trie des png',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'code.python.generate');
  assert.equal(resolution.mask.intent, 'code.python.generate');
  assert.equal(resolution.mask.version, 'mask-1');
  assert.equal(validateMaskUnified(resolution.mask).valid, true);
  assert.equal(resolution.compiled.target, 'python');
  assert.match(String(resolution.code || resolution.compiled.value || ''), /def main|Path/);
});

test("resolveUserRequest keeps image troubleshooting requests in text mode", async () => {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: "explique le probleme avec le generateur d'image",
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'chat.reply');
  assert.equal(resolution.mask.intent, 'chat.reply');
});

test("resolveUserRequest keeps non-conforming drawing questions in text mode", async () => {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'pourquoi le dessin de truc pas conforme ?',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'chat.reply');
  assert.equal(resolution.mask.intent, 'chat.reply');
});

test('resolveUserRequest enriches doubtful image prompts with concise web definition context', async () => {
  const fakeTextToWazaa = async (text) => ({
    wazaa: '1.1',
    meta: {
      source: 'test',
      timestamp: 1,
      sourceText: text,
    },
    signal: { confidence: 0.41 },
    hierarchy: {},
    entities: [],
    relations: [],
    intents: [{ type: 'image.generate', score: 0.51, label: 'Generer une image' }],
    ambiguities: [],
    intent: {
      type: 'image.generate',
      confidence: 0.41,
    },
  });
  fakeTextToWazaa.sync = (text) => ({
    wazaa: '1.1',
    meta: {
      source: 'test',
      timestamp: 1,
      sourceText: text,
    },
    signal: { confidence: 0.41 },
    hierarchy: {},
    entities: [],
    relations: [],
    intents: [{ type: 'image.generate', score: 0.51, label: 'Generer une image' }],
    ambiguities: [],
    intent: {
      type: 'image.generate',
      confidence: 0.41,
    },
  });

  const lookupCalls = [];
  const resolver = createIntentResolver({
    textToWazaa: fakeTextToWazaa,
    lookupDefinitionContext: async ({ query }) => {
      lookupCalls.push(query);
      return {
        term: query,
        title: 'qilin',
        summary: 'Créature mythique chinoise proche du dragon, souvent représentée comme un être noble et fantastique.',
        url: 'https://example.com/qilin',
        source: 'test',
        language: 'fr',
      };
    },
  });

  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de qilin violet',
    executeRuntime: false,
  });

  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0], 'qilin');
  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.mask.meta.definitionLookup.title, 'qilin');
  assert.match(String(resolution.compiled.value.prompt || ''), /Contexte utile : Créature mythique chinoise proche du dragon/i);
});

test('resolveUserRequest attaches a temporary image scratchpad when an entity is resolved', async () => {
  const resolver = createIntentResolver({
    resolveImageEntityContext: async () => ({
      canonicalSubject: 'Master Chief',
      description: "personnage de fiction de l'univers Halo",
      summary: 'Super-soldat fictif de la franchise Halo.',
      universe: 'Halo',
      entityType: 'fictional_character',
    }),
  });

  const resolution = await withImagePipelineMode('smart', () => resolver.resolveUserRequest({
    userText: 'genere une image de john 117 en armure bleue',
    executeRuntime: false,
  }));

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.mask.meta.imageEntityContext.canonicalSubject, 'Master Chief');
  assert.equal(resolution.mask.meta.imageScratchpad.canonicalSubject, 'Master Chief');
  assert.match(String(resolution.compiled.value.prompt || ''), /Ardoise utile :/i);
});

test('resolveUserRequest marks simple single-subject prompts as raw by default', async () => {
  const resolver = createIntentResolver({
    resolveImageEntityContext: async () => ({
      canonicalSubject: 'Master Chief',
      description: "personnage de fiction de l'univers Halo",
      summary: 'Super-soldat fictif de la franchise Halo.',
      universe: 'Halo',
      entityType: 'fictional_character',
    }),
  });

  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de licorne',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.imageRequestMode, 'raw');
  assert.equal(resolution.mask.meta.imageRequestMode, 'raw');
  assert.equal(resolution.mask.meta.imageScratchpad, undefined);
});

test('resolveUserRequest smooths noisy image requests before building the canonical mask', async () => {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une imag de pikachuu bleu',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.requestText.changed, true);
  assert.equal(resolution.requestText.original, 'genere une imag de pikachuu bleu');
  assert.match(String(resolution.requestText.smoothed || ''), /image de pikachu bleu/i);
  assert.equal(resolution.mask.meta.originalSourceText, 'genere une imag de pikachuu bleu');
  assert.match(String(resolution.mask.meta.requestTextSmoother?.smoothedText || ''), /image de pikachu bleu/i);
  assert.match(String(resolution.mask.inputs.subject?.[0] || ''), /pikachu/i);
});
