const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createVerifyJWT,
  resolveNezServiceIdentity,
  getNezServiceTokens,
} = require('../src/middleware/jwt-auth.cjs');

// L'outil MCP a11_chat envoie un X-NEZ-TOKEN (secret statique) a /api/chat.
// Avant le correctif, verifyJWT n'acceptait qu'un JWT HMAC et renvoyait
// 401 A11_JWT_Missing: le moteur tournait mais le message restait devant une
// porte fermee. Ces tests verifient que l'identite service NEZ est acceptee et
// qu'un JWT valide reste prioritaire.

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

function setupNezToken(token) {
  if (token === undefined) {
    delete process.env.A11_NEZ_TOKEN;
    delete process.env.NEZ_TOKENS;
    delete process.env.NEZ_ALLOWED_TOKEN;
  } else {
    process.env.A11_NEZ_TOKEN = token;
  }
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
