'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');
const createPersonaVoiceDialogueRouter = require('../src/routes/persona-voice-dialogue.cjs');

async function withServer(fn) {
  const app = express();
  app.use('/api/personas/dialogue', createPersonaVoiceDialogueRouter({
    verifyJWT(req, _res, next) {
      req.user = { email: String(req.headers['x-test-email'] || '') };
      next();
    },
    responders: {
      vivy: async (input) => ({ assistant: `Vivy entend: ${input.personaDialogueTurn}.` }),
      djeff: async (input) => ({ reply: `Djeff repond: ${input.personaDialogueTurn}.` }),
    },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { await fn(baseUrl); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('persona dialogue is bounded and returns one polished TTS request per turn', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/personas/dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-email': 'cellaurojeffrey@gmail.com' },
      body: JSON.stringify({ topic: 'Ameliorer le duo', personas: ['vivy', 'djeff'], maxTurns: 99 }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.turns.length, 6);
    assert.deepEqual(payload.turns.map((turn) => turn.persona), ['vivy', 'djeff', 'vivy', 'djeff', 'vivy', 'djeff']);
    assert.equal(payload.turns[0].ttsRequest.endpoint, '/api/tts/speak');
    assert.equal(payload.turns[0].ttsRequest.body.voicePolish, true);
    assert.equal(payload.voiceLearning.syntheticOutputsEnterTrainingCorpus, false);
  });
});

test('persona dialogue remains family-only', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/personas/dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-email': 'outside@example.com' },
      body: JSON.stringify({ topic: 'test' }),
    });
    assert.equal(response.status, 403);
  });
});
