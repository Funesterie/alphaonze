'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'fiches-'));
process.env.A11_FICHES_DIR = RACINE;
process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fiches-clips-'));
const fiche = require('../src/fiche/fiche-compte.cjs');

const ENV = { A11_FICHES_DIR: RACINE };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const BONNE_ANALYSE = async () => ({ ok: true, videoPrompt: 'real adult man, olive skin, short dark hair, short black beard, broad shoulders, dark t-shirt.' });

test('une fiche est creee a la premiere visite, dans un dossier par compte, jamais au nom brut', () => {
  const u = { id: 'u-fiche-1', email: 'a@x.fr', username: 'Djeff' };
  const f = fiche.lireFiche(u, { env: ENV });
  assert.equal(f.pseudo, 'Djeff');
  assert.equal(f.avatar, null);
  const cle = fiche.cleCompte(u);
  assert.match(cle, /^[a-f0-9]{32}$/);
  assert.ok(fs.existsSync(path.join(RACINE, cle, 'fiche.json')));
  assert.notEqual(fiche.cleCompte({ id: 'u-fiche-2' }), cle, 'deux comptes, deux dossiers');
  assert.throws(() => fiche.lireFiche({}, { env: ENV }), /compte_inconnu/);
});

test('la photo exige le consentement, un format image et une analyse d un seul visage adulte', async () => {
  const u = { id: 'u-photo' };
  await assert.rejects(fiche.enregistrerPhoto(u, { image: JPEG, mimeType: 'image/jpeg' }, { env: ENV, decrireImpl: BONNE_ANALYSE }), /consentement_manquant/);
  await assert.rejects(fiche.enregistrerPhoto(u, { image: JPEG, mimeType: 'image/gif', consentement: fiche.CONSENTEMENT_PHOTO }, { env: ENV, decrireImpl: BONNE_ANALYSE }), /format_photo/);

  const refus = await fiche.enregistrerPhoto(u, { image: JPEG, mimeType: 'image/jpeg', consentement: fiche.CONSENTEMENT_PHOTO },
    { env: ENV, decrireImpl: async () => ({ ok: false, raison: 'Deux visages sur la photo.' }) });
  assert.equal(refus.ok, false);
  assert.equal(refus.raison, 'Deux visages sur la photo.');
  assert.equal(fiche.lireFiche(u, { env: ENV }).avatar, null, 'aucun avatar sur un refus');

  const ok = await fiche.enregistrerPhoto(u, { image: JPEG, mimeType: 'image/jpeg', consentement: fiche.CONSENTEMENT_PHOTO }, { env: ENV, decrireImpl: BONNE_ANALYSE });
  assert.equal(ok.ok, true);
  assert.match(ok.fiche.avatar.videoPrompt, /^real adult man/);
  const photo = fiche.cheminPhoto(u, { env: ENV });
  assert.deepEqual(fs.readFileSync(photo.chemin), JPEG);
  assert.equal(fiche.vuePublique(ok.fiche).avatar.aPhoto, true);
  assert.equal(JSON.stringify(fiche.vuePublique(ok.fiche)).includes('photo.jpg'), false, 'jamais le chemin de la photo');

  assert.deepEqual(fiche.identiteClipDuCompte(u, { env: ENV }), { label: fiche.LIBELLE_CLIP, videoPrompt: ok.fiche.avatar.videoPrompt });
  const corrigee = fiche.majFiche(u, { videoPrompt: 'real adult man, olive skin, shaved head, black beard.' }, { env: ENV });
  assert.match(corrigee.avatar.videoPrompt, /shaved head/);

  fiche.supprimerAvatar(u, { env: ENV });
  assert.equal(fiche.cheminPhoto(u, { env: ENV }), null);
  assert.equal(fs.existsSync(photo.chemin), false, 'la photo est effacee du disque');
  assert.equal(fiche.identiteClipDuCompte(u, { env: ENV }), null);
});

test('une analyse qui ne decrit pas un adulte reel est rejetee ; cinq analyses par jour', async () => {
  assert.equal(fiche.interpreterAnalyse({ ok: true, videoPrompt: 'cute anime girl' }).ok, false);
  assert.equal(fiche.interpreterAnalyse(null).ok, false);
  const u = { id: 'u-quota' };
  const jour = new Date('2026-09-13T10:00:00Z');
  for (let i = 0; i < fiche.ANALYSES_PAR_JOUR; i += 1) {
    await fiche.enregistrerPhoto(u, { image: JPEG, mimeType: 'image/jpeg', consentement: fiche.CONSENTEMENT_PHOTO }, { env: ENV, decrireImpl: BONNE_ANALYSE, maintenant: jour });
  }
  await assert.rejects(fiche.enregistrerPhoto(u, { image: JPEG, mimeType: 'image/jpeg', consentement: fiche.CONSENTEMENT_PHOTO },
    { env: ENV, decrireImpl: BONNE_ANALYSE, maintenant: jour }), /trop_d_analyses/);
  const lendemain = await fiche.enregistrerPhoto(u, { image: JPEG, mimeType: 'image/jpeg', consentement: fiche.CONSENTEMENT_PHOTO },
    { env: ENV, decrireImpl: BONNE_ANALYSE, maintenant: new Date('2026-09-14T08:00:00Z') });
  assert.equal(lendemain.ok, true, 'le compteur repart le lendemain');
});

