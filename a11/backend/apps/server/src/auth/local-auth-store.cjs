const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
  const resolvedFilePath = path.resolve(String(filePath || path.join(process.cwd(), 'runtime', 'auth', 'local-users.json')));

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
      created_at: new Date().toISOString(),
    };
    state.users.push(user);
    writeState(state);
    return toPublicUser(user);
  }

  return {
    filePath: resolvedFilePath,
    createUser,
    findUserByIdentifier,
  };
}

module.exports = {
  createLocalAuthStore,
};
