const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const analyzeSemanticIntent = require('../src/mask/semantic/analyze-semantic-intent.cjs');
const textToWazaa = require('../src/mask/text-to-wazaa.cjs');
const wazaaToMask = require('../src/mask/wazaa-to-mask.cjs');
const { mergeEnrichedWazaa } = require('../src/mask/resolve-text-to-wazaa.cjs');
const createChatRouter = require('../src/routes/chat.cjs');

async function withServer(registerRoutes, runAssertions) {
  const app = express();
  registerRoutes(app);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runAssertions(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error_) => (error_ ? reject(error_) : resolve()));
    });
  }
}

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { response, json };
}

test('analyzeSemanticIntent auto-selects web image search for confident show-subject prompts', () => {
  const result = analyzeSemanticIntent('montre moi goku', {});

  assert.equal(result?.decision?.shouldClarify, false);
  assert.equal(result?.subject, 'goku');
  assert.equal(result?.decision?.selectedIntentType, 'web.image.search');
  assert.equal(result?.topIntents?.[0]?.type, 'web.image.search');
  assert.ok(Number(result?.summary?.confidence || 0) >= 0.6);
});

test('analyzeSemanticIntent keeps explicit image prompts on image.generate', () => {
  const result = analyzeSemanticIntent('genere une image de goku super saiyan', {});

  assert.equal(result?.decision?.shouldClarify, false);
  assert.equal(result?.decision?.selectedIntentType, 'image.generate');
  assert.equal(result?.topIntents?.[0]?.type, 'image.generate');
  assert.ok(Number(result?.summary?.confidence || 0) >= 0.5);
});

test('analyzeSemanticIntent keeps colored creation prompts on image.generate instead of code', () => {
  const result = analyzeSemanticIntent('genere un lapin violet', {});

  assert.equal(result?.decision?.shouldClarify, false);
  assert.equal(result?.decision?.selectedIntentType, 'image.generate');
  assert.equal(result?.topIntents?.[0]?.type, 'image.generate');
});

test('analyzeSemanticIntent treats gold-colored subject prompts as image requests', () => {
  const result = analyzeSemanticIntent('salut genere moi un lapin dore', {});

  assert.equal(result?.decision?.shouldClarify, false);
  assert.equal(result?.decision?.selectedIntentType, 'image.generate');
  assert.equal(result?.topIntents?.[0]?.type, 'image.generate');
});

test('analyzeSemanticIntent activates python and filesystem knowledge for file automation prompts', () => {
  const result = analyzeSemanticIntent('ecris un script python pour trier des png dans un dossier', {});

  assert.equal(result?.decision?.selectedIntentType, 'code.python.generate');
  assert.ok(result?.knowledge?.activeModules?.some((entry) => entry.id === 'python.core'));
  assert.ok(result?.knowledge?.activeModules?.some((entry) => entry.id === 'filesystem.ops'));
});

test('analyzeSemanticIntent activates auth and network knowledge for token and cors issues', () => {
  const result = analyzeSemanticIntent('pourquoi mon jwt bearer plante avec une erreur cors sur mon api', {});

  assert.ok(result?.knowledge?.activeModules?.some((entry) => entry.id === 'security.auth'));
  assert.ok(result?.knowledge?.activeModules?.some((entry) => entry.id === 'networking.basics'));
  assert.notEqual(result?.decision?.selectedIntentType, 'image.generate');
});

test("analyzeSemanticIntent keeps image troubleshooting questions on chat.reply instead of image generation", () => {
  const result = analyzeSemanticIntent("explique le probleme avec le generateur d'image", {});

  assert.equal(result?.decision?.selectedIntentType, 'chat.reply');
  assert.equal(result?.topIntents?.[0]?.type, 'chat.reply');
  assert.equal(result?.summary?.metaImageDiscussion, true);
});

test("analyzeSemanticIntent keeps non-conforming drawing questions on chat.reply instead of image generation", () => {
  const result = analyzeSemanticIntent('pourquoi le dessin de truc pas conforme ?', {});

  assert.equal(result?.decision?.selectedIntentType, 'chat.reply');
  assert.equal(result?.topIntents?.[0]?.type, 'chat.reply');
  assert.equal(result?.summary?.metaImageDiscussion, true);
});

