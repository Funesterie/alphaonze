'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const serverPagePath = path.join(__dirname, '..', 'nossen-index.html');
const releasePagePath = path.join(__dirname, '..', '..', '..', '..', 'nossen-index.html');

function readPageScript(filePath = serverPagePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, `script NOSSEN absent de ${filePath}`);

  // Le rafraichissement periodique s'appelle refreshJukebox depuis le mode vitrine
  // (17/09/2026) ; il s'appelait loadSongs avant. Les deux noms restent acceptes.
  const marker = /\n  init\(\);\r?\n  setInterval\(function\(\) \{ (?:loadSongs|refreshJukebox)\(\); \}, 120000\);\r?\n/;
  assert.match(match[1], marker, 'point d injection du banc de test absent');
  return match[1].replace(marker, `
  window.__NOSSEN_TEST_HOOKS__ = {
    api: api,
    requestJson: requestJson,
    resolveHttpUrl: resolveHttpUrl,
    normalizeSongSource: normalizeSongSource,
    mapSong: mapSong,
    newestSongsFirst: newestSongsFirst,
    replaceSongs: replaceSongs,
    loadSongs: loadSongs,
    pollJob: pollJob,
    resumePolling: resumePolling,
    stopPolling: stopPolling,
    play: play,
    updateAudioProgress: updateAudioProgress,
    state: function() {
      return {
        songs: songs.slice(),
        currentIdx: currentIdx,
        activeJobId: activeJobId,
        pollInFlight: pollInFlight
      };
    }
  };
`);
}

function createClassList() {
  const names = new Set();
  return {
    add(...values) { values.forEach((value) => names.add(value)); },
    remove(...values) { values.forEach((value) => names.delete(value)); },
    toggle(value, force) {
      if (force === true) names.add(value);
      else if (force === false) names.delete(value);
      else if (names.has(value)) names.delete(value);
      else names.add(value);
      return names.has(value);
    },
    contains(value) { return names.has(value); },
  };
}

function createElement(id) {
  const listeners = new Map();
  const element = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    title: '',
    disabled: false,
    style: {},
    dataset: {},
    classList: createClassList(),
    paused: true,
    ended: false,
    readyState: 0,
    duration: Number.NaN,
    currentTime: 0,
    error: null,
    src: '',
    playImpl: null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      event.target ||= element;
      for (const listener of listeners.get(type) || []) listener.call(element, event);
    },
    load() {
      element.dispatch('loadstart');
    },
    play() {
      if (element.playImpl) return element.playImpl();
      element.paused = false;
      element.ended = false;
      element.dispatch('playing');
      return Promise.resolve();
    },
    pause() {
      element.paused = true;
      element.dispatch('pause');
    },
  };
  return element;
}

function createScheduler() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(fn, delay) {
      const id = nextId++;
      tasks.set(id, { fn, delay: Number(delay) || 0 });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    runNext() {
      const next = [...tasks.entries()].sort((a, b) => a[1].delay - b[1].delay || a[0] - b[0])[0];
      assert.ok(next, 'aucun timer a executer');
      tasks.delete(next[0]);
      next[1].fn();
      return next[1].delay;
    },
    delays() { return [...tasks.values()].map((task) => task.delay).sort((a, b) => a - b); },
    size() { return tasks.size; },
  };
}

function createSessionStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function createHarness(fetchImpl, extraGlobals = {}) {
  const scheduler = createScheduler();
  const elements = new Map();
  const ids = [
    'audio', 'bar', 'casting', 'clips', 'file-name', 'fill', 'go-clip', 'go-full',
    'import-file', 'import-url', 'list', 'msg', 'now-playing', 'player', 'player-state',
    'song', 'song-count', 'st', 'user-badge', 'vibe'
  ];
  ids.forEach((id) => elements.set(id, createElement(id)));
  elements.get('vibe').value = 'auto';
  elements.get('casting').value = 'auto';

  const playButtons = [];
  // Un vrai navigateur a addEventListener sur document et window ; la page mobile
  // s en sert des le chargement (reprise au retour de Safari iOS). Sans eux, le
  // script plantait avant la premiere assertion.
  const documentListeners = new Map();
  const document = {
    visibilityState: 'visible',
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    querySelectorAll(selector) {
      return selector === '.s .play' ? playButtons : [];
    },
  };
  const sessionStorage = createSessionStorage();
  class FakeFormData {
    constructor() { this.values = []; }
    append(name, value) { this.values.push([name, value]); }
  }

  const context = {
    AbortController,
    FormData: FakeFormData,
    Promise,
    URL,
    console,
    document,
    encodeURIComponent,
    fetch: fetchImpl,
    location: { origin: 'https://a11.funesterie.me' },
    sessionStorage,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    setInterval: scheduler.setTimeout,
    clearInterval: scheduler.clearTimeout,
  };
  const windowListeners = new Map();
  context.addEventListener = (type, listener) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(listener);
  };
  context.window = context;
  Object.assign(context, extraGlobals);
  vm.runInNewContext(readPageScript(), context, { filename: serverPagePath });

  return {
    document,
    documentListeners,
    windowListeners,
    hooks: context.__NOSSEN_TEST_HOOKS__,
    elements,
    playButtons,
    scheduler,
    sessionStorage,
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test('les deux pages NOSSEN deployables restent identiques', () => {
  assert.equal(fs.readFileSync(serverPagePath, 'utf8'), fs.readFileSync(releasePagePath, 'utf8'));
});

test('api rejette un statut HTTP JSON et borne une requete silencieuse', async () => {
  const denied = createHarness(async () => jsonResponse(401, {
    error: 'A11_JWT_Missing',
    message: 'Authentification requise',
  }));
  await assert.rejects(
    denied.hooks.api('/api/private'),
    (error) => error.status === 401 && error.code === 'A11_JWT_Missing' && /Authentification/.test(error.message)
  );

  let seenSignal;
  const silent = createHarness((_url, options) => {
    seenSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });
  const pending = silent.hooks.api('/api/silent', undefined, { timeoutMs: 5 });
  assert.equal(silent.scheduler.runNext(), 1000, 'le timeout minimal evite une valeur nulle accidentelle');
  await assert.rejects(pending, (error) => error.code === 'request_timeout');
  assert.equal(seenSignal.aborted, true);
});

test('loadSongs charge tout l historique public sans dépendre de la session et garde le tri', async () => {
  let publicSongs = [
    { title: 'Ancien', trackUrl: '/media/old.mp3', createdAt: '2026-07-01T00:00:00Z', durationSeconds: 61 },
    { title: '<img src=x onerror=alert(1)>', trackUrl: '/media/recent.mp3', createdAt: '2026-09-01T00:00:00Z', durationSeconds: 87 },
  ];
  const calls = [];
  const page = createHarness(async (url) => {
    const pathname = new URL(url).pathname;
    calls.push(pathname);
    if (pathname === '/api/nossen/my-songs') return jsonResponse(401, { error: 'A11_JWT_Missing' });
    if (pathname === '/api/vivy/stream/songs.json') return jsonResponse(200, { ok: true, songs: publicSongs });
    throw new Error(`appel inattendu: ${pathname}`);
  });

  await page.hooks.loadSongs();
  assert.deepEqual(calls, ['/api/vivy/stream/songs.json']);
  assert.equal(page.hooks.state().songs[0].audioUrl, '/media/recent.mp3');
  assert.equal(page.hooks.state().songs[0].playUrl, 'https://a11.funesterie.me/media/recent.mp3');
  assert.ok(page.elements.get('list').innerHTML.indexOf('&lt;img') < page.elements.get('list').innerHTML.indexOf('Ancien'));
  assert.doesNotMatch(page.elements.get('list').innerHTML, /<img src=x/);

  page.elements.get('song').value = '1'; // Ancien
  publicSongs = [
    ...publicSongs,
    { title: 'Encore plus recent', trackUrl: '/media/newest.mp3', createdAt: '2026-09-09T00:00:00Z' },
  ];
  await page.hooks.loadSongs();
  assert.equal(page.elements.get('song').value, '2', 'la selection survit au nouveau tri');
  assert.equal(page.hooks.state().songs[0].title, 'Encore plus recent');
});

test('les URL absolues ne sont jamais doublement prefixees', () => {
  const page = createHarness(async () => jsonResponse(200, { ok: true }));
  assert.equal(
    page.hooks.resolveHttpUrl('https://files.funesterie.me/audio/test.mp3'),
    'https://files.funesterie.me/audio/test.mp3'
  );
  assert.equal(page.hooks.normalizeSongSource('/api/mcp-bridge/play/track.mp3'), '/api/mcp-bridge/play/track.mp3');
  assert.equal(page.hooks.resolveHttpUrl('javascript:alert(1)'), '');
});

test('un ancien morceau sans audio reste visible mais ne peut pas lancer de lecture ou de clip', async () => {
  const page = createHarness(async () => jsonResponse(200, { songs: [{ title: 'Archive perdue', trackUrl: '', available: false, createdAt: '2026-06-01' }] }));
  await page.hooks.loadSongs();
  assert.equal(page.hooks.state().songs[0].available, false);
  assert.match(page.elements.get('list').innerHTML, /Audio non récupéré/);
  assert.match(page.elements.get('list').innerHTML, /data-idx="0" disabled/);
  assert.match(page.elements.get('list').innerHTML, /data-pick="0" disabled/);
  assert.match(page.elements.get('song').innerHTML, /value="0" disabled/);
});

test('la recherche filtre les chansons par initiale ou par mots, sans accents ni majuscules', async () => {
  // 13/09/2026 : plus de 800 titres, Djeff veut chercher par lettre ou par mot.
  const page = createHarness(async () => jsonResponse(200, { songs: [
    { title: 'Essence Pure Éclat', trackUrl: '/media/a.mp3', createdAt: '2026-09-13T00:00:00Z' },
    { title: 'La Batte Perce le Noir', trackUrl: '/media/b.mp3', createdAt: '2026-09-09T00:00:00Z' },
    { title: 'Djeff Est de Retour', trackUrl: '/media/c.mp3', createdAt: '2026-09-04T00:00:00Z' },
    { title: 'Éclipse Rose', trackUrl: '/media/d.mp3', createdAt: '2026-08-01T00:00:00Z' },
  ] }));
  await page.hooks.loadSongs();
  const recherche = page.elements.get('song-search');
  const taper = (texte) => { recherche.value = texte; recherche.dispatch('input'); };
  const liste = () => page.elements.get('list').innerHTML;

  taper('e');
  assert.equal(page.elements.get('song-count').textContent, '2 / 4', 'une lettre = initiale : Essence et Éclipse');
  assert.match(liste(), /Essence Pure/);
  assert.match(liste(), /Éclipse Rose/);
  assert.doesNotMatch(liste(), /La Batte/);

  taper('ECLAT pure');
  assert.equal(page.elements.get('song-count').textContent, '1 / 4', 'des mots, sans accent ni majuscule');
  assert.match(liste(), /data-idx="0"/, 'chaque chanson garde son indice d origine');
  assert.match(page.elements.get('song').innerHTML, /1 résultat/);

  taper('zzz');
  assert.match(liste(), /Aucune chanson ne correspond à « zzz »/);
  assert.match(page.elements.get('song').innerHTML, /Aucun titre ne correspond/);

  taper('retour');
  recherche.dispatch('keydown', { key: 'Enter' });
  assert.equal(page.elements.get('song').value, 2, 'Entree choisit le premier resultat');

  taper('batte');
  assert.match(page.elements.get('song').innerHTML, /value="2"/, 'la chanson choisie reste choisissable meme filtree');
  taper('');
  assert.equal(page.elements.get('song-count').textContent, 4, 'sans recherche, le compteur redevient le total');

  // Le champ du jukebox (carte « historique ») partage la meme recherche.
  const jukebox = page.elements.get('jukebox-search');
  jukebox.value = 'batte';
  jukebox.dispatch('input');
  assert.equal(page.elements.get('song-count').textContent, '1 / 4', 'le jukebox filtre aussi');
  assert.equal(recherche.value, 'batte', 'les deux champs se recopient');
  assert.match(liste(), /La Batte Perce le Noir/);
  jukebox.dispatch('keydown', { key: 'Enter' });
  assert.match(page.elements.get('audio').src, /\/media\/b\.mp3$/, 'Entree dans le jukebox lance la lecture du premier resultat');
});

test('pollJob ne chevauche pas les appels et arrete explicitement un 404', async () => {
  let statusCalls = 0;
  let resolveFirst;
  const firstStatus = new Promise((resolve) => { resolveFirst = resolve; });
  const page = createHarness(async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/mcp-bridge/clip/status/job-1') {
      statusCalls += 1;
      if (statusCalls === 1) return firstStatus;
      return jsonResponse(404, { ok: false, error: 'Job introuvable' });
    }
    if (pathname === '/api/mcp-bridge/clip/list') return jsonResponse(200, { ok: true, clips: [] });
    throw new Error(`appel inattendu: ${pathname}`);
  });

  page.hooks.pollJob('job-1', 'clip');
  assert.equal(page.scheduler.runNext(), 0);
  assert.equal(statusCalls, 1);
  assert.deepEqual(page.scheduler.delays(), [30000], 'aucun second poll tant que le premier est en vol');

  resolveFirst(jsonResponse(200, { ok: true, status: 'generating', progress: 12 }));
  await settle();
  assert.deepEqual(page.scheduler.delays(), [8000]);

  assert.equal(page.scheduler.runNext(), 8000);
  await settle();
  assert.equal(statusCalls, 2);
  assert.match(page.elements.get('msg').textContent, /Job introuvable/);
  assert.equal(page.elements.get('go-clip').disabled, false);
  assert.equal(page.hooks.state().activeJobId, null);
  assert.equal(page.scheduler.size(), 0);
});

