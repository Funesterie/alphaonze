'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-etire-'));
const { etirerArc, buildBeatsBlock } = require('../src/clips/clip-vivy-director.cjs');

// Arc typique : 7 sections, comme celui de FIGHTERZ CLUB le 12/09/2026.
const ARC = ['intro', 'couplet', 'pre-refrain', 'refrain', 'pont', 'refrain', 'outro']
  .map((label, i) => ({ label, intensity: [0.2, 0.5, 0.7, 0.95, 0.4, 1, 0.3][i], color: 'c' + i, matiere: 'm' + i }));
const PAROLES = ARC.map((s, i) => ({ label: s.label, intention: 'acte ' + i + ' des paroles', image: 'image ' + i }));

test('un Full Clip de 26 segments recoit 26 plans distincts qui couvrent tout l arc', () => {
  const beats = etirerArc(ARC, PAROLES, 26, 205, null);
  assert.equal(beats.length, 26, 'plus de boucle sur 7 plans');
  const sections = new Set(beats.map((b) => b.section + '|' + b.acte));
  assert.equal(sections.size, 7, 'chaque section de l arc a au moins un plan');
  assert.equal(beats[0].section, 'intro');
  assert.equal(beats[25].section, 'outro', 'le dernier plan finit le morceau');
  assert.equal(beats[25].fin, 205, 'le decoupage couvre toute la duree');
});

test('chaque plan porte l acte des paroles de sa section', () => {
  const beats = etirerArc(ARC, PAROLES, 26, 205, null);
  for (const b of beats) {
    const i = ARC.findIndex((s) => s.label === b.section);
    assert.ok(b.acte.startsWith('acte '), 'acte present');
    assert.ok(Number(b.acte.split(' ')[1]) >= i, 'acte de la bonne section');
  }
});

test('les sections longues recoivent plus de plans quand l audio donne leurs bornes', () => {
  const bornes = { sections: [[0, 8], [8, 40], [40, 48], [48, 110], [110, 120], [120, 190], [190, 205]]
    .map(([a, b]) => ({ startSeconds: a, endSeconds: b })) };
  const beats = etirerArc(ARC, PAROLES, 26, 205, bornes);
  const compte = (i) => beats.filter((b) => b.acte === 'acte ' + i + ' des paroles').length;
  assert.ok(compte(3) > compte(0), 'le refrain de 62 s a plus de plans que l intro de 8 s');
  assert.ok(compte(5) > compte(4));
  assert.equal(beats.length, 26);
});

test('un Clip court de 6 plans parcourt quand meme tout l arc, dans l ordre', () => {
  const beats = etirerArc(ARC, PAROLES, 6, 205, null);
  assert.equal(beats.length, 6);
  const ordre = beats.map((b) => ARC.findIndex((s) => s.label === b.section && ('acte ' + ARC.indexOf(s) + ' des paroles') === b.acte));
  assert.deepEqual([...ordre].sort((a, b) => a - b), ordre, 'ordre chronologique conserve');
  assert.equal(beats[0].section, 'intro');
});

test('la consigne demande exactement N plans, fait jouer le theme sans mot pour mot ni hors sujet', () => {
  const bloc = buildBeatsBlock(etirerArc(ARC, PAROLES, 26, 205, null));
  assert.match(bloc, /EXACTEMENT 26 plans/);
  assert.match(bloc, /THÈME : acte 3 des paroles/);
  assert.match(bloc, /pas mot pour mot/, 'les paroles vagues s interpretent');
  assert.match(bloc, /sujet de la chanson/, 'mais on ne part pas hors sujet');
  assert.match(bloc, /piste visuelle \(facultative\)/);
  assert.match(bloc, /\(1\/\d\)/, 'les plans d une meme section sont numerotes pour progresser');
  assert.equal(buildBeatsBlock(null), '');
  assert.equal(etirerArc(ARC, PAROLES, 0, 205, null), null);
});