test("analyzeSemanticIntent does not route mail requests with referenced images to image generation", () => {
  const result = analyzeSemanticIntent("envoi un mail à cellaurojeffrey@gmail.com avec l'image de dragon", {});

  assert.equal(result?.decision?.selectedIntentType, 'chat.reply');
  assert.notEqual(result?.topIntents?.[0]?.type, 'image.generate');
  assert.notEqual(result?.topIntents?.[0]?.type, 'web.image.search');
  assert.equal(result?.summary?.decision?.selectedIntentType, 'chat.reply');
});

test('textToWazaa and wazaaToMask preserve semantic hierarchy and emit canonical masks per domain', () => {
  const imageWazaa = textToWazaa.sync('genere une image de goku dans le ciel', {});
  assert.equal(imageWazaa?.intent?.type, 'image.generate');
  assert.equal(imageWazaa?.meta?.sourceText, 'genere une image de goku dans le ciel');
  assert.ok(imageWazaa?.hierarchy?.message);

  const imageMask = wazaaToMask(imageWazaa);
  assert.equal(imageMask?.intent, 'image.generate');
  assert.equal(imageMask?.raw, 'genere une image de goku dans le ciel');
  assert.equal(imageMask?.meta?.promptCompiler, 'a11-fr-minimal');
  assert.ok(Array.isArray(imageMask?.inputs?.subject));
  assert.ok(imageMask.inputs.subject.includes('goku'));

  const codeWazaa = textToWazaa.sync('ecris un script python pour trier des png', {});
  assert.equal(codeWazaa?.intent?.type, 'code.python.generate');
  const codeMask = wazaaToMask(codeWazaa);
  assert.equal(codeMask?.intent, 'code.python.generate');
  assert.equal(codeMask?.version, 'mask-1');
});

test('wazaaToMask ignores noisy llm image subjects when source text contains the real subject', () => {
  const imageMask = wazaaToMask({
    intent: { type: 'image.generate', confidence: 0.92 },
    entities: [
      { role: 'subject', value: 'que tu génere a image of vegeta' },
    ],
    meta: {
      sourceText: "j'aimerais que tu génère une image de vegeta avec la chevelure rose",
      translatedText: 'que tu genere a image of vegeta pink with the chevelure',
      llmColors: ['pink'],
    },
  });

  assert.equal(imageMask?.intent, 'image.generate');
  assert.ok(imageMask?.inputs?.subject?.some((value) => /vegeta/i.test(String(value))));
  assert.equal(imageMask?.meta?.promptCompiler, 'a11-fr-minimal');
  assert.ok(imageMask?.inputs?.composition?.includes('sujet unique bien cadré'));
  assert.ok(!imageMask?.inputs?.subject?.some((value) => /image of|g[eé]n[eè]re/i.test(String(value))));
});

test('wazaaToMask extracts an explicit decor from source text when the environment entity is missing', () => {
  const imageMask = wazaaToMask({
    intent: { type: 'image.generate', confidence: 0.91 },
    entities: [
      { role: 'subject', value: 'dragon bleu' },
    ],
    meta: {
      sourceText: 'genere une image de dragon bleu dans une grotte',
    },
  });

  assert.equal(imageMask?.intent, 'image.generate');
  assert.ok(imageMask?.inputs?.environment?.some((value) => /dans une grotte/i.test(String(value))));
});

test('wazaaToMask infers a coherent decor for creature prompts without explicit environment', () => {
  const imageMask = wazaaToMask({
    intent: { type: 'image.generate', confidence: 0.91 },
    entities: [
      { role: 'subject', value: 'dragon bleu' },
    ],
    meta: {
      sourceText: 'genere une image de dragon bleu',
    },
  });

  assert.equal(imageMask?.intent, 'image.generate');
  assert.ok(imageMask?.inputs?.environment?.some((value) => /décor simple cohérent avec le sujet/i.test(String(value))));
});

test('wazaaToMask applies a simple object profile for apple-like prompts', () => {
  const text = 'genere une image de pomme';
  const analysis = analyzeSemanticIntent(text, {});
  const imageMask = wazaaToMask(textToWazaa.sync(text, {}), { semanticAnalysis: analysis });

  assert.equal(imageMask?.intent, 'image.generate');
  assert.equal(imageMask?.meta?.subjectProfile?.type, 'simple_food_object');
  assert.ok(imageMask?.inputs?.composition?.includes('objet unique isolé'));
  assert.ok(imageMask?.inputs?.environment?.includes('fond neutre simple'));
});

