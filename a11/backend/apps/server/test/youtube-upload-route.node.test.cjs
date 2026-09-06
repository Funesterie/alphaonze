'use strict';

/**
 * Route de publication YouTube.
 *
 * L'invariant qui compte n'est pas "la route publie" mais "elle ne publie que ce
 * qu'on lui autorise, et elle ne va chercher que dans NOTRE stockage". Une route
 * qui telecharge une URL arbitraire fournie par l'appelant est un relais SSRF: le
 * serveur irait interroger n'importe quelle adresse interne pour le compte de qui
 * appelle. C'est le point le plus teste ici.
 *
 * Le resolveur est expose uniquement sous `_private` afin de tester les vrais
 * chemins/URL de la pipeline sans monter un serveur ni affaiblir la route publique.
 */

const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { _private } = require('../src/routes/social-autoprompt.cjs');
const {
  claimSocialPublicationRequest,
  completeSocialPublicationRequest,
  ensureSocialSchema,
  startSocialPublicationAttempt,
} = require('../src/social/social-autoprompt.cjs');

const source = fs.readFileSync(path.join(__dirname, '../src/routes/social-autoprompt.cjs'), 'utf8');
const resolveur = _private.resolveGeneratedVideoSource;
const downloadSource = _private.downloadGeneratedVideoUrlToTemp;
const publicationCapabilities = _private.resolveSocialPublicationCapabilities;
const uploadHttpError = _private.resolveYoutubeUploadHttpError;
const buildRequestHash = _private.buildYoutubePublicationRequestHash;
const buildUploadMetadata = _private.buildYoutubeUploadMetadata;
const normalizeIdempotencyKey = _private.normalizeYoutubeUploadIdempotencyKey;
const publicationClaimHttpResponse = _private.resolveYoutubePublicationClaimHttpResponse;
const uploadAttemptLimit = _private.resolveYoutubeUploadAttemptLimit;
const acquirePublicationLock = _private.tryAcquireYoutubePublicationLock;
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-youtube-route-'));
const nestedRelative = 'video_20260811_demo/clip-final.mp4';
const nestedFile = path.join(runtimeRoot, 'files', 'generated', 'videos', ...nestedRelative.split('/'));
fs.mkdirSync(path.dirname(nestedFile), { recursive: true });
fs.writeFileSync(nestedFile, Buffer.from('video-test'));
after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));

const ENV_R2 = { R2_PUBLIC_BASE_URL: 'https://files.funesterie.me' };

test('une URL de notre stockage R2 est acceptee', () => {
  const r = resolveur('https://files.funesterie.me/archive/mix/clip.mp4', ENV_R2);
  assert.equal(r.kind, 'url');
});

test('une URL hors de notre stockage est REFUSEE (anti-SSRF)', () => {
  for (const hostile of [
    'https://evil.example/clip.mp4',
    'https://169.254.169.254/latest/meta-data/clip.mp4',
    'https://localhost/clip.mp4',
    'https://127.0.0.1:3000/clip.mp4',
    // Prefixe trompeur: l'hote n'est PAS le notre malgre l'apparence.
    'https://files.funesterie.me.evil.example/clip.mp4',
  ]) {
    const r = resolveur(hostile, ENV_R2);
    assert.equal(r.kind, 'invalid', `aurait du refuser: ${hostile}`);
  }
});

test('http en clair est refuse, meme sur notre hote', () => {
  const r = resolveur('http://files.funesterie.me/archive/mix/clip.mp4', ENV_R2);
  assert.equal(r.kind, 'invalid');
});

test('sans base R2 configuree, aucune URL ne passe', () => {
  // Sinon une configuration incomplete ouvrirait la porte au lieu de la fermer.
  const r = resolveur('https://files.funesterie.me/archive/mix/clip.mp4', {});
  assert.equal(r.kind, 'invalid');
});

test('une URL de notre hote mais hors du chemin de base est refusee', () => {
  // Un hote partage entre locataires: l'hote seul ne suffit pas a autoriser.
  const r = resolveur(
    'https://files.funesterie.me/autre-locataire/clip.mp4',
    { R2_PUBLIC_BASE_URL: 'https://files.funesterie.me/archive' }
  );
  assert.equal(r.kind, 'invalid');
});

