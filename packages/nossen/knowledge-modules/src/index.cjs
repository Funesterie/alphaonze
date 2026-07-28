'use strict';

/**
 * Modules de connaissance NOSSEN, publics.
 *
 * Un module est une donnee, pas du code: il decrit ce qu'un agent doit savoir sur un
 * domaine, quand l'activer, et ce qu'il ne doit pas faire. Le code de reference reste
 * la source de verite; ces modules en donnent la lecture pour que la connaissance ne
 * dorme pas dans un fichier que personne ne relit.
 */

const persona = require('./modules/persona.funesterie.cast.module.json');
const temporalGravity = require('./modules/physics.temporal.gravity.module.json');
const pulsarPalette = require('./modules/encoding.pulsar.palette.module.json');

const modules = Object.freeze([persona, temporalGravity, pulsarPalette]);

/** Tous les modules, dans l'ordre de declaration. */
function listModules() {
  return modules.slice();
}

/** Un module par son identifiant, ou null. */
function getModule(id) {
  const wanted = String(id || '').trim().toLowerCase();
  if (!wanted) return null;
  return modules.find((m) => String(m.id || '').toLowerCase() === wanted) || null;
}

/**
 * Modules dont l'activation correspond au texte donne.
 *
 * On compare sur une forme repliee (sans accents, en minuscules): « gravité temporelle »
 * doit trouver le module declare avec « gravite temporelle ».
 */
function matchModules(text = '', { mode = '', language = '' } = {}) {
  const folded = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (!folded) return [];

  return modules.filter((m) => {
    const a = m.activation || {};
    if (mode && Array.isArray(a.modesAny) && a.modesAny.length && !a.modesAny.includes(mode)) return false;
    if (language && Array.isArray(a.languagesAny) && a.languagesAny.length && !a.languagesAny.includes(language)) return false;
    const keywords = Array.isArray(a.keywordsAny) ? a.keywordsAny : [];
    return keywords.some((k) => folded.includes(
      String(k).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    ));
  });
}

module.exports = { listModules, getModule, matchModules, modules };
