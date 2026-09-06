'use strict';

/**
 * Le passeur du Jukebox NUMA.
 *
 * Ce qui est protégé ici, par ordre de gravité si ça cède:
 *
 *   1. le jeton OAuth ne doit JAMAIS sortir du module — ni rendu, ni passé à
 *      l'appelant, ni tracé. C'est la raison d'être du passeur;
 *   2. Cerbère décide AVANT la forge: on ne fabrique pas un droit avant de savoir
 *      s'il est dû;
 *   3. une pièce ne vaut que pour sa zone, son disque et son action;
 *   4. la trace BLOOP ne contient jamais de clé.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createJukebox, listCassettes } = require('../src/security/jukebox-numa.cjs');

const SECRET = 'secret-de-test-jukebox-de-plus-de-32-octets';
const ENV = { JUKEBOX_CAPABILITY_SECRET: SECRET, JUKEBOX_AUDIENCE: 'a11-backend' };
const JETON = 'JETON-OAUTH-QUI-NE-DOIT-JAMAIS-SORTIR';

const SESSION_OK = {
  session: { authenticated: true },
  permissions: { admin: true, family: true },
};
const SESSION_ANONYME = { session: { authenticated: false }, permissions: {} };

function coffreFactice() {
  return { getSessionProviderTokens: async () => ({ accessToken: JETON }) };
}

function demande(zone = '/Vivy/Productions', action = 'write', drive = 'perso') {
  return { agent: 'vivy', drive, zone, action };
}

test('les cassettes sont explicites et déterministes', () => {
  const noms = listCassettes().map((c) => c.drive).sort();
  assert.deepEqual(noms, ['entra', 'google', 'k44', 'perso']);
});

test('une cassette app-only sans driveId configuré refuse au lieu d appeler /me', () => {
  // Un jeton applicatif n'a pas de /me. Sans driveId, il n'y a aucune URL valide
  // a construire: mieux vaut le dire que d'envoyer une requete qui rendra 400.
  const { CASSETTES } = require('../src/security/jukebox-numa.cjs');
  assert.equal(CASSETTES.entra.auth, 'application');
  assert.equal(CASSETTES.entra.base({}), '', 'sans JUKEBOX_ENTRA_DRIVE_ID, aucune racine');
  assert.match(CASSETTES.entra.base({ JUKEBOX_ENTRA_DRIVE_ID: 'b!abc' }), /\/drives\/b!abc\/root:$/);
  // Et surtout: jamais /me sur une cassette applicative.
  assert.ok(!CASSETTES.entra.base({ JUKEBOX_ENTRA_DRIVE_ID: 'b!abc' }).includes('/me/'));
  assert.ok(!CASSETTES.k44.base({ JUKEBOX_K44_DRIVE_ID: 'b!k44' }).includes('/me/'));
});

test('les cassettes déléguées gardent /me, qui est correct pour un jeton de session', () => {
  const { CASSETTES } = require('../src/security/jukebox-numa.cjs');
  assert.equal(CASSETTES.perso.auth, 'delegated');
  assert.match(CASSETTES.perso.base({}), /\/me\/drive\/root:$/);
});

test('k44 est réservé mais inerte tant que son driveId n est pas posé', async () => {
  // Compartiment prévu pour séparer les rôles plus tard. Il ne doit surtout pas
  // retomber silencieusement sur le disque d'à côté.
  const jukebox = createJukebox({ vault: coffreFactice(), env: ENV });
  const { coin } = await jukebox.requestCoin(demande('/K44/Docs', 'write', 'k44'), { cerbereState: SESSION_OK });
  const sortie = await jukebox.withDrive(coin, { drive: 'k44', zone: '/K44/Docs', action: 'write' }, async () => 'x');
  assert.equal(sortie.ok, false);
  assert.equal(sortie.error, 'jukebox_drive_not_configured');
});

test('Cerbère décide avant la forge: pas de session, pas de pièce', async () => {
  const traces = [];
  const jukebox = createJukebox({ vault: coffreFactice(), trace: (t) => traces.push(t), env: ENV });
  const r = await jukebox.requestCoin(demande(), { cerbereState: SESSION_ANONYME });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'session_required');
  assert.ok(!r.coin, 'aucune pièce ne doit être forgée sur un refus');
  assert.equal(traces[0].event, 'capability.denied');
});

test('sans secret configuré, le passeur refuse au lieu de signer avec du vide', async () => {
  const jukebox = createJukebox({ vault: coffreFactice(), env: {} });
  const r = await jukebox.requestCoin(demande(), { cerbereState: SESSION_OK });
  assert.equal(r.error, 'jukebox_secret_missing');
});

test('une cassette ou une action inconnue est refusée', async () => {
  const jukebox = createJukebox({ vault: coffreFactice(), env: ENV });
  assert.equal((await jukebox.requestCoin(demande('/x', 'write', 'dropbox'), { cerbereState: SESSION_OK })).error, 'jukebox_unknown_drive');
  assert.equal((await jukebox.requestCoin(demande('/x', 'delete'), { cerbereState: SESSION_OK })).error, 'jukebox_unknown_action');
});

test('une zone qui tente de s échapper est refusée à la demande', async () => {
  const jukebox = createJukebox({ vault: coffreFactice(), env: ENV });
  const r = await jukebox.requestCoin(demande('/Vivy/../../etc'), { cerbereState: SESSION_OK });
  assert.equal(r.ok, false);
  assert.match(r.error, /ZONE_INVALID/);
});

test('le jeton ne sort jamais: withDrive prête un appel, pas une clé', async () => {
  const appelsVus = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    appelsVus.push({ url, autorisation: init?.headers?.authorization });
    return { ok: true, status: 200 };
  };
  try {
    const traces = [];
    const jukebox = createJukebox({ vault: coffreFactice(), trace: (t) => traces.push(t), env: ENV });
    const { coin } = await jukebox.requestCoin(demande(), { cerbereState: SESSION_OK });

    let recu = null;
    const sortie = await jukebox.withDrive(coin, { drive: 'perso', zone: '/Vivy/Productions', action: 'write' },
      async (contexte) => { recu = contexte; return 'fait'; });

    assert.equal(sortie.ok, true);
    assert.equal(sortie.result, 'fait');
    // Le contexte prêté ne contient que de quoi appeler, jamais la clé.
    assert.deepEqual(Object.keys(recu).sort(), ['appeler', 'drive', 'zone']);
    const texte = JSON.stringify({ sortie, traces, cles: Object.keys(recu) });
    assert.ok(!texte.includes(JETON), 'le jeton ne doit apparaitre nulle part');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('l appel prêté est bien préfixé par la zone, et porte le jeton lui-même', async () => {
  const appelsVus = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    appelsVus.push({ url, autorisation: init?.headers?.authorization });
    return { ok: true, status: 200 };
  };
  try {
    const jukebox = createJukebox({ vault: coffreFactice(), env: ENV });
    const { coin } = await jukebox.requestCoin(demande(), { cerbereState: SESSION_OK });
    await jukebox.withDrive(coin, { drive: 'perso', zone: '/Vivy/Productions', action: 'write' },
      async ({ appeler }) => { await appeler('master.wav', { method: 'PUT' }); });

    assert.equal(appelsVus.length, 1);
    assert.match(appelsVus[0].url, /\/me\/drive\/root:\/Vivy\/Productions\/master\.wav$/);
    assert.equal(appelsVus[0].autorisation, `Bearer ${JETON}`);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('l appel prêté refuse lui aussi de sortir de la zone', async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const jukebox = createJukebox({ vault: coffreFactice(), env: ENV });
    const { coin } = await jukebox.requestCoin(demande(), { cerbereState: SESSION_OK });
    const sortie = await jukebox.withDrive(coin, { drive: 'perso', zone: '/Vivy/Productions', action: 'write' },
      async ({ appeler }) => { await appeler('../../secret.txt'); });
    // La pièce ne protège que ce qu'on lui déclare: le chemin relatif doit être
    // vérifié une seconde fois, au moment de l'appel.
    assert.equal(sortie.ok, false);
    assert.equal(sortie.error, 'jukebox_path_escape');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('une pièce ne vaut pas pour une autre zone, même signée', async () => {
  const jukebox = createJukebox({ vault: coffreFactice(), env: ENV });
  const { coin } = await jukebox.requestCoin(demande(), { cerbereState: SESSION_OK });
  const sortie = await jukebox.withDrive(coin, { drive: 'perso', zone: '/Vivy/Secret', action: 'write' },
    async () => 'ne devrait pas arriver');
  assert.equal(sortie.ok, false);
  assert.equal(sortie.error, 'SCENTGATE_CAPABILITY_ZONE_OUTSIDE');
});

test('un coffre vide se dit, au lieu d appeler sans clé', async () => {
  const jukebox = createJukebox({ vault: { getSessionProviderTokens: async () => ({}) }, env: ENV });
  const { coin } = await jukebox.requestCoin(demande(), { cerbereState: SESSION_OK });
  const sortie = await jukebox.withDrive(coin, { drive: 'perso', zone: '/Vivy/Productions', action: 'write' }, async () => 'x');
  assert.equal(sortie.error, 'jukebox_no_credential');
});

test('une trace BLOOP qui casse ne bloque ni n autorise rien', async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const jukebox = createJukebox({
      vault: coffreFactice(),
      trace: () => { throw new Error('bloop indisponible'); },
      env: ENV,
    });
    const r = await jukebox.requestCoin(demande(), { cerbereState: SESSION_OK });
    assert.equal(r.ok, true, 'une trace cassee ne doit pas empecher la forge');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
