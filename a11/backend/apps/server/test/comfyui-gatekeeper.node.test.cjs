const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  CHEMINS_AUTORISES,
  cheminAutorise,
  createGatekeeper,
  jetonValide,
} = require('../src/video/comfyui-gatekeeper.cjs');

const JETON = 'jeton-de-test-suffisamment-long-1234';

// Faux ComfyUI en amont, pour verifier ce qui passe et ce qui est arrete.
function amontFactice() {
  const vues = [];
  const s = http.createServer((req, res) => {
    vues.push({ url: req.url, methode: req.method });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  return { serveur: s, vues };
}

function requete(port, chemin, { methode = 'GET', jeton = JETON } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: chemin, method: methode,
        headers: jeton ? { authorization: `Bearer ${jeton}` } : {} },
      (res) => {
        let corps = '';
        res.on('data', (c) => { corps += c; });
        res.on('end', () => resolve({ statut: res.statusCode, corps }));
      }
    );
    req.on('error', () => resolve({ statut: 0, corps: '' }));
    req.end();
  });
}

test('refuse de demarrer sans jeton, ou avec un jeton trop court', () => {
  assert.throws(() => createGatekeeper({ env: {}, token: '' }), /COMFYUI_TUNNEL_TOKEN/);
  assert.throws(() => createGatekeeper({ env: {}, token: 'court' }), /24 signes/);
});

test('la comparaison de jeton est a temps constant et refuse les longueurs differentes', () => {
  assert.equal(jetonValide(JETON, JETON), true);
  assert.equal(jetonValide(`${JETON}x`, JETON), false);
  assert.equal(jetonValide('', ''), false);
  assert.equal(jetonValide(null, JETON), false);
});

test('la liste blanche laisse passer le strict necessaire', () => {
  assert.ok(cheminAutorise('POST', '/prompt'));
  assert.ok(cheminAutorise('GET', '/system_stats'));
  assert.ok(cheminAutorise('GET', '/history/abc-123'));
  assert.ok(cheminAutorise('GET', '/view?filename=a.mp3&type=output'));
  assert.ok(cheminAutorise('GET', '/object_info'));
  assert.ok(cheminAutorise('POST', '/upload/image'));
});

test('et bloque tout le reste — c est la raison d etre du portier', () => {
  // /userdata lit et ecrit des fichiers ; l'interface donne acces a tout.
  assert.equal(cheminAutorise('GET', '/userdata/quelquechose'), false);
  assert.equal(cheminAutorise('POST', '/userdata/x'), false);
  assert.equal(cheminAutorise('GET', '/'), false);
  assert.equal(cheminAutorise('GET', '/internal/logs/raw'), false);
  assert.equal(cheminAutorise('POST', '/interrupt'), false);
  assert.equal(cheminAutorise('POST', '/free'), false);
  // Bonne methode, mauvais verbe.
  assert.equal(cheminAutorise('GET', '/prompt'), false);
  assert.equal(cheminAutorise('DELETE', '/history/abc'), false);
});

test('bout en bout : sans jeton on est refuse, avec on passe', async () => {
  const amont = amontFactice();
  await new Promise((r) => amont.serveur.listen(0, '127.0.0.1', r));
  const portAmont = amont.serveur.address().port;

  const portier = createGatekeeper({ env: {}, token: JETON, target: `http://127.0.0.1:${portAmont}` });
  const port = await portier.ecouter(0);

  const sans = await requete(port, '/system_stats', { jeton: '' });
  assert.equal(sans.statut, 401);

  const mauvais = await requete(port, '/system_stats', { jeton: 'jeton-faux-mais-de-bonne-taille!!' });
  assert.equal(mauvais.statut, 401);

  const bon = await requete(port, '/system_stats');
  assert.equal(bon.statut, 200);

  const interdit = await requete(port, '/userdata/secrets');
  assert.equal(interdit.statut, 403);

  // Le point qui compte : rien d'interdit n'a atteint ComfyUI.
  assert.deepEqual(amont.vues.map((v) => v.url), ['/system_stats']);

  await portier.fermer();
  await new Promise((r) => amont.serveur.close(r));
});

test('la liste blanche reste courte — chaque ajout elargit la surface', () => {
  assert.ok(CHEMINS_AUTORISES.length <= 8, `${CHEMINS_AUTORISES.length} chemins ouverts, c est beaucoup`);
});