test('une extension non video est refusee', () => {
  for (const mauvais of ['clip.exe', 'clip.sh', 'clip.mp3', 'clip']) {
    assert.equal(
      resolveur(`https://files.funesterie.me/archive/${mauvais}`, ENV_R2).kind,
      'invalid',
      `aurait du refuser: ${mauvais}`
    );
  }
});

test('une traversee de chemin en nom de fichier est refusee', () => {
  for (const mauvais of ['../../etc/passwd.mp4', '/etc/shadow.mp4', 'a/b/c.mp4']) {
    const r = resolveur(mauvais, {});
    // basename() ramene au fichier seul, qui n'existe pas dans le runtime de test.
    assert.notEqual(r.kind, 'url');
    assert.notEqual(r.kind, 'file', `aurait du refuser: ${mauvais}`);
  }
});

test('une entree vide est nommee comme telle, pas traitee', () => {
  assert.equal(resolveur('', ENV_R2).kind, 'none');
});

test('la forme URL renvoyee par la pipeline video mappe le vrai fichier imbrique', () => {
  const env = { A11_RUNTIME_ROOT: runtimeRoot, SOCIAL_PUBLIC_BASE_URL: 'https://funesterie.me' };
  const r = resolveur(`https://funesterie.me/files/runtime/files/generated/videos/${nestedRelative}`, env);
  assert.equal(r.kind, 'file');
  assert.equal(r.path, fs.realpathSync(nestedFile));
});

test('le chemin public relatif de la pipeline mappe le vrai fichier imbrique', () => {
  const r = resolveur(`/files/runtime/files/generated/videos/${nestedRelative}`, { A11_RUNTIME_ROOT: runtimeRoot });
  assert.equal(r.kind, 'file');
  assert.equal(r.path, fs.realpathSync(nestedFile));
});

test('une origine ressemblante et toute traversee imbriquee sont refusees', () => {
  const env = { A11_RUNTIME_ROOT: runtimeRoot, SOCIAL_PUBLIC_BASE_URL: 'https://funesterie.me' };
  assert.equal(
    resolveur(`https://funesterie.me.evil.example/files/runtime/files/generated/videos/${nestedRelative}`, env).kind,
    'invalid'
  );
  assert.equal(resolveur('generated/videos/../secrets/clip.mp4', env).kind, 'invalid');
});

