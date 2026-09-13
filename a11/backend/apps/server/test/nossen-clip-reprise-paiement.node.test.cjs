'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Le module cree son dossier de clips au chargement ; /app n'existe pas en CI.
process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-reprise-paiement-'));
const {
  estRefusPaiement, estRefusAutorisation, estRefusDePolitique, generateClip, PAUSES_REPRISE_PAIEMENT_MS,
} = require('../src/clips/clip-generator-v2.cjs');
const { detailDepuisReponse } = require('../src/clips/comfy-solde.cjs');

// Message reel du 12/09/2026 (Funesterie va Briller, arrete au plan 3 sur 28).
const REFUS_PAIEMENT = 'clip_video_generation_failed: Payment Required: Please add credits to your account to use this node.';

test('le refus de paiement Comfy est reconnu, sans se confondre avec les autres refus', () => {
  assert.equal(estRefusPaiement(REFUS_PAIEMENT), true);
  assert.equal(estRefusAutorisation(REFUS_PAIEMENT), false);
  assert.equal(estRefusDePolitique(REFUS_PAIEMENT), false);
  for (const autre of ['clip_video_generation_failed: PolicyViolation', 'Unauthorized: Please login first', 'socket hang up', '', null]) {
    assert.equal(estRefusPaiement(autre), false, String(autre));
  }
  assert.ok(PAUSES_REPRISE_PAIEMENT_MS.length >= 1 && PAUSES_REPRISE_PAIEMENT_MS.every((p) => p <= 600000));
});

test('le solde distingue credits mensuels et bonus (reponse reelle du 13/09/2026)', () => {
  const detail = detailDepuisReponse({
    amount_micros: 457.6190928, cloud_credit_balance_micros: 0, currency: 'usd',
    effective_balance_micros: 457.6190928, pending_charges_micros: 0, prepaid_balance_micros: 457.6190928,
  });
  assert.deepEqual(detail, { credits: 965, mensuel: 0, bonus: 965, enAttente: 0 });
  assert.equal(detailDepuisReponse({}), null);
});

function harnais({ refusParPlan, solde }) {
  const appels = [];
  const pauses = [];
  const deps = {
    materializeMedia: async (_value, destination, options) => {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, options.kind === 'audio' ? 'ID3audio' : 'video');
    },
    loadDirectorImpl: () => ({ directClip: async () => ({ scenes: [{ name: 'Plan', visual: 'A precise cinematic visual' }] }) }),
    generateVideoImpl: async (_prompt, index) => {
      appels.push(index);
      const deja = appels.filter((i) => i === index).length;
      if (index === 1 && deja <= refusParPlan) throw new Error(REFUS_PAIEMENT);
      return `https://cloud.comfy.org/api/s/plan-${index}`;
    },
    lireSoldeImpl: async () => solde,
    // 14 s = 2 plans de 7 s.
    execFileSyncImpl: (command, args) => {
      if (command === 'ffprobe') return Buffer.from(args.includes('stream=codec_type') ? 'video\n' : '14.0\n');
      fs.writeFileSync(args.at(-1), 'assembled');
      return Buffer.alloc(0);
    },
    sleepImpl: async (ms) => { pauses.push(ms); },
  };
  return { deps, appels, pauses };
}

test('reserve mensuelle vide mais bonus disponible : le clip attend la bascule et va au bout', async () => {
  const { deps, appels, pauses } = harnais({ refusParPlan: 1, solde: { credits: 965, mensuel: 0, bonus: 965 } });
  const result = await generateClip({ songUrl: '/audio.mp3', title: 'Bascule' }, deps);
  assert.equal(result.partial, false, 'plus de clip partiel pour un refus passager');
  assert.equal(result.segments, 2);
  assert.deepEqual(appels, [0, 1, 1], 'le plan refuse est reessaye une fois, rien d autre');
  assert.ok(pauses.includes(PAUSES_REPRISE_PAIEMENT_MS[0]), 'une pause laisse Comfy basculer de reserve');
});

test('les deux reserves vides : arret immediat, sans attente ni nouvel essai', async () => {
  const { deps, appels, pauses } = harnais({ refusParPlan: 99, solde: { credits: 50, mensuel: 0, bonus: 50 } });
  const result = await generateClip({ songUrl: '/audio.mp3', title: 'A sec' }, deps);
  assert.equal(result.partial, true);
  assert.equal(result.segments, 1);
  assert.deepEqual(appels, [0, 1], 'aucun nouvel essai quand rien ne peut payer');
  assert.ok(!pauses.some((p) => PAUSES_REPRISE_PAIEMENT_MS.includes(p) && p > 2000), 'aucune attente inutile');
  assert.match(result.warning, /réserve Comfy épuisée \(crédits mensuels et bonus\)/);
  assert.match(result.warning, /mensuel 0, bonus 50/);
});

test('solde illisible : essais bornes par la liste des pauses, puis arret propre', async () => {
  const { deps, appels } = harnais({ refusParPlan: 99, solde: null });
  const result = await generateClip({ songUrl: '/audio.mp3', title: 'Illisible' }, deps);
  assert.equal(result.segments, 1);
  assert.equal(appels.filter((i) => i === 1).length, 1 + PAUSES_REPRISE_PAIEMENT_MS.length);
  assert.match(result.warning, /réserve Comfy épuisée/);
});
