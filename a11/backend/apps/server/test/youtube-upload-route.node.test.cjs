'use strict';

/**
 * Route de publication YouTube.
 *
 * L'invariant qui compte n'est pas "la route publie" mais "elle ne publie que ce
 * qu'on lui autorise, et elle ne va chercher que dans NOTRE stockage". Une route
 * qui telecharge une URL arbitraire fournie par l'appelant est un relais SSRF: le
 * serveur irait interroger n'importe quelle adresse interne pour le compte de qui
 * appelle. C'est le point le plus teste ici.
 *
 * Le resolveur vit dans la fabrique de routes et n'est pas exportable sans monter
 * un routeur complet: on le teste sur la SOURCE, comme le fait deja
 * test/google-gmail-scopes.node.test.cjs.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/routes/social-autoprompt.cjs'), 'utf8');

// --- le resolveur, extrait et evalue isolement --------------------------------

const blocResolveur = source.match(
  /function resolveGeneratedVideoSource\(input = '', env = process\.env\) \{[\s\S]*?\n\}/
)?.[0] || '';

test('le resolveur de source video est present dans la source', () => {
  assert.ok(blocResolveur, 'sans ce bloc les tests suivants ne verifient rien');
});

function chargerResolveur() {
  // cleanText est une dependance du bloc: on en fournit une equivalente.
  const fabrique = new Function(
    'cleanText', 'path', 'fs', 'getCanonicalRuntimeRoot',
    `${blocResolveur}; return resolveGeneratedVideoSource;`
  );
  return fabrique(
    (v, max) => String(v ?? '').trim().slice(0, max || undefined),
    path,
    fs,
    () => path.join(__dirname, '__runtime_inexistant__')
  );
}

const ENV_R2 = { R2_PUBLIC_BASE_URL: 'https://files.funesterie.me' };

test('une URL de notre stockage R2 est acceptee', () => {
  const r = chargerResolveur()('https://files.funesterie.me/archive/mix/clip.mp4', ENV_R2);
  assert.equal(r.kind, 'url');
});

test('une URL hors de notre stockage est REFUSEE (anti-SSRF)', () => {
  const resolveur = chargerResolveur();
  for (const hostile of [
    'https://evil.example/clip.mp4',
    'https://169.254.169.254/latest/meta-data/clip.mp4',
    'https://localhost/clip.mp4',
    'https://127.0.0.1:3000/clip.mp4',
    // Prefixe trompeur: l'hote n'est PAS le notre malgre l'apparence.
    'https://files.funesterie.me.evil.example/clip.mp4',
  ]) {
    const r = resolveur(hostile, ENV_R2);
    assert.equal(r.kind, 'invalid', `aurait du refuser: ${hostile}`);
  }
});

test('http en clair est refuse, meme sur notre hote', () => {
  const r = chargerResolveur()('http://files.funesterie.me/archive/mix/clip.mp4', ENV_R2);
  assert.equal(r.kind, 'invalid');
});

test('sans base R2 configuree, aucune URL ne passe', () => {
  // Sinon une configuration incomplete ouvrirait la porte au lieu de la fermer.
  const r = chargerResolveur()('https://files.funesterie.me/archive/mix/clip.mp4', {});
  assert.equal(r.kind, 'invalid');
});

test('une URL de notre hote mais hors du chemin de base est refusee', () => {
  // Un hote partage entre locataires: l'hote seul ne suffit pas a autoriser.
  const r = chargerResolveur()(
    'https://files.funesterie.me/autre-locataire/clip.mp4',
    { R2_PUBLIC_BASE_URL: 'https://files.funesterie.me/archive' }
  );
  assert.equal(r.kind, 'invalid');
});

test('une extension non video est refusee', () => {
  const resolveur = chargerResolveur();
  for (const mauvais of ['clip.exe', 'clip.sh', 'clip.mp3', 'clip']) {
    assert.equal(
      resolveur(`https://files.funesterie.me/archive/${mauvais}`, ENV_R2).kind,
      'invalid',
      `aurait du refuser: ${mauvais}`
    );
  }
});

test('une traversee de chemin en nom de fichier est refusee', () => {
  const resolveur = chargerResolveur();
  for (const mauvais of ['../../etc/passwd.mp4', '/etc/shadow.mp4', 'a/b/c.mp4']) {
    const r = resolveur(mauvais, {});
    // basename() ramene au fichier seul, qui n'existe pas dans le runtime de test.
    assert.notEqual(r.kind, 'url');
    assert.notEqual(r.kind, 'file', `aurait du refuser: ${mauvais}`);
  }
});

test('une entree vide est nommee comme telle, pas traitee', () => {
  assert.equal(chargerResolveur()('', ENV_R2).kind, 'none');
});

// --- garde-fous de la route --------------------------------------------------

const blocRoute = source.match(
  /router\.post\('\/youtube\/upload-generated'[\s\S]*?\n  \}\);/
)?.[0] || '';

test('la route de publication YouTube existe', () => {
  assert.ok(blocRoute, 'route absente');
});

test('la publication exige confirm:true, comme SoundCloud', () => {
  // Une publication externe ne doit jamais partir d'un appel accidentel.
  assert.match(blocRoute, /confirm !== true && req\.body\?\.confirm !== 'true'/);
  const avant = blocRoute.slice(0, blocRoute.indexOf('resolveGeneratedVideoSource'));
  assert.match(avant, /youtube_upload_confirm_required/, 'le verrou doit preceder tout traitement');
});

test('le defaut de confidentialite est private', () => {
  assert.match(blocRoute, /privacyStatus.*\|\| 'private'/);
});

test('le perimetre manquant rend 403, pas 500', () => {
  // C'est une autorisation a corriger par un reconsentement, pas une panne.
  assert.match(blocRoute, /youtube_upload_scope_missing/);
  assert.match(blocRoute, /status\(403\)/);
});

test('le fichier temporaire est supprime dans tous les cas', () => {
  // Une video rapatriee qui reste sur disque apres un echec est une fuite.
  assert.match(blocRoute, /finally \{[\s\S]*rmSync\(tempFile/);
});

test('le verrouillage en prive impose par YouTube est remonte a l appelant', () => {
  assert.match(blocRoute, /lockedPrivateLikely/);
});
