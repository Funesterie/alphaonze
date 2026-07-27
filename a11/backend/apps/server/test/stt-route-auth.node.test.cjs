'use strict';

/**
 * Garde d'authentification sur la transcription.
 *
 * Caddy publie /api/stt/* sur l'internet. La route etait montee sans verifyJWT, donc
 * n'importe qui pouvait faire transcrire de l'audio par un fournisseur facturable, et
 * lire au passage la configuration des fournisseurs via /stt/status.
 *
 * Ces tests existent pour qu'un remontage etourdi ne rouvre pas le trou en silence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const createSttRouter = require('../src/routes/stt.cjs');

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(server, method, routePath, headers = {}) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${routePath}`, { method, headers });
  const body = await res.text();
  return { status: res.status, body };
}

/** Garde de test: accepte uniquement le porteur 'jeton-valide'. */
function fakeVerifyJWT(req, res, next) {
  if (req.headers.authorization === 'Bearer jeton-valide') {
    req.user = { id: 'compte-test' };
    return next();
  }
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

test('la transcription refuse une requete sans jeton', async (t) => {
  const app = express();
  app.use('/api', createSttRouter({ verifyJWT: fakeVerifyJWT }));
  const server = await startServer(app);
  t.after(() => server.close());

  const anonyme = await request(server, 'POST', '/api/stt/transcribe');
  assert.equal(anonyme.status, 401, 'un anonyme ne doit pas atteindre le fournisseur');

  const statut = await request(server, 'GET', '/api/stt/status');
  assert.equal(statut.status, 401, 'le statut detaille les fournisseurs configures');
});

test('la transcription laisse passer un compte connecte', async (t) => {
  const app = express();
  app.use('/api', createSttRouter({ verifyJWT: fakeVerifyJWT }));
  const server = await startServer(app);
  t.after(() => server.close());

  const statut = await request(server, 'GET', '/api/stt/status', { authorization: 'Bearer jeton-valide' });
  assert.equal(statut.status, 200, 'un compte connecte garde acces au statut');

  // Sans fichier audio, la route repond 400: preuve qu'on a franchi la garde et
  // atteint la validation metier, sans depenser un appel de transcription.
  const sansAudio = await request(server, 'POST', '/api/stt/transcribe', { authorization: 'Bearer jeton-valide' });
  assert.equal(sansAudio.status, 400, 'la garde est franchie, la validation metier prend le relais');
});

test('sans garde fournie au montage, la route refuse au lieu de s ouvrir', async (t) => {
  // Le defaut le plus couteux serait un passe-plat silencieux.
  const app = express();
  app.use('/api', createSttRouter());
  const server = await startServer(app);
  t.after(() => server.close());

  const res = await request(server, 'POST', '/api/stt/transcribe');
  assert.equal(res.status, 503, 'pas de garde montee => pas de transcription');
  assert.match(res.body, /auth_guard_missing/);
});