test('pollJob suit tous les etats actifs du serveur jusqu a la livraison sans reactiver Clip', async () => {
  const { ACTIVE_STATUSES } = require('../src/clips/clip-jobs.cjs');
  const statuses = [...ACTIVE_STATUSES, 'done'];
  let statusCalls = 0;
  let listCalls = 0;
  let mesClipsCalls = 0;
  const page = createHarness(async (url) => {
    if (new URL(url).pathname.includes('/status/')) {
      const status = statuses[statusCalls++];
      return jsonResponse(200, {
        ok: true, status, stage: status, progress: statusCalls * 15,
        ...(status === 'done' ? { outputFilename: 'existing-clip.mp4' } : {}),
      });
    }
    // Espace privé (13/09/2026) : la page rafraîchit « Mes clips » ET la vitrine.
    if (new URL(url).pathname.endsWith('/mes-clips')) {
      mesClipsCalls += 1;
      return jsonResponse(200, { ok: true, clips: [] });
    }
    listCalls += 1;
    return jsonResponse(200, { ok: true, clips: [] });
  });

  page.hooks.pollJob('job-lifecycle', 'clip');
  for (const status of ACTIVE_STATUSES) {
    page.scheduler.runNext();
    await settle();
    assert.equal(page.hooks.state().activeJobId, 'job-lifecycle', status);
    assert.equal(page.elements.get('go-clip').disabled, true, status);
    assert.equal(page.elements.get('go-full').disabled, true, status);
    assert.deepEqual(page.scheduler.delays(), [8000], status);
    assert.doesNotMatch(page.elements.get('msg').textContent, /invalide|absent/);
    assert.equal(listCalls, 0, 'un etat valide ne doit pas abandonner le suivi');
  }
  page.scheduler.runNext();
  await settle();
  assert.equal(statusCalls, statuses.length);
  assert.match(page.elements.get('msg').textContent, /Clip prêt/);
  assert.equal(page.elements.get('go-clip').disabled, false);
  assert.equal(page.hooks.state().activeJobId, null);
  assert.equal(page.scheduler.size(), 0);
  assert.equal(listCalls, 1);
  assert.equal(mesClipsCalls, 1, 'mes clips rafraichis une fois, a la livraison');
});

