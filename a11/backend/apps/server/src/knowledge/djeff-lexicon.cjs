'use strict';

/**
 * Lexique de Djeff : ses mots a lui, injectes tels quels dans le contexte de Vivy.
 *
 * Constat du 13/09/2026 : « Double Excalibur » (les deux Beretta 92FS de Revy) est
 * devenu « deux epees ». L'historique ChatGPT parle bien des 92FS, mais jamais sous ce
 * nom ; la recherche par mots tombait donc sur la « formule Excalibur » des nombres
 * premiers. Un sens que seul Djeff connait ne se retrouve pas par recherche : il
 * s'ecrit. Ce module lit src/knowledge/djeff-lexique.md et rend, pour un texte donne,
 * les definitions des termes qui y apparaissent. Deterministe, sans reseau, ne leve
 * jamais : le graphe peut tomber, le lexique reste.
 */

const fs = require('node:fs');
const path = require('node:path');

const LEXIQUE_PATH = path.join(__dirname, 'djeff-lexique.md');
const MAX_ENTREES = 6;

let cache = null;
let cacheStamp = '';

function plier(texte = '') {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Sections `## Terme`, ligne `alias:`, puis la definition. */
function parserLexique(markdown = '') {
  const entrees = [];
  for (const bloc of String(markdown || '').split(/^##\s+/m).slice(1)) {
    const lignes = bloc.split(/\r?\n/);
    const terme = lignes.shift().trim();
    if (!terme) continue;
    const alias = [terme];
    const definition = [];
    for (const ligne of lignes) {
      const a = ligne.match(/^alias\s*:\s*(.+)$/i);
      if (a) alias.push(...a[1].split(',').map((x) => x.trim()).filter(Boolean));
      else if (ligne.trim()) definition.push(ligne.trim());
    }
    if (!definition.length) continue;
    entrees.push({
      terme,
      alias: [...new Set(alias.map(plier).filter(Boolean))],
      definition: definition.join(' '),
    });
  }
  return entrees;
}

function lireLexique(fichier = LEXIQUE_PATH) {
  try {
    const stamp = `${fichier}:${fs.statSync(fichier).mtimeMs}`;
    if (cache && cacheStamp === stamp) return cache;
    cache = parserLexique(fs.readFileSync(fichier, 'utf8'));
    cacheStamp = stamp;
    return cache;
  } catch {
    return [];
  }
}

/** Les entrees dont un alias apparait (mot entier) dans le texte. */
function entreesPour(texte = '', entrees = lireLexique()) {
  const plie = ` ${plier(texte)} `;
  if (plie.trim().length === 0) return [];
  return entrees
    .filter((entree) => entree.alias.some((alias) => plie.includes(` ${alias} `)))
    .slice(0, MAX_ENTREES);
}

/** Bloc pret a coller dans un prompt, ou chaine vide. */
function blocLexique(texte = '', entrees) {
  const trouvees = entreesPour(texte, entrees);
  if (!trouvees.length) return '';
  return [
    'LEXIQUE DE DJEFF (sens exact, prioritaire sur le sens courant) :',
    ...trouvees.map((entree) => `- ${entree.terme} : ${entree.definition}`),
  ].join('\n');
}

module.exports = {
  LEXIQUE_PATH,
  parserLexique,
  lireLexique,
  entreesPour,
  blocLexique,
};
