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

test('textToWazaa and wazaaToMask preserve semantic hierarchy and emit canonical masks per domain', () => {
  const imageWazaa = textToWazaa.sync('genere une image de goku dans le ciel', {});
  assert.equal(imageWazaa?.intent?.type, 'image.generate');
  assert.equal(imageWazaa?.meta?.sourceText, 'genere une image de goku dans le ciel');
  assert.ok(imageWazaa?.hierarchy?.message);

  const imageMask = wazaaToMask(imageWazaa);
  assert.equal(imageMask?.intent, 'image.generate');
  assert.equal(imageMask?.raw, 'genere une image de goku dans le ciel');
  assert.ok(Array.isArray(imageMask?.inputs?.subject));
  assert.ok(imageMask.inputs.subject.includes('goku'));

  const codeWazaa = textToWazaa.sync('ecris un script python pour trier des png', {});
  assert.equal(codeWazaa?.intent?.type, 'code.python.generate');
  const codeMask = wazaaToMask(codeWazaa);
  assert.equal(codeMask?.intent, 'code.python.generate');
  assert.equal(codeMask?.version, 'mask-1');
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
      assert.match(String(json.source_url || ''), /example\.com/);
    }
  );
});
