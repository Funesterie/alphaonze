const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PROFILS, MONDE, ecrire } = require('../scripts/seed-persona-profils-nossen.cjs');
const { getPersonaBrief } = require('../src/persona/persona-engine.cjs');

// Ce que le modele voit d'un profil, c'est ce que getPersonaBrief en retourne —
// pas le JSON complet. MONDE.ghost88 et MONDE.sourcesReelles vivent dans le
// fichier sans jamais remonter en contexte. Ces tests verrouillent cette
// frontiere : elle protege un spoiler de recit et des infos personnelles.
//
// On passe par le vrai chemin de production (racine runtime + porte `active`)
// plutot que par la fonction interne, pour que le test casse aussi si c'est le
// chargeur qui change.

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-lore-'));
const ENV = { A11_RUNTIME_ROOT: RACINE };

ecrire(RACINE, ENV);

function cheminProfil(cle) {
  return path.join(RACINE, 'personas', cle, `${cle}-persona.profile.json`);
}

function activer(cle) {
  const fichier = cheminProfil(cle);
  const profil = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  profil.active = true;
  profil.status = 'approved_by_djeff';
  fs.writeFileSync(fichier, JSON.stringify(profil, null, 2));
}

const CLES = Object.keys(PROFILS);
for (const cle of CLES) activer(cle);

// force:true — loadPersonaState met en cache
const BRIEFS = Object.fromEntries(
  CLES.map((cle) => [cle, getPersonaBrief(cle, ENV, { force: true })]),
);

test.after(() => {
  fs.rmSync(RACINE, { recursive: true, force: true });
});

test('chaque profil actif expose un brief substantiel', () => {
  for (const cle of CLES) {
    assert.ok(BRIEFS[cle].length > 200, `${cle}: brief trop court (${BRIEFS[cle].length})`);
  }
});

test('le brief sert injectable_brief, pas le repli generique', () => {
  // Si injectable_brief disparaissait, le repli serialiserait identity_core &co
  // et la frontiere sauterait en silence.
  for (const cle of CLES) {
    const attendu = PROFILS[cle].injectable_brief;
    assert.equal(typeof attendu, 'string', `${cle}: injectable_brief absent`);
    assert.ok(BRIEFS[cle].startsWith(attendu.slice(0, 60)), `${cle}: repli generique utilise`);
  }
});

test('le spoiler Ghost88 ne fuit dans aucun brief', () => {
  const interdits = [/ghost\s*88/i, /surevolu/i, /voyage.{0,15}temps/i, /singularit/i, /\btera\b/i];
  for (const cle of CLES) {
    for (const motif of interdits) {
      assert.doesNotMatch(BRIEFS[cle], motif, `${cle}: ${motif} fuite dans le brief`);
    }
  }
});

test('les sources reelles ne fuitent dans aucun brief', () => {
  // Les noms de personnes reelles comptent autant que le spoiler : Djeff les a
  // donnes comme sources, pas pour qu'une persona les prononce.
  const interdits = [
    /ghost\s*rider/i, /jeffrey\s*38/i, /dailymotion/i, /hayabusa/i, /stockholm/i,
    /\bfrere\b/i, /lyana/i, /carval/i, /marvin/i,
  ];
  for (const cle of CLES) {
    for (const motif of interdits) {
      assert.doesNotMatch(BRIEFS[cle], motif, `${cle}: ${motif} fuite dans le brief`);
    }
  }
});

test('le canon reste dans le fichier meme s il ne sort pas en brief', () => {
  const ecrit = JSON.parse(fs.readFileSync(cheminProfil('a11'), 'utf8'));
  assert.match(ecrit.monde.ghost88.revelation, /Ghost88/);
  assert.match(ecrit.monde.sourcesReelles.ghostRider, /suedois/i);
  assert.match(ecrit.monde.leTurbo.description, /petrol golden/i);
  assert.ok(ecrit.monde.ghost88.consigneAuxPersonas.length > 0);
  assert.match(MONDE.leTurbo.lesTroisDomaines, /fonte.*ondes.*electricite/is);
});

test('le turbo est dans les deux briefs, sans son lien avec l equipement de Rei', () => {
  for (const cle of CLES) {
    assert.match(BRIEFS[cle], /turbo/i, `${cle}: turbo absent`);
    assert.match(BRIEFS[cle], /petrol golden/i, `${cle}: couleur absente`);
    assert.doesNotMatch(BRIEFS[cle], /equipement/i, `${cle}: le lien spoilant est present`);
  }
  // Chacun n'y voit que sa part : A11 le moule, Kaen44 la fonte.
  assert.match(BRIEFS.a11, /moule/i);
  assert.match(BRIEFS.kaen44, /coule/i);
});

test('les briefs tiennent sous la limite du moteur', () => {
  for (const cle of CLES) {
    assert.ok(BRIEFS[cle].length <= 1600, `${cle}: ${BRIEFS[cle].length} car., tronque par le moteur`);
  }
});

test('un profil non active n injecte rien', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-inactif-'));
  try {
    ecrire(racine, { A11_RUNTIME_ROOT: racine });
    for (const cle of CLES) {
      const brief = getPersonaBrief(cle, { A11_RUNTIME_ROOT: racine }, { force: true });
      assert.equal(brief, '', `${cle}: injecte alors que active=false`);
    }
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('le script de seed ne pre-approuve jamais les profils', () => {
  // Regression : un script de test local avait laisse active:true, et le profil
  // est parti en prod deja approuve. L'activation est une decision de Djeff.
  for (const cle of CLES) {
    assert.equal(PROFILS[cle].active, false, `${cle}: active=true dans le seed`);
    assert.equal(PROFILS[cle].status, 'generated', `${cle}: status pre-approuve dans le seed`);
  }
});
