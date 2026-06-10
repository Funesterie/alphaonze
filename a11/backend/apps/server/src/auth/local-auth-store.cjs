const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function createLocalUserId(username, email) {
  const seed = `${normalizeText(username).toLowerCase()}|${normalizeEmail(email)}|${Date.now()}|${Math.random()}`;
  return `local-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16)}`;
}

function createLocalAuthStore({ filePath, logger = console } = {}) {
  const resolvedFilePath = path.resolve(String(filePath || path.join(getCanonicalRuntimeRoot(process.env), 'auth', 'local-users.json')));

  function ensureDirectory() {
    fs.mkdirSync(path.dirname(resolvedFilePath), { recursive: true });
  }

  function readState() {
    ensureDirectory();
    if (!fs.existsSync(resolvedFilePath)) {
      return { version: 1, users: [] };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(resolvedFilePath, 'utf8'));
      const users = Array.isArray(parsed?.users) ? parsed.users : [];
      return { version: 1, users };
    } catch (error_) {
      logger?.warn?.('[AUTH] Local auth store unreadable:', error_?.message);
      return { version: 1, users: [] };
    }
  }

  function writeState(state) {
    ensureDirectory();
    const payload = JSON.stringify({
      version: 1,
      users: Array.isArray(state?.users) ? state.users : [],
      updatedAt: new Date().toISOString(),
    }, null, 2);
    const tmpPath = `${resolvedFilePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, payload, 'utf8');
    fs.renameSync(tmpPath, resolvedFilePath);
  }

  function toPublicUser(user) {
    if (!user) return null;
    return {
      id: normalizeText(user.id),
      username: normalizeText(user.username),
      email: normalizeEmail(user.email),
      password_hash: normalizeText(user.password_hash),
      auth_session_version: Number(user.auth_session_version || 0) || 0,
      last_global_logout_at: user.last_global_logout_at || null,
      created_at: user.created_at || null,
      auth_provider: 'local-file',
    };
  }

  function findUserByIdentifier(identifier) {
    const normalizedIdentifier = normalizeText(identifier);
    const normalizedIdentifierLower = normalizedIdentifier.toLowerCase();
    if (!normalizedIdentifierLower) return null;
    const state = readState();
    const user = state.users.find((candidate) => {
      const username = normalizeText(candidate?.username).toLowerCase();
      const email = normalizeEmail(candidate?.email);
      return username === normalizedIdentifierLower || email === normalizedIdentifierLower;
    });
    return toPublicUser(user || null);
  }

  function createUser({ username, email, passwordHash } = {}) {
    const normalizedUsername = normalizeText(username);
    const normalizedUsernameLower = normalizedUsername.toLowerCase();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPasswordHash = normalizeText(passwordHash);
    if (!normalizedUsername || !normalizedEmail || !normalizedPasswordHash) {
      const error = new Error('missing_fields');
      error.code = 'missing_fields';
      throw error;
    }

    const state = readState();
    const usernameTaken = state.users.some((candidate) => normalizeText(candidate?.username).toLowerCase() === normalizedUsernameLower);
    if (usernameTaken) {
      const error = new Error('username_taken');
      error.code = 'username_taken';
      throw error;
    }

    const emailTaken = state.users.some((candidate) => normalizeEmail(candidate?.email) === normalizedEmail);
    if (emailTaken) {
      const error = new Error('email_taken');
      error.code = 'email_taken';
      throw error;
    }

    const user = {
      id: createLocalUserId(normalizedUsername, normalizedEmail),
      username: normalizedUsername,
      email: normalizedEmail,
      password_hash: normalizedPasswordHash,
      auth_session_version: 0,
      created_at: new Date().toISOString(),
    };
    state.users.push(user);
    writeState(state);
    return toPublicUser(user);
  }

  function findUserIndex(user = {}) {
    const identityId = normalizeText(user.id || user.sub || user.user_id || user.userId);
    const identityEmail = normalizeEmail(user.email);
    const identityUsername = normalizeText(user.username || user.preferred_username || user.name).toLowerCase();
    const state = readState();
    const index = state.users.findIndex((candidate) => {
      const id = normalizeText(candidate?.id);
      const username = normalizeText(candidate?.username).toLowerCase();
      const email = normalizeEmail(candidate?.email);
      return Boolean(identityId && id === identityId)
        || Boolean(identityEmail && email === identityEmail)
        || Boolean(identityUsername && username === identityUsername);
    });
    return { state, index };
  }

  function getSessionVersion(user = {}) {
    const { state, index } = findUserIndex(user);
    if (index < 0) return null;
    return Number(state.users[index]?.auth_session_version || 0) || 0;
  }

  function bumpSessionVersion(user = {}) {
    const { state, index } = findUserIndex(user);
    if (index < 0) return null;
    const nextVersion = (Number(state.users[index]?.auth_session_version || 0) || 0) + 1;
    state.users[index].auth_session_version = nextVersion;
    state.users[index].last_global_logout_at = new Date().toISOString();
    writeState(state);
    return nextVersion;
  }

  return {
    filePath: resolvedFilePath,
    createUser,
    findUserByIdentifier,
    getSessionVersion,
    bumpSessionVersion,
  };
}

module.exports = {
  createLocalAuthStore,
};
