'use strict';

/**
 * La route du Jukebox est la frontière: à partir d'ici, Vivy agit sur le Drive.
 *
 * Ce qui est protégé, par ordre de gravité si ça cède:
 *
 *   1. la route ne doit JAMAIS accepter une URL. Une route qui relaie une adresse
 *      fournie par l'appelant est un proxy ouvert avec les identifiants du serveur;
 *   2. un nom de fichier ne traverse pas de dossier: la zone est le périmètre;
 *   3. les verbes sont fermés — pas de méthode HTTP choisie par l'appelant;
 *   4. une pièce absente ou invalide ne laisse rien passer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const createVivyDriveRouter = require('../src/routes/vivy-drive.cjs');

const SECRET = 'secret-de-test-jukebox-de-plus-de-32-octets';

function serveur({ user = { id: 2, sid: 's1' }, env = {} } = {}) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/vivy/drive', createVivyDriveRouter({
    db: null,
    vault: { getSessionProviderTokens: async () => ({ accessToken: 'JETON' }) },
    env: { JUKEBOX_CAPABILITY_SECRET: SECRET, JUKEBOX_AUDIENCE: 'a11-backend', ...env },
  }));
  return app;
}

async function appeler(app, chemin, corps, methode = 'POST') {
  const { createServer } = require('node:http');
  const srv = createServer(app);
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const rep = await fetch(`http://127.0.0.1:${port}${chemin}`, {
      method: methode,
      headers: corps ? { 'content-type': 'application/json' } : {},
      body: corps ? JSON.stringify(corps) : undefined,
    });
    return { status: rep.status, body: await rep.json().catch(() => ({})) };
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

test('les cassettes sont annoncées sans exposer la moindre adresse', async () => {
  const r = await appeler(serveur(), '/api/vivy/drive/cassettes', null, 'GET');
  assert.equal(r.status, 200);
  const texte = JSON.stringify(r.body);
  assert.match(texte, /entra/);
  // Aucun identifiant de disque ni URL Graph ne doit fuir par cette liste.
  assert.ok(!texte.includes('graph.microsoft.com'), 'aucune URL Graph');
  assert.ok(!texte.includes('/drives/'), 'aucun driveId');
});

test('un échange sans pièce est refusé avant toute autre validation', async () => {
  const r = await appeler(serveur(), '/api/vivy/drive/exchange', { op: 'list', drive: 'perso', zone: '/Vivy' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'vivy_drive_coin_missing');
});

test('un verbe inconnu est refusé: pas de méthode HTTP choisie par l appelant', async () => {
  const piece = { payload: { schema: 'x' }, signature: 'y' };
  for (const op of ['delete', 'PUT', 'move', 'copy', '']) {
    const r = await appeler(serveur(), '/api/vivy/drive/exchange', { coin: piece, op, drive: 'perso', zone: '/Vivy' });
    assert.equal(r.body.error, 'vivy_drive_unknown_op', `verbe accepté à tort: ${op}`);
  }
});

test('un nom de fichier ne traverse jamais de dossier', async () => {
  const piece = { payload: { schema: 'x' }, signature: 'y' };
  for (const nom of ['../secret.txt', 'a/b.txt', 'dossier\\x.txt', '..']) {
    const r = await appeler(serveur(), '/api/vivy/drive/exchange', {
      coin: piece, op: 'write', drive: 'perso', zone: '/Vivy', name: nom, content: 'x',
    });
    assert.equal(r.body.error, 'vivy_drive_bad_name', `nom accepté à tort: ${nom}`);
  }
});

test('lire ou écrire exige un nom, lister non', async () => {
  const piece = { payload: { schema: 'x' }, signature: 'y' };
  for (const op of ['read', 'write']) {
    const r = await appeler(serveur(), '/api/vivy/drive/exchange', { coin: piece, op, drive: 'perso', zone: '/Vivy' });
    assert.equal(r.body.error, 'vivy_drive_name_required');
  }
});

test('une pièce falsifiée est refusée en 403, pas en 500', async () => {
  const piece = {
    payload: { schema: 'nossen.scentgate.capability.v1', action: 'list', drive: 'perso', zone: '/Vivy', nonce: 'n' },
    signature: 'signature-inventee',
  };
  const r = await appeler(serveur(), '/api/vivy/drive/exchange', { coin: piece, op: 'list', drive: 'perso', zone: '/Vivy' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /^SCENTGATE_/);
});

test('la route n expose aucun champ url, endpoint ou path', async () => {
  // Garde de conception: si quelqu'un ajoute un jour un passe-plat d'URL, ce test
  // doit tomber. Une route qui relaie une adresse devient un proxy authentifie.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/routes/vivy-drive.cjs'), 'utf8'
  );
  for (const champ of ['req.body?.url', 'req.body.url', 'req.body?.endpoint', 'req.body?.path']) {
    assert.ok(!source.includes(champ), `la route lit ${champ}: proxy ouvert`);
  }
});
