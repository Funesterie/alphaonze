'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resoudreAudio, lirePresents } = require('../src/routes/auto-dj-route.cjs');

function racineTemporaire() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autodj-'));
  fs.writeFileSync(path.join(dir, 'morceau.mp3'), 'faux audio');
  fs.mkdirSync(path.join(dir, 'jukebox'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'jukebox', 'autre.mp3'), 'faux audio');
  return dir;
}

function envAvecRacine(dir) {
  // getCanonicalRuntimeRoot lit cette variable en priorite.
  return { A11_RUNTIME_ROOT: dir };
}

test('un fichier sous la racine est accepte', () => {
  const dir = racineTemporaire();
  assert.ok(resoudreAudio('morceau.mp3', envAvecRacine(dir)));
  assert.ok(resoudreAudio('jukebox/autre.mp3', envAvecRacine(dir)));
});

test('la traversee par ../ est refusee', () => {
  const dir = racineTemporaire();
  // Le piege classique : le chemin ne contient rien d'interdit avant resolution.
  assert.strictEqual(resoudreAudio('../../../etc/passwd', envAvecRacine(dir)), '');
  assert.strictEqual(resoudreAudio('jukebox/../../evade.mp3', envAvecRacine(dir)), '');
});

test('un chemin absolu hors racine est refuse', () => {
  const dir = racineTemporaire();
  const dehors = path.join(os.tmpdir(), 'hors-racine.mp3');
  fs.writeFileSync(dehors, 'faux audio');
  assert.strictEqual(resoudreAudio(dehors, envAvecRacine(dir)), '');
});

test('un fichier inexistant est refuse', () => {
  const dir = racineTemporaire();
  assert.strictEqual(resoudreAudio('fantome.mp3', envAvecRacine(dir)), '');
});

test('un repertoire n est pas un morceau', () => {
  const dir = racineTemporaire();
  assert.strictEqual(resoudreAudio('jukebox', envAvecRacine(dir)), '');
});

test('une demande vide est refusee', () => {
  const dir = racineTemporaire();
  // Sans le test d'existence, path.resolve(racine, '') rendrait la racine
  // elle-meme, donc un repertoire presente comme un morceau valide.
  assert.strictEqual(resoudreAudio('', envAvecRacine(dir)), '');
});

test('un bus de presence absent rend une liste vide, pas une erreur', () => {
  assert.deepStrictEqual(lirePresents({}), []);
  assert.deepStrictEqual(lirePresents({ A11_AGENT_STATE_DIR: '/chemin/qui/n/existe/pas' }), []);
});

test('un presence.json illisible ne fait pas taire le casting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-'));
  fs.writeFileSync(path.join(dir, 'presence.json'), '{ ceci n est pas du json');
  assert.deepStrictEqual(lirePresents({ A11_AGENT_STATE_DIR: dir }), []);
});

test('les agents presents sortent en minuscules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-'));
  fs.writeFileSync(path.join(dir, 'presence.json'), JSON.stringify({
    agents: [{ name: 'Vivy' }, { name: 'CODEX' }, { name: '' }],
  }));
  assert.deepStrictEqual(lirePresents({ A11_AGENT_STATE_DIR: dir }), ['vivy', 'codex']);
});
