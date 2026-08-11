const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createComfyClient,
  isComfyEnabled,
  resolveComfyBaseUrl,
  DEFAULT_BASE_URL,
} = require('../src/video/comfyui-client.cjs');

// Faux fetch : on rejoue les reponses de ComfyUI sans instance qui tourne.
function fauxFetch(routes) {
  const appels = [];
  const fn = async (url, init = {}) => {
    appels.push({ url, method: init.method || 'GET', body: init.body });
    const chemin = String(url).replace(/^https?:\/\/[^/]+/, '');
    for (const [motif, reponse] of routes) {
      if (motif.test(chemin)) {
        const r = typeof reponse === 'function' ? reponse(appels.length) : reponse;
        return {
          ok: r.ok !== false,
          status: r.status || 200,
          json: async () => r.json,
          arrayBuffer: async () => r.buffer || new ArrayBuffer(0),
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.appels = appels;
  return fn;
}

test('resout l URL de base depuis l environnement, avec un repli local', () => {
  assert.equal(resolveComfyBaseUrl({}), DEFAULT_BASE_URL);
  assert.equal(resolveComfyBaseUrl({ COMFYUI_BASE_URL: 'http://192.168.1.20:8188/' }), 'http://192.168.1.20:8188');
});

test('est actif des qu une URL est donnee, et se laisse couper explicitement', () => {
  assert.equal(isComfyEnabled({}), false);
  assert.equal(isComfyEnabled({ COMFYUI_BASE_URL: 'http://127.0.0.1:8188' }), true);
  assert.equal(isComfyEnabled({ COMFYUI_BASE_URL: 'http://127.0.0.1:8188', COMFYUI_ENABLED: 'false' }), false);
});

test('health remonte la VRAM libre — ce qui decide si un plan passe sur 12 Go', async () => {
  const client = createComfyClient({
    fetch: fauxFetch([[/\/system_stats/, {
      json: {
        system: { comfyui_version: '0.30.0' },
        devices: [{ name: 'NVIDIA GeForce RTX 5070', vram_total: 12878610432, vram_free: 11500000000 }],
      },
    }]]),
  });

  const etat = await client.health();
  assert.equal(etat.ok, true);
  assert.equal(etat.version, '0.30.0');
  assert.match(etat.gpu, /5070/);
  assert.equal(etat.vramLibre, 11500000000);
});

test('health ne jette pas quand ComfyUI est eteint', async () => {
  const client = createComfyClient({ fetch: async () => { throw new Error('ECONNREFUSED'); } });
  const etat = await client.health();
  assert.equal(etat.ok, false);
  assert.match(etat.raison, /ECONNREFUSED/);
});

test('health interrompt aussi un fetch ComfyUI bloque', async () => {
  let receivedSignal = null;
  const client = createComfyClient({
    requestTimeoutMs: 1,
    fetch: async (_url, init = {}) => new Promise((_resolve, reject) => {
      receivedSignal = init.signal;
      init.signal.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')), { once: true });
    }),
  });
  const startedAt = Date.now();
  const result = await client.health();
  assert.equal(result.ok, false);
  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
  assert.match(result.raison, /delai reseau depasse/);
  assert.ok(Date.now() - startedAt < 2_500);
});

test('listNodes filtre les noeuds — sert a decouvrir ceux de H3 au lieu de les supposer', async () => {
  const client = createComfyClient({
    fetch: fauxFetch([[/\/object_info$/, {
      json: { KSampler: {}, MiniMaxH3Sampler: {}, MiniMaxH3TextEncode: {}, SaveVideo: {} },
    }]]),
  });

  assert.deepEqual((await client.listNodes({ filtre: 'minimax' })).sort(), ['MiniMaxH3Sampler', 'MiniMaxH3TextEncode']);
  assert.equal((await client.listNodes()).length, 4);
});

test('submit refuse un graphe invalide au lieu de rendre un identifiant vide', async () => {
  const client = createComfyClient({
    fetch: fauxFetch([[/\/prompt/, { json: { error: { message: 'noeud inconnu' }, node_errors: {} } }]]),
  });

  await assert.rejects(() => client.submit({}), /a refuse le graphe.*noeud inconnu/i);
});

test('waitFor sonde jusqu au succes', async () => {
  let tour = 0;
  const client = createComfyClient({
    pollMs: 1,
    fetch: fauxFetch([[/\/history\//, () => {
      tour += 1;
      if (tour < 3) return { json: {} };
      return { json: { abc: { status: { completed: true }, outputs: { 9: { videos: [{ filename: 'plan.mp4', type: 'output' }] } } } } };
    }]]),
  });

  const r = await client.waitFor('abc');
  assert.equal(r.ok, true);
  assert.equal(client.firstOutputFile(r.outputs).filename, 'plan.mp4');
});

test('getStatus rend processing sans attendre puis done avec les sorties', async () => {
  let tour = 0;
  const client = createComfyClient({
    fetch: fauxFetch([[/\/history\//, () => {
      tour += 1;
      if (tour === 1) return { json: {} };
      return { json: { abc: { status: { completed: true }, outputs: { 9: { audio: [{ filename: 'song.mp3' }] } } } } };
    }]]),
  });

  assert.equal((await client.getStatus('abc')).state, 'processing');
  const fini = await client.getStatus('abc');
  assert.equal(fini.state, 'done');
  assert.equal(client.firstOutputFile(fini.outputs).filename, 'song.mp3');
});

test('waitFor rend la main sur erreur d execution, sans boucler', async () => {
  const client = createComfyClient({
    pollMs: 1,
    fetch: fauxFetch([[/\/history\//, {
      json: { abc: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'VRAM insuffisante' }]] } } },
    }]]),
  });

  const r = await client.waitFor('abc');
  assert.equal(r.ok, false);
  assert.match(r.raison, /VRAM insuffisante/);
});

