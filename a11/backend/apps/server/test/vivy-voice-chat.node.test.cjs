'use strict';

/**
 * Chat vocal avec Vivy, reserve fondateur/famille.
 *
 * Djeff: « tu debloque ca que pour les compte fondateur/famille ». Le verrou doit etre
 * cote serveur: masquer un bouton n'empeche personne d'appeler la route, et chaque
 * appel coute une transcription facturable puis un appel LLM.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const createVivyVoiceChatRouter = require('../src/routes/vivy-voice-chat.cjs');

const FAMILLE = { id: 'djeff', email: 'cellaurojeffrey@gmail.com' };
const INCONNU = { id: 'zoe', email: 'zoe@example.com' };

function demarrer({ user, buildVivyAiChat } = {}) {
  const app = express();
  app.use('/api/vivy/voice-chat', createVivyVoiceChatRouter({
    verifyJWT: (req, _res, next) => { req.user = user; next(); },
    buildVivyAiChat,
  }));
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function envoyerAudio(server, octets = 4096) {
  const { port } = server.address();
  const form = new FormData();
  form.append('audio', new Blob([Buffer.alloc(octets, 7)], { type: 'audio/webm' }), 'voix.webm');
  const res = await fetch(`http://127.0.0.1:${port}/api/vivy/voice-chat`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('un compte hors famille est refuse', async (t) => {
  let llmAppele = false;
  const server = await demarrer({
    user: INCONNU,
    buildVivyAiChat: async () => { llmAppele = true; return { reply: 'salut' }; },
  });
  t.after(() => server.close());

  const res = await envoyerAudio(server);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'voice_chat_restricted');
  assert.equal(llmAppele, false, 'le refus doit tomber avant toute depense');
});

test('le sondage d acces dit non sans rien depenser', async (t) => {
  const server = await demarrer({ user: INCONNU, buildVivyAiChat: async () => ({ reply: '' }) });
  t.after(() => server.close());

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/vivy/voice-chat/access`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.allowed, false);
  assert.equal(body.reason, 'family_only');
});

test('un compte famille est autorise', async (t) => {
  const server = await demarrer({ user: FAMILLE, buildVivyAiChat: async () => ({ reply: '' }) });
  t.after(() => server.close());

  const { port } = server.address();
  const body = await (await fetch(`http://127.0.0.1:${port}/api/vivy/voice-chat/access`)).json();
  assert.equal(body.allowed, true);
});

test('un audio trop court est refuse avant la transcription', async (t) => {
  let llmAppele = false;
  const server = await demarrer({
    user: FAMILLE,
    buildVivyAiChat: async () => { llmAppele = true; return { reply: 'x' }; },
  });
  t.after(() => server.close());

  const res = await envoyerAudio(server, 32);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'missing_audio');
  assert.equal(llmAppele, false);
});

test('sans garde d authentification montee, la route refuse', async (t) => {
  const app = express();
  app.use('/api/vivy/voice-chat', createVivyVoiceChatRouter({ buildVivyAiChat: async () => ({ reply: '' }) }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => server.close());

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/vivy/voice-chat/access`);
  assert.equal(res.status, 503);
});

test('la liste famille reconnait bien les comptes du projet', () => {
  const { isFamilyVoiceUser } = createVivyVoiceChatRouter;
  assert.equal(isFamilyVoiceUser({ user: { email: 'cellaurojeffrey@gmail.com' } }), true);
  assert.equal(isFamilyVoiceUser({ user: { email: 'MarvinCellauro@Gmail.com' } }), true, 'la casse ne doit pas compter');
  assert.equal(isFamilyVoiceUser({ user: { email: 'inconnu@example.com' } }), false);
  assert.equal(isFamilyVoiceUser({ user: {} }), false);
  assert.equal(isFamilyVoiceUser({}), false);
});
