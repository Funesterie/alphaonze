'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { hasFullAccess, normalizeEmail } = require('../auth/full-access.cjs');
const { getFamilyVoiceIdentityByKey } = require('../config/family-accounts.cjs');

const CREATIVE_SCOPES = Object.freeze([
  'chat:djeff-cypher', 'chat:vivy', 'prompts:creative', 'media:prepare',
  'voice:consented', 'files:own', 'graph:read', 'clip:estimate',
]);
const HARD_BOUNDARIES = Object.freeze([
  'no-secrets', 'no-cross-account-data', 'no-billing', 'no-deploy',
  'no-destructive-infra', 'no-paid-generation-without-explicit-confirmation',
  'no-external-publication-without-explicit-confirmation', 'actuatesHardware:false',
]);
const BASE_SOLUTION = Object.freeze(Array.from({ length: 81 }, (_item, index) => {
  const row = Math.floor(index / 9);
  const column = index % 9;
  return ((row * 3 + Math.floor(row / 3) + column) % 9) + 1;
}));

function clamp(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function fail(code, status, message = code) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function userId(user = {}) {
  return String(user.id || user.user_id || user.sub || user.email || user.username || '').trim();
}

function token(randomBytes, bytes = 18) {
  return randomBytes(bytes).toString('base64url');
}

function shuffle(values, randomBytes) {
  const output = values.slice();
  for (let index = output.length - 1; index > 0; index -= 1) {
    const other = randomBytes(4).readUInt32BE(0) % (index + 1);
    [output[index], output[other]] = [output[other], output[index]];
  }
  return output;
}

function generateSudokuBoard(randomBytes = crypto.randomBytes, givens = 36) {
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], randomBytes);
  const rows = shuffle([0, 1, 2], randomBytes)
    .flatMap((band) => shuffle([0, 1, 2], randomBytes).map((row) => band * 3 + row));
  const columns = shuffle([0, 1, 2], randomBytes)
    .flatMap((stack) => shuffle([0, 1, 2], randomBytes).map((column) => stack * 3 + column));
  const solution = rows.flatMap((row) => columns.map((column) => digits[BASE_SOLUTION[row * 9 + column] - 1]));
  const puzzle = Array(81).fill(0);
  const positions = shuffle(Array.from({ length: 81 }, (_item, index) => index), randomBytes);
  positions.slice(0, clamp(givens, 36, 28, 55)).forEach((index) => { puzzle[index] = solution[index]; });
  return { puzzle, solution };
}

function normalizeGrid(value) {
  const items = Array.isArray(value) ? value : String(value || '').replace(/[^0-9]/g, '').split('');
  if (items.length !== 81) return null;
  const grid = items.map(Number);
  return grid.every((item) => Number.isInteger(item) && item >= 1 && item <= 9) ? grid : null;
}

function isValidSudokuGrid(grid) {
  if (!Array.isArray(grid) || grid.length !== 81) return false;
  const valid = (items) => items.slice().sort((a, b) => a - b).join('') === '123456789';
  for (let row = 0; row < 9; row += 1) if (!valid(grid.slice(row * 9, row * 9 + 9))) return false;
  for (let column = 0; column < 9; column += 1) {
    if (!valid(Array.from({ length: 9 }, (_item, row) => grid[row * 9 + column]))) return false;
  }
  for (let boxRow = 0; boxRow < 3; boxRow += 1) {
    for (let boxColumn = 0; boxColumn < 3; boxColumn += 1) {
      const box = [];
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 3; column += 1) box.push(grid[(boxRow * 3 + row) * 9 + boxColumn * 3 + column]);
      }
      if (!valid(box)) return false;
    }
  }
  return true;
}

function mac(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value || '')).digest();
}