test('pollJob continue de refuser un etat absent ou inconnu', async () => {
  for (const status of [undefined, 'unexpected-state']) {
    const page = createHarness(async (url) => jsonResponse(200,
      new URL(url).pathname.includes('/status/')
        ? { ok: true, status, progress: 5 }
        : { ok: true, clips: [] }
    ));
    page.hooks.pollJob('job-invalid', 'clip');
    page.scheduler.runNext();
    await settle();
    assert.match(page.elements.get('msg').textContent, /Statut de génération invalide ou absent/);
    assert.equal(page.hooks.state().activeJobId, null);
    assert.equal(page.scheduler.size(), 0);
  }
});

test('pollJob refuse un faux succes sans sortie et distingue un resultat partiel', async () => {
  let response = { ok: true, status: 'done', progress: 100 };
  const page = createHarness(async (url) => {
    if (new URL(url).pathname.includes('/status/')) return jsonResponse(200, response);
    return jsonResponse(200, { ok: true, clips: [] });
  });

  page.hooks.pollJob('job-empty', 'clip');
  page.scheduler.runNext();
  await settle();
  assert.match(page.elements.get('msg').textContent, /aucun fichier vidéo/);

  response = { ok: true, status: 'done', progress: 100, outputFilename: 'clip.mp4', partial: true, warning: '2 plans sur 6' };
  page.hooks.pollJob('job-partial', 'clip');
  page.scheduler.runNext();
  await settle();
  assert.match(page.elements.get('msg').textContent, /partiel prêt.*2 plans sur 6/);
  assert.doesNotMatch(page.elements.get('msg').textContent, /✅/);
});

