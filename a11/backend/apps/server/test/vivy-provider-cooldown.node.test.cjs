'use strict';

/**
 * Fournisseurs en panne de compte, et budget de prompt Groq.
 *
 * Journaux du 27/07: openai 401, deepseek 402, xai 403 a CHAQUE chanson, plus groq 413
 * a chaque fois. Le refroidissement n'armait que sur 429, donc trois fournisseurs
 * condamnes etaient reessayes sans fin -- un aller-retour perdu chacun, sur un budget
 * qui finissait deja en 524. Et le mecanisme de budget de prompt existait sans que Groq
 * n'ait de valeur: on lui envoyait le prompt entier pour se faire refuser.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getVivyLlmConfigs } = require('../src/routes/vivy-studio.cjs');

function avecEnv(valeurs, fn) {
  const anciennes = {};
  for (const [k, v] of Object.entries(valeurs)) {
    anciennes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(anciennes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('le bundle Groq porte un budget de prompt', () => {
  avecEnv({ GROQ_API_KEY: 'cle-test', VIVY_GROQ_MAX_PROMPT_CHARS: undefined }, () => {
    const groq = getVivyLlmConfigs({ mode: 'song', purpose: 'lyrics' })
      .find((c) => c.provider === 'groq');
    assert.ok(groq, 'le fournisseur groq doit etre present avec une cle');
    assert.ok(
      Number(groq.maxPromptChars) > 0,
      'sans budget, fitVivyChatRequestForBundle ne tronque rien et Groq repond 413'
    );
  });
});

test('le budget Groq reste reglable par variable d environnement', () => {
  avecEnv({ GROQ_API_KEY: 'cle-test', VIVY_GROQ_MAX_PROMPT_CHARS: '9000' }, () => {
    const groq = getVivyLlmConfigs({ mode: 'song', purpose: 'lyrics' })
      .find((c) => c.provider === 'groq');
    assert.equal(Number(groq.maxPromptChars), 9000);
  });
});

test('un budget absurde est ramene a un plancher utilisable', () => {
  avecEnv({ GROQ_API_KEY: 'cle-test', VIVY_GROQ_MAX_PROMPT_CHARS: '10' }, () => {
    const groq = getVivyLlmConfigs({ mode: 'song', purpose: 'lyrics' })
      .find((c) => c.provider === 'groq');
    assert.ok(Number(groq.maxPromptChars) >= 4000, 'un prompt de dix caracteres ne produit rien');
  });
});

test('les statuts de compte sont bien ceux mis au repos', () => {
  // Le code met au repos 401 (cle refusee), 402 (plus de credits) et 403 (acces
  // interdit). 429 garde son propre repos, plus court, car il guerit tout seul.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'routes', 'vivy-studio.cjs'),
    'utf8'
  );
  assert.match(source, /\[401, 402, 403\]\.includes\(status\)/, 'les trois statuts de compte doivent etre couverts');
  assert.match(source, /VIVY_LLM_CREDENTIAL_COOLDOWN_MS/, 'la duree du repos doit rester reglable');
});
