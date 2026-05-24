'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeVersion(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function getUserIdentity(user = {}) {
  return {
    id: normalizeText(user.id ?? user.sub ?? user.user_id ?? user.userId),
    email: normalizeEmail(user.email ?? user.mail ?? user.userPrincipalName),
    username: normalizeText(user.username ?? user.preferred_username ?? user.name),
  };
}

function getUserKey(user = {}) {
  const identity = getUserIdentity(user);
  if (identity.id) return `id:${identity.id}`;
  if (identity.email) return `email:${identity.email}`;
  if (identity.username) return `username:${identity.username.toLowerCase()}`;
  return '';
}

function isUserSessionToken(payload = {}) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.agent === true || payload.typ === 'agent_token') return false;
  return Boolean(getUserKey(payload));
}

function resolveRegistryFile(filePath) {
  const explicit = normalizeText(
    filePath
    || process.env.A11_AUTH_SESSION_REGISTRY_FILE
    || process.env.AUTH_SESSION_REGISTRY_FILE
  );
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);

  const runtimeRoot = normalizeText(process.env.A11_RUNTIME_ROOT);
  const root = runtimeRoot
    ? (path.isAbsolute(runtimeRoot) ? runtimeRoot : path.resolve(process.cwd(), runtimeRoot))
    : path.join(process.cwd(), 'runtime');
  return path.join(root, 'auth', 'auth-sessions.json');
}

function readFileState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, users: {}, sessions: {} };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      version: 1,
      users: parsed && typeof parsed.users === 'object' && parsed.users ? parsed.users : {},
      sessions: parsed && typeof parsed.sessions === 'object' && parsed.sessions ? parsed.sessions : {},
    };
  } catch {
    return { version: 1, users: {}, sessions: {} };
  }
}

function writeFileState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify({
    version: 1,
    users: state && typeof state.users === 'object' && state.users ? state.users : {},
    sessions: state && typeof state.sessions === 'object' && state.sessions ? state.sessions : {},
    updatedAt: new Date().toISOString(),
  }, null, 2);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, filePath);
}

function createSessionId() {
  if (typeof crypto.randomUUID === 'function') return `sid_${crypto.randomUUID()}`;
  return `sid_${crypto.randomBytes(24).toString('hex')}`;
}

function hashMeta(value) {
  const text = normalizeText(value);
  if (!text) return '';
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);
}

function getRequestHost(req) {
  return normalizeText(req?.headers?.['x-forwarded-host'] || req?.headers?.host).split(',')[0].trim();
}

function getRequestIpHash(req) {
  const raw = normalizeText(
    req?.headers?.['cf-connecting-ip']
    || req?.headers?.['x-real-ip']
    || req?.headers?.['x-forwarded-for']
    || req?.ip
    || req?.socket?.remoteAddress
  ).split(',')[0].trim();
  return hashMeta(raw);
}

function normalizeSurface(value) {
  const raw = normalizeText(value).toLowerCase();
  if (['kaen44', 'kaen', 'k44'].includes(raw)) return 'k44';
  if (['a11', 'alphaonze', 'cp', 'ops', 'admin'].includes(raw)) return 'a11';
  if (['vivy', 'music'].includes(raw)) return 'vivy';
  if (['funesterie', 'general', 'web', 'public'].includes(raw)) return 'funesterie';
  if (['a11+vivy', 'a11-vivy'].includes(raw)) return 'a11+vivy';
  return raw || 'funesterie';
}

function buildSessionSummary(record = {}, currentSessionId = '') {
  const sessionId = normalizeText(record.session_id || record.sessionId || record.sid);
  return {
    id: sessionId,
    current: Boolean(currentSessionId && sessionId === currentSessionId),
    userId: normalizeText(record.user_id || record.userId) || undefined,
    email: normalizeEmail(record.email) || undefined,
    username: normalizeText(record.username) || undefined,
    provider: normalizeText(record.provider) || undefined,
    surface: normalizeSurface(record.surface),
    client: normalizeText(record.client) || undefined,
    createdAt: normalizeIsoDate(record.created_at || record.createdAt),
    lastSeenAt: normalizeIsoDate(record.last_seen_at || record.lastSeenAt),
    expiresAt: normalizeIsoDate(record.expires_at || record.expiresAt),
    revokedAt: normalizeIsoDate(record.revoked_at || record.revokedAt),
    requestHost: normalizeText(record.request_host || record.requestHost) || undefined,
  };
}