function sameMac(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getMarvinApproverEmails(env = process.env) {
  const configured = String(env.A11_SUDOKU_MARVIN_EMAILS || '').split(/[\s,;]+/g).map(normalizeEmail).filter(Boolean);
  const identity = getFamilyVoiceIdentityByKey('marvin');
  return [...new Set([...configured, normalizeEmail(identity?.accountEmail), 'cellauromarvin@gmail.com'].filter(Boolean))];
}

function createSudokuCapabilityService(options = {}) {
  const env = options.env || process.env;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const randomBytes = typeof options.randomBytes === 'function' ? options.randomBytes : crypto.randomBytes;
  const boardFactory = typeof options.boardFactory === 'function' ? options.boardFactory : generateSudokuBoard;
  const records = new Map();
  const secret = String(env.A11_SUDOKU_TOKEN_SECRET || env.JWT_SECRET || '').trim();
  const challengeTtlMs = clamp(env.A11_SUDOKU_CHALLENGE_TTL_MS, 600000, 60000, 1800000);
  const grantTtlSeconds = clamp(env.A11_SUDOKU_GRANT_TTL_SECONDS, 900, 60, 3600);
  const maxAttempts = clamp(env.A11_SUDOKU_MAX_ATTEMPTS, 5, 1, 10);
  const issuer = 'funesterie-cerbere-sudoku';
  const audience = 'funesterie-creative-capability';

  const configured = () => {
    if (secret.length < 24) throw fail('sudoku_capability_not_configured', 503, 'Sudoku capability secret is not configured.');
  };
  const cleanup = () => {
    for (const [id, record] of records) {
      if ((record.redeemedAt || record.expiresAt) + 300000 < now()) records.delete(id);
    }
  };
  const get = (id) => {
    cleanup();
    const record = records.get(String(id || '').trim());
    if (!record) throw fail('sudoku_challenge_not_found', 404, 'Sudoku challenge not found.');
    if (record.expiresAt <= now()) {
      record.state = 'expired';
      throw fail('sudoku_challenge_expired', 410, 'Sudoku challenge expired.');
    }
    return record;
  };
  const owner = (record, user) => {
    if (!userId(user) || userId(user) !== record.ownerId) throw fail('sudoku_challenge_owner_required', 403, 'Challenge reserved to its owner.');
  };
  const view = (record) => ({
    id: record.id,
    state: record.state,
    puzzle: record.puzzle.slice(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    solveAttemptsRemaining: Math.max(0, maxAttempts - record.solveAttempts),
    requiresMarvinApproval: true,
    grant: 'creative_full_session',
    agents: ['djeff-cypher', 'vivy'],
    guardian: 'marvin',
    scopes: CREATIVE_SCOPES.slice(),
    boundaries: HARD_BOUNDARIES.slice(),
  });

  function createChallenge(user = {}) {
    configured();
    if (!userId(user) || !hasFullAccess(user, env)) throw fail('sudoku_full_access_account_required', 403, 'A Funesterie admin account is required.');
    const id = token(randomBytes);
    const board = boardFactory(randomBytes, 36);
    const solution = normalizeGrid(board?.solution);
    if (!Array.isArray(board?.puzzle) || board.puzzle.length !== 81 || !solution || !isValidSudokuGrid(solution)) {
      throw fail('sudoku_board_generation_failed', 500, 'Sudoku board generation failed.');
    }
    const record = {
      id,
      ownerId: userId(user),
      ownerEmail: normalizeEmail(user.email),
      puzzle: board.puzzle.map(Number),
      solutionHash: mac(secret, `${id}:${solution.join('')}`),
      state: 'pending',
      expiresAt: now() + challengeTtlMs,
      solveAttempts: 0,
      approvalAttempts: 0,
      approvalHash: null,
      approvedBy: null,
      redeemedAt: null,
    };
    records.set(id, record);
    return view(record);
  }

  function solveChallenge(id, user = {}, submitted) {
    configured();
    const record = get(id);
    owner(record, user);
    if (record.state !== 'pending') throw fail('sudoku_challenge_not_pending', 409, `Challenge state is ${record.state}.`);
    record.solveAttempts += 1;
    const grid = normalizeGrid(submitted);
    const givensMatch = grid && record.puzzle.every((value, index) => !value || value === grid[index]);
    const correct = grid && isValidSudokuGrid(grid) && givensMatch
      && sameMac(record.solutionHash, mac(secret, `${id}:${grid.join('')}`));
    if (!correct) {
      if (record.solveAttempts >= maxAttempts) record.state = 'locked';
      throw fail('sudoku_solution_invalid', 400, 'Sudoku solution is invalid.');
    }
    const approvalCode = token(randomBytes, 12);
    record.approvalHash = mac(secret, `${id}:${approvalCode}`);
    record.state = 'awaiting_marvin';
    return { ...view(record), approvalCode, message: 'Sudoku validé. Marvin doit approuver depuis son propre compte.' };
  }

  function approveChallenge(id, user = {}, approvalCode = '') {
    configured();
    const record = get(id);
    const approver = userId(user);
    const email = normalizeEmail(user.email);
    if (!approver || !getMarvinApproverEmails(env).includes(email)) throw fail('marvin_approval_required', 403, 'Approval is reserved to Marvin.');
    if (approver === record.ownerId || email === record.ownerEmail) throw fail('two_person_rule_required', 403, 'Owner and Marvin must be different accounts.');
    if (record.state !== 'awaiting_marvin') throw fail('sudoku_challenge_not_awaiting_approval', 409, `Challenge state is ${record.state}.`);
    record.approvalAttempts += 1;
    if (!sameMac(record.approvalHash, mac(secret, `${id}:${String(approvalCode || '').trim()}`))) {
      if (record.approvalAttempts >= maxAttempts) record.state = 'locked';
      throw fail('marvin_approval_code_invalid', 400, 'Marvin approval code is invalid.');
    }
    record.state = 'approved';
    record.approvedBy = approver;
    return { ...view(record), message: 'Marvin a approuvé. Le propriétaire peut activer sa session.' };
  }

  function redeemChallenge(id, user = {}) {
    configured();
    const record = get(id);
    owner(record, user);
    if (record.state !== 'approved') throw fail('sudoku_challenge_not_approved', 409, `Challenge state is ${record.state}.`);
    const claims = {
      sub: record.ownerId,
      email: record.ownerEmail || undefined,
      type: 'funesterie_creative_capability',
      grant: 'creative_full_session',
      agents: ['djeff-cypher', 'vivy'],
      guardian: 'marvin',
      scopes: CREATIVE_SCOPES.slice(),
      boundaries: HARD_BOUNDARIES.slice(),
      challengeId: id,
      approvedBy: record.approvedBy,
      jti: token(randomBytes),
    };
    const capabilityToken = jwt.sign(claims, secret, { algorithm: 'HS256', issuer, audience, expiresIn: grantTtlSeconds });
    record.state = 'redeemed';
    record.redeemedAt = now();
    record.approvalHash = null;
    return { ok: true, state: 'redeemed', capabilityToken, tokenType: 'Bearer', expiresIn: grantTtlSeconds, ...claims };
  }

  function verifyCapabilityToken(value, user = {}) {
    configured();
    let claims;
    try {
      claims = jwt.verify(String(value || '').trim(), secret, { algorithms: ['HS256'], issuer, audience });
    } catch (_error) {
      throw fail('creative_capability_invalid', 401, 'Creative capability token is invalid or expired.');
    }
    if (userId(user) && claims.sub !== userId(user)) throw fail('creative_capability_subject_mismatch', 403, 'Creative capability belongs to another account.');
    return {
      ok: true,
      active: true,
      grant: claims.grant,
      agents: claims.agents || [],
      guardian: claims.guardian,
      scopes: claims.scopes || [],
      boundaries: claims.boundaries || [],
      subject: claims.sub,
      challengeId: claims.challengeId,
      expiresAt: new Date(Number(claims.exp) * 1000).toISOString(),
    };
  }

  const status = (user = {}) => ({
    ok: true,
    enabled: secret.length >= 24,
    canCreate: Boolean(userId(user) && hasFullAccess(user, env)),
    canApproveAsMarvin: getMarvinApproverEmails(env).includes(normalizeEmail(user.email)),
    grant: 'creative_full_session',
    agents: ['djeff-cypher', 'vivy'],
    guardian: 'marvin',
    scopes: CREATIVE_SCOPES.slice(),
    boundaries: HARD_BOUNDARIES.slice(),
    challengeTtlMs,
    grantTtlSeconds,
  });

  return { approveChallenge, createChallenge, redeemChallenge, solveChallenge, status, verifyCapabilityToken };
}

module.exports = {
  BASE_SOLUTION,
  CREATIVE_SCOPES,
  HARD_BOUNDARIES,
  createSudokuCapabilityService,
  generateSudokuBoard,
  getMarvinApproverEmails,
  isValidSudokuGrid,
  normalizeGrid,
};
