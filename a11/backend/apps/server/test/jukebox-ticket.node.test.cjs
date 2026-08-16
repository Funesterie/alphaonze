'use strict';

const test = require('node:test');
const assert = require('node:assert');

const t = require('../src/clips/jukebox-ticket.cjs');

const SECRET = 'secret-de-test-suffisamment-long-1234';
const ENV = { JUKEBOX_TICKET_SECRET: SECRET };

function emettre(extra = {}) {
  return t.emettreTicket({ clipId: 'nossen-001.mp4', viewerId: 'drive:djeff', ...extra }, ENV);
}

test('un ticket frais est valide pour son clip', () => {
  const v = t.verifierTicket(emettre(), { clipId: 'nossen-001.mp4' }, ENV);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.viewerId, 'drive:djeff');
});

test('un ticket ne vaut pas pour un autre clip', () => {
  const v = t.verifierTicket(emettre(), { clipId: 'nossen-002.mp4' }, ENV);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.raison, 'autre_clip');
});

test('un ticket expire ne joue plus', () => {
  const ticket = emettre({ ttlSeconds: 30 });
  const plusTard = Date.now() + 31 * 1000;
  const v = t.verifierTicket(ticket, { clipId: 'nossen-001.mp4', now: plusTard }, ENV);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.raison, 'expire');
});

test('une charge modifiee est rejetee', () => {
  const ticket = emettre();
  const [charge, signature] = ticket.split('.');
  const donnees = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
  donnees.v = 'drive:pirate';
  const truquee = Buffer.from(JSON.stringify(donnees)).toString('base64url');
  const v = t.verifierTicket(`${truquee}.${signature}`, { clipId: 'nossen-001.mp4' }, ENV);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.raison, 'signature_invalide');
});

test('un ticket signe avec un autre secret est rejete', () => {
  const autre = t.emettreTicket(
    { clipId: 'nossen-001.mp4', viewerId: 'drive:pirate' },
    { JUKEBOX_TICKET_SECRET: 'un-autre-secret-tout-aussi-long-99' }
  );
  const v = t.verifierTicket(autre, { clipId: 'nossen-001.mp4' }, ENV);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.raison, 'signature_invalide');
});

test('un ticket anonyme est refuse a l emission', () => {
  // Sans spectateur, le filigrane ne designe personne : le ticket ne sert plus
  // qu'a ouvrir la porte, ce qui est exactement ce qu'on veut eviter.
  assert.throws(() => t.emettreTicket({ clipId: 'x.mp4', viewerId: '' }, ENV), /viewerId requis/);
});

test('aucun secret par defaut', () => {
  assert.throws(
    () => t.emettreTicket({ clipId: 'x.mp4', viewerId: 'drive:a' }, {}),
    /JUKEBOX_TICKET_SECRET/
  );
});

test('un secret trop court est refuse', () => {
  assert.throws(
    () => t.emettreTicket({ clipId: 'x.mp4', viewerId: 'drive:a' }, { JUKEBOX_TICKET_SECRET: 'court' }),
    /16 caracteres/
  );
});

test('une entree malformee ne leve jamais', () => {
  for (const mauvais of ['', 'nimportequoi', '.', 'a.b', 'x'.repeat(900), null, undefined, 42]) {
    const v = t.verifierTicket(mauvais, { clipId: 'x.mp4' }, ENV);
    assert.strictEqual(v.ok, false, `a accepte : ${String(mauvais).slice(0, 20)}`);
    assert.ok(v.raison, 'raison manquante');
  }
});

test('le TTL est borne', () => {
  const trop = t.verifierTicket(emettre({ ttlSeconds: 99999 }), { clipId: 'nossen-001.mp4' }, ENV);
  const dansUneHeureEtDemie = Date.now() + 90 * 60 * 1000;
  assert.strictEqual(trop.ok, true);
  const apres = t.verifierTicket(
    emettre({ ttlSeconds: 99999 }),
    { clipId: 'nossen-001.mp4', now: dansUneHeureEtDemie },
    ENV
  );
  assert.strictEqual(apres.ok, false, 'le TTL max de 1 h n a pas ete applique');
});

test('deux tickets du meme spectateur tracent deux lectures distinctes', () => {
  const a = t.verifierTicket(emettre(), { clipId: 'nossen-001.mp4' }, ENV);
  const b = t.verifierTicket(emettre(), { clipId: 'nossen-001.mp4' }, ENV);
  assert.notStrictEqual(a.nonce, b.nonce);
  assert.notStrictEqual(t.marqueDeLecture(a), t.marqueDeLecture(b));
});

test('la marque de lecture nomme le spectateur', () => {
  const v = t.verifierTicket(emettre(), { clipId: 'nossen-001.mp4' }, ENV);
  const marque = t.marqueDeLecture(v);
  assert.match(marque, /NOSSEN/);
  assert.match(marque, /drive:djeff/);
});

test('pas de marque sans ticket valide', () => {
  assert.strictEqual(t.marqueDeLecture({ ok: false }), '');
  assert.strictEqual(t.marqueDeLecture(null), '');
});
