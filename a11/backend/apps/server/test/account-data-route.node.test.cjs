'use strict';

/**
 * Bilan et suppression des donnees d'un compte.
 *
 * Demande de Djeff: pouvoir supprimer ce qu'un compte stocke, pour la vie privee et
 * pour liberer de la place. Le bilan doit rester lisible meme quand la base est en
 * panne, et la suppression ne doit jamais partir d'un clic accidentel.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const createAccountDataRouter = require('../src/routes/account-data.cjs');

function creerRuntime() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'account-data-'));
  const dossier = path.join(racine, 'accounts', 'alice');
  fs.mkdirSync(path.join(dossier, 'chansons'), { recursive: true });
  fs.writeFileSync(path.join(dossier, 'note.txt'), 'x'.repeat(100));
  fs.writeFileSync(path.join(dossier, 'chansons', 'a.mp3'), 'y'.repeat(500));
  // Fichier d'un autre compte: il ne doit jamais entrer dans le bilan ni disparaitre.
  fs.mkdirSync(path.join(racine, 'accounts', 'bob'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'accounts', 'bob', 'prive.mp3'), 'z'.repeat(900));
  return racine;
}

function demarrer(racine, { db = null, user = { id: 'alice' } } = {}) {
  const app = express();
  app.use('/api/account/data', createAccountDataRouter({
    verifyJWT: (req, _res, next) => { req.user = user; next(); },
    db,
    runtimeRoot: racine,
  }));
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

test('le bilan chiffre les fichiers du compte, et rien d autre', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine, {
    db: { query: async () => ({ rows: [{ conversations: '4', messages: '37' }] }) },
  });
  t.after(() => server.close());

  const res = await appeler(server, 'GET', '/api/account/data/summary');
  assert.equal(res.status, 200);
  assert.equal(res.body.fichiers.fichiers, 2, 'les 900 octets de bob ne doivent pas compter');
  assert.equal(res.body.fichiers.octets, 600);
  assert.equal(res.body.conversations.conversations, 4);
  assert.equal(res.body.conversations.messages, 37);
});

test('une base en panne n empeche pas de voir la place occupee', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine, {
    db: { query: async () => { throw new Error('base injoignable'); } },
  });
  t.after(() => server.close());

  const res = await appeler(server, 'GET', '/api/account/data/summary');
  assert.equal(res.status, 200, 'le bilan doit rester utilisable');
  assert.equal(res.body.conversations.disponible, false);
  assert.equal(res.body.fichiers.octets, 600);
});

test('la suppression exige une confirmation explicite', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine);
  t.after(() => server.close());

  const sansConfirmation = await appeler(server, 'DELETE', '/api/account/data/files', {});
  assert.equal(sansConfirmation.status, 400);
  assert.ok(fs.existsSync(path.join(racine, 'accounts', 'alice', 'note.txt')), 'rien ne doit partir sans confirmation');
});

test('la suppression efface les fichiers du compte et epargne les autres', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine);
  t.after(() => server.close());

  const res = await appeler(server, 'DELETE', '/api/account/data/files', { confirm: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.supprimes, 2);
  assert.equal(res.body.octetsLiberes, 600);
  assert.ok(!fs.existsSync(path.join(racine, 'accounts', 'alice')), 'le sous-arbre du compte doit disparaitre');
  assert.ok(fs.existsSync(path.join(racine, 'accounts', 'bob', 'prive.mp3')), 'le compte voisin doit survivre');
});

test('supprimer deux fois ne casse rien', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const server = await demarrer(racine);
  t.after(() => server.close());

  await appeler(server, 'DELETE', '/api/account/data/files', { confirm: true });
  const seconde = await appeler(server, 'DELETE', '/api/account/data/files', { confirm: true });
  assert.equal(seconde.status, 200);
  assert.equal(seconde.body.supprimes, 0);
});

test('sans garde d authentification montee, la route refuse', async (t) => {
  const racine = creerRuntime();
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
  const app = express();
  app.use('/api/account/data', createAccountDataRouter({ runtimeRoot: racine }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => server.close());

  const res = await appeler(server, 'GET', '/api/account/data/summary');
  assert.equal(res.status, 503);
});