function createRevokedError(message = 'A11_SESSION_REVOKED') {
  const error = new Error(message);
  error.code = 'A11_SESSION_REVOKED';
  error.status = 401;
  return error;
}

function createAuthSessionRegistry({ db, localAuthStore, logger = console, filePath } = {}) {
  const registryFile = resolveRegistryFile(filePath);
  let dbSchemaReady = false;
  let dbSchemaFailed = false;

  async function ensureDbSchema() {
    if (!db || dbSchemaReady || dbSchemaFailed) return false;
    try {
      await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_session_version INTEGER DEFAULT 0');
      await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_global_logout_at TIMESTAMP');
      await db.query(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          session_id TEXT PRIMARY KEY,
          user_key TEXT NOT NULL,
          user_id TEXT,
          email TEXT,
          username TEXT,
          provider TEXT,
          surface TEXT,
          client TEXT,
          session_generation INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          last_seen_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP,
          revoked_at TIMESTAMP,
          request_host TEXT,
          user_agent_hash TEXT,
          ip_hash TEXT
        )
      `);
      await db.query('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_key ON auth_sessions(user_key, last_seen_at DESC)');
      await db.query('CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at ON auth_sessions(revoked_at)');
      dbSchemaReady = true;
      return true;
    } catch (error) {
      dbSchemaFailed = true;
      logger?.warn?.('[AUTH] session registry schema unavailable:', error?.message);
      return false;
    }
  }

  async function queryDbVersion(user) {
    if (!db || !(await ensureDbSchema())) return null;
    const identity = getUserIdentity(user);
    const selectors = [];
    if (identity.id) selectors.push(['id::text=$1', identity.id]);
    if (identity.email) selectors.push(['LOWER(email)=LOWER($1)', identity.email]);
    if (identity.username) selectors.push(['LOWER(username)=LOWER($1)', identity.username]);

    for (const [where, value] of selectors) {
      try {
        const result = await db.query(
          `SELECT COALESCE(auth_session_version, 0)::int AS version FROM users WHERE ${where} LIMIT 1`,
          [value]
        );
        if (result.rows[0]) return normalizeVersion(result.rows[0].version);
      } catch (error) {
        logger?.warn?.('[AUTH] session version lookup failed:', error?.message);
        return null;
      }
    }
    return null;
  }

  async function bumpDbVersion(user) {
    if (!db || !(await ensureDbSchema())) return null;
    const identity = getUserIdentity(user);
    const selectors = [];
    if (identity.id) selectors.push(['id::text=$1', identity.id]);
    if (identity.email) selectors.push(['LOWER(email)=LOWER($1)', identity.email]);
    if (identity.username) selectors.push(['LOWER(username)=LOWER($1)', identity.username]);

    for (const [where, value] of selectors) {
      try {
        const result = await db.query(
          `UPDATE users
           SET auth_session_version = COALESCE(auth_session_version, 0) + 1,
               last_global_logout_at = NOW(),
               updated_at = NOW()
           WHERE ${where}
           RETURNING COALESCE(auth_session_version, 0)::int AS version`,
          [value]
        );
        if (result.rows[0]) return normalizeVersion(result.rows[0].version);
      } catch (error) {
        logger?.warn?.('[AUTH] session version bump failed:', error?.message);
        return null;
      }
    }
    return null;
  }

  async function getSessionVersion(user = {}) {
    if (!isUserSessionToken(user)) return 0;

    const dbVersion = await queryDbVersion(user);
    if (dbVersion !== null) return dbVersion;

    if (localAuthStore && typeof localAuthStore.getSessionVersion === 'function') {
      const localVersion = await localAuthStore.getSessionVersion(user);
      if (localVersion !== null && localVersion !== undefined) return normalizeVersion(localVersion);
    }

    const key = getUserKey(user);
    if (!key) return 0;
    const state = readFileState(registryFile);
    return normalizeVersion(state.users[key]?.generation);
  }

  async function setFileVersion(user, nextVersion) {
    const key = getUserKey(user);
    if (!key) return 0;
    const state = readFileState(registryFile);
    state.users[key] = {
      ...(state.users[key] || {}),
      generation: normalizeVersion(nextVersion),
      lastGlobalLogoutAt: new Date().toISOString(),
    };
    writeFileState(registryFile, state);
    return normalizeVersion(nextVersion);
  }

  async function createSession({ req, user = {}, provider = '', surface = '', client = '', expiresAt = null } = {}) {
    const key = getUserKey(user);
    if (!key) return { sessionId: '', sessionGeneration: 0 };

    const identity = getUserIdentity(user);
    const sessionGeneration = await getSessionVersion(user);
    const sessionId = createSessionId();
    const now = new Date().toISOString();
    const record = {
      session_id: sessionId,
      user_key: key,
      user_id: identity.id || '',
      email: identity.email || '',
      username: identity.username || '',
      provider: normalizeText(provider || user.provider || user.auth_provider || (user.localAuth ? 'local' : '')),
      surface: normalizeSurface(surface || user.surface),
      client: normalizeText(client || 'web').slice(0, 64),
      session_generation: sessionGeneration,
      created_at: now,
      last_seen_at: now,
      expires_at: normalizeIsoDate(expiresAt),
      revoked_at: null,
      request_host: getRequestHost(req),
      user_agent_hash: hashMeta(req?.headers?.['user-agent']),
      ip_hash: getRequestIpHash(req),
    };

    if (db && (await ensureDbSchema())) {
      try {
        await db.query(
          `INSERT INTO auth_sessions (
            session_id, user_key, user_id, email, username, provider, surface, client,
            session_generation, created_at, last_seen_at, expires_at, request_host,
            user_agent_hash, ip_hash
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),$10,$11,$12,$13)`,
          [
            record.session_id,
            record.user_key,
            record.user_id || null,
            record.email || null,
            record.username || null,
            record.provider || null,
            record.surface || null,
            record.client || null,
            record.session_generation,
            record.expires_at ? new Date(record.expires_at) : null,
            record.request_host || null,
            record.user_agent_hash || null,
            record.ip_hash || null,
          ]
        );
        return { sessionId, sessionGeneration, record };
      } catch (error) {
        logger?.warn?.('[AUTH] session insert failed, using file registry:', error?.message);
      }
    }

    const state = readFileState(registryFile);
    state.users[key] = state.users[key] || { generation: sessionGeneration };
    state.sessions[sessionId] = record;
    writeFileState(registryFile, state);
    return { sessionId, sessionGeneration, record };
  }

  async function readSession(sessionId) {
    const sid = normalizeText(sessionId);
    if (!sid) return null;

    if (db && (await ensureDbSchema())) {
      try {
        const result = await db.query('SELECT * FROM auth_sessions WHERE session_id=$1 LIMIT 1', [sid]);
        if (result.rows[0]) return result.rows[0];
      } catch (error) {
        logger?.warn?.('[AUTH] session lookup failed:', error?.message);
      }
    }

    const state = readFileState(registryFile);
    return state.sessions[sid] || null;
  }

  async function touchSession(sessionId) {
    const sid = normalizeText(sessionId);
    if (!sid) return;
    if (db && (await ensureDbSchema())) {
      try {
        await db.query('UPDATE auth_sessions SET last_seen_at=NOW() WHERE session_id=$1 AND revoked_at IS NULL', [sid]);
        return;
      } catch (error) {
        logger?.warn?.('[AUTH] session touch failed:', error?.message);
      }
    }
    const state = readFileState(registryFile);
    if (state.sessions[sid] && !state.sessions[sid].revoked_at) {
      state.sessions[sid].last_seen_at = new Date().toISOString();
      writeFileState(registryFile, state);
    }
  }

  async function assertTokenCurrent(claims = {}) {
    if (!isUserSessionToken(claims)) return true;

    const key = getUserKey(claims);
    const currentVersion = await getSessionVersion(claims);
    const tokenVersion = normalizeVersion(
      claims.sv
      ?? claims.sessionVersion
      ?? claims.sessionGeneration
      ?? claims.auth_session_version
    );
    if (currentVersion > tokenVersion) {
      throw createRevokedError();
    }

    const sessionId = normalizeText(claims.sid || claims.sessionId || claims.session_id);
    if (!sessionId) return true;

    const session = await readSession(sessionId);
    if (!session || normalizeText(session.user_key) !== key) {
      throw createRevokedError();
    }
    if (session.revoked_at || session.revokedAt) {
      throw createRevokedError();
    }
    const expiresAt = normalizeIsoDate(session.expires_at || session.expiresAt);
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      throw createRevokedError();
    }
    await touchSession(sessionId);
    return true;
  }

  async function listSessions(claims = {}) {
    if (!isUserSessionToken(claims)) return [];
    const key = getUserKey(claims);
    const currentSessionId = normalizeText(claims.sid || claims.sessionId || claims.session_id);

    if (db && (await ensureDbSchema())) {
      try {
        const result = await db.query(
          `SELECT *
           FROM auth_sessions
           WHERE user_key=$1
           ORDER BY revoked_at NULLS FIRST, last_seen_at DESC, created_at DESC
           LIMIT 50`,
          [key]
        );
        return result.rows.map((row) => buildSessionSummary(row, currentSessionId));
      } catch (error) {
        logger?.warn?.('[AUTH] session list failed:', error?.message);
      }
    }

    const state = readFileState(registryFile);
    return Object.values(state.sessions)
      .filter((record) => normalizeText(record?.user_key) === key)
      .sort((a, b) => String(b.last_seen_at || b.created_at || '').localeCompare(String(a.last_seen_at || a.created_at || '')))
      .slice(0, 50)
      .map((record) => buildSessionSummary(record, currentSessionId));
  }

  async function revokeSession(claims = {}, sessionId = '') {
    if (!isUserSessionToken(claims)) return { ok: false, error: 'session_identity_missing' };
    const key = getUserKey(claims);
    const sid = normalizeText(sessionId);
    if (!sid) return { ok: false, error: 'session_id_missing' };

    const session = await readSession(sid);
    if (!session) return { ok: false, error: 'session_not_found' };
    if (normalizeText(session.user_key) !== key) return { ok: false, error: 'session_not_found' };

    const revokedAt = new Date().toISOString();
    if (db && (await ensureDbSchema())) {
      try {
        await db.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at, NOW()) WHERE session_id=$1 AND user_key=$2', [sid, key]);
        return { ok: true, sessionId: sid, revokedAt };
      } catch (error) {
        logger?.warn?.('[AUTH] session revoke failed:', error?.message);
      }
    }

    const state = readFileState(registryFile);
    if (state.sessions[sid] && normalizeText(state.sessions[sid].user_key) === key) {
      state.sessions[sid].revoked_at = state.sessions[sid].revoked_at || revokedAt;
      writeFileState(registryFile, state);
      return { ok: true, sessionId: sid, revokedAt };
    }
    return { ok: false, error: 'session_not_found' };
  }

  async function revokeCurrentSession(claims = {}) {
    const sid = normalizeText(claims?.sid || claims?.sessionId || claims?.session_id);
    if (!sid) return { ok: true, legacy: true };
    return revokeSession(claims, sid);
  }

  async function revokeAllForUser(user = {}) {
    if (!isUserSessionToken(user)) return { ok: false, error: 'session_identity_missing' };
    const key = getUserKey(user);

    let nextVersion = await bumpDbVersion(user);
    let store = 'db';
    if (nextVersion === null) {
      if (localAuthStore && typeof localAuthStore.bumpSessionVersion === 'function') {
        const localVersion = await localAuthStore.bumpSessionVersion(user);
        if (localVersion !== null && localVersion !== undefined) {
          nextVersion = normalizeVersion(localVersion);
          store = 'local-auth-store';
        }
      }
    }
    if (nextVersion === null) {
      const currentVersion = await getSessionVersion(user);
      nextVersion = await setFileVersion(user, currentVersion + 1);
      store = 'file';
    }

    const revokedAt = new Date().toISOString();
    if (db && (await ensureDbSchema())) {
      try {
        await db.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at, NOW()) WHERE user_key=$1', [key]);
      } catch (error) {
        logger?.warn?.('[AUTH] session revoke-all failed:', error?.message);
      }
    }

    const state = readFileState(registryFile);
    let fileChanged = false;
    for (const record of Object.values(state.sessions)) {
      if (normalizeText(record?.user_key) === key && !record.revoked_at) {
        record.revoked_at = revokedAt;
        fileChanged = true;
      }
    }
    if (fileChanged) writeFileState(registryFile, state);

    return { ok: true, version: nextVersion, store, allSessions: true };
  }

  return {
    createSession,
    getSessionVersion,
    assertTokenCurrent,
    listSessions,
    revokeSession,
    revokeCurrentSession,
    revokeAllForUser,
    normalizeSurface,
  };
}

module.exports = {
  createAuthSessionRegistry,
  getUserKey,
  isUserSessionToken,
  normalizeSurface,
  normalizeVersion,
};
