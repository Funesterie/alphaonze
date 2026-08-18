'use strict';

/**
 * Le paywall clips ne doit plus jamais tendre une adresse Stripe.
 *
 * Un Payment Link `buy.stripe.com/...` est permanent et public. Le garde le
 * servait a chaque hotlink, c'est-a-dire en priorite a ceux qui aspirent les
 * clips; une fois l'URL dans la nature, elle reste exploitable jusqu'a une
 * revocation manuelle dans Stripe. Ces tests verrouillent le demantelement:
 * seule une page funesterie.me est acceptee, et une URL Stripe remise dans la
 * variable d'environnement doit degrader vers un refus, pas vers une caisse.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSharinganClipsGuard,
  estLienAtterrissageValide,
  isRipper,
} = require('../src/clips/sharingan-clips-guard.cjs');

function fakeReq(overrides = {}) {
  return { headers: {}, cookies: {}, ip: '203.0.113.7', ...overrides };
}

function fakeRes() {
  const res = { statusCode: null, redirectedTo: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.payload = body; return res; };
  res.redirect = (_code, url) => { res.redirectedTo = url; return res; };
  res.sendFile = () => res;
  return res;
}

test('une page funesterie.me est acceptee comme atterrissage', () => {
  assert.equal(estLienAtterrissageValide('https://funesterie.me/'), true);
  assert.equal(estLienAtterrissageValide('https://a11.funesterie.me/clips'), true);
});

test('aucune adresse Stripe ne peut servir d atterrissage', () => {
  assert.equal(estLienAtterrissageValide('https://buy.stripe.com/4gMfZh2Ya1zO4Bl5ec7Re06'), false);
  assert.equal(estLienAtterrissageValide('https://checkout.stripe.com/c/pay/cs_live_abc'), false);
  assert.equal(estLienAtterrissageValide('https://funesterie.me.stripe.com/x'), false);
  assert.equal(estLienAtterrissageValide('https://funesterie.me/?next=https://buy.stripe.com/x'), false);
});

test('un domaine tiers ou du http nu est refuse', () => {
  assert.equal(estLienAtterrissageValide('https://funesterie.evil.tld/'), false);
  assert.equal(estLienAtterrissageValide('http://funesterie.me/'), false);
  assert.equal(estLienAtterrissageValide(''), false);
});

test('un hotlink externe part chez nous, pas chez Stripe', () => {
  const guard = createSharinganClipsGuard({ landingUrl: 'https://funesterie.me/' });
  const res = fakeRes();
  guard(fakeReq({ headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://ailleurs.tld/' } }), res, () => {
    assert.fail('le hotlink externe ne doit pas passer');
  });
  assert.equal(res.redirectedTo, 'https://funesterie.me/');
});

test('une URL Stripe en configuration degrade en 402, jamais en caisse', () => {
  const guard = createSharinganClipsGuard({ landingUrl: 'https://buy.stripe.com/4gMfZh2Ya1zO4Bl5ec7Re06' });
  const res = fakeRes();
  guard(fakeReq({ headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://ailleurs.tld/' } }), res, () => {
    assert.fail('le hotlink externe ne doit pas passer');
  });
  assert.equal(res.redirectedTo, null);
  assert.equal(res.statusCode, 402);
  assert.equal(res.payload?.error, 'payment_required');
});

test('le lecteur du site et les services internes passent toujours', () => {
  const guard = createSharinganClipsGuard({ landingUrl: 'https://funesterie.me/' });

  let passe = false;
  guard(fakeReq({ headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://funesterie.me/vivy' } }), fakeRes(), () => { passe = true; });
  assert.equal(passe, true, 'le lecteur de notre propre page doit passer');

  passe = false;
  guard(fakeReq({ internalService: true }), fakeRes(), () => { passe = true; });
  assert.equal(passe, true, 'un service interne doit passer');
});

test('les aspirateurs restent detectes', () => {
  assert.equal(isRipper(fakeReq({ headers: { 'user-agent': 'yt-dlp/2024.03.10' } })), true);
  assert.equal(isRipper(fakeReq({ headers: { 'user-agent': 'Mozilla/5.0' } })), false);
});