test('le lecteur rend lisibles duree infinie, pause, fin et erreur play()', async () => {
  const page = createHarness(async () => jsonResponse(200, { ok: true }));
  page.hooks.replaceSongs([{ title: 'Morceau', playUrl: '/media/song.mp3', audioUrl: '/media/song.mp3', createdAt: '2026-09-09T00:00:00Z' }]);
  const button = createElement('play-0');
  button.dataset.idx = '0';
  page.playButtons.push(button);
  const audio = page.elements.get('audio');

  page.hooks.play(0);
  await settle();
  audio.duration = Number.POSITIVE_INFINITY;
  audio.currentTime = 4;
  audio.dispatch('loadedmetadata');
  assert.match(page.elements.get('player-state').textContent, /durée indéterminée/);
  assert.equal(page.elements.get('player-state').classList.contains('warn'), true);

  audio.duration = 87;
  audio.currentTime = 7;
  audio.dispatch('timeupdate');
  assert.match(page.elements.get('player-state').textContent, /0:07 \/ 1:27/);
  assert.doesNotMatch(page.elements.get('player-state').textContent, /Infinity|NaN/);

  page.hooks.play(0); // pause
  assert.equal(audio.paused, true);
  assert.equal(button.textContent, '▶');
  assert.match(page.elements.get('player-state').textContent, /Pause/);

  audio.ended = true;
  audio.dispatch('ended');
  assert.equal(page.hooks.state().currentIdx, null);
  assert.equal(page.elements.get('player-state').textContent, 'Terminé');

  const rejected = createHarness(async () => jsonResponse(200, { ok: true }));
  rejected.hooks.replaceSongs([{ title: 'Cassé', playUrl: '/media/broken.mp3', audioUrl: '/media/broken.mp3', createdAt: '2026-09-09T00:00:00Z' }]);
  const brokenButton = createElement('play-broken');
  brokenButton.dataset.idx = '0';
  rejected.playButtons.push(brokenButton);
  const brokenAudio = rejected.elements.get('audio');
  brokenAudio.error = { code: 4 };
  brokenAudio.playImpl = () => Promise.reject(new Error('NotSupportedError'));
  rejected.hooks.play(0);
  await settle();
  assert.match(rejected.elements.get('player-state').textContent, /Format audio ou lien non pris en charge/);
  assert.equal(rejected.elements.get('player-state').classList.contains('error'), true);
  assert.equal(rejected.hooks.state().currentIdx, null);
});