test('waitFor abandonne au bout du delai imparti', async () => {
  let horloge = 0;
  const client = createComfyClient({
    pollMs: 1,
    timeoutMs: 50,
    now: () => { horloge += 30; return horloge; },
    fetch: fauxFetch([[/\/history\//, { json: {} }]]),
  });

  const r = await client.waitFor('abc');
  assert.equal(r.ok, false);
  assert.match(r.raison, /delai depasse/);
});

test('le jeton du portier est porte sur chaque requete', async () => {
  // Sans lui, tout appel passant par le tunnel repond 401 — et le portier a ete
  // ecrit AVANT que le client sache l envoyer. C est le genre de trou qui ne se
  // voit qu en production.
  const vus = [];
  const client = createComfyClient({
    env: { COMFYUI_TUNNEL_TOKEN: 'jeton-porte-par-le-client-1234' },
    fetch: async (url, init = {}) => {
      vus.push(init.headers || {});
      return { ok: true, status: 200, json: async () => ({ devices: [{}], system: {} }) };
    },
  });

  await client.health();
  assert.equal(vus.length, 1);
  assert.equal(vus[0].authorization, 'Bearer jeton-porte-par-le-client-1234');
});

test('sans jeton configure, aucune entete d autorisation n est ajoutee', async () => {
  // En local on parle a ComfyUI en direct : un Bearer vide vaut mieux ne pas exister.
  const vus = [];
  const client = createComfyClient({
    env: {},
    fetch: async (url, init = {}) => {
      vus.push(init.headers);
      return { ok: true, status: 200, json: async () => ({ devices: [{}], system: {} }) };
    },
  });

  await client.health();
  assert.ok(!vus[0] || !vus[0].authorization);
});

test('firstOutputFile trouve la sortie quel que soit le noeud et le type', () => {
  const client = createComfyClient({ fetch: async () => ({ ok: true, json: async () => ({}) }) });
  assert.equal(client.firstOutputFile({ 12: { images: [{ filename: 'a.png' }] } }).kind, 'images');
  assert.equal(client.firstOutputFile({ 3: {}, 7: { videos: [{ filename: 'b.mp4' }] } }).filename, 'b.mp4');
  assert.equal(client.firstOutputFile({}), null);
});
