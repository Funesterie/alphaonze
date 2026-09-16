const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  createVerifyJWT,
  resolveNezServiceIdentity,
  getNezServiceTokens,
} = require('../src/middleware/jwt-auth.cjs');
const {
  verifyQuinteNezToken,
} = require('../src/security/quinte-nez-token.cjs');

// L'outil MCP a11_chat envoie un X-NEZ-TOKEN a /api/chat.
// Le rail historique utilise un secret statique. Le rail RubixGate ajoute une
// preuve journaliere Quinté × NEZ sans transformer le resultat hippique public
// en mot de passe. Un JWT utilisateur valide reste prioritaire.

const AUTH_CONTEXT = 'a11mcp-auth:v1';

function resStub() {
  const captured = {};
  return {
    status(code) { captured.status = code; return this; },
    json(body) { captured.json = body; },
    _captured: captured,
  };
}

function fakeFailingJwt() {
  return { verify() { throw new Error('invalid signature'); } };
}

function clearQuinteEnv() {
  delete process.env.NEZ_QUINTE_TOKEN_ENABLED;
  delete process.env.NEZ_QUINTE_TOKEN_REQUIRED;
  delete process.env.NEZ_QUINTE_MAX_AGE_HOURS;
  delete process.env.NEZ_QUINTE_MAX_FUTURE_MINUTES;
  delete process.env.NEZ_QUINTE_BASE_SECRET;
  delete process.env.STEGO_SALT;
}

function setupNezToken(token) {
  clearQuinteEnv();
  if (token === undefined) {
    delete process.env.A11_NEZ_TOKEN;
    delete process.env.NEZ_TOKENS;
    delete process.env.NEZ_ALLOWED_TOKEN;
  } else {
    process.env.A11_NEZ_TOKEN = token;
  }
}

function todayKeyHint(nowMs = Date.now()) {
  return `quinte-${new Date(nowMs).toISOString().slice(0, 10)}-R1`;
}

// Deliberately assembled at runtime so repository scanners never mistake a
// test fixture for deployable credential material.
function fixtureKeyMaterial() {
  return ['rubix', 'fixture', 'root', '01'].join('-');
}

function makeDailyToken({
  secret,
  keyHint = todayKeyHint(),
  numbers = '07-03-12-05-09',
  publishedAt = new Date(Date.now() - 60_000).toISOString(),
  validUntil = new Date(Date.now() + 60 * 60_000).toISOString(),
}) {
  const payload = { k: keyHint, n: numbers, p: publishedAt, e: validUntil };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const root = crypto.createHmac('sha256', secret)
    .update(`${keyHint}:${numbers}`)
    .digest();
  const mac = crypto.createHmac('sha256', root)
    .update(`${AUTH_CONTEXT}:${encoded}`)
    .digest('hex');
  return `nezq1.${encoded}.${mac}`;
}

function setupDailyEnv(secret, { required = true } = {}) {
  process.env.STEGO_SALT = secret;
  process.env.NEZ_QUINTE_TOKEN_ENABLED = 'true';
  process.env.NEZ_QUINTE_TOKEN_REQUIRED = required ? 'true' : 'false';
  process.env.NEZ_QUINTE_MAX_AGE_HOURS = '36';
}

test('X-NEZ-TOKEN valide est accepte comme identite service sur /api/chat', async () => {
  setupNezToken('nez:test-service-secret');
  try {
    const verifyJWT = createVerifyJWT({
      jwt: fakeFailingJwt(),
      jwtSecret: 'server-secret',
      logger: { warn() {}, log() {} },
    });
    let nextCalled = false;
    const req = {
      method: 'POST',
      path: '/api/chat',
      headers: { 'x-nez-token': 'nez:test-service-secret' },
    };
    await verifyJWT(req, resStub(), () => { nextCalled = true; });
    assert.equal(nextCalled, true, 'le chat doit passer avec un NEZ service token');
    assert.equal(req.user?.isService, true);
    assert.equal(req.user?.isAdmin, true);
    assert.equal(req.user?.role, 'admin');
    assert.equal(req.serviceAuth?.mode, 'nez-service');
  } finally {
    setupNezToken(undefined);
  }
});