test('le lecteur arrete un demarrage bloque meme si paused passe deja a false', async () => {
  const page = createHarness(async () => jsonResponse(200, { ok: true }));
  page.hooks.replaceSongs([{ title: 'Bloque', playUrl: '/media/stuck.mp3', audioUrl: '/media/stuck.mp3', createdAt: '2026-09-09T00:00:00Z' }]);
  const button = createElement('play-stuck');
  button.dataset.idx = '0';
  page.playButtons.push(button);

  const audio = page.elements.get('audio');
  audio.readyState = 0;
  audio.playImpl = () => {
    audio.paused = false;
    return new Promise(() => {});
  };

  page.hooks.play(0);
  assert.equal(audio.paused, false);
  assert.equal(audio.readyState, 0);
  assert.equal(page.scheduler.runNext(), 20000);
  assert.match(page.elements.get('player-state').textContent, /n'a pas d.marr./);
  assert.equal(page.elements.get('player-state').classList.contains('error'), true);
  assert.equal(page.hooks.state().currentIdx, null);
  assert.equal(audio.paused, true);
});

// Reprise au retour de Safari iOS (branche mobile). Les tests d origine de cette
// branche ne faisaient que chercher des motifs dans le HTML ; ceux-ci executent
// vraiment la reprise, comme elle se produira sur le telephone.
const CLE_SUIVI = 'nossen.activeClipJob.v1';

test('au retour au premier plan, un Full Clip memorise reprend son suivi aussitot', async () => {
  let appelsStatut = 0;
  const page = createHarness(async (url) => {
    if (new URL(url).pathname.includes('/status/job-retour')) {
      appelsStatut += 1;
      return jsonResponse(200, { ok: true, status: 'generating', stage: 'video:polling', progress: 40 });
    }
    return jsonResponse(200, { ok: true, clips: [] });
  });
  page.sessionStorage.setItem(CLE_SUIVI, JSON.stringify({ id: 'job-retour', mode: 'full', startedAt: Date.now() }));
  assert.ok(!page.hooks.state().activeJobId, 'aucun suivi actif avant le retour');
  const ecouteurs = page.documentListeners.get('visibilitychange') || [];
  assert.equal(ecouteurs.length, 1, 'la page doit ecouter visibilitychange');
  page.document.visibilityState = 'visible';
  ecouteurs[0]();
  page.scheduler.runNext();
  await settle();
  assert.equal(page.hooks.state().activeJobId, 'job-retour');
  assert.ok(appelsStatut >= 1, 'le statut du job doit etre redemande au serveur');
});

test('une page restauree par le bfcache de Safari reprend aussi le suivi', async () => {
  let appelsStatut = 0;
  const page = createHarness(async (url) => {
    if (new URL(url).pathname.includes('/status/job-bfcache')) {
      appelsStatut += 1;
      return jsonResponse(200, { ok: true, status: 'generating', stage: 'video:polling', progress: 20 });
    }
    return jsonResponse(200, { ok: true, clips: [] });
  });
  page.sessionStorage.setItem(CLE_SUIVI, JSON.stringify({ id: 'job-bfcache', mode: 'clip', startedAt: Date.now() }));
  const ecouteurs = page.windowListeners.get('pageshow') || [];
  assert.equal(ecouteurs.length, 1, 'la page doit ecouter pageshow');
  ecouteurs[0]({ persisted: true });
  page.scheduler.runNext();
  await settle();
  assert.equal(page.hooks.state().activeJobId, 'job-bfcache');
  assert.ok(appelsStatut >= 1);
});

test('un suivi memorise hors de sa fenetre est oublie au lieu d etre relance', async () => {
  let appelsStatut = 0;
  const page = createHarness(async (url) => {
    if (new URL(url).pathname.includes('/status/')) appelsStatut += 1;
    return jsonResponse(200, { ok: true, clips: [] });
  });
  page.sessionStorage.setItem(CLE_SUIVI, JSON.stringify({ id: 'job-perime', mode: 'full', startedAt: 1 }));
  page.document.visibilityState = 'visible';
  (page.documentListeners.get('visibilitychange') || [])[0]();
  try { page.scheduler.runNext(); } catch (_) { /* rien de planifie : attendu */ }
  await settle();
  assert.equal(appelsStatut, 0, 'aucun appel pour un job hors fenetre');
  assert.ok(!page.sessionStorage.getItem(CLE_SUIVI), 'l etat perime doit etre efface');
});

test('traduction (16/09) : les sept langues ont les memes cles et les memes emplacements', () => {
  const html = fs.readFileSync(serverPagePath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const debut = script.indexOf('var I18N = {') + 'var I18N = '.length;
  const fin = script.indexOf('function normaliserLangue');
  const I18N = new Function(`return ${script.slice(debut, fin).trim().replace(/;\s*$/, '')}`)();
  const cles = Object.keys(I18N.fr).sort();
  assert.deepEqual(Object.keys(I18N).sort(), ['de', 'en', 'es', 'fr', 'it', 'ja', 'zh']);
  const emplacements = (texte) => (String(texte).match(/\{\d\}/g) || []).sort().join('');
  for (const [langue, textes] of Object.entries(I18N)) {
    assert.deepEqual(Object.keys(textes).sort(), cles, `${langue} : cles differentes du francais`);
    for (const cle of cles) {
      assert.equal(emplacements(textes[cle]), emplacements(I18N.fr[cle]), `${langue} ${cle} : emplacements {n}`);
    }
  }
  // Toute cle utilisee par la page existe.
  const utilisees = [...html.matchAll(/(?:\bt\(|data-i18n(?:-placeholder|-aria)?=)["']([a-z]+\.[A-Za-z0-9]+)["']/g)].map((m) => m[1]);
  for (const cle of utilisees) assert.ok(I18N.fr[cle] != null, `cle absente : ${cle}`);
});

test('traduction : la page choisie en japonais affiche ses messages en japonais', async () => {
  const page = createHarness(async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/vivy/stream/songs.json') return jsonResponse(200, { ok: true, songs: [] });
    if (pathname.includes('/status/')) return jsonResponse(404, { error: 'not_found' });
    return jsonResponse(200, { ok: true });
  }, {
    localStorage: { getItem: (cle) => (cle === 'nossen.lang' ? 'ja' : null), setItem() {} },
  });

  await page.hooks.loadSongs();
  await settle();
  assert.match(page.elements.get('list').innerHTML, /現在利用できる曲はありません/);
  assert.doesNotMatch(page.elements.get('list').innerHTML, /Aucune chanson/);

  page.hooks.pollJob('job-ja', 'clip');
  page.scheduler.runNext();
  await settle();
  assert.match(page.elements.get('msg').textContent, /ジョブが見つかりません/);
});