test('Gemini : cle absente = indisponible ; reponse JSON lue telle quelle', async () => {
  await assert.rejects(fiche.decrireVisageGemini({ image: JPEG, mimeType: 'image/jpeg', env: {} }), /vision_indisponible/);
  let appel = null;
  const rep = await fiche.decrireVisageGemini({
    image: JPEG, mimeType: 'image/jpeg', env: { GEMINI_API_KEY: 'k' },
    fetchImpl: async (url, opts) => {
      appel = { url, opts };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true,"videoPrompt":"real adult woman, fair skin"}' }] } }] }) };
    },
  });
  assert.equal(rep.ok, true);
  assert.match(appel.url, /gemini-2\.5-flash:generateContent$/);
  assert.equal(appel.opts.headers['x-goog-api-key'], 'k', 'la cle en en-tete, jamais dans l URL');
  assert.equal(JSON.parse(appel.opts.body).contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
});

async function avecServeur(user, options, travail) {
  const express = require('express');
  const { createFicheRouter } = require('../src/routes/fiche.cjs');
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/fiche', createFicheRouter({ env: ENV, ...options }));
  const serveur = app.listen(0);
  await new Promise((ok) => serveur.once('listening', ok));
  try { await travail(`http://127.0.0.1:${serveur.address().port}/fiche`); } finally { serveur.close(); }
}

test('routes : lire, envoyer une photo, la relire, corriger, supprimer', async () => {
  await avecServeur({ id: 'u-route', username: 'Lea' }, { decrireImpl: BONNE_ANALYSE }, async (base) => {
    const lu = await (await fetch(base)).json();
    assert.equal(lu.fiche.pseudo, 'Lea');
    assert.equal(lu.consentement, fiche.CONSENTEMENT_PHOTO);

    const sansConsent = new FormData();
    sansConsent.append('photo', new Blob([JPEG], { type: 'image/jpeg' }), 'moi.jpg');
    assert.equal((await fetch(`${base}/photo`, { method: 'POST', body: sansConsent })).status, 400);

    const fd = new FormData();
    fd.append('consentement', fiche.CONSENTEMENT_PHOTO);
    fd.append('photo', new Blob([JPEG], { type: 'image/jpeg' }), 'moi.jpg');
    const envoi = await fetch(`${base}/photo`, { method: 'POST', body: fd });
    assert.equal(envoi.status, 200);
    assert.match((await envoi.json()).fiche.avatar.videoPrompt, /^real adult man/);

    const relue = await fetch(`${base}/photo`);
    assert.equal(relue.status, 200);
    assert.equal(relue.headers.get('cache-control'), 'private, no-store');

    const put = await fetch(base, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoPrompt: 'x' }) });
    assert.equal(put.status, 400, 'description trop courte');

    assert.equal((await fetch(`${base}/photo`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/photo`)).status, 404);
  });
  await avecServeur(null, {}, async (base) => {
    assert.equal((await fetch(base)).status, 401, 'sans compte, pas de fiche');
  });
});

test('clips : le casting Moi exige un avatar, et la fiche du compte remplace les fiches maison', async () => {
  const { identiteDepuisFiche } = require('../src/clips/clip-vivy-director.cjs');
  const id = identiteDepuisFiche({ label: fiche.LIBELLE_CLIP, videoPrompt: 'real adult woman, fair skin, red hair.' });
  assert.deepEqual(id.identityIds, ['moi']);
  assert.equal(id.prompt, 'real adult woman, fair skin, red hair.');
  assert.deepEqual(id.castLabels, [fiche.LIBELLE_CLIP]);

  const express = require('express');
  const credits = require('../src/clips/clip-credits.cjs');
  const { createClipRouter } = require('../src/clips/clip-router.cjs');
  let configRecue = null;
  const lancer = async (identite) => {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 'u-moi', isAdmin: true }; next(); });
    app.use('/clip', createClipRouter({
      magasinCredits: credits.creerMagasinMemoire(),
      isAdminRequest: () => true,
      lireSoldeComfy: async () => null,
      lireIdentiteCompte: () => identite,
      generateClipImpl: async (config) => { configRecue = config; return { segments: 1, filename: 'x.mp4' }; },
    }));
    const serveur = app.listen(0);
    await new Promise((ok) => serveur.once('listening', ok));
    try {
      return await fetch(`http://127.0.0.1:${serveur.address().port}/clip/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ songUrl: 'https://example.com/a.mp3', title: 'T', casting: 'moi' }),
      });
    } finally { serveur.close(); }
  };
  const sans = await lancer(null);
  assert.equal(sans.status, 400);
  assert.equal((await sans.json()).error, 'AVATAR_MANQUANT');

  const avec = await lancer({ label: fiche.LIBELLE_CLIP, videoPrompt: 'real adult woman, fair skin, red hair.' });
  assert.equal(avec.status, 200);
  for (let i = 0; i < 50 && !configRecue; i += 1) await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(configRecue.identiteCompte.videoPrompt, 'real adult woman, fair skin, red hair.');
});