test('wazaaToMask applies a reference character profile for gohan-like prompts', () => {
  const text = 'genere une image de gohan';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(wazaa?.meta?.semantic?.subjectProfile?.type, 'reference_character');
  assert.equal(imageMask?.meta?.subjectProfile?.type, 'reference_character');
  assert.ok(imageMask?.inputs?.composition?.includes('un seul personnage complet'));
  assert.ok(imageMask?.inputs?.environment?.includes('fond simple cohérent avec le personnage'));
});

test('wazaaToMask canonicalizes bugsbunny into a stronger named reference character prompt', () => {
  const text = 'genere une image de bugsbunny avec une cigarette';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'reference_character');
  assert.ok(imageMask?.inputs?.subject?.includes('Bugs Bunny'));
  assert.ok(imageMask?.inputs?.style?.includes('dessin animé classique'));
  assert.match(String(imageMask?.meta?.subjectProfile?.promptInstruction || ''), /lapin de dessin animé gris et blanc/i);
});

test('wazaaToMask canonicalizes zelda into a more explicit named reference character', () => {
  const text = 'genere une image de zelda';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'reference_character');
  assert.ok(imageMask?.inputs?.subject?.includes('Princesse Zelda'));
  assert.ok(imageMask?.inputs?.style?.includes('illustration fantasy nette'));
  assert.match(String(imageMask?.meta?.subjectProfile?.promptInstruction || ''), /Zelda/i);
});

test('wazaaToMask canonicalizes mario with wearable prompts into a named reference character', () => {
  const text = 'genere une image de mario en pull';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'reference_character');
  assert.ok(imageMask?.inputs?.subject?.includes('Mario'));
  assert.ok(imageMask?.meta?.semantic?.accessories?.some((entry) => /pull/i.test(String(entry?.label || ''))));
  assert.ok(imageMask?.meta?.promptInstructions?.some((value) => /pull/i.test(String(value))));
});

test('wazaaToMask canonicalizes princess peach into a named reference character', () => {
  const text = 'genere un dessin de la princesse peach avec une cigarette';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'reference_character');
  assert.ok(imageMask?.inputs?.subject?.includes('Princesse Peach'));
  assert.ok(imageMask?.meta?.promptInstructions?.some((value) => /cigarette/i.test(String(value))));
});

test('wazaaToMask keeps boruto as a reference character for anime action prompts', () => {
  const text = 'genere une image de boruto en train de fumer';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'reference_character');
  assert.ok(imageMask?.inputs?.subject?.some((value) => /boruto/i.test(String(value))));
});

test('wazaaToMask canonicalizes john 117 into master chief', () => {
  const text = "génère une image de john 117 avec l'armure bleue";
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'reference_character');
  assert.ok(imageMask?.inputs?.subject?.includes('Master Chief'));
  assert.match(String(imageMask?.meta?.subjectProfile?.promptInstruction || ''), /Master Chief|super-soldat/i);
});

test('wazaaToMask applies a single human profile for warrior prompts', () => {
  const text = 'génère une image de guerriere nordique';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'single_human_figure');
  assert.ok(imageMask?.inputs?.composition?.includes('une seule personne complète'));
  assert.ok(imageMask?.inputs?.environment?.includes('fond simple cohérent avec le personnage'));
});

test('semantic libraries expose metier and accessory hints for warrior props prompts', () => {
  const text = 'genere une image de guerriere nordique avec une épée';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.ok(wazaa?.meta?.semantic?.metiers?.some((entry) => /guerrier|viking/i.test(String(entry?.label || ''))));
  assert.ok(wazaa?.meta?.semantic?.accessories?.some((entry) => /épée|epee/i.test(String(entry?.label || ''))));
  assert.ok(imageMask?.meta?.promptInstructions?.some((value) => /épée|epee/i.test(String(value))));
  assert.equal(imageMask?.meta?.subjectProfile?.type, 'single_human_figure');
});

test('wazaaToMask keeps subject and accessory relation for rabbit with carrot prompts', () => {
  const text = 'genere une image d un lapin avec une carotte dans la bouche';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.ok(imageMask?.inputs?.subject?.some((value) => /lapin/i.test(String(value))));
  assert.ok(!imageMask?.inputs?.environment?.some((value) => /dans la bouche/i.test(String(value))));
  assert.ok(imageMask?.meta?.promptInstructions?.some((value) => /carotte dans la bouche du sujet principal/i.test(String(value))));
  assert.equal(imageMask?.meta?.subjectProfile?.type, 'single_animal');
});

