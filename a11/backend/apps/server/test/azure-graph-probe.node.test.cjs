'use strict';

/**
 * La sonde Graph doit renseigner sans jamais fuir.
 *
 * Un message d'erreur Microsoft Graph contient couramment l'identifiant du
 * locataire, un nom d'utilisateur ou un identifiant de requete. La sonde ne doit
 * donc remonter que des codes — statut HTTP et code d'erreur — jamais le message,
 * jamais le jeton. C'est ce que ces tests protegent en premier.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  probeGraphCapabilities,
  formatGraphCapabilities,
} = require('../src/auth/azure-graph-probe.cjs');

const ENV = {
  AZURE_TENANT_ID: '63b5a713-0000-0000-0000-000000000000',
  AZURE_CLIENT_ID: 'fe326a74-0000-0000-0000-000000000000',
  AZURE_CLIENT_SECRET: 'secret-de-test',
};

const JETON_FACTICE = 'jeton.tres.secret.a.ne.jamais.afficher';

function fetchScenarise(parChemin) {
  return async (url) => {
    const chemin = String(url).replace('https://graph.microsoft.com/v1.0', '').split('?')[0];
    const prevu = parChemin[chemin] || { status: 200, body: { value: [] } };
    return {
      status: prevu.status,
      ok: prevu.status >= 200 && prevu.status < 300,
      json: async () => prevu.body,
    };
  };
}

test('sans configuration, la sonde le dit au lieu d essayer', async () => {
  const rapport = await probeGraphCapabilities({}, { fetchToken: async () => 'inutilise' });
  assert.equal(rapport.jeton, false);
  assert.equal(rapport.motif, 'azure_graph_not_configured');
  assert.equal(rapport.driveUtilisable, false);
});

test('un echec de jeton ne fait pas planter la sonde', async () => {
  const rapport = await probeGraphCapabilities(ENV, {
    fetchToken: async () => { throw new Error('azure_client_secret_missing'); },
  });
  assert.equal(rapport.jeton, false);
  assert.match(rapport.motif, /secret/);
});

test('un 403 sur le disque nomme la permission a accorder', async () => {
  // Le cas le plus frequent, et celui qui perd le plus de temps: la permission
  // existe dans le portail mais personne n'a donne le consentement administrateur.
  const original = globalThis.fetch;
  globalThis.fetch = fetchScenarise({
    '/organization': { status: 200, body: { value: [{ id: 'x' }] } },
    '/users': { status: 200, body: { value: [{ id: 'u' }] } },
    '/drives': { status: 403, body: { error: { code: 'Authorization_RequestDenied', message: 'Insufficient privileges pour le locataire 63b5a713' } } },
    '/sites': { status: 403, body: { error: { code: 'Authorization_RequestDenied' } } },
  });
  try {
    const rapport = await probeGraphCapabilities(ENV, { fetchToken: async () => ({ accessToken: JETON_FACTICE }) });
    assert.equal(rapport.jeton, true);
    assert.equal(rapport.driveUtilisable, false);
    const disques = rapport.capacites.find((c) => c.capacite === 'disques');
    assert.equal(disques.accorde, false);
    assert.match(disques.diagnostic, /consentement admin manquant/);
    assert.match(disques.permissionRequise, /Files\.Read\.All/);
  } finally {
    globalThis.fetch = original;
  }
});

test('le rapport ne contient jamais le jeton ni le message Graph', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fetchScenarise({
    '/drives': { status: 403, body: { error: { code: 'Authorization_RequestDenied', message: 'locataire 63b5a713 utilisateur djeff@exemple' } } },
  });
  try {
    const rapport = await probeGraphCapabilities(ENV, { fetchToken: async () => ({ accessToken: JETON_FACTICE }) });
    const texte = formatGraphCapabilities(rapport).join('\n') + JSON.stringify(rapport);
    assert.ok(!texte.includes(JETON_FACTICE), 'le jeton ne doit jamais apparaitre');
    assert.ok(!texte.includes('djeff@exemple'), 'le message Graph ne doit jamais etre recopie');
    assert.ok(!texte.includes('Insufficient privileges'), 'pas de message brut');
  } finally {
    globalThis.fetch = original;
  }
});

test('un disque joignable est annoncé comme tel', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fetchScenarise({
    '/organization': { status: 200, body: { value: [{ id: 'x' }] } },
    '/users': { status: 200, body: { value: [{ id: 'u' }] } },
    '/drives': { status: 200, body: { value: [{ id: 'd' }] } },
    '/sites': { status: 200, body: { value: [] } },
  });
  try {
    const rapport = await probeGraphCapabilities(ENV, { fetchToken: async () => ({ accessToken: JETON_FACTICE }) });
    assert.equal(rapport.driveUtilisable, true);
    assert.match(formatGraphCapabilities(rapport).join('\n'), /sans utilisateur/);
  } finally {
    globalThis.fetch = original;
  }
});
