'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-credits-'));
const credits = require('../src/clips/clip-credits.cjs');

const ENV_DEFAUT = {};

test('le prix suit le vrai cout Comfy x2 : Clip 6 plans, Full Clip au prorata des plans', () => {
  // 6 x 0,14 USD x 0,92 x 2 = 1,55 EUR -> 16 credits de 0,10 EUR
  assert.equal(credits.creditsPourPlans(6, ENV_DEFAUT), 16);
  assert.equal(credits.creditsPourPlans(26, ENV_DEFAUT), 67);
  assert.equal(credits.creditsPourPlans(0, ENV_DEFAUT), 0);
  assert.equal(credits.creditsPourPlans(-3, ENV_DEFAUT), 0);
  assert.ok(credits.creditsPourPlans(6, { NOSSEN_CLIP_MARGE: '3' }) > 16, 'la marge se regle par variable');
});

test('les plans estimes : 6 pour un Clip, duree/8 pour un Full Clip, large sans duree', () => {
  assert.equal(credits.plansEstimes({ fullDuration: false, dureeSecondes: 400 }), 6);
  assert.equal(credits.plansEstimes({ fullDuration: true, dureeSecondes: 205 }), 26);
  assert.equal(credits.plansEstimes({ fullDuration: true }), 30);
  assert.equal(credits.plansEstimes({ fullDuration: true, dureeSecondes: 99999 }), 45, 'plafonne');
});

test('reserver refuse sans debiter quand le solde ne suffit pas', async () => {
  const m = credits.creerMagasinMemoire();
  const r = await credits.reserver(m, { userId: 'u1', credits: 16, ref: 'clip:a' });
  assert.equal(r.ok, false);
  assert.equal(r.solde, 0);
  assert.equal(m.lignes.length, 0, 'aucune ligne ecrite');
});

test('un achat ou un remboursement rejoue ne credite jamais deux fois', async () => {
  const m = credits.creerMagasinMemoire();
  await credits.crediter(m, { userId: 'u1', credits: 100, ref: 'stripe:cs_1', reason: 'achat' });
  const bis = await credits.crediter(m, { userId: 'u1', credits: 100, ref: 'stripe:cs_1', reason: 'achat' });
  assert.equal(bis.insere, false);
  assert.equal(await m.solde('u1'), 100);
});

test('deux clips lances en meme temps ne depensent pas deux fois le meme solde', async () => {
  const m = credits.creerMagasinMemoire();
  await credits.crediter(m, { userId: 'u1', credits: 20, ref: 'stripe:cs_2', reason: 'achat' });
  const [a, b] = await Promise.all([
    credits.reserver(m, { userId: 'u1', credits: 16, ref: 'clip:x' }),
    credits.reserver(m, { userId: 'u1', credits: 16, ref: 'clip:y' }),
  ]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(await m.solde('u1'), 4);
});

test('on ne facture que les plans livres : echec rembourse, partiel au prorata', () => {
  const reservation = { credits: 16 };
  assert.equal(credits.aRembourser(reservation, 0, ENV_DEFAUT), 16);
  assert.equal(credits.aRembourser(reservation, 5, ENV_DEFAUT), 16 - credits.creditsPourPlans(5, ENV_DEFAUT));
  assert.equal(credits.aRembourser(reservation, 6, ENV_DEFAUT), 0);
  assert.equal(credits.aRembourser(reservation, 40, ENV_DEFAUT), 0, 'jamais de debit au-dela de la reservation');
});

test('une session Stripe ne credite que si pack, paiement et montant concordent', () => {
  const base = { id: 'cs_9', payment_status: 'paid', amount_total: 1000, metadata: { kind: 'clip_credits', pack: 'decouverte', userId: 'u7' } };
  assert.deepEqual(credits.creditDepuisSessionStripe(base), { userId: 'u7', credits: 100, ref: 'stripe:cs_9', reason: 'achat_pack_decouverte' });
  assert.equal(credits.creditDepuisSessionStripe({ ...base, payment_status: 'unpaid' }), null);
  assert.equal(credits.creditDepuisSessionStripe({ ...base, amount_total: 1 }), null, 'montant modifie');
  assert.equal(credits.creditDepuisSessionStripe({ ...base, metadata: { ...base.metadata, pack: 'gratuit' } }), null);
  assert.equal(credits.creditDepuisSessionStripe({ ...base, metadata: { kind: 'clip' } }), null, 'un autre produit');
});

test('l adresse de retour d un achat reste sur funesterie.me', () => {
  const { adresseRetourCredits } = require('../lib/stripe-service.cjs');
  assert.equal(adresseRetourCredits('https://nossen.funesterie.me/page?x=1'), 'https://nossen.funesterie.me/page');
  assert.equal(adresseRetourCredits('https://evil.example/funesterie.me'), null);
  assert.equal(adresseRetourCredits('http://nossen.funesterie.me/'), null, 'https seulement');
  assert.equal(adresseRetourCredits('https://funesterie.me.evil.example/'), null);
});

// --- Route /start, de bout en bout, avec un registre en memoire ---------------

async function avecServeur({ admin, palier = null }, travail) {
  const express = require('express');
  const { createClipRouter } = require('../src/clips/clip-router.cjs');
  const magasin = credits.creerMagasinMemoire();
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'u1', email: 'fan@example.com', isAdmin: admin }; next(); });
  app.use('/clip', createClipRouter({
    magasinCredits: magasin,
    palierUtilisateur: async () => palier,
    isAdminRequest: (req) => req.user.isAdmin === true,
    generateClipImpl: async () => ({ segments: 2, url: '/x.mp4', filename: 'x.mp4' }),
  }));
  const serveur = app.listen(0);
  await new Promise((ok) => serveur.once('listening', ok));
  const base = `http://127.0.0.1:${serveur.address().port}/clip`;
  try { await travail({ base, magasin }); } finally { serveur.close(); }
}

