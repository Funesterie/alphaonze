'use strict';

const crypto = require('node:crypto');
const { parseKey, encrypt, decrypt } = require('./crypto.cjs');
const SCHEMA = 'funesterie-mcp-private-repo-relay/v1';
const PREFIX = 'a11-mcp-relay-';
const MARKER_PATH = '.a11-relay/session.json';
const MIN_RETENTION_MS = 10 * 60 * 1000;
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
const MCP_METHODS = new Set(['initialize', 'ping', 'tools/list', 'tools/call']);

function assertSafeSession(session) {
  if (!session || !/^a11-mcp-relay-[a-f0-9]{16}$/.test(session.repoName || '') ||
      typeof session.sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(session.sessionId) ||
      !(Number.isSafeInteger(session.repoId) || typeof session.repoId === 'string')) {
    throw new Error('Invalid relay session descriptor');
  }
}

class PrivateRepoRelay {
  constructor({ github, sharedKey, allowedTools = [], now = () => Date.now(), allowDelete = false }) {
    if (!github || typeof github.createPrivateRepo !== 'function') throw new Error('GitHub adapter required');
    this.github = github;
    this.key = parseKey(sharedKey);
    this.allowedTools = new Set(allowedTools);
    this.now = now;
    this.allowDelete = allowDelete === true;
    // Intentionally process-local: after a restart, deletion requires manual review.
    this.createdRepoIds = new Map();
  }