test('wazaaToMask applies ice phoenix guidance for phoenix glacé prompts', () => {
  const text = 'genere une photo d un phoenix glacé';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'phoenix_creature');
  assert.ok(imageMask?.inputs?.style?.includes('photorealiste'));
  assert.ok(imageMask?.inputs?.style?.includes('textures cristallines'));
  assert.ok(imageMask?.inputs?.environment?.includes('atmosphère froide et cristalline'));
  assert.ok(imageMask?.meta?.promptInstructions?.some((value) => /phénix de glace/i.test(String(value))));
});

test('wazaaToMask applies a single plant profile for winter fir prompts', () => {
  const text = 'genere une image de sapin blanc en hiver';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'single_plant_object');
  assert.ok(imageMask?.inputs?.composition?.includes('une seule plante complète'));
  assert.ok(imageMask?.inputs?.environment?.some((value) => /hiver/i.test(String(value))));
});

test('wazaaToMask turns smoking prompts into explicit cigarette action guidance', () => {
  const text = 'genere une image de pikachu fumant une cigarette';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.ok(imageMask?.meta?.semantic?.accessories?.some((entry) => /cigarette/i.test(String(entry?.label || ''))));
  assert.ok(imageMask?.meta?.promptInstructions?.some((value) => /train de fumer/i.test(String(value))));
  assert.ok(imageMask?.inputs?.composition?.some((value) => /cigarette bien visible près de la bouche/i.test(String(value))));
});

test('wazaaToMask applies pokemon spectre guidance for anime ghost pokemon prompts', () => {
  const text = 'genere une image anime d un pokemon spectre rouge';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const imageMask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(imageMask?.meta?.subjectProfile?.type, 'pokemon_creature');
  assert.ok(imageMask?.inputs?.style?.includes('anime'));
  assert.ok(imageMask?.inputs?.composition?.includes('un seul pokémon complet'));
  assert.ok(imageMask?.inputs?.composition?.includes('forme spectrale lisible'));
  assert.ok(imageMask?.inputs?.environment?.includes('fond simple cohérent avec le pokémon'));
});

test("wazaaToMask rejects french connector fragments as image subjects", () => {
  const imageMask = wazaaToMask({
    intent: { type: 'image.generate', confidence: 0.91 },
    entities: [
      { role: 'subject', value: "d'une" },
    ],
    meta: {
      sourceText: "genere une image d'une tortue ninja",
    },
  });

  assert.equal(imageMask?.intent, 'image.generate');
  assert.ok(imageMask?.inputs?.subject?.some((value) => /tortue ninja/i.test(String(value))));
  assert.ok(!imageMask?.inputs?.subject?.some((value) => /^d['’]?une?$/i.test(String(value))));
});

test('mergeEnrichedWazaa canonicalizes legacy LLM intent aliases', () => {
  const lowConfidenceHeuristic = {
    intent: { type: 'chat.reply', confidence: 0.2 },
    entities: [],
    meta: { sourceText: 'dummy' },
  };

  const mergedCode = mergeEnrichedWazaa(lowConfidenceHeuristic, {
    intent: 'code.generate',
    subject: '',
    colors: [],
    environment: '',
    style: '',
    translatedText: 'write a python script that sorts png files',
  }, 'ecris un script python pour trier des png');
  assert.equal(mergedCode?.intent?.type, 'code.python.generate');

  const mergedReply = mergeEnrichedWazaa(lowConfidenceHeuristic, {
    intent: 'text.answer',
    subject: '',
    colors: [],
    environment: '',
    style: '',
    translatedText: 'reply in text',
  }, 'reponds-moi bonjour');
  assert.equal(mergedReply?.intent?.type, 'chat.reply');
});

test('POST /api/chat auto-searches the web for confident show-subject prompts', async () => {
  await withServer(
    (app) => {
      app.use('/api', createChatRouter({
        openaiClient: null,
        duckduckgoImageSearch: async (subject) => ({
          image_url: `https://images.example.com/${encodeURIComponent(subject)}.png`,
          source_url: 'https://example.com/source',
          title: subject,
        }),
        generateSd: async () => {
          throw new Error('should_not_be_called');
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/chat', {
        message: 'montre moi goku',
      });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.artifact_type, 'web_image');
      assert.equal(json.title, 'goku');
      assert.match(String(json.image_url || ''), /\/goku\.png$/i);
      assert.match(String(json.imagePath || ''), /\/goku\.png$/i);
      assert.match(String(json.content || json.choices?.[0]?.message?.content || ''), /ouvrir l'image/i);
      assert.match(String(json.source_url || ''), /example\.com/);
    }
  );
});
