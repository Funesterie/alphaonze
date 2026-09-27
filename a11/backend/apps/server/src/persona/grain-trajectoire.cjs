'use strict';

// Journal de trajectoire du grain (27/09/2026). Accord Djeff / ChatGPT / Claude : « l'histoire
// donne la forme », mais cette histoire n'etait pas enregistree — les 2255 morceaux du jukebox
// ne gardent ni le style envoye, ni la voix, ni la texture choisie. Chaque morceau reellement
// envoye au fournisseur laisse ici une ligne ; le retour (etoiles, retrait motive) se joint plus
// tard par taskId. Les ecoutes brutes ne valent PAS preference (un vieux morceau expose en a
// mecaniquement plus) : elles ne sont pas une cible d'apprentissage.
// Journal seulement : il ne change rien au son.

const fs = require('node:fs');
const path = require('node:path');

function resolveTrajectoireFile(env = process.env) {
  const configured = String(env.A11_GRAIN_TRAJECTOIRE_FILE || '').trim();
  if (configured) return configured;
  const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
  return path.join(getCanonicalRuntimeRoot(env), 'personas', 'grain-trajectoire.jsonl');
}

function lireTrajectoire(env = process.env) {
  try {
    return fs.readFileSync(resolveTrajectoireFile(env), 'utf8').split('\n').filter(Boolean)
      .map((ligne) => { try { return JSON.parse(ligne); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Ajoute une decision au journal. Temps semantique : repetition = nombre de fois ou ce grain a
 * deja choisi cette texture sur ses 20 derniers morceaux ; rang = numero du morceau dans sa vie.
 * Jamais d'heure brute dans la decision (l'horodatage n'est la que pour l'audit).
 */
function journaliserTrajectoire(entree = {}, env = process.env) {
  const grain = String(entree.grain || 'off');
  const passe = lireTrajectoire(env).filter((e) => e.grain === grain);
  const recents = passe.slice(-20);
  const ligne = {
    schema: 'funesterie.grain-trajectoire.v1',
    at: new Date().toISOString(),
    decisionId: entree.decisionId || null,
    persona: entree.persona || '',
    voix: entree.voix || '',
    grain,
    grainVersion: entree.grainVersion || null,
    derivation: entree.derivation || null,
    moteur: entree.moteur || 'grainPrefere',
    contexte: String(entree.contexte || '').slice(0, 300),
    titre: String(entree.titre || '').slice(0, 160),
    optionsTexture: entree.optionsTexture || null,
    optionsMouvement: entree.optionsMouvement || null,
    texture: entree.texture || '',
    mouvement: entree.mouvement || '',
    fournisseur: entree.fournisseur || '',
    modele: entree.modele || '',
    tempsSemantique: {
      rang: passe.length + 1,
      repetitionTexture: recents.filter((e) => e.texture && e.texture === entree.texture).length,
      repetitionMouvement: recents.filter((e) => e.mouvement && e.mouvement === entree.mouvement).length,
    },
    banc: entree.banc || null,
    retour: null,
  };
  const file = resolveTrajectoireFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(ligne)}\n`);
  return ligne;
}

module.exports = { journaliserTrajectoire, lireTrajectoire, resolveTrajectoireFile };
