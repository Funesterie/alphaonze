/**
 * Test Phase 1 - Checkpoints & Tools
 * node test-phase1.cjs
 */

const http = require('node:http');

const BASE = 'http://localhost:3000';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
  }
}

async function run() {
  console.log('\n=== TEST PHASE 1 : Checkpoints & Tools ===\n');

  // ─── AUTH ───────────────────────────────────────────────────────────────────
  console.log('── 1. Authentification ──');

  const loginOk = await request('POST', '/api/auth/login', { username: 'Djeff', password: '1991' });
  ok('Login valide', loginOk.status === 200 && loginOk.body.token, `status=${loginOk.status}`);
  const token = loginOk.body.token;

  const loginFail = await request('POST', '/api/auth/login', { username: 'Djeff', password: 'wrong' });
  ok('Login invalide → 401/400', loginFail.status >= 400, `status=${loginFail.status}`);

  // ─── CHECKPOINTS ────────────────────────────────────────────────────────────
  console.log('\n── 2. Checkpoints ──');

  // Sans token → 401
  const noAuth = await request('POST', '/api/checkpoints', { conversationId: 'test' });
  ok('Sans token → 401', noAuth.status === 401, `status=${noAuth.status}`);

  // Champ manquant → 400
  const missingField = await request('POST', '/api/checkpoints', {}, token);
  ok('conversationId manquant → 400', missingField.status === 400, `status=${missingField.status}`);

  // Créer checkpoint
  const create = await request('POST', '/api/checkpoints', {
    conversationId: 'test_conv_abc-xyz',
    stepNumber: 1,
    reason: 'manual_test',
    conversationHistory: [{ role: 'user', content: 'Test message A11' }],
    confidenceScore: 0.95,
  }, token);
  ok('Créer checkpoint → 200', create.status === 200 && create.body.ok, `id=${create.body.checkpoint?.checkpointId}`);
  const cpId = create.body.checkpoint?.checkpointId;

  // Lister
  const list = await request('GET', '/api/checkpoints?conversationId=test_conv_abc-xyz', null, token);
  ok('Lister checkpoints → 200', list.status === 200 && list.body.count >= 1, `count=${list.body.count}`);

  // Récupérer
  const get = await request('GET', `/api/checkpoints/${cpId}`, null, token);
  ok('Récupérer checkpoint → 200', get.status === 200 && get.body.checkpoint?.checkpointId === cpId, `id=${get.body.checkpoint?.checkpointId}`);

  // Stats
  const stats = await request('GET', '/api/checkpoints/stats?conversationId=test_conv_abc-xyz', null, token);
  ok('Stats → 200', stats.status === 200 && stats.body.stats?.total >= 1, `total=${stats.body.stats?.total}`);

  // Rollback
  const rollback = await request('POST', '/api/checkpoints/rollback', { checkpointId: cpId, reason: 'test_rollback' }, token);
  ok('Rollback → 200', rollback.status === 200 && rollback.body.ok, `status=${rollback.status}`);

  // ─── TOOLS ──────────────────────────────────────────────────────────────────
  console.log('\n── 3. Tools ──');

  // Capabilities
  const caps = await request('GET', '/api/tools/capabilities', null, token);
  ok('Capabilities → 200', caps.status === 200 && caps.body.ok, `visual=${caps.body.capabilities?.generate_visual?.mode}`);

  // Tool call mock
  const call = await request('POST', '/api/tools/call', {
    tool: 'generate_visual',
    params: { prompt: 'test image a11 phase1' },
  }, token);
  ok('Tool call generate_visual → 200', call.status === 200 && call.body.jobId, `jobId=${call.body.jobId}`);
  const jobId = call.body.jobId;

  // Attendre que le job se termine
  await new Promise(r => setTimeout(r, 1500));

  // Job status
  const jobStatus = await request('GET', `/api/tools/jobs/${jobId}`, null, token);
  ok('Job status → 200', jobStatus.status === 200, `status=${jobStatus.body.job?.status}`);
  ok('Job complété', jobStatus.body.job?.status === 'completed', `status=${jobStatus.body.job?.status}`);

  // Liste jobs
  const jobs = await request('GET', '/api/tools/jobs', null, token);
  ok('Liste jobs → 200', jobs.status === 200 && jobs.body.count >= 1, `count=${jobs.body.count}`);

  // Circuit breaker
  const cb = await request('GET', '/api/tools/circuit-breaker', null, token);
  ok('Circuit breaker → 200', cb.status === 200 && cb.body.ok, `status=${cb.status}`);

  // Tool inconnu → 400
  const unknown = await request('POST', '/api/tools/call', { tool: 'unknown_tool', params: {} }, token);
  ok('Tool inconnu → 400', unknown.status === 400, `status=${unknown.status}`);

  // ─── NETTOYAGE ──────────────────────────────────────────────────────────────
  console.log('\n── 4. Nettoyage ──');

  const del = await request('DELETE', `/api/checkpoints/${cpId}`, null, token);
  ok('Supprimer checkpoint → 200', del.status === 200 && del.body.deleted, `deleted=${del.body.deleted}`);

  console.log('\n=== FIN DES TESTS ===\n');
}

run().catch(e => {
  console.error('ERREUR FATALE:', e.message);
  process.exit(1);
});
