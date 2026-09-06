'use strict';

/**
 * Une fenetre trop courte pour aboutir est pire que pas de tentative du tout.
 *
 * Journaux de prod du 09/08/2026, une seule demande NOSSEN:
 *
 *   11:50:25 openrouter 504   11:50:41 deepseek 504   11:50:57 openai   504
 *   11:50:33 gemini     504   11:50:49 together 504
 *
 * Exactement 8 s d'ecart. Ce n'etaient pas cinq pannes simultanees: c'etait
 * VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS=8000 qui coupait chaque fournisseur avant
 * qu'il ait pu ecrire des paroles. Cinq echecs garantis, tout le budget consomme,
 * puis 502 chez Cloudflare.
 *
 * Deux choses sont epinglees ici: la fenetre doit rester plausible, et le journal
 * doit dire QUI a coupe. Le message « failed status=504 » faisait accuser les
 * fournisseurs et a coute des semaines de diagnostic.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/routes/vivy-studio.cjs'),
  'utf8'
);

// Budget reel: 92 s de requete moins 20 s reserves a la soumission Suno.
const FENETRE_LLM_MS = 92000 - 20000;

function defautNumerique(variable) {
  const motif = new RegExp(`process\\.env\\.${variable}\\s*\\|\\|\\s*(\\d+)`);
  const trouve = motif.exec(SOURCE);
  assert.ok(trouve, `defaut introuvable pour ${variable}`);
  return Number(trouve[1]);
}

test('un fournisseur cloud a le temps d ecrire des paroles', () => {
  const fenetre = defautNumerique('VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS');
  // Un 70B qui redige un texte complet demande 15 a 30 s. En dessous de 15 s on
  // ne mesure plus la disponibilite du fournisseur, seulement notre impatience.
  assert.ok(
    fenetre >= 15000,
    `fenetre cloud de ${fenetre}ms: trop courte pour aboutir, l'echec est garanti`
  );
});

test('le gros modele ne mange pas la totalite du budget', () => {
  const gros = defautNumerique('VIVY_NOSSEN_120B_TIMEOUT_MS');
  const cloud = defautNumerique('VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS');

  // Il est essaye en premier (VIVY_NOSSEN_LARGE_MODEL_FIRST). S'il prend tout, les
  // fournisseurs qui repondent ne sont jamais atteints -- la panne du 28/07.
  assert.ok(gros < FENETRE_LLM_MS / 2, `${gros}ms sur ${FENETRE_LLM_MS}ms: trop gourmand`);

  // Apres lui, il doit rester de quoi tenter au moins deux fournisseurs entiers.
  const restant = FENETRE_LLM_MS - gros;
  assert.ok(
    Math.floor(restant / cloud) >= 2,
    `apres le gros modele il reste ${restant}ms, soit ${Math.floor(restant / cloud)} tentative(s) de ${cloud}ms`
  );
});

test('une coupure de notre fait est marquee comme telle', () => {
  // Le drapeau selfInflicted est ce qui permet au journal de ne plus accuser les
  // fournisseurs a notre place.
  assert.match(SOURCE, /error\.selfInflicted = true/);
  assert.match(SOURCE, /function buildVivyLlmAttemptTimeoutError/);
  assert.match(SOURCE, /coupe par nous apres %dms/);
});

test('le minuteur de tentative leve l erreur qui porte sa fenetre', () => {
  // Sans ca, on saurait qu'on a coupe mais pas apres combien de temps, et la
  // valeur fautive resterait invisible dans les journaux.
  assert.match(SOURCE, /rejectTimeout\?\.\(buildVivyLlmAttemptTimeoutError\(attemptTimeoutMs\)\)/);
});
