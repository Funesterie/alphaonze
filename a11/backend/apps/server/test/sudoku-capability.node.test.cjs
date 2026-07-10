'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  BASE_SOLUTION,
  CREATIVE_SCOPES,
  HARD_BOUNDARIES,
  createSudokuCapabilityService,
  generateSudokuBoard,
  isValidSudokuGrid,
} = require('../src/security/sudoku-capability.cjs');
const {
  createSudokuCapabilityRouter,
  readCapabilityToken,
} = require('../src/routes/sudoku-capability.cjs');

const OWNER = Object.freeze({ id: 'djeff-owner', email: 'cellaurojeffrey@gmail.com', role: 'admin' });
const MARVIN = Object.freeze({ id: 'marvin-guardian', email: 'marvincellauro@gmail.com', role: 'admin' });
const ENV = Object.freeze({
  JWT_SECRET: 'test-only-sudoku-capability-secret-with-adequate-length',
  A11_SUDOKU_MARVIN_EMAILS: MARVIN.email,
  A11_SUDOKU_CHALLENGE_TTL_MS: '600000',
  A11_SUDOKU_GRANT_TTL_SECONDS: '900',
});

function fixedBoard() {
  return {
    solution: BASE_SOLUTION.slice(),
    puzzle: BASE_SOLUTION.map((value, index) => (index % 2 === 0 ? value : 0)),
  };
}

test('generated Sudoku board is valid and never exposes its solution as the puzzle', () => {
  const board = generateSudokuBoard();
  assert.equal(board.solution.length, 81);
  assert.equal(board.puzzle.length, 81);
  assert.equal(isValidSudokuGrid(board.solution), true);
  assert.ok(board.puzzle.filter(Boolean).length >= 28);
  assert.ok(board.puzzle.some((value) => value === 0));
  board.puzzle.forEach((value, index) => {
    if (value) assert.equal(value, board.solution[index]);
  });
});

test('Sudoku capability requires owner solve, independent Marvin approval and one-time redeem', () => {
  let counter = 0;
  const service = createSudokuCapabilityService({
    env: ENV,
    boardFactory: fixedBoard,
    randomBytes: (length) => Buffer.alloc(length, (counter += 1) % 255),
  });

  assert.throws(() => service.createChallenge({ id: 'basic', email: 'basic@example.com' }), {
    code: 'sudoku_full_access_account_required',
  });

  const challenge = service.createChallenge(OWNER);
  assert.equal(challenge.state, 'pending');
  assert.equal(challenge.requiresMarvinApproval, true);
  assert.equal(Object.hasOwn(challenge, 'solution'), false);
  assert.deepEqual(challenge.agents, ['djeff-cypher', 'vivy']);
  assert.equal(challenge.guardian, 'marvin');

  assert.throws(() => service.solveChallenge(challenge.id, OWNER, Array(81).fill(1)), {
    code: 'sudoku_solution_invalid',
  });
  const solved = service.solveChallenge(challenge.id, OWNER, BASE_SOLUTION);
  assert.equal(solved.state, 'awaiting_marvin');
  assert.ok(solved.approvalCode.length >= 12);

  assert.throws(() => service.approveChallenge(challenge.id, {
    id: 'other-admin',
    email: 'other@example.com',
    role: 'admin',
  }, solved.approvalCode), { code: 'marvin_approval_required' });

  const approved = service.approveChallenge(challenge.id, MARVIN, solved.approvalCode);
  assert.equal(approved.state, 'approved');
  const grant = service.redeemChallenge(challenge.id, OWNER);
  assert.equal(grant.state, 'redeemed');
  assert.equal(grant.grant, 'creative_full_session');
  assert.deepEqual(grant.scopes, CREATIVE_SCOPES);
  assert.deepEqual(grant.boundaries, HARD_BOUNDARIES);
  assert.ok(!grant.scopes.some((scope) => /secret|billing|deploy|hardware|paid|cross-account/i.test(scope)));

  const verified = service.verifyCapabilityToken(grant.capabilityToken, OWNER);
  assert.equal(verified.active, true);
  assert.equal(verified.subject, OWNER.id);
  assert.deepEqual(verified.agents, ['djeff-cypher', 'vivy']);
  assert.throws(() => service.verifyCapabilityToken(grant.capabilityToken, MARVIN), {
    code: 'creative_capability_subject_mismatch',
  });
  assert.throws(() => service.redeemChallenge(challenge.id, OWNER), {
    code: 'sudoku_challenge_not_approved',
  });
});

test('Marvin cannot approve a challenge that he owns', () => {
  const service = createSudokuCapabilityService({ env: ENV, boardFactory: fixedBoard });
  const challenge = service.createChallenge(MARVIN);
  const solved = service.solveChallenge(challenge.id, MARVIN, BASE_SOLUTION);
  assert.throws(() => service.approveChallenge(challenge.id, MARVIN, solved.approvalCode), {
    code: 'two_person_rule_required',
  });
});

test('expired challenges and missing secrets fail closed', () => {
  let current = 1_000_000;
  const service = createSudokuCapabilityService({
    env: { ...ENV, A11_SUDOKU_CHALLENGE_TTL_MS: '60000' },
    now: () => current,
    boardFactory: fixedBoard,
  });
  const challenge = service.createChallenge(OWNER);
  current += 60_001;
  assert.throws(() => service.solveChallenge(challenge.id, OWNER, BASE_SOLUTION), {
    code: 'sudoku_challenge_expired',
  });

  const disabled = createSudokuCapabilityService({ env: {}, boardFactory: fixedBoard });
  assert.equal(disabled.status(OWNER).enabled, false);
  assert.throws(() => disabled.createChallenge(OWNER), {
    code: 'sudoku_capability_not_configured',
  });
});

test('capability header never aliases the normal account Bearer token', () => {
  assert.equal(readCapabilityToken({ headers: { 'x-a11-creative-capability': 'creative-token' } }), 'creative-token');
  assert.equal(readCapabilityToken({ headers: { authorization: 'Capability scoped-token' } }), 'scoped-token');
  assert.equal(readCapabilityToken({ headers: { authorization: 'Bearer account-token' } }), '');
});

test('HTTP route completes owner solve, Marvin approval, redeem and validation', async (t) => {
  const service = createSudokuCapabilityService({ env: ENV, boardFactory: fixedBoard });
  const app = express();
  app.use((req, _res, next) => {
    req.user = req.headers['x-test-user'] === 'marvin' ? MARVIN : OWNER;
    next();
  });
  app.use('/api', createSudokuCapabilityRouter({ service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const json = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, options);
    return { response, payload: await response.json() };
  };

  const created = await json('/challenges', { method: 'POST' });
  assert.equal(created.response.status, 201);
  const id = created.payload.challenge.id;
  const solved = await json(`/challenges/${id}/solve`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ solution: BASE_SOLUTION }),
  });
  assert.equal(solved.response.status, 200);

  const approved = await json(`/challenges/${id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': 'marvin' },
    body: JSON.stringify({
      approvalCode: solved.payload.challenge.approvalCode,
      confirm: 'marvin-approve-creative-session',
    }),
  });
  assert.equal(approved.response.status, 200);

  const redeemed = await json(`/challenges/${id}/redeem`, { method: 'POST' });
  assert.equal(redeemed.response.status, 200);
  const validated = await json('/validate', {
    headers: { 'x-a11-creative-capability': redeemed.payload.capabilityToken },
  });
  assert.equal(validated.response.status, 200);
  assert.equal(validated.payload.active, true);
});