test('Bearer NEZ token est aussi accepte (chaine Authorization)', async () => {
  setupNezToken('nez:bearer-secret');
  try {
    const verifyJWT = createVerifyJWT({
      jwt: fakeFailingJwt(),
      jwtSecret: 'server-secret',
      logger: { warn() {} },
    });
    let nextCalled = false;
    const req = {
      method: 'POST',
      path: '/api/chat',
      headers: { authorization: 'Bearer nez:bearer-secret' },
    };
    await verifyJWT(req, resStub(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.user?.isService, true);
  } finally {
    setupNezToken(undefined);
  }
});

test('NEZ token errone est rejete (401), fail closed', async () => {
  setupNezToken('nez:bon-secret');
  try {
    const verifyJWT = createVerifyJWT({
      jwt: fakeFailingJwt(),
      jwtSecret: 'server-secret',
      logger: { warn() {} },
    });
    const res = resStub();
    let nextCalled = false;
    await verifyJWT(
      { method: 'POST', path: '/api/chat', headers: { 'x-nez-token': 'nez:mauvais' } },
      res,
      () => { nextCalled = true; }
    );
    assert.equal(nextCalled, false);
    assert.equal(res._captured.status, 401);
  } finally {
    setupNezToken(undefined);
  }
});

test('Aucun token NEZ configure => refus, pas de defaut faible', async () => {
  setupNezToken(undefined);
  const verifyJWT = createVerifyJWT({
    jwt: fakeFailingJwt(),
    jwtSecret: 'server-secret',
    logger: { warn() {} },
  });
  const res = resStub();
  await verifyJWT(
    { method: 'POST', path: '/api/chat', headers: { 'x-nez-token': 'nez:a11-client-funesterie-pro' } },
    res,
    () => {}
  );
  assert.equal(res._captured.status, 401);
  assert.equal(getNezServiceTokens().length, 0);
});

test('Un JWT utilisateur valide reste prioritaire sur le NEZ service', async () => {
  setupNezToken('nez:service-secret');
  try {
    const userPayload = { id: 'user-42', email: 'djeff@funesterie.me', role: 'admin' };
    const verifyJWT = createVerifyJWT({
      jwt: { verify() { return userPayload; } },
      jwtSecret: 'server-secret',
      logger: { warn() {} },
    });
    let nextCalled = false;
    const req = {
      method: 'POST',
      path: '/api/chat',
      headers: {
        authorization: 'Bearer real.jwt.token',
        'x-nez-token': 'nez:service-secret',
      },
    };
    await verifyJWT(req, resStub(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.user?.id, 'user-42', 'le JWT utilisateur doit gagner');
    assert.equal(req.user?.isService, undefined);
  } finally {
    setupNezToken(undefined);
  }
});

test('resolveNezServiceIdentity expose un user admin/fullAccess pour le chat', () => {
  setupNezToken('nez:abc');
  try {
    const r = resolveNezServiceIdentity({ headers: { 'x-nez-token': 'nez:abc' } });
    assert.equal(r.user.fullAccess, true);
    assert.equal(r.user.isAdmin, true);
  } finally {
    setupNezToken(undefined);
  }
});

test('Quinté x NEZ journalier valide est accepte sans partager le fichier resultat', async () => {
  setupNezToken('legacy-static-token');
  const fixtureMaterial = fixtureKeyMaterial();
  setupDailyEnv(fixtureMaterial, { required: true });
  try {
    const token = makeDailyToken({ secret: fixtureMaterial });
    const direct = verifyQuinteNezToken(token);
    assert.equal(direct.valid, true);

    const verifyJWT = createVerifyJWT({
      jwt: fakeFailingJwt(),
      jwtSecret: 'server-secret',
      logger: { warn() {}, log() {} },
    });
    let nextCalled = false;
    const req = {
      method: 'POST',
      path: '/api/chat',
      headers: { 'x-nez-token': token },
    };
    await verifyJWT(req, resStub(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.serviceAuth?.mode, 'nez-quinte-daily');
    assert.equal(req.serviceAuth?.keyHint, todayKeyHint());
    assert.equal(req.user?.isService, true);
  } finally {
    setupNezToken(undefined);
  }
});

test('modifier l ordre public sans recalculer le MAC invalide le token', () => {
  setupNezToken('legacy-static-token');
  const fixtureMaterial = fixtureKeyMaterial();
  setupDailyEnv(fixtureMaterial, { required: true });
  try {
    const token = makeDailyToken({ secret: fixtureMaterial });
    const [, encoded, mac] = token.split('.');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    payload.n = '03-07-12-05-09';
    const tampered = `nezq1.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${mac}`;
    const result = verifyQuinteNezToken(tampered);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'quinte_token_mac_invalid');
  } finally {
    setupNezToken(undefined);
  }
});

test('un token journalier signe mais expire est refuse', () => {
  setupNezToken('legacy-static-token');
  const fixtureMaterial = fixtureKeyMaterial();
  setupDailyEnv(fixtureMaterial, { required: true });
  try {
    const now = Date.now();
    const token = makeDailyToken({
      secret: fixtureMaterial,
      publishedAt: new Date(now - 2 * 60 * 60_000).toISOString(),
      validUntil: new Date(now - 60 * 60_000).toISOString(),
    });
    const result = verifyQuinteNezToken(token, process.env, now);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'quinte_token_expired');
  } finally {
    setupNezToken(undefined);
  }
});

test('mode Quinté REQUIRED refuse le token NEZ statique historique', () => {
  setupNezToken('legacy-static-token');
  setupDailyEnv(fixtureKeyMaterial(), { required: true });
  try {
    const result = resolveNezServiceIdentity({ headers: { 'x-nez-token': 'legacy-static-token' } });
    assert.equal(result, null);
  } finally {
    setupNezToken(undefined);
  }
});

test('mode Quinté observe garde le token statique comme repli de migration', () => {
  setupNezToken('legacy-static-token');
  setupDailyEnv(fixtureKeyMaterial(), { required: false });
  try {
    const result = resolveNezServiceIdentity({ headers: { 'x-nez-token': 'legacy-static-token' } });
    assert.equal(result?.mode, 'nez-service');
  } finally {
    setupNezToken(undefined);
  }
});
