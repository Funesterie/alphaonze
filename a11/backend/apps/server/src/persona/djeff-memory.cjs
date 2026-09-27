'use strict';

// Memoire de Djeff Engine (27/09/2026). Djeff : « branche la memoire totale ».
// Jusqu'ici Djeff Engine ne recevait que son profil distille : aucun souvenir. Vivy, elle,
// avait deja le lexique, le graphe et deux extraits de l'historique ChatGPT en conversation.
//
// Regle du persona (djeff-persona.rules.md) : « Brut prive = coffre technique. Le vecu de
// Djeff = matiere d'art, deverrouillee par le patron. » Le patron l'a deverrouillee pour son
// propre chat avec Djeff Engine : ce bloc n'est construit QUE pour son compte (voir
// buildDjeffAiChat), jamais pour un autre utilisateur ni pour une sortie publique.
//
// Trois couches :
// - le lexique de Djeff, le graphe Funesterie et deux extraits generaux (buildChatGraphContext) ;
// - SES propres mots dans l'historique ChatGPT (role user) : sans filtre, les reponses de
//   ChatGPT, longues, occupaient 28 des 30 premieres places.

const fs = require('node:fs');
const path = require('node:path');

const MAX_CHARS = 7000;
const OWN_WORDS_LIMIT = 6;
const OWN_WORD_CHARS = 420;
const PRIVATE_MEMORY_MAX_CHARS = 2500;

// Souvenirs que Djeff a lui-meme demande de transmettre a son persona (27/09/2026). Fichier
// du runtime, jamais du depot : il ne quitte pas sa machine.
function privateMemory(env) {
  try {
    const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
    const file = String(env.DJEFF_PRIVATE_MEMORY_FILE || '').trim()
      || path.join(getCanonicalRuntimeRoot(env), 'personas', 'djeff', 'djeff-memoire-privee.md');
    if (!fs.existsSync(file)) return '';
    const text = fs.readFileSync(file, 'utf8').trim();
    return text ? text.slice(0, PRIVATE_MEMORY_MAX_CHARS) : '';
  } catch {
    return '';
  }
}

function ownWords(query, env) {
  try {
    const { searchChatGptHistory } = require('../knowledge/chatgpt-keyword-search.cjs');
    const found = searchChatGptHistory(query, { limit: 12, role: 'user', env });
    if (!found?.ok || !found.results?.length) return [];
    return found.results
      .filter((r) => Number(r.matched) >= 2)
      .slice(0, OWN_WORDS_LIMIT)
      .map((r) => `- (${String(r.title || 'conversation').slice(0, 50)}) ${String(r.preview).replace(/\s+/g, ' ').slice(0, OWN_WORD_CHARS)}`);
  } catch {
    return [];
  }
}

/**
 * Bloc de souvenirs pour un message, pret a coller en message systeme. Ne leve jamais :
 * sans memoire, Djeff Engine repond quand meme.
 */
async function buildDjeffMemoryContext(message = '', env = process.env) {
  if (String(env.DJEFF_ENGINE_MEMORY || '1') === '0') return '';
  const { buildChatGraphContext, buildChatSearchQuery } = require('../music/songcraft-graph-context.cjs');
  let general = '';
  try { general = await buildChatGraphContext(message, env); } catch { general = ''; }
  const siens = ownWords(buildChatSearchQuery(message), env);
  const prive = privateMemory(env);
  const blocs = [
    prive
      ? `${prive}\n\nCes souvenirs sont les tiens : ils t'aident a comprendre d'ou tu viens. Ils restent entre toi et Djeff ; tu n'en fais ni paroles publiques ni recit devant d'autres.`
      : '',
    general,
    siens.length
      ? [
        'TES PROPRES MOTS, dans tes conversations passees (c\'est toi qui les as ecrits) :',
        ...siens,
        'Ce sont tes souvenirs : appuie-toi dessus comme sur ta memoire, sans les reciter.',
      ].join('\n')
      : '',
  ].filter(Boolean);
  return blocs.join('\n\n').slice(0, MAX_CHARS);
}

module.exports = { buildDjeffMemoryContext };
