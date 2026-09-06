import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createScentGateCapability,
  verifyScentGateCapability,
  SCENT_GATE_CAPABILITY_ACTIONS
} from '../index.js';

/**
 * La pièce du Jukebox NUMA. Ce qui est protégé ici, dans l'ordre de gravité:
 *
 *   1. la zone ne doit jamais pouvoir s'échapper (traversée de chemin);
 *   2. une signature valide n'autorise pas tout: la demande doit tenir DANS la pièce;
 *   3. pas de hiérarchie devinée entre actions;
 *   4. pas de rejeu, et pas de nonce brûlé par un refus.
 *
 * Règle d'acier rappelée par Djeff: le casse-tête NUMA n'est pas la serrure. Ici on
 * teste la serrure.
 */

const SECRET = 'un-secret-de-test-de-plus-de-32-octets-pour-hmac';
const BASE = {
  agent: 'vivy',
  drive: 'perso',
  zone: '/Vivy/Productions',
  action: 'write',
  issuer: 'jukebox',
  audience: 'a11-backend'
};

test('une pièce bien formée se vérifie et porte ce qu on lui a demandé', () => {
  const piece = createScentGateCapability(BASE, { secret: SECRET });
  assert.equal(piece.payload.schema, 'nossen.scentgate.capability.v1');
  assert.equal(piece.payload.zone, '/Vivy/Productions');
  assert.ok(piece.payload.nonce);
  // Aucun secret ne doit jamais entrer dans l'enveloppe.
  const texte = JSON.stringify(piece);
  assert.ok(!texte.includes(SECRET));

  const verdict = verifyScentGateCapability(piece, { secret: SECRET, expectedAudience: 'a11-backend' });
  assert.equal(verdict.ok, true);
});

test('la traversée de chemin est refusée à la forge, pas nettoyée', () => {
  for (const zone of ['/Vivy/../..', '/Vivy/Productions/../../Secret', '..', '/..%2f', '/Vivy/./x']) {
    assert.throws(
      () => createScentGateCapability({ ...BASE, zone }, { secret: SECRET }),
      (error) => /^SCENTGATE_CAPABILITY_ZONE_(INVALID|TOO_BROAD|MISSING)$/.test(error.code || ''),
      `zone acceptée à tort: ${zone}`
    );
  }
});

test('la racine du disque n est pas une zone délivrable', () => {
  // Une pièce pour « / » donnerait tout le disque: ce n'est plus une capacité.
  for (const zone of ['/', '//', '   /   ']) {
    assert.throws(
      () => createScentGateCapability({ ...BASE, zone }, { secret: SECRET }),
      (error) => /^SCENTGATE_CAPABILITY_ZONE_(TOO_BROAD|MISSING)$/.test(error.code || ''),
      `racine acceptée à tort: ${JSON.stringify(zone)}`
    );
  }
});

test('une demande hors de la zone accordée est refusée malgré une signature valide', () => {
  const piece = createScentGateCapability(BASE, { secret: SECRET });
  const verdict = verifyScentGateCapability(piece, {
    secret: SECRET,
    requested: { drive: 'perso', zone: '/Vivy/Secret', action: 'write' }
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.error, 'SCENTGATE_CAPABILITY_ZONE_OUTSIDE');
});

test('un préfixe de nom voisin ne passe pas pour une sous-zone', () => {
  // /Vivy/Prod ne doit PAS autoriser /Vivy/Production: sans la barre oblique
  // finale, une simple comparaison de préfixe ouvrirait le dossier d'à côté.
  const piece = createScentGateCapability({ ...BASE, zone: '/Vivy/Prod' }, { secret: SECRET });
  const verdict = verifyScentGateCapability(piece, {
    secret: SECRET,
    requested: { drive: 'perso', zone: '/Vivy/Production', action: 'write' }
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.error, 'SCENTGATE_CAPABILITY_ZONE_OUTSIDE');
});

test('une sous-zone légitime est acceptée', () => {
  const piece = createScentGateCapability(BASE, { secret: SECRET });
  const verdict = verifyScentGateCapability(piece, {
    secret: SECRET,
    requested: { drive: 'perso', zone: '/Vivy/Productions/album-1/master.wav', action: 'write' }
  });
  assert.equal(verdict.ok, true);
});

test('changer de disque avec la même pièce est refusé', () => {
  const piece = createScentGateCapability(BASE, { secret: SECRET });
  const verdict = verifyScentGateCapability(piece, {
    secret: SECRET,
    requested: { drive: 'entra', zone: '/Vivy/Productions', action: 'write' }
  });
  assert.equal(verdict.error, 'SCENTGATE_CAPABILITY_DRIVE_MISMATCH');
});

test('aucune hiérarchie n est devinée entre les actions', () => {
  // Une pièce « write » n'autorise pas « read » et réciproquement. Une échelle
  // implicite est une échelle qu'on escalade.
  const piece = createScentGateCapability(BASE, { secret: SECRET });
  const verdict = verifyScentGateCapability(piece, {
    secret: SECRET,
    requested: { drive: 'perso', zone: '/Vivy/Productions', action: 'read' }
  });
  assert.equal(verdict.error, 'SCENTGATE_CAPABILITY_ACTION_MISMATCH');
  assert.ok(!SCENT_GATE_CAPABILITY_ACTIONS.includes('delete'), 'supprimer ne doit pas etre delivrable');
});

test('une signature falsifiée est rejetée', () => {
  const piece = createScentGateCapability(BASE, { secret: SECRET });
  piece.payload.zone = '/Vivy/Secret';
  const verdict = verifyScentGateCapability(piece, { secret: SECRET });
  assert.equal(verdict.error, 'SCENTGATE_CAPABILITY_SIGNATURE_INVALID');
});

test('une pièce expirée ne vaut plus rien', () => {
  const piece = createScentGateCapability({ ...BASE, ttlSeconds: 15 }, { secret: SECRET, now: 1000 });
  const verdict = verifyScentGateCapability(piece, { secret: SECRET, now: 1000 + 16000 });
  assert.equal(verdict.error, 'SCENTGATE_CAPABILITY_EXPIRED');
});

test('le rejeu est refusé, mais un refus ne brûle pas le nonce', () => {
  const vus = new Set();
  const piece = createScentGateCapability(BASE, { secret: SECRET });

  // Un premier essai hors zone échoue: le nonce doit rester utilisable ensuite,
  // sinon une demande malformée suffirait à annuler une pièce légitime.
  const horsZone = verifyScentGateCapability(piece, {
    secret: SECRET, seenNonces: vus,
    requested: { drive: 'perso', zone: '/Ailleurs', action: 'write' }
  });
  assert.equal(horsZone.ok, false);
  assert.equal(vus.size, 0, 'un refus ne doit pas consommer le nonce');

  const bon = verifyScentGateCapability(piece, {
    secret: SECRET, seenNonces: vus,
    requested: { drive: 'perso', zone: '/Vivy/Productions', action: 'write' }
  });
  assert.equal(bon.ok, true);
  assert.equal(vus.size, 1);

  const rejeu = verifyScentGateCapability(piece, {
    secret: SECRET, seenNonces: vus,
    requested: { drive: 'perso', zone: '/Vivy/Productions', action: 'write' }
  });
  assert.equal(rejeu.error, 'SCENTGATE_CAPABILITY_REPLAYED');
});

test('un secret faible est refusé, comme pour les signaux', () => {
  assert.throws(
    () => createScentGateCapability(BASE, { secret: 'trop-court' }),
    (error) => error.code === 'SCENTGATE_SIGNAL_SECRET_WEAK'
  );
});
