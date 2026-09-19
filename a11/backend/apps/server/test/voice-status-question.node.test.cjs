'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSiwisStatusQuestion,
  isOfficialVoiceStatusQuestion,
} = require('../src/chat/voice-status-question.cjs');

test('les vraies questions sur la voix restent reconnues', () => {
  assert.equal(isOfficialVoiceStatusQuestion('ta voix marche ?'), true);
  assert.equal(isOfficialVoiceStatusQuestion('la voix officielle est cassée'), true);
  assert.equal(isOfficialVoiceStatusQuestion('le vocal ne répond plus'), true);
  assert.equal(isSiwisStatusQuestion('piper fonctionne ?'), true);
});

test('un recit ne declenche plus le texte tout fait sur la voix (19/09/2026)', () => {
  const recit = "Rei a quatorze ans. Son pere lui demande de venir l'aider a chercher du materiel pour son travail, "
    + "et beaucoup de choses se passent : la moto parle a sa facon, les personnes sont ok avec ca, "
    + "et Rei ne repond rien, il regarde la Gilera sous la bache.";
  assert.equal(isOfficialVoiceStatusQuestion(recit), false);

  // Bouts de mots qui matchaient avant : « per-son-ne », « beauco-up », « s-ok ».
  assert.equal(isOfficialVoiceStatusQuestion('les personnes sont beaucoup trop nombreuses'), false);
  assert.equal(isSiwisStatusQuestion('le tuple est ok'), false);
});
