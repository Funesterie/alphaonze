'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  REPERTOIRE,
  cleDe,
  creerBanque,
  listerPhrases,
} = require(path.join(__dirname, '../src/music/vivy-banque-vocale.cjs'));

const toutesPretes = () => Object.fromEntries(listerPhrases().map((p) => [p.cle, `audio/${p.cle}.wav`]));

test('chaque nature a plusieurs formulations', () => {
  // Une reaction juste mais toujours identique sonne comme une alarme, pas comme
  // une coequipiere. La variation est la moitie du travail.
  for (const [nature, phrases] of Object.entries(REPERTOIRE)) {
    assert.ok(phrases.length >= 3, `${nature} n a que ${phrases.length} formulation(s)`);
  }
});

test('les cles sont stables — elles survivent a un redemarrage', () => {
  // Sinon le cache serait a refaire a chaque relance, et la banque ne servirait a rien.
  assert.equal(cleDe('danger', 0), 'danger-0');
  assert.equal(cleDe('DANGER', 2), 'danger-2');
  const a = listerPhrases().map((p) => p.cle);
  const b = listerPhrases().map((p) => p.cle);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, 'aucune cle en double');
});

test('sans phrase en banque, elle se tait — elle ne fabrique pas a la volee', () => {
  // Regle tiree de la mesure : un commentaire sur un boss qui arrive quatre
  // secondes trop tard decrit un passe que Djeff a deja vecu. Le silence vaut mieux.
  const vide = creerBanque();
  assert.equal(vide.choisir('danger'), null);
  assert.equal(vide.etat().prete, false);
});

test('avec la banque prete, elle rend l audio immediatement', () => {
  const b = creerBanque({ audios: toutesPretes() });
  const r = b.choisir('danger');
  assert.ok(r && r.audio, 'un audio doit etre rendu');
  assert.match(r.cle, /^danger-\d+$/);
  assert.ok(REPERTOIRE.danger.includes(r.texte));
  assert.equal(b.etat().prete, true);
});

test('elle ne redit jamais la meme formulation deux fois de suite', () => {
  const b = creerBanque({ audios: toutesPretes() });
  let precedent = null;
  for (let i = 0; i < 12; i += 1) {
    const r = b.choisir('boss');
    assert.notEqual(r.cle, precedent, `formulation repetee au tour ${i}`);
    precedent = r.cle;
  }
});

test('avec une seule phrase disponible, mieux vaut se repeter que se taire', () => {
  // Sur un danger, le silence coute plus cher que la repetition.
  const b = creerBanque({ audios: { 'danger-0': 'audio/danger-0.wav' } });
  const a = b.choisir('danger');
  const c = b.choisir('danger');
  assert.equal(a.cle, 'danger-0');
  assert.equal(c.cle, 'danger-0');
});

test('une nature inconnue rend null, sans inventer', () => {
  const b = creerBanque({ audios: toutesPretes() });
  assert.equal(b.choisir('meteo'), null);
  assert.equal(b.choisir(''), null);
  assert.equal(b.choisir(null), null);
});

test('preparer ne synthetise que ce qui manque', async () => {
  const dejaLa = { 'danger-0': 'audio/danger-0.wav' };
  const demandes = [];
  const b = creerBanque({ audios: dejaLa });
  const r = await b.preparer(async (texte, cle) => { demandes.push(cle); return `audio/${cle}.wav`; });
  assert.equal(demandes.includes('danger-0'), false, 'ne pas resynthetiser ce qui est deja la');
  assert.equal(r.faits, listerPhrases().length - 1);
  assert.equal(r.prete, true);
});

test('une synthese qui echoue ne fait pas tomber la preparation', async () => {
  // Mieux vaut une banque incomplete qu aucune banque : les phrases reussies
  // restent jouables.
  const b = creerBanque();
  const r = await b.preparer(async (texte, cle) => {
    if (cle.startsWith('vanne')) throw new Error('provider indisponible');
    return `audio/${cle}.wav`;
  });
  assert.ok(r.echecs.length >= 3, 'les echecs doivent etre rapportes');
  assert.equal(r.prete, false);
  assert.ok(b.choisir('danger'), 'les natures reussies restent jouables');
  assert.equal(b.choisir('vanne'), null, 'la nature echouee se tait');
});

test('sans synthetiseur, on refuse plutot que de faire semblant', async () => {
  const b = creerBanque();
  await assert.rejects(() => b.preparer(), /synthetiseur_manquant/);
});
