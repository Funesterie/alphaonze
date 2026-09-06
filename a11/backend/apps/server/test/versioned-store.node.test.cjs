'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collect,
  inspect,
  isDeleted,
  openRead,
  remove,
  write,
} = require(path.join(__dirname, '../src/storage/versioned-store.cjs'));

function racineTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a11-versioned-'));
}

function nettoyer(racine) {
  fs.rmSync(racine, { recursive: true, force: true });
}

test('écrire ne remplace jamais : chaque écriture crée une version à côté', () => {
  const racine = racineTemporaire();
  try {
    assert.equal(write(racine, 'tete', 'premier').version, 1);
    assert.equal(write(racine, 'tete', 'deuxieme').version, 2);
    assert.equal(write(racine, 'tete', 'troisieme').version, 3);

    const etat = inspect(racine, 'tete');
    assert.deepEqual(etat.versions, [1, 2, 3]);
    assert.equal(etat.published, 3, 'le pointeur suit la dernière écriture');
  } finally { nettoyer(racine); }
});

test('un lecteur en cours termine sur SA version, même si on écrit par-dessus', () => {
  const racine = racineTemporaire();
  try {
    write(racine, 'tete', 'contenu initial');
    const lecture = openRead(racine, 'tete');
    assert.equal(lecture.content, 'contenu initial');
    assert.equal(lecture.version, 1);

    // Une autre tête écrit pendant la lecture. Aucun blocage, aucune attente.
    write(racine, 'tete', 'contenu remplace');

    assert.equal(lecture.content, 'contenu initial', 'le lecteur ne doit pas voir le sol bouger');
    assert.equal(openRead(racine, 'tete').content, 'contenu remplace', 'un nouveau lecteur voit la nouvelle');

    lecture.release();
  } finally { nettoyer(racine); }
});

test('supprimer pendant une lecture : invisible pour les nouveaux, intact pour le lecteur', () => {
  const racine = racineTemporaire();
  try {
    write(racine, 'tete', 'matiere en cours de lecture');
    const lecture = openRead(racine, 'tete');

    // C'est le cas « dossier verrouillé de Visual Studio ». Ici, ça passe.
    const resultat = remove(racine, 'tete');
    assert.equal(resultat.tombstoned, true);

    assert.equal(isDeleted(racine, 'tete'), true);
    assert.equal(openRead(racine, 'tete'), null, 'plus aucun nouveau lecteur ne doit la voir');
    assert.equal(lecture.content, 'matiere en cours de lecture', 'le lecteur en cours garde ses octets');

    lecture.release();
  } finally { nettoyer(racine); }
});

test('les octets ne partent qu\'au relâchement du dernier lecteur', () => {
  const racine = racineTemporaire();
  try {
    write(racine, 'tete', 'contenu tenu');
    const a = openRead(racine, 'tete');
    const b = openRead(racine, 'tete');

    remove(racine, 'tete');
    assert.equal(inspect(racine, 'tete').versions.length, 1, 'deux lecteurs tiennent encore la version');

    a.release();
    collect(racine, 'tete');
    assert.equal(inspect(racine, 'tete').versions.length, 1, 'un lecteur tient toujours');

    b.release();
    collect(racine, 'tete');
    assert.equal(inspect(racine, 'tete').exists, false, 'le dernier parti, la ressource peut disparaître');
  } finally { nettoyer(racine); }
});

test('le ramassage épargne la version publiée et les versions tenues', () => {
  const racine = racineTemporaire();
  try {
    write(racine, 'tete', 'v1');
    const ancienne = openRead(racine, 'tete');   // tient la v1
    write(racine, 'tete', 'v2');
    write(racine, 'tete', 'v3');                  // publiée

    const r = collect(racine, 'tete');
    assert.deepEqual(r.removed, [2], 'seule la v2, dépassée et libre, doit partir');
    assert.ok(r.kept.includes(1), 'la v1 est tenue par un lecteur');
    assert.ok(r.kept.includes(3), 'la v3 est publiée');

    ancienne.release();
    assert.deepEqual(collect(racine, 'tete').removed, [1], 'relâchée, la v1 peut partir');
  } finally { nettoyer(racine); }
});

test('relâcher deux fois ne fausse pas le compteur', () => {
  const racine = racineTemporaire();
  try {
    write(racine, 'tete', 'contenu');
    const a = openRead(racine, 'tete');
    const b = openRead(racine, 'tete');
    a.release();
    a.release();  // doublon : doit être sans effet

    remove(racine, 'tete');
    collect(racine, 'tete');
    assert.equal(inspect(racine, 'tete').versions.length, 1, 'b tient encore, rien ne doit partir');

    b.release();
    collect(racine, 'tete');
    assert.equal(inspect(racine, 'tete').exists, false);
  } finally { nettoyer(racine); }
});

test('réécrire après suppression fait revivre la ressource', () => {
  const racine = racineTemporaire();
  try {
    write(racine, 'tete', 'avant');
    remove(racine, 'tete');
    assert.equal(openRead(racine, 'tete'), null);

    write(racine, 'tete', 'apres');
    assert.equal(isDeleted(racine, 'tete'), false, 'la pierre doit être levée');
    assert.equal(openRead(racine, 'tete').content, 'apres');
  } finally { nettoyer(racine); }
});

test('lire une clé jamais écrite ne fabrique rien', () => {
  const racine = racineTemporaire();
  try {
    assert.equal(openRead(racine, 'inconnue'), null);
    assert.equal(inspect(racine, 'inconnue').exists, false);
  } finally { nettoyer(racine); }
});

test('une clé ne peut pas sortir de sa racine', () => {
  const racine = racineTemporaire();
  try {
    for (const mechante of ['../evasion', 'a/b', 'a\\b', '..', '']) {
      assert.throws(() => write(racine, mechante, 'x'), /cle invalide/, `acceptée à tort : ${mechante}`);
    }
  } finally { nettoyer(racine); }
});

test('la poignée de passage porte le numéro de version, pas un chemin nu', () => {
  const racine = racineTemporaire();
  try {
    // Une tête publie, transmet SA version ; la suivante la relit à l'identique
    // même si une troisième a écrit entre-temps.
    const publiee = write(racine, 'malleole', 'etat transmis entre tetes');
    const poignee = { key: 'malleole', version: publiee.version };

    write(racine, 'malleole', 'ecriture concurrente d une autre tete');

    const relecture = openRead(racine, 'malleole');
    assert.notEqual(relecture.version, poignee.version, 'le pointeur a bien avancé');
    assert.equal(poignee.version, 1, 'la poignée garde la version d origine, pas le pointeur courant');
    relecture.release();
  } finally { nettoyer(racine); }
});
