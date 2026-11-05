'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PrivateRepoRelay, MIN_RETENTION_MS, crypto: seal } = require('../src/index.cjs');
const { GitHubAdapter } = require('../src/github-adapter.cjs');

class FakeGitHub {
  constructor(owner = 'Funesterie') { this.owner = owner; this.repos = new Map(); this.deleted = []; this.nextId = 100; }
  async createPrivateRepo(name) {
    if (this.repos.has(name)) throw new Error('Already exists');
    const repo = { id: this.nextId++, name, private: true, owner: { login: this.owner }, files: new Map() };
    this.repos.set(name, repo);
    return { ...repo, files: undefined };
  }
  async getRepo(name) {
    const r = this.repos.get(name);
    if (!r) throw new Error('Not found');
    return r;
  }
  async putJson(name, path, body) {
    const repo = await this.getRepo(name);
    if (repo.files.has(path)) throw new Error('File already exists');
    repo.files.set(path, structuredClone(body));
  }
  async getJson(name, path) {
    const r = await this.getRepo(name);
    return structuredClone(r.files.get(path) || null);
  }
  async listJson(name, directory) {
    const r = await this.getRepo(name);
    return [...r.files.keys()].filter(k => k.startsWith(directory + '/') && !k.slice(directory.length + 1).includes('/'))
      .map(k => k.slice(directory.length + 1));
  }
  async deleteRepo(name) { this.deleted.push(name); this.repos.delete(name); }
}

function setup(opts = {}) {
  const github = new FakeGitHub();
  const key = Buffer.alloc(32, 7);
  let now = Date.parse('2026-11-05T09:00:00Z');
  const relay = new PrivateRepoRelay({ github, sharedKey: key, now: () => now, ...opts });
  return { github, key, relay, advance(ms) { now += ms; } };
}

test('AES-GCM ties ciphertext to session and direction', () => {
  const key = Buffer.alloc(32, 5);
  const sessionId = '57f0663a-44ad-4c8e-a64d-32d638d32164';
  const item = seal.encrypt(key, { message: 'classified-payload' }, { sessionId, direction: 'request' });
  assert.equal(JSON.stringify(item).includes('classified-payload'), false);
  assert.deepEqual(seal.decrypt(key, item, { sessionId, direction: 'request' }), { message: 'classified-payload' });
  assert.throws(() => seal.decrypt(key, item, { sessionId, direction: 'response' }), /binding mismatch/);
  item.ciphertext = Buffer.from('bad').toString('base64');
  assert.throws(() => seal.decrypt(key, item, { sessionId, direction: 'request' }));
  assert.throws(() => seal.parseKey('password'));
});

test('creates a private repository and delivers encrypted MCP requests and responses', async () => {
  const { github, relay } = setup({ allowedTools: ['lotus__search'] });
  const session = await relay.createSession();
  assert.match(session.repoName, /^a11-mcp-relay-[a-f0-9]{16}$/);
  assert.equal((await github.getRepo(session.repoName)).private, true);
  assert.equal((await github.getJson(session.repoName, '.a11-relay/session.json')).sessionId, session.sessionId);
  await assert.rejects(relay.sendMcpRequest(session, 'tools/call', { name: 'github__delete_repository' }), /not explicitly allowed/);
  const request = await relay.sendMcpRequest(session, 'tools/call', { name: 'lotus__search', arguments: { q: 'lotus' } }, 3);
  const raw = await github.getJson(session.repoName, request.path);
  assert.equal(JSON.stringify(raw).includes('lotus__search'), false);
  assert.deepEqual((await relay.listMessages(session, 'request'))[0].payload, {
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lotus__search', arguments: { q: 'lotus' } }
  });
  await relay.sendMcpResponse(session, 3, { result: { matches: 4 } });
  assert.deepEqual((await relay.listMessages(session, 'response'))[0].payload.result, { matches: 4 });
});

test('cleanup is blocked unless acknowledged, aged, opted in and exact repository named', async () => {
  const s = setup({ allowDelete: true });
  const session = await s.relay.createSession();
  await assert.rejects(s.relay.cleanup(session), /no recipient acknowledgment/);
  const request = await s.relay.sendMcpRequest(session, 'ping', {}, 'ping-1');
  await s.relay.sendMcpResponse(session, 'ping-1', { result: { ok: true } });
  await s.relay.acknowledge(session, [request.messageId]);
  await assert.rejects(s.relay.cleanup(session), /minimum retention/);
  s.advance(MIN_RETENTION_MS + 1);
  const preview = await s.relay.cleanup(session);
  assert.equal(preview.dryRun, true);
  assert.deepEqual(s.github.deleted, []);
  await assert.rejects(s.relay.cleanup(session, { dryRun: false }), /exact repo confirmation/);
  const confirmation = `DELETE ${session.owner}/${session.repoName}`;
  assert.deepEqual(await s.relay.cleanup(session, { dryRun: false, confirmation }), {
    deleted: true, repo: `${session.owner}/${session.repoName}`
  });
  assert.deepEqual(s.github.deleted, [session.repoName]);
});