  async createSession({ lifetimeMs = 60 * 60 * 1000 } = {}) {
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < MIN_RETENTION_MS || lifetimeMs > MAX_SESSION_MS) {
      throw new Error('Session lifetime must be between 10 minutes and 24 hours');
    }
    const repoName = PREFIX + crypto.randomBytes(8).toString('hex');
    const sessionId = crypto.randomUUID();
    const repo = await this.github.createPrivateRepo(repoName);
    if (repo.private !== true || repo.name !== repoName ||
        repo.owner?.login?.toLowerCase() !== this.github.owner?.toLowerCase()) {
      throw new Error('Created repository failed private/owner validation; manual review required');
    }
    const createdAt = this.now();
    const session = {
      schema: SCHEMA, sessionId, repoId: repo.id, repoName,
      owner: this.github.owner, createdAt, expiresAt: createdAt + lifetimeMs
    };
    // A failed marker write does not automatically delete a repo: it is left for review.
    await this.github.putJson(repoName, MARKER_PATH, session);
    this.createdRepoIds.set(repoName, repo.id);
    return session;
  }

  async verifiedSession(session, { permitExpired = false } = {}) {
    assertSafeSession(session);
    if (session.owner !== this.github.owner || session.schema !== SCHEMA) throw new Error('Relay owner/schema mismatch');
    const repo = await this.github.getRepo(session.repoName);
    if (!repo || repo.private !== true || repo.name !== session.repoName ||
        repo.owner?.login?.toLowerCase() !== session.owner.toLowerCase() ||
        String(repo.id) !== String(session.repoId)) throw new Error('Repo identity or privacy mismatch');
    const marker = await this.github.getJson(session.repoName, MARKER_PATH);
    if (!marker || marker.schema !== SCHEMA || marker.sessionId !== session.sessionId ||
        marker.owner !== session.owner || marker.repoName !== session.repoName ||
        String(marker.repoId) !== String(session.repoId) ||
        marker.createdAt !== session.createdAt || marker.expiresAt !== session.expiresAt) {
      throw new Error('Session marker mismatch');
    }
    if (!permitExpired && this.now() >= session.expiresAt) throw new Error('Relay session expired');
    return marker;
  }

  async push(session, direction, payload) {
    if (!['request', 'response'].includes(direction)) throw new Error('Invalid direction');
    await this.verifiedSession(session);
    const envelope = encrypt(this.key, payload, { sessionId: session.sessionId, direction });
    const path = `messages/${direction}-${envelope.messageId}.json`;
    await this.github.putJson(session.repoName, path, envelope);
    return { messageId: envelope.messageId, path };
  }

  async sendMcpRequest(session, method, params = {}, id = crypto.randomUUID()) {
    if (!['string', 'number'].includes(typeof id) ||
        (typeof id === 'number' && !Number.isFinite(id))) throw new Error('MCP request ID must be a string or finite number');
    if (!MCP_METHODS.has(method)) throw new Error('MCP method not allowed in relay');
    if (method === 'tools/call' && (!params || !this.allowedTools.has(params.name))) {
      throw new Error('MCP tool is not explicitly allowed');
    }
    return this.push(session, 'request', { jsonrpc: '2.0', id, method, params });
  }

  async sendMcpResponse(session, id, { result, error } = {}) {
    if (id === null || id === undefined || (result === undefined) === (error === undefined)) {
      throw new Error('Exactly one of result or error is required');
    }
    return this.push(session, 'response', {
      jsonrpc: '2.0', id, ...(result === undefined ? { error } : { result })
    });
  }

  async listMessages(session, direction, { permitExpired = false } = {}) {
    if (!['request', 'response'].includes(direction)) throw new Error('Invalid direction');
    await this.verifiedSession(session, { permitExpired });
    const listed = await this.github.listJson(session.repoName, 'messages');
    // Never silently ignore an unrecognized file that could contain an
    // unacknowledged message when deciding whether cleanup is safe.
    if (listed.some(n => !/^(request|response)-[0-9a-f-]{36}\.json$/.test(n))) {
      throw new Error('Unexpected message filename in relay mailbox');
    }
    const names = listed.filter(n => n.startsWith(direction + '-')).sort();
    const messages = [];
    for (const name of names) {
      const env = await this.github.getJson(session.repoName, 'messages/' + name);
      if (!env) continue;
      if (name !== `${direction}-${env.messageId}.json`) throw new Error('Envelope filename mismatch');
      messages.push({ messageId: env.messageId, payload: decrypt(this.key, env, { sessionId: session.sessionId, direction }) });
    }
    return messages;
  }

  // A cleanup receipt is valid only if it covers the entire current session
  // and every request has exactly one matching JSON-RPC response. The check
  // is repeated just before cleanup to reject newly arrived messages.
  async assertCompleteExchange(session, processedIds, { permitExpired = false } = {}) {
    const requests = await this.listMessages(session, 'request', { permitExpired });
    const responses = await this.listMessages(session, 'response', { permitExpired });
    if (!requests.length) throw new Error('No requests to acknowledge');
    const messageIds = new Set(requests.map(m => m.messageId));
    const acknowledged = new Set(processedIds);
    if (acknowledged.size !== processedIds.length || acknowledged.size !== messageIds.size ||
        [...messageIds].some(id => !acknowledged.has(id))) {
      throw new Error('Acknowledgment must cover every request message exactly once');
    }
    const requestRpcIds = new Set();
    for (const { payload } of requests) {
      if (payload?.jsonrpc !== '2.0' || !MCP_METHODS.has(payload.method) ||
          !['string', 'number'].includes(typeof payload.id) ||
          (typeof payload.id === 'number' && !Number.isFinite(payload.id))) {
        throw new Error('Invalid MCP request in session');
      }
      const key = JSON.stringify(payload.id);
      if (requestRpcIds.has(key)) throw new Error('Duplicate MCP request ID');
      requestRpcIds.add(key);
    }
    const responseRpcIds = new Set();
    for (const { payload } of responses) {
      const key = JSON.stringify(payload?.id);
      if (payload?.jsonrpc !== '2.0' || !requestRpcIds.has(key) ||
          (payload.result === undefined) === (payload.error === undefined) ||
          responseRpcIds.has(key)) {
        throw new Error('Unexpected or duplicate MCP response in session');
      }
      responseRpcIds.add(key);
    }
    if (responseRpcIds.size !== requestRpcIds.size) {
      throw new Error('Cannot acknowledge requests without matching responses');
    }
  }

  async acknowledge(session, processedIds) {
    if (!Array.isArray(processedIds) || !processedIds.length ||
        processedIds.some(x => typeof x !== 'string' || !/^[a-f0-9-]{36}$/.test(x))) {
      throw new Error('Expected non-empty list of message IDs');
    }
    await this.verifiedSession(session);
    await this.assertCompleteExchange(session, processedIds);
    const ack = encrypt(this.key, { done: true, processedIds, at: this.now() },
      { sessionId: session.sessionId, direction: 'ack' });
    await this.github.putJson(session.repoName, 'acks/done.json', ack);
    return { acknowledged: true, count: processedIds.length };
  }

  async cleanup(session, { dryRun = true, confirmation = '' } = {}) {
    await this.verifiedSession(session, { permitExpired: true });
    if (String(this.createdRepoIds.get(session.repoName)) !== String(session.repoId)) {
      throw new Error('Deletion forbidden: repository not created by this relay process');
    }
    const ack = await this.github.getJson(session.repoName, 'acks/done.json');
    if (!ack) throw new Error('Deletion forbidden: no recipient acknowledgment');
    const payload = decrypt(this.key, ack, { sessionId: session.sessionId, direction: 'ack' });
    if (payload.done !== true || !Array.isArray(payload.processedIds) || !payload.processedIds.length) {
      throw new Error('Deletion forbidden: acknowledgment invalid');
    }
    await this.assertCompleteExchange(session, payload.processedIds, { permitExpired: true });
    if (this.now() - session.createdAt < MIN_RETENTION_MS) {
      throw new Error('Deletion forbidden: minimum retention is 10 minutes');
    }
    const repo = `${session.owner}/${session.repoName}`;
    if (dryRun) return { eligible: true, dryRun: true, wouldDelete: repo };
    if (!this.allowDelete || confirmation !== `DELETE ${repo}`) {
      throw new Error('Deletion disabled: require server opt-in and exact repo confirmation');
    }
    await this.github.deleteRepo(session.repoName);
    this.createdRepoIds.delete(session.repoName);
    return { deleted: true, repo };
  }
}

module.exports = { PrivateRepoRelay, MIN_RETENTION_MS, SCHEMA, MARKER_PATH };