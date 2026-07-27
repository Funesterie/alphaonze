'use strict';

/**
 * Par defaut, l'ecriture de paroles n'essaie plus le modele local.
 *
 * Mesure du 27/07 en production sur qwen2.5:7b: 8 jetons/seconde, soit 53 a 77 s pour
 * une chanson complete, alors que la tentative locale expire a 40 s. Elle ne pouvait
 * donc jamais aboutir, et consommait 40 s du budget de 92 s avant meme la chaine
 * cloud -- d'ou les « NOSSEN stoppe (524) » signales par Djeff.
 *
 * Le chat et le routage restent locaux: leurs reponses font quelques dizaines de
 * jetons et reviennent en quelques secondes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getVivyLlmConfigs } = require('../src/routes/vivy-studio.cjs');

const ENV_LOCAL = {
  VIVY_OLLAMA_BASE_URL: 'http://a11-ollama:11434',
  VIVY_CHAT_LOCAL_MODEL: 'qwen2.5:7b',
  VIVY_NOSSEN_LOCAL_MODEL: 'qwen2.5:7b',
  OLLAMA_API_KEY: 'ollama-local',
  // Un fournisseur cloud, sinon il ne reste rien a comparer.
  VIVY_OPENAI_BASE_URL: 'https://exemple.test/v1',
  VIVY_OPENAI_API_KEY: 'cle-test',
  VIVY_SONG_MODEL: 'modele-cloud-test',
};

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

const estLocal = (c) => String(c?.provider || '').toLowerCase() === 'ollama'
  || /a11-ollama|localhost|127\.0\.0\.1/.test(String(c?.baseURL || ''));

test('par defaut, aucun fournisseur local pour les paroles', () => {
  avecEnv({ ...ENV_LOCAL, VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK: undefined }, () => {
    const configs = getVivyLlmConfigs({ mode: 'song', purpose: 'lyrics' });
    assert.ok(configs.length > 0, 'il doit rester des fournisseurs cloud');
    assert.equal(configs.filter(estLocal).length, 0, '40 s perdus a chaque chanson sur une tentative vouee a l echec');
  });
});

test('la decision reste reversible sans redeployer', () => {
  avecEnv({ ...ENV_LOCAL, VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK: 'true' }, () => {
    const configs = getVivyLlmConfigs({ mode: 'song', purpose: 'lyrics' });
    assert.ok(configs.filter(estLocal).length > 0, 'le drapeau existant doit toujours pouvoir le remettre');
  });
});

test('l option explicite du code prime aussi', () => {
  avecEnv({ ...ENV_LOCAL, VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK: undefined }, () => {
    const configs = getVivyLlmConfigs({ mode: 'song', purpose: 'lyrics', allowLocalLyricsFallback: true });
    assert.ok(configs.filter(estLocal).length > 0);
  });
});

test('le chat garde le modele local en tete', () => {
  avecEnv({ ...ENV_LOCAL, VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK: undefined }, () => {
    const configs = getVivyLlmConfigs({ mode: 'chat' });
    assert.ok(configs.filter(estLocal).length > 0, 'une reponse de chat est courte: le local convient');
  });
});

test('le routage de chanson garde le local', () => {
  avecEnv({ ...ENV_LOCAL, VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK: undefined }, () => {
    const configs = getVivyLlmConfigs({ mode: 'song', purpose: 'routing' });
    assert.ok(configs.filter(estLocal).length > 0, 'le routeur repond en quelques jetons');
  });
});
