'use strict';

/**
 * Historique Vivy partage entre appareils.
 *
 * Djeff ne retrouvait pas ses conversations Vivy de l'iPhone sur le PC. La memoire
 * episodique, elle, etait bien commune: Vivy se souvenait. Mais la LISTE des
 * conversations vient de la table `messages`, ou la route de chat de Vivy n'ecrivait
 * jamais -- la base ne contenait aucun identifiant « vivy: », la ou a11 et kaen44 en
 * avaient. Ce n'etait pas une regression: le branchement n'avait jamais existe.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { createVivyStudioRouter } = require('../src/routes/vivy-studio.cjs');

function demarrer(enregistres, user = { id: '2', email: 'djeff@example.test' }) {
  const app = express();
  app.use('/api/vivy/studio', createVivyStudioRouter({
    verifyJWT: (req, _res, next) => { req.user = user; next(); },
    saveChatMemoryMessage: async (userId, role, content, conversationId) => {
      enregistres.push({ userId, role, content, conversationId });
    },
  }));
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function envoyer(server, corps) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/vivy/studio/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  await res.text();
  // La persistance part apres la reponse: on laisse la micro-tache s'executer.
  await new Promise((r) => setTimeout(r, 60));
  return res.status;
}

test('un tour de chat Vivy est enregistre sous le prefixe vivy:', async (t) => {
  const enregistres = [];
  const server = await demarrer(enregistres);
  t.after(() => server.close());

  await envoyer(server, { message: 'Salut Vivy, on fait un son ?', conversationId: 'chat-1782039969690' });

  assert.ok(enregistres.length >= 1, 'aucun message enregistre');
  for (const e of enregistres) {
    assert.match(e.conversationId, /^vivy:/, 'le prefixe de surface est ce que lit /api/a11/history');
    assert.equal(e.userId, '2');
  }
  assert.ok(enregistres.some((e) => e.role === 'user' && /on fait un son/i.test(e.content)));
});

test('un identifiant deja prefixe n est pas prefixe deux fois', async (t) => {
  const enregistres = [];
  const server = await demarrer(enregistres);
  t.after(() => server.close());

  await envoyer(server, { message: 'test', conversationId: 'vivy:chat-42' });

  for (const e of enregistres) {
    assert.equal(e.conversationId, 'vivy:chat-42');
    assert.doesNotMatch(e.conversationId, /vivy:vivy:/);
  }
});

test('sans conversation nommee, le fil par defaut reste rattache a Vivy', async (t) => {
  const enregistres = [];
  const server = await demarrer(enregistres);
  t.after(() => server.close());

  await envoyer(server, { message: 'test sans identifiant' });

  for (const e of enregistres) assert.equal(e.conversationId, 'vivy:default');
});

test('sans compte connecte, rien n est enregistre', async (t) => {
  const enregistres = [];
  const server = await demarrer(enregistres, {});
  t.after(() => server.close());

  await envoyer(server, { message: 'anonyme' });

  assert.deepEqual(enregistres, [], 'un tour sans utilisateur ne doit rien ecrire');
});

test('une panne de persistance ne casse pas le chat', async (t) => {
  const app = express();
  app.use('/api/vivy/studio', createVivyStudioRouter({
    verifyJWT: (req, _res, next) => { req.user = { id: '2' }; next(); },
    saveChatMemoryMessage: async () => { throw new Error('base injoignable'); },
  }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => server.close());

  const statut = await envoyer(server, { message: 'la base est morte' });
  assert.notEqual(statut, 500, 'la reponse doit partir meme si l enregistrement echoue');
});
