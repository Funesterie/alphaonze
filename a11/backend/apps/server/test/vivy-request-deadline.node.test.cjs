'use strict';

/**
 * Echeance unique pour une requete de production.
 *
 * Le budget LLM (80 s) et le delai Suno (30 s) etaient regles independamment: 110 s
 * possibles alors que Cloudflare coupe vers 100 s. Djeff a vu le resultat -- « NOSSEN
 * stoppe: Chat Vivy indisponible (524) ». Les deux etapes partagent desormais une
 * echeance au lieu de s'additionner.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveVivyRequestDeadlineAt,
  resolveVivyRemainingMs,
  resolveVivySunoTimeoutMs,
} = require('../src/routes/vivy-studio.cjs');

test('l echeance est posee une fois et ne bouge plus pour la meme requete', () => {
  const req = {};
  const premiere = resolveVivyRequestDeadlineAt(req);
  assert.ok(premiere > Date.now(), 'une echeance doit etre dans le futur');
  assert.equal(resolveVivyRequestDeadlineAt(req), premiere, 'un second appel ne doit pas la repousser');
});

test('sans requete, aucune echeance n est imposee', () => {
  assert.equal(resolveVivyRequestDeadlineAt(null), 0);
  assert.equal(resolveVivyRemainingMs(null), 0);
});

test('le delai Suno reste borne par le temps restant', () => {
  const req = {};
  resolveVivyRequestDeadlineAt(req);
  // Il reste beaucoup de temps: on garde le delai configure.
  assert.equal(resolveVivySunoTimeoutMs(req), 30000);

  // Le LLM a presque tout consomme: Suno ne doit pas rajouter 30 s par-dessus.
  req.__vivyRequestDeadlineAt = Date.now() + 12000;
  const serre = resolveVivySunoTimeoutMs(req);
  assert.ok(serre <= 12000, `attendu <= 12000, obtenu ${serre}`);
  assert.ok(serre >= 8000, 'un plancher evite un appel voue a l echec');
});

test('une echeance depassee retombe sur le plancher, pas sur zero', () => {
  const req = { __vivyRequestDeadlineAt: Date.now() - 5000 };
  assert.equal(resolveVivySunoTimeoutMs(req), 8000, 'mieux vaut une erreur Suno claire qu un abandon immediat');
});

test('sans requete, le delai configure s applique tel quel', () => {
  assert.equal(resolveVivySunoTimeoutMs(null), 30000);
});

test('budget total et reserve tiennent sous le plafond Cloudflare', () => {
  const req = {};
  const restant = resolveVivyRequestDeadlineAt(req) - Date.now();
  assert.ok(restant <= 95000, `le budget doit rester sous les ~100 s de Cloudflare, obtenu ${restant}`);
  assert.ok(restant >= 60000, 'mais rester assez large pour ecrire une vraie chanson');
});