test('deletion remains disabled by default even with confirmation', async () => {
  const s = setup();
  const session = await s.relay.createSession();
  const request = await s.relay.sendMcpRequest(session, 'ping', {}, 'ping-1');
  await s.relay.sendMcpResponse(session, 'ping-1', { result: { ok: true } });
  await s.relay.acknowledge(session, [request.messageId]);
  s.advance(MIN_RETENTION_MS + 1);
  await assert.rejects(s.relay.cleanup(session, {
    dryRun: false, confirmation: `DELETE ${session.owner}/${session.repoName}`
  }), /disabled/);
  assert.equal(s.github.deleted.length, 0);
});

test('refuses private-to-public downgrade, marker swap or different process deletion', async () => {
  const s = setup({ allowDelete: true });
  const session = await s.relay.createSession();
  const repo = await s.github.getRepo(session.repoName);
  repo.private = false;
  await assert.rejects(s.relay.sendMcpRequest(session, 'ping'), /privacy mismatch/);
  repo.private = true;
  repo.files.get('.a11-relay/session.json').repoId = -1;
  await assert.rejects(s.relay.sendMcpRequest(session, 'ping'), /marker mismatch/);
  repo.files.get('.a11-relay/session.json').repoId = session.repoId;
  const newRelay = new PrivateRepoRelay({ github: s.github, sharedKey: s.key, now: () => session.createdAt + MIN_RETENTION_MS + 1, allowDelete: true });
  const request = await s.relay.sendMcpRequest(session, 'ping', {}, 'ping-1');
  await s.relay.sendMcpResponse(session, 'ping-1', { result: { ok: true } });
  await s.relay.acknowledge(session, [request.messageId]);
  await assert.rejects(newRelay.cleanup(session), /not created by this relay process/);
});

test('acknowledgment requires actual responses and rejects unknown or duplicate message IDs', async () => {
  const s = setup({ allowDelete: true });
  const session = await s.relay.createSession();
  const first = await s.relay.sendMcpRequest(session, 'ping', {}, 'p1');
  await assert.rejects(s.relay.acknowledge(session, [first.messageId]), /without matching responses/);
  await s.relay.sendMcpResponse(session, 'p1', { result: { ok: true } });
  await assert.rejects(s.relay.acknowledge(session, ['00000000-0000-0000-0000-000000000000']), /every request message/);
  await assert.rejects(s.relay.acknowledge(session, [first.messageId, first.messageId]), /every request message/);
  await s.relay.acknowledge(session, [first.messageId]);
  s.advance(MIN_RETENTION_MS + 1);
  const preview = await s.relay.cleanup(session);
  assert.equal(preview.eligible, true);
});

test('cleanup fails closed when new messages appear after acknowledgment', async () => {
  const s = setup({ allowDelete: true });
  const session = await s.relay.createSession();
  const first = await s.relay.sendMcpRequest(session, 'ping', {}, 'p1');
  await s.relay.sendMcpResponse(session, 'p1', { result: {} });
  await s.relay.acknowledge(session, [first.messageId]);
  await s.relay.sendMcpRequest(session, 'ping', {}, 'p2');
  s.advance(MIN_RETENTION_MS + 1);
  await assert.rejects(s.relay.cleanup(session, {
    dryRun: false, confirmation: `DELETE ${session.owner}/${session.repoName}`
  }), /every request message/);
  assert.deepEqual(s.github.deleted, []);
});

test('response correlation rejects unknown and duplicated RPC responses', async () => {
  const s = setup({ allowDelete: true });
  const session = await s.relay.createSession();
  const first = await s.relay.sendMcpRequest(session, 'ping', {}, 'p1');
  await s.relay.sendMcpResponse(session, 'unknown', { result: {} });
  await assert.rejects(s.relay.acknowledge(session, [first.messageId]), /Unexpected or duplicate/);
});

test('GitHub adapter creates private repositories using server-side authentication', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return { status: 201, ok: true, json: async () => ({ private: true, name: 'a11-mcp-relay-0011223344556677', owner: { login: 'Funesterie' }, id: 9 }) };
  };
  const api = new GitHubAdapter({ token: 'dummy-not-a-real-token', owner: 'Funesterie', fetchImpl: fakeFetch });
  await api.createPrivateRepo('a11-mcp-relay-0011223344556677');
  assert.equal(calls[0].url, 'https://api.github.com/orgs/Funesterie/repos');
  assert.equal(JSON.parse(calls[0].options.body).private, true);
  assert.equal(calls[0].options.headers.authorization, 'Bearer dummy-not-a-real-token');
  assert.throws(() => api.repoPath('alphaonze'), /Unexpected relay repo/);
});