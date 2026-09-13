'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-solde-'));
const solde = require('../src/clips/comfy-solde.cjs');
const credits = require('../src/clips/clip-credits.cjs');

test('le solde de l API est en cents malgre son nom : 211 credits par dollar', () => {
  // Releve reel du 13/09/2026 : 2 836,39 -> 5 984 credits au tableau de bord Comfy.
  assert.equal(solde.creditsDepuisReponse({ effective_balance_micros: 2836.3890864 }), 5984);
  // Un plan Seedance 2.0 Fast (119,5 credits) = 56,64 cents.
  assert.equal(solde.creditsDepuisReponse({ effective_balance_micros: 2893.0264672 }) - 5984, 120);
  assert.equal(solde.creditsDepuisReponse({}), null);
  assert.equal(solde.creditsDepuisReponse({ effective_balance_micros: 'x' }), null);
});

test('la couverture deduit les plans que les clips en cours vont encore consommer', () => {
  const seule = solde.couverture({ plans: 41, soldeCredits: 5984, env: {} });
  assert.equal(seule.plansPossibles, 50);
  assert.equal(seule.suffisant, true);
  const partagee = solde.couverture({ plans: 41, soldeCredits: 5984, plansEnCours: 20, env: {} });
  assert.equal(partagee.plansPossibles, 30);
  assert.equal(partagee.suffisant, false);
  assert.equal(partagee.creditsNecessaires, Math.ceil(41 * 119.5));
  assert.equal(solde.couverture({ plans: 6, soldeCredits: 50, env: {} }).plansPossibles, 0);
  assert.equal(solde.creditsComfyParPlan({ NOSSEN_CLIP_COMFY_CREDITS_PAR_PLAN: '200' }), 200, 'reglable');
});

test('le lecteur ne tente rien sans cle, met en cache, et un echec reste un inconnu', async () => {
  let appels = 0;
  let maintenant = 0;
  const fetchOk = async () => { appels += 1; return { ok: true, json: async () => ({ effective_balance_micros: 1000 }) }; };
  assert.equal(await solde.creerLecteurSolde({ fetchImpl: fetchOk, env: {} })(), null, 'sans cle : rien');
  assert.equal(appels, 0);

  const lire = solde.creerLecteurSolde({ fetchImpl: fetchOk, env: { COMFY_API_KEY: 'k' }, nowImpl: () => maintenant });
  assert.equal((await lire()).credits, 2110);
  await lire();
  assert.equal(appels, 1, 'deuxieme lecture servie par le cache');
  maintenant = 61_000;
  await lire();
  assert.equal(appels, 2, 'cache expire apres 60 s');

  const enPanne = solde.creerLecteurSolde({ fetchImpl: async () => { throw new Error('reseau'); }, env: { COMFY_API_KEY: 'k' } });
  assert.equal(await enPanne(), null);
  const refuse = solde.creerLecteurSolde({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }), env: { COMFY_API_KEY: 'k' } });
  assert.equal(await refuse(), null);
});

// --- Routes, avec un solde Comfy injecte -------------------------------------

async function avecServeur({ admin, soldeCredits }, travail) {
  const express = require('express');
  const { createClipRouter } = require('../src/clips/clip-router.cjs');
  const magasin = credits.creerMagasinMemoire();
  await credits.crediter(magasin, { userId: 'u1', credits: 1000, ref: 'stripe:t', reason: 'achat' });
  let lancements = 0;
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'u1', email: 'fan@example.com', isAdmin: admin }; next(); });
  app.use('/clip', createClipRouter({
    magasinCredits: magasin,
    isAdminRequest: (req) => req.user.isAdmin === true,
    lireSoldeComfy: async () => (soldeCredits == null ? null : { credits: soldeCredits }),
    generateClipImpl: async () => { lancements += 1; return { segments: 1, url: '/x.mp4', filename: 'x.mp4' }; },
  }));
  const serveur = app.listen(0);
  await new Promise((ok) => serveur.once('listening', ok));
  const base = `http://127.0.0.1:${serveur.address().port}/clip`;
  try { await travail({ base, magasin, lancements: () => lancements }); } finally { serveur.close(); }
}

const post = (url, corps) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });

test('l estimation d un Full Clip previent quand la reserve ne couvre pas toute la chanson', async () => {
  await avecServeur({ admin: false, soldeCredits: 1000 }, async ({ base }) => {
    const e = await (await fetch(`${base}/estimation?full=1&durationSeconds=285`)).json();
    assert.equal(e.plans, 41);
    assert.equal(e.reserve.connue, true);
    assert.equal(e.reserve.suffisant, false);
    assert.equal(e.reserve.plansPossibles, 8);
    assert.equal(e.reserve.creditsDisponibles, undefined, 'le solde exact reste reserve aux admins');
    assert.equal(e.creditsSite, credits.creditsPourPlans(41));
  });
  await avecServeur({ admin: true, soldeCredits: 1000 }, async ({ base }) => {
    const e = await (await fetch(`${base}/estimation?full=1&durationSeconds=285`)).json();
    assert.equal(e.reserve.creditsDisponibles, 1000);
    assert.equal(e.creditsSite, 0);
    const c = await (await fetch(`${base}/credits`)).json();
    assert.deepEqual(c.reserveComfy, { credits: 1000, plans: 8 });
  });
});

test('reserve vide : 503 avant toute reservation de credits et tout lancement', async () => {
  await avecServeur({ admin: false, soldeCredits: 50 }, async ({ base, magasin, lancements }) => {
    const r = await post(`${base}/start`, { songUrl: 'https://example.com/a.mp3', title: 'T' });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'RESERVE_VIDEO_VIDE');
    assert.equal(await magasin.solde('u1'), 1000, 'aucun credit pris');
    assert.equal(lancements(), 0);
  });
});

test('reserve basse : le clip part, avec un avertissement ; solde inconnu : rien ne change', async () => {
  await avecServeur({ admin: true, soldeCredits: 300 }, async ({ base }) => {
    const d = await (await post(`${base}/start`, { songUrl: 'https://example.com/a.mp3', title: 'T', fullDuration: true, durationSeconds: 285 })).json();
    assert.equal(d.ok, true);
    assert.deepEqual(d.avertissement, { code: 'RESERVE_VIDEO_BASSE', plans: 41, plansPossibles: 2 });
  });
  await avecServeur({ admin: true, soldeCredits: null }, async ({ base }) => {
    const e = await (await fetch(`${base}/estimation?full=0`)).json();
    assert.deepEqual(e.reserve, { connue: false });
    const d = await (await post(`${base}/start`, { songUrl: 'https://example.com/a.mp3', title: 'T' })).json();
    assert.equal(d.ok, true);
    assert.equal(d.avertissement, undefined);
  });
});
