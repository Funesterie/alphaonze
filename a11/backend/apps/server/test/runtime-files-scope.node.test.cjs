'use strict';

/**
 * Cloisonnement des fichiers runtime par compte.
 *
 * La route etait authentifiee mais pas cloisonnee: le confinement bloquait la traversee
 * de chemin, rien de plus. Tout compte connecte pouvait lister et supprimer n'importe
 * quoi dans un runtime partage contenant `secrets/`, `auth/` et les albums de tous.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const createRuntimeFilesRouter = require('../src/routes/runtime-files.cjs');

function creerRuntime() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-scope-'));
  fs.mkdirSync(path.join(racine, 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'secrets', 'suno_api_key'), 'CLE-SECRETE');
  fs.mkdirSync(path.join(racine, 'accounts', 'alice'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'accounts', 'alice', 'chanson.mp3'), 'audio-alice');
  fs.mkdirSync(path.join(racine, 'accounts', 'bob'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'accounts', 'bob', 'prive.mp3'), 'audio-bob');
  return racine;
}

function demarrer(racine, utilisateur) {
  const app = express();
  app.use((req, _res, next) => { req.user = utilisateur; next(); });
  app.use('/files', createRuntimeFilesRouter({ runtimeRoot: racine }));
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function appeler(server, methode, chemin, corps) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${chemin}`, {
    method: methode,
    headers: corps ? { 'content-type': 'application/json' } : undefined,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('un compte ne voit que ses propres fichiers', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine, { id: 'alice', email: 'alice@example.com' });
  t.after(() => server.close());

  const res = await appeler(server, 'GET', '/files/list');
  assert.equal(res.status, 200);
  const noms = res.body.entries.map((e) => e.name);
  assert.deepEqual(noms, ['chanson.mp3']);
  assert.equal(res.body.scope, 'account');
});

test('un compte ne peut pas supprimer les secrets du runtime partage', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine, { id: 'alice', email: 'alice@example.com' });
  t.after(() => server.close());

  // Chemin qui remonte hors du sous-arbre du compte.
  const res = await appeler(server, 'DELETE', '/files/delete', { path: '../../secrets/suno_api_key' });
  assert.equal(res.status, 403, 'la remontee doit etre refusee');
  assert.ok(fs.existsSync(path.join(racine, 'secrets', 'suno_api_key')), 'le secret doit survivre');
});

test('un compte ne peut pas supprimer le fichier d un autre compte', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine, { id: 'alice', email: 'alice@example.com' });
  t.after(() => server.close());

  const res = await appeler(server, 'DELETE', '/files/delete', { path: '../bob/prive.mp3' });
  assert.equal(res.status, 403);
  assert.ok(fs.existsSync(path.join(racine, 'accounts', 'bob', 'prive.mp3')), 'le fichier de bob doit survivre');
});

test('un compte peut supprimer son propre fichier', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine, { id: 'alice', email: 'alice@example.com' });
  t.after(() => server.close());

  const res = await appeler(server, 'DELETE', '/files/delete', { path: 'chanson.mp3' });
  assert.equal(res.status, 200);
  assert.ok(!fs.existsSync(path.join(racine, 'accounts', 'alice', 'chanson.mp3')));
});

test('un compte sans dossier recoit un espace vide, pas une erreur', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine, { id: 'nouveau', email: 'nouveau@example.com' });
  t.after(() => server.close());

  const res = await appeler(server, 'GET', '/files/list');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.entries, []);
});

test('la vue partagee reste possible pour la famille, mais seulement sur demande', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine, { id: 'djeff', email: 'cellaurojeffrey@gmail.com' });
  t.after(() => server.close());

  const parDefaut = await appeler(server, 'GET', '/files/list');
  assert.equal(parDefaut.body.scope, 'account', 'meme un fondateur reste cloisonne par defaut');

  const partage = await appeler(server, 'GET', '/files/list?scope=shared');
  assert.equal(partage.body.scope, 'shared');
  assert.ok(partage.body.entries.some((e) => e.name === 'secrets'), 'la vue complete reste accessible sur demande');
});

test('un compte ordinaire ne peut pas reclamer la vue partagee', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine, { id: 'alice', email: 'alice@example.com' });
  t.after(() => server.close());

  const res = await appeler(server, 'GET', '/files/list?scope=shared');
  assert.equal(res.body.scope, 'account', 'le drapeau ne doit rien ouvrir sans droit famille');
  assert.ok(!res.body.entries.some((e) => e.name === 'secrets'));
});