test('un lien symbolique legacy ne peut pas sortir du runtime', (t) => {
  const legacyRoot = path.join(runtimeRoot, 'video');
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-youtube-outside-'));
  const outsideFile = path.join(outsideRoot, 'secret.mp4');
  const link = path.join(legacyRoot, 'legacy-link.mp4');
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(outsideFile, Buffer.from('hors-runtime'));
  try {
    try {
      fs.symlinkSync(outsideFile, link, 'file');
    } catch (error) {
      if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`liens symboliques indisponibles: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.equal(
      resolveur('legacy-link.mp4', { A11_RUNTIME_ROOT: runtimeRoot }).kind,
      'invalid'
    );
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

function remoteResponse({ status = 200, headers = {}, chunks = [] } = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (key) => normalized[String(key).toLowerCase()] ?? null },
    body: Readable.from(chunks),
    arrayBuffer: async () => { throw new Error('arrayBuffer ne doit jamais etre appele'); },
  };
}

test('une redirection R2 vers metadata est refusee sans second fetch', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-youtube-redirect-'));
  let calls = 0;
  try {
    await assert.rejects(
      () => downloadSource({
        url: 'https://files.funesterie.me/archive/clip.mp4',
        tempDir,
        timeoutMs: 1000,
        maxBytes: 1024,
        fetchImpl: async (_url, options) => {
          calls += 1;
          assert.equal(options.redirect, 'manual');
          return remoteResponse({
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
          });
        },
      }),
      (error) => error.code === 'youtube_upload_source_redirect_refused'
    );
    assert.equal(calls, 1, 'la destination de redirection ne doit jamais etre demandee');
    assert.deepEqual(fs.readdirSync(tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('un flux qui depasse la limite est interrompu et son fichier partiel supprime', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-youtube-limit-'));
  try {
    await assert.rejects(
      () => downloadSource({
        url: 'https://files.funesterie.me/archive/clip.mp4',
        tempDir,
        timeoutMs: 1000,
        maxBytes: 5,
        fetchImpl: async () => remoteResponse({ chunks: [Buffer.from('1234'), Buffer.from('5678')] }),
      }),
      (error) => error.code === 'youtube_upload_source_too_large'
    );
    assert.deepEqual(fs.readdirSync(tempDir), [], 'aucun fichier partiel ne doit rester');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('la source distante est streamee vers disque sans arrayBuffer', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-youtube-stream-'));
  let downloaded = null;
  try {
    downloaded = await downloadSource({
      url: 'https://files.funesterie.me/archive/clip.mp4',
      tempDir,
      timeoutMs: 1000,
      maxBytes: 1024,
      fetchImpl: async () => remoteResponse({ chunks: [Buffer.from('video-'), Buffer.from('test')] }),
    });
    assert.equal(downloaded.bytes, 10);
    assert.equal(fs.readFileSync(downloaded.path, 'utf8'), 'video-test');
    assert.doesNotMatch(blocRoute, /\.arrayBuffer\(/);
  } finally {
    if (downloaded?.path) fs.rmSync(downloaded.path, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('le timeout configurable interrompt le fetch et ne laisse aucun fichier', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-youtube-timeout-'));
  try {
    await assert.rejects(
      () => downloadSource({
        url: 'https://files.funesterie.me/archive/clip.mp4',
        tempDir,
        timeoutMs: 100,
        maxBytes: 1024,
        fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        }),
      }),
      (error) => error.code === 'youtube_upload_source_timeout'
    );
    assert.deepEqual(fs.readdirSync(tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- garde-fous de la route --------------------------------------------------

const blocRoute = source.match(
  /router\.post\('\/youtube\/upload-generated'[\s\S]*?\n  \}\);/
)?.[0] || '';
const debutHtmlAdmin = source.indexOf('function buildSocialConnectHtml()');
const finHtmlAdmin = source.indexOf('function createSocialAutopromptApiRouter', debutHtmlAdmin);
const blocHtmlAdmin = debutHtmlAdmin >= 0 && finHtmlAdmin > debutHtmlAdmin
  ? source.slice(debutHtmlAdmin, finHtmlAdmin)
  : '';

test('la route de publication YouTube existe', () => {
  assert.ok(blocRoute, 'route absente');
});

test('la demo admin exige deux confirmations et publie en prive par defaut', () => {
  assert.ok(blocHtmlAdmin, 'HTML admin absent');
  assert.match(blocHtmlAdmin, /id="youtube-confirm" type="checkbox"/);
  assert.match(blocHtmlAdmin, /id="youtube-upload" disabled/);
  assert.match(blocHtmlAdmin, /<option value="private" selected>/);
  assert.match(blocHtmlAdmin, /window\.confirm\(/);
  assert.match(blocHtmlAdmin, /api\('\/youtube\/upload-generated'/);
  assert.match(blocHtmlAdmin, /confirm:\s*true/);
});

test('la demo conserve une cle UUID apres erreur et ne la renouvelle qu apres succes ou abandon explicite', () => {
  assert.match(blocHtmlAdmin, /crypto\.randomUUID\(\)/);
  assert.match(blocHtmlAdmin, /localStorage\.setItem\(youtubeIdempotencyStorageKey, youtubeIdempotencyKey\)/);
  assert.match(blocHtmlAdmin, /idempotencyKey:\s*youtubeIdempotencyKey/);
  assert.match(blocHtmlAdmin, /id="youtube-abandon" disabled/);
  assert.match(blocHtmlAdmin, /J'ai vérifié : abandonner la tentative/);
  assert.match(blocHtmlAdmin, /youtubeAbandon\.onclick[\s\S]*window\.confirm\(/);
  assert.match(blocHtmlAdmin, /catch \(e\) \{[\s\S]*youtubeAbandon\.disabled = false/);
  assert.match(blocHtmlAdmin, /JSON\.stringify\(resultat[\s\S]*clearYoutubeAttempt\(\)/);
});

test('la publication exige confirm:true, comme SoundCloud', () => {
  // Une publication externe ne doit jamais partir d'un appel accidentel.
  assert.match(blocRoute, /confirm !== true && req\.body\?\.confirm !== 'true'/);
  const avant = blocRoute.slice(0, blocRoute.indexOf('resolveGeneratedVideoSource'));
  assert.match(avant, /youtube_upload_confirm_required/, 'le verrou doit preceder tout traitement');
});

test('le defaut de confidentialite est private', () => {
  assert.equal(
    buildUploadMetadata({}, { kind: 'url', url: 'https://files.funesterie.me/clip.mp4' }).privacyStatus,
    'private'
  );
});

test('idempotencyKey est obligatoire et limitee a un alphabet sur', () => {
  assert.equal(normalizeIdempotencyKey(undefined).error, 'youtube_upload_idempotency_key_required');
  assert.equal(normalizeIdempotencyKey('court').error, 'youtube_upload_idempotency_key_invalid');
  assert.equal(normalizeIdempotencyKey('cle avec espaces').error, 'youtube_upload_idempotency_key_invalid');
  assert.deepEqual(
    normalizeIdempotencyKey('550e8400-e29b-41d4-a716-446655440000'),
    { ok: true, key: '550e8400-e29b-41d4-a716-446655440000' }
  );
  const avantSource = blocRoute.slice(0, blocRoute.indexOf('resolveGeneratedVideoSource'));
  assert.match(avantSource, /normalizeYoutubeUploadIdempotencyKey/);
});

test('le hash lie utilisateur, source et metadonnees sans les persister en clair', () => {
  const metadata = buildUploadMetadata({ title: 'Clip test', privacyStatus: 'private' }, { kind: 'file', path: nestedFile });
  const base = buildRequestHash({ userId: 'user-1', source: { kind: 'file', path: nestedFile }, metadata });
  assert.match(base, /^[a-f0-9]{64}$/);
  assert.equal(
    base,
    buildRequestHash({ userId: 'user-1', source: { kind: 'file', path: nestedFile }, metadata })
  );
  assert.notEqual(
    base,
    buildRequestHash({ userId: 'user-2', source: { kind: 'file', path: nestedFile }, metadata })
  );
  assert.notEqual(
    base,
    buildRequestHash({ userId: 'user-1', source: { kind: 'file', path: nestedFile }, metadata: { ...metadata, title: 'Autre' } })
  );
});

test('le quota global vaut 20 ouvertures videos.insert sur 24 h et reste configurable', () => {
  assert.equal(uploadAttemptLimit({}), 20);
  assert.equal(uploadAttemptLimit({ SOCIAL_YOUTUBE_UPLOAD_MAX_ATTEMPTS_24H: '7' }), 7);
  assert.equal(uploadAttemptLimit({ SOCIAL_YOUTUBE_UPLOAD_MAX_ATTEMPTS_24H: '0' }), 0);
  assert.equal(uploadAttemptLimit({ SOCIAL_YOUTUBE_UPLOAD_MAX_ATTEMPTS_24H: 'invalide' }), 20);
});

test('le verrou process-global refuse une concurrence et se libere de facon idempotente', () => {
  const release = acquirePublicationLock();
  assert.equal(typeof release, 'function');
  assert.equal(acquirePublicationLock(), null);
  release();
  release();
  const releaseAgain = acquirePublicationLock();
  assert.equal(typeof releaseAgain, 'function');
  releaseAgain();
  assert.ok(blocRoute.indexOf('tryAcquireYoutubePublicationLock') < blocRoute.indexOf('downloadGeneratedVideoUrlToTemp'));
  assert.match(blocRoute, /finally \{[\s\S]*releaseYoutubeLock\(\)/);
});

function publicationDbFixture({ existing = null, used = 0, retryAfterSeconds = 3600 } = {}) {
  const transactionQueries = [];
  const schemaQueries = [];
  let released = false;
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      transactionQueries.push({ sql: text, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(text)) return { rows: [] };
      if (/pg_advisory_xact_lock/i.test(text)) return { rows: [{}] };
      if (/SELECT id, user_id, provider, request_hash/i.test(text)) {
        return { rows: existing ? [existing] : [] };
      }
      if (/SELECT COUNT\(\*\)::integer AS used/i.test(text)) {
        return { rows: [{ used, retry_after_seconds: retryAfterSeconds }] };
      }
      if (/INSERT INTO social_publication_requests/i.test(text)) {
        return { rows: [{
          id: 41,
          user_id: params[0],
          provider: params[1],
          request_hash: params[3],
          status: 'pending',
          result_json: null,
        }] };
      }
      if (/UPDATE social_publication_requests[\s\S]*attempt_started_at = NOW\(\)/i.test(text)) {
        return { rows: [{
          ...(existing || {}),
          id: existing?.id || 41,
          user_id: params[0],
          provider: params[1],
          request_hash: params[3],
          status: 'pending',
          result_json: null,
          attempt_started_at: '2026-08-11T12:00:00.000Z',
        }] };
      }
      throw new Error(`requete transactionnelle inattendue: ${text}`);
    },
    release() { released = true; },
  };
  const db = {
    async query(sql) {
      schemaQueries.push(String(sql));
      return { rows: [], rowCount: 0 };
    },
    async connect() { return client; },
  };
  return {
    db,
    schemaQueries,
    transactionQueries,
    wasReleased: () => released,
  };
}

test('le schema persiste requetes, hash, et unicite d idempotence', async () => {
  const statements = [];
  await ensureSocialSchema({
    async query(sql) {
      statements.push(String(sql));
      return { rows: [], rowCount: 0 };
    },
  });
  const schema = statements.join('\n');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS social_publication_requests/i);
  assert.match(schema, /request_hash TEXT NOT NULL/i);
  assert.match(schema, /status TEXT NOT NULL DEFAULT 'pending'/i);
  assert.match(schema, /attempt_started_at TIMESTAMPTZ/i);
  assert.match(schema, /UNIQUE \(user_id, provider, idempotency_key\)/i);
  assert.match(schema, /provider, attempt_started_at DESC/i);
});

test('le claim reserve l idempotence sans lire ni consommer le quota', async () => {
  const fixture = publicationDbFixture({ used: 20 });
  const claim = await claimSocialPublicationRequest(fixture.db, {
    userId: 'user-1',
    provider: 'youtube',
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    requestHash: 'a'.repeat(64),
  });
  assert.equal(claim.outcome, 'claimed');
  const sql = fixture.transactionQueries.map((entry) => entry.sql);
  assert.match(sql[0], /BEGIN/i);
  assert.match(sql[1], /pg_advisory_xact_lock/i);
  assert.equal(sql.some((entry) => /SELECT COUNT|attempt_started_at >=/i.test(entry)), false);
  assert.ok(sql.some((entry) => /INSERT INTO social_publication_requests/i.test(entry)));
  assert.match(sql.at(-1), /COMMIT/i);
  assert.equal(fixture.wasReleased(), true);
  const persistedParams = JSON.stringify(fixture.transactionQueries.map((entry) => entry.params));
  assert.doesNotMatch(persistedParams, /access[_-]?token|clip-final\.mp4|files\.funesterie/i);
  assert.doesNotMatch(blocRoute, /console\.(?:log|warn|error)/);
});

test('le quota est compte et marque atomiquement seulement juste avant videos.insert', async () => {
  const pendingRow = {
    id: 41,
    user_id: 'user-1',
    provider: 'youtube',
    request_hash: 'a'.repeat(64),
    status: 'pending',
    result_json: null,
    attempt_started_at: null,
  };
  const fixture = publicationDbFixture({ existing: pendingRow, used: 3 });
  const started = await startSocialPublicationAttempt(fixture.db, {
    userId: 'user-1',
    provider: 'youtube',
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    requestHash: 'a'.repeat(64),
    maxAttempts24h: 20,
  });
  assert.equal(started.outcome, 'started');
  assert.equal(started.used, 4);
  assert.ok(started.request.attemptStartedAt);
  const sql = fixture.transactionQueries.map((entry) => entry.sql);
  const lockIndex = fixture.transactionQueries.findIndex((entry) => /social-publication-attempt-quota/i.test(JSON.stringify(entry.params)));
  const countIndex = sql.findIndex((entry) => /SELECT COUNT/i.test(entry));
  const markIndex = sql.findIndex((entry) => /attempt_started_at = NOW\(\)/i.test(entry));
  assert.ok(lockIndex >= 0 && lockIndex < countIndex);
  assert.ok(countIndex < markIndex);
  assert.match(sql[countIndex], /attempt_started_at >= NOW\(\) - INTERVAL '24 hours'/i);
  assert.match(sql.at(-1), /COMMIT/i);
  const startInRoute = blocRoute.indexOf('startSocialPublicationAttempt');
  assert.ok(startInRoute > blocRoute.indexOf('downloadGeneratedVideoUrlToTemp'));
  assert.ok(startInRoute < blocRoute.indexOf('uploadYoutubeVideo'));
});

test('not connected, busy et echec de download restent avant le marquage quota', () => {
  const startIndex = blocRoute.indexOf('startSocialPublicationAttempt');
  assert.ok(blocRoute.indexOf("error: 'youtube_not_connected'") < startIndex);
  assert.ok(blocRoute.indexOf("error: 'youtube_upload_busy'") < startIndex);
  assert.ok(blocRoute.indexOf('downloadGeneratedVideoUrlToTemp') < startIndex);
  assert.doesNotMatch(
    blocRoute.slice(0, startIndex),
    /attempt_started_at|startSocialPublicationAttempt/
  );
});

test('un replay ne reinserre jamais; hash different conflict et quota de depart rend 429', async () => {
  const succeededRow = {
    id: 7,
    user_id: 'user-1',
    provider: 'youtube',
    request_hash: 'a'.repeat(64),
    status: 'succeeded',
    result_json: { ok: true, uploaded: { videoId: 'video-1' } },
  };
  const replayFixture = publicationDbFixture({ existing: succeededRow });
  const replay = await claimSocialPublicationRequest(replayFixture.db, {
    userId: 'user-1', provider: 'youtube', idempotencyKey: 'request-key-0001', requestHash: 'a'.repeat(64),
  });
  assert.equal(replay.outcome, 'succeeded');
  assert.equal(replayFixture.transactionQueries.some((entry) => /INSERT INTO/i.test(entry.sql)), false);
  assert.equal(publicationClaimHttpResponse(replay).body.idempotentReplay, true);

  const mismatchFixture = publicationDbFixture({ existing: succeededRow });
  const mismatch = await claimSocialPublicationRequest(mismatchFixture.db, {
    userId: 'user-1', provider: 'youtube', idempotencyKey: 'request-key-0001', requestHash: 'b'.repeat(64),
  });
  assert.equal(mismatch.outcome, 'mismatch');
  assert.equal(publicationClaimHttpResponse(mismatch).status, 409);

  const quotaFixture = publicationDbFixture({
    existing: {
      id: 8,
      user_id: 'user-2',
      provider: 'youtube',
      request_hash: 'c'.repeat(64),
      status: 'pending',
      attempt_started_at: null,
    },
    used: 20,
    retryAfterSeconds: 1234,
  });
  const quota = await startSocialPublicationAttempt(quotaFixture.db, {
    userId: 'user-2', provider: 'youtube', idempotencyKey: 'request-key-0002', requestHash: 'c'.repeat(64), maxAttempts24h: 20,
  });
  assert.deepEqual(
    { outcome: quota.outcome, used: quota.used, limit: quota.limit, retryAfterSeconds: quota.retryAfterSeconds },
    { outcome: 'quota', used: 20, limit: 20, retryAfterSeconds: 1234 }
  );
  assert.equal(quotaFixture.transactionQueries.some((entry) => /attempt_started_at = NOW\(\)/i.test(entry.sql)), false);
  assert.equal(publicationClaimHttpResponse(quota).status, 429);
});

test('pending et failed ne sont jamais relances et demandent une verification', () => {
  for (const status of ['pending', 'failed']) {
    const response = publicationClaimHttpResponse({
      outcome: status,
      request: { status, errorCode: status === 'failed' ? 'youtube_upload_busy' : '' },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.outcomeToVerify, true);
    assert.match(response.body.message, /ne sera pas relancee|ne sera pas relanc/i);
  }
});

test('la completion est un update atomique uniquement depuis pending', async () => {
  let captured = null;
  const db = {
    async query(sql, params) {
      captured = { sql: String(sql), params };
      return { rows: [{
        id: 9,
        user_id: params[0],
        provider: params[1],
        request_hash: params[3],
        status: params[4],
        result_json: JSON.parse(params[5]),
      }] };
    },
  };
  const completed = await completeSocialPublicationRequest(db, {
    userId: 'user-1',
    provider: 'youtube',
    idempotencyKey: 'request-key-0003',
    requestHash: 'd'.repeat(64),
    status: 'succeeded',
    result: { ok: true, uploaded: { videoId: 'video-3' } },
  });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.result.uploaded.videoId, 'video-3');
  assert.match(captured.sql, /AND request_hash = \$4 AND status = 'pending'/i);
  assert.equal(captured.params.some((value) => String(value).includes('access_token')), false);
});

test('seul le perimetre manquant rend 403 avec demande de reconnexion', () => {
  const resultat = uploadHttpError({ code: 'youtube_upload_scope_missing' });
  assert.equal(resultat.status, 403);
  assert.equal(resultat.body.error, 'youtube_upload_scope_missing');
  assert.equal(resultat.body.reconnectRequired, true);
  assert.match(resultat.body.message, /Reconnecter/);
});

test('quotaExceeded, dailyLimitExceeded et uploadLimitExceeded rendent des 429 distincts', () => {
  for (const code of [
    'youtube_upload_quota_exceeded',
    'youtube_upload_daily_limit_exceeded',
    'youtube_upload_limit_exceeded',
  ]) {
    const resultat = uploadHttpError({ code });
    assert.equal(resultat.status, 429, code);
    assert.equal(resultat.body.error, code);
    assert.equal(resultat.body.reconnectRequired, undefined, code);
    assert.doesNotMatch(resultat.body.message, /perimetre|reconnect/i, code);
  }
});

test('un interdit generique rend 403 sans le presenter comme un scope manquant', () => {
  const resultat = uploadHttpError({ code: 'youtube_upload_forbidden' });
  assert.equal(resultat.status, 403);
  assert.equal(resultat.body.error, 'youtube_upload_forbidden');
  assert.equal(resultat.body.reconnectRequired, undefined);
  assert.doesNotMatch(resultat.body.message, /perimetre|reconnect/i);
});

test('les erreurs de source rendent uniquement 413, 502 ou 504', () => {
  for (const [code, status] of [
    ['youtube_upload_source_too_large', 413],
    ['youtube_upload_source_fetch_failed', 502],
    ['youtube_upload_source_redirect_refused', 502],
    ['youtube_upload_source_timeout', 504],
  ]) {
    const resultat = uploadHttpError({ code, upstreamStatus: 302 });
    assert.equal(resultat.status, status, code);
    assert.equal(resultat.body.error, code);
    assert.doesNotMatch(resultat.body.message, /169\.254|files\.funesterie/i);
  }
});

test('le fichier temporaire est supprime dans tous les cas', () => {
  // Une video rapatriee qui reste sur disque apres un echec est une fuite.
  assert.match(blocRoute, /finally \{[\s\S]*rmSync\(tempFile/);
});

test('le verrouillage en prive impose par YouTube est remonte a l appelant', () => {
  assert.match(blocRoute, /lockedPrivateLikely/);
});

test('le statut annonce la publication YouTube quand son client dedie est configure', () => {
  const status = publicationCapabilities(null, {
    SOCIAL_YOUTUBE_CLIENT_ID: 'client-test',
    SOCIAL_YOUTUBE_CLIENT_SECRET: 'secret-test',
  });
  assert.equal(status.publicationEnabled, true);
  assert.equal(status.youtubePublicationEnabled, true);
  assert.equal(status.soundcloudPublicationEnabled, false);
  assert.doesNotMatch(source, /publicationEnabled:\s*false/);
});
