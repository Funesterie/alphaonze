'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-acces-'));
process.env.NOSSEN_CLIPS_DIR = DOSSIER;
const acces = require('../src/clips/clip-acces.cjs');
const credits = require('../src/clips/clip-credits.cjs');

// Deux comptes, trois clips : un chacun, et un clip sans job (lance par script).
for (const f of ['A-1.mp4', 'B-2.mp4', 'Orphelin.mp4']) fs.writeFileSync(path.join(DOSSIER, f), 'video');
fs.writeFileSync(path.join(DOSSIER, 'jobs.json'), JSON.stringify([
  { id: 'j1', status: 'done', userId: 'u1', email: 'a@x.fr', title: 'A', outputFilename: 'A-1.mp4', createdAt: '2026-09-13T00:00:00Z' },
  { id: 'j2', status: 'done', userId: 'u2', email: 'b@x.fr', title: 'B', outputFilename: 'B-2.mp4', partial: true, createdAt: '2026-09-13T00:01:00Z' },
]));

const U1 = { id: 'u1', email: 'a@x.fr' };
const U2 = { id: 'u2', email: 'b@x.fr' };

test('un clip n est visible que de son auteur, des admins, ou de tous s il est en vitrine', () => {
  assert.equal(acces.peutVoirClip({ filename: 'A-1.mp4', user: U1 }), true, 'l auteur');
  assert.equal(acces.peutVoirClip({ filename: 'B-2.mp4', user: U1 }), false, 'un autre compte');
  assert.equal(acces.peutVoirClip({ filename: 'B-2.mp4', user: { email: 'B@X.FR' } }), true, 'reconnu par son email');
  assert.equal(acces.peutVoirClip({ filename: 'A-1.mp4', user: null }), false, 'un anonyme');
  assert.equal(acces.peutVoirClip({ filename: 'Orphelin.mp4', user: U1 }), false, 'sans job, sans auteur');
  assert.equal(acces.peutVoirClip({ filename: 'Orphelin.mp4', admin: true }), true, 'l admin voit tout');
  assert.equal(acces.peutVoirClip({ filename: '../jobs.json', admin: true }), false, 'jamais hors des videos');

  acces.publierDansVitrine('B-2.mp4', true);
  assert.equal(acces.peutVoirClip({ filename: 'B-2.mp4', user: null }), true, 'la vitrine est a tous');
  acces.publierDansVitrine('B-2.mp4', false);
  assert.equal(acces.peutVoirClip({ filename: 'B-2.mp4', user: U1 }), false, 'retire de la vitrine');
  assert.throws(() => acces.publierDansVitrine('../../etc/passwd'), /nom_de_clip_invalide/);
});

test('mes clips : ceux du compte seulement ; la vitrine pour tous, tout pour l admin', () => {
  assert.deepEqual(acces.clipsDuCompte(U1).map((c) => c.filename), ['A-1.mp4']);
  assert.equal(acces.clipsDuCompte(U2)[0].partial, true);
  assert.deepEqual(acces.clipsDuCompte(null), []);

  acces.publierDansVitrine('A-1.mp4', true);
  assert.deepEqual(acces.clipsVisibles({ admin: false }).map((c) => c.filename), ['A-1.mp4']);
  const tout = acces.clipsVisibles({ admin: true });
  assert.equal(tout.length, 3);
  const parNom = Object.fromEntries(tout.map((c) => [c.filename, c]));
  assert.equal(parNom['A-1.mp4'].auteur, 'a@x.fr');
  assert.equal(parNom['A-1.mp4'].enVitrine, true);
  assert.equal(parNom['Orphelin.mp4'].auteur, null);
  acces.publierDansVitrine('A-1.mp4', false);
});

async function avecServeur(user, travail) {
  const express = require('express');
  const { createClipRouter } = require('../src/clips/clip-router.cjs');
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/clip', createClipRouter({
    magasinCredits: credits.creerMagasinMemoire(),
    isAdminRequest: (req) => Boolean(req.user && req.user.isAdmin === true),
    lireSoldeComfy: async () => null,
    generateClipImpl: async () => ({ segments: 1 }),
  }));
  const serveur = app.listen(0);
  await new Promise((ok) => serveur.once('listening', ok));
  try { await travail(`http://127.0.0.1:${serveur.address().port}/clip`); } finally { serveur.close(); }
}

const post = (url, corps) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });

test('les routes : /list ne publie plus tout, /mes-clips est personnel, la vitrine est reservee a l admin', async () => {
  await avecServeur(U1, async (base) => {
    const liste = await (await fetch(`${base}/list`)).json();
    assert.equal(liste.admin, false);
    assert.deepEqual(liste.clips, [], 'rien en vitrine : rien de public');
    const mes = await (await fetch(`${base}/mes-clips`)).json();
    assert.deepEqual(mes.clips.map((c) => c.filename), ['A-1.mp4']);
    assert.equal((await post(`${base}/vitrine`, { filename: 'A-1.mp4' })).status, 403);
  });
  await avecServeur({ id: 'admin', email: 'djeff@x.fr', isAdmin: true }, async (base) => {
    const r = await post(`${base}/vitrine`, { filename: 'B-2.mp4', publier: true });
    assert.equal(r.status, 200);
    assert.equal((await post(`${base}/vitrine`, { filename: '../x.mp4' })).status, 400);
    const liste = await (await fetch(`${base}/list`)).json();
    assert.equal(liste.admin, true);
    assert.equal(liste.clips.length, 3);
  });
  await avecServeur(U1, async (base) => {
    const liste = await (await fetch(`${base}/list`)).json();
    assert.deepEqual(liste.clips.map((c) => c.filename), ['B-2.mp4'], 'la vitrine choisie par l admin');
  });
  acces.publierDansVitrine('B-2.mp4', false);
});
