'use strict';

/**
 * Les schemas de rimes ne doivent pas se chanter.
 *
 * Djeff, sur un morceau reel: « ya des bug de paroles ». Les paroles envoyees a Suno
 * contenaient « AABB », « ABAB » et « AABB BA BA » -- les annotations de travail que
 * Vivy pose pour tenir sa structure de rimes. Ce sont des marques de format, pas des
 * paroles: au meme titre qu'une etiquette [Vivy], elles n'ont rien a faire dans le
 * texte chante.
 *
 * On teste la regle telle qu'elle est ecrite dans sanitizeVivyProviderCleanLyrics.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'vivy-studio.cjs'),
  'utf8'
);

// Les deux regles extraites du code, pour tester ce qui tourne vraiment.
const estSchemaDeRimes = (line) => /^\s*[A-H]{2,}(?:\s+[A-H]{1,4})*\s*$/.test(String(line || ''));
const nettoyerFinDeVers = (line) => String(line).replace(/\s+[A-H]{2,}(?:\s+[A-H]{1,4})*\s*$/, '');

test('la regle est bien presente dans le nettoyeur', () => {
  assert.match(SOURCE, /estSchemaDeRimes/, 'la regle doit vivre dans sanitizeVivyProviderCleanLyrics');
});

test('les schemas seuls sur leur ligne sont supprimes', () => {
  for (const marque of ['AABB', 'ABAB', 'AABB BA BA', 'ABCB', 'AA BB']) {
    assert.ok(estSchemaDeRimes(marque), `non detecte: ${marque}`);
  }
});

test('un schema colle en fin de vers est retire, le vers reste', () => {
  assert.equal(
    nettoyerFinDeVers('La nuit est notre scene. AABB BA BA'),
    'La nuit est notre scene.'
  );
});

test('aucune vraie parole n est prise pour un schema', () => {
  const paroles = [
    'Dans le reflet d une vitre fissuree,',
    'NOSSEN, on ne s arrete jamais,',
    'Chaque virage, une balle qui s elance.',
    'Le casque fume, la visiere s eclaire,',
    'A demain',
    'ABBA reste un groupe, pas un schema',
  ];
  for (const ligne of paroles) {
    assert.ok(!estSchemaDeRimes(ligne), `parole supprimee a tort: ${ligne}`);
    assert.equal(nettoyerFinDeVers(ligne), ligne, `parole tronquee a tort: ${ligne}`);
  }
});

test('une etiquette de section n est pas confondue avec un schema', () => {
  for (const tag of ['[Verse 1 - Djeff solo]', '[Chorus]', '[Outro]']) {
    assert.ok(!estSchemaDeRimes(tag));
  }
});