const post = (url, corps) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });

async function attendre(condition) {
  for (let i = 0; i < 100; i += 1) {
    if (await condition()) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

test('un non-admin sans credits recoit 402, rien n est lance', async () => {
  await avecServeur({ admin: false }, async ({ base }) => {
    const r = await post(`${base}/start`, { songUrl: 'https://example.com/a.mp3', title: 'T' });
    assert.equal(r.status, 402);
    const d = await r.json();
    assert.equal(d.error, 'CREDITS_INSUFFISANTS');
    assert.equal(d.requis, 16);
  });
});

test('un non-admin paie les plans livres et recupere le reste', async () => {
  await avecServeur({ admin: false }, async ({ base, magasin }) => {
    await credits.crediter(magasin, { userId: 'u1', credits: 100, ref: 'stripe:t', reason: 'achat' });
    const r = await post(`${base}/start`, { songUrl: 'https://example.com/a.mp3', title: 'T' });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.credits.reserves, 16);
    // 2 plans livres sur 6 : on garde le prix de 2 plans, le reste revient.
    const attendu = 100 - credits.creditsPourPlans(2);
    assert.ok(await attendre(async () => (await magasin.solde('u1')) === attendu), 'remboursement des plans non livres');
  });
});

test('un admin lance gratuitement', async () => {
  await avecServeur({ admin: true }, async ({ base, magasin }) => {
    const r = await post(`${base}/start`, { songUrl: 'https://example.com/a.mp3', title: 'T', fullDuration: true });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.credits, undefined);
    assert.equal(magasin.lignes.length, 0);
    const c = await (await fetch(`${base}/credits`)).json();
    assert.equal(c.admin, true);
  });
});

test('Fondateur : 50 credits clip par mois, verses une seule fois ; Premium : aucun', async () => {
  const m = credits.creerMagasinMemoire();
  const palier = { subscription_plan: 'founder', subscription_active: true, subscription_end_date: null };
  assert.equal(credits.estFondateurActif(palier), true);
  assert.equal(credits.estFondateurActif({ ...palier, subscription_active: false }), false);
  assert.equal(credits.estFondateurActif({ subscription_plan: 'premium', subscription_active: true }), false, 'Premium renfloue Suno, pas Comfy');
  assert.equal(credits.estFondateurActif({ ...palier, subscription_end_date: '2000-01-01' }), false, 'abonnement expire');
  const sept = new Date('2026-09-12T10:00:00Z');
  await credits.attribuerMoisFondateur(m, { userId: 'f1', maintenant: sept, env: {} });
  await credits.attribuerMoisFondateur(m, { userId: 'f1', maintenant: sept, env: {} });
  assert.equal(await m.solde('f1'), 50);
  await credits.attribuerMoisFondateur(m, { userId: 'f1', maintenant: new Date('2026-10-01T00:00:00Z'), env: {} });
  assert.equal(await m.solde('f1'), 100, 'nouveau mois, nouvelle mensualite');
});

test('un Fondateur voit sa mensualite et lance son clip sans achat', async () => {
  await avecServeur({ admin: false, palier: { subscription_plan: 'founder', subscription_active: true } }, async ({ base }) => {
    const c = await (await fetch(`${base}/credits`)).json();
    assert.equal(c.solde, 50);
    assert.equal(c.tarif.fondateurParMois, 50);
    const r = await post(`${base}/start`, { songUrl: 'https://example.com/a.mp3', title: 'T' });
    assert.equal(r.status, 200);
  });
});
