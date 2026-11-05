'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GitHubAdapter, PrivateRepoRelay, MIN_RETENTION_MS } = require('../src/index.cjs');

function fakeGitHubREST() {
  const repos = new Map();
  const calls = [];
  let nextId = 5000;
  const answer = (data, status = 200) => new Response(
    data === null ? null : JSON.stringify(data),
    { status, headers: { 'content-type': 'application/json' } }
  );

  async function fetchImpl(url, options) {
    const u = new URL(url);
    const method = options.method;
    const path = u.pathname;
    calls.push({ method, path });
    assert.equal(u.origin, 'https://api.github.com');
    assert.equal(options.headers.authorization, 'Bearer fake-token-never-real');
    if (method === 'POST' && path === '/orgs/Funesterie/repos') {
      const body = JSON.parse(options.body);
      assert.equal(body.private, true);
      const name = body.name;
      if (repos.has(name)) return answer({ message: 'duplicate' }, 422);
      const repo = {
        id: nextId++, name, private: true, owner: { login: 'Funesterie' },
        files: new Map()
      };
      repos.set(name, repo);
      return answer({ id: repo.id, name, private: repo.private, owner: repo.owner }, 201);
    }
    const m = /^\/repos\/Funesterie\/(a11-mcp-relay-[a-f0-9]{16})(?:\/contents\/(.+))?$/.exec(path);
    if (!m) return answer({ message: 'not found' }, 404);
    const instance = repos.get(m[1]);
    if (!instance) return answer({ message: 'not found' }, 404);

    if (method === 'GET' && !m[2]) return answer({
      id: instance.id, name: instance.name,
      private: instance.private, owner: instance.owner
    });
    if (method === 'DELETE' && !m[2]) {
      repos.delete(m[1]);
      return answer(null, 204);
    }
    if (!m[2]) return answer({ message: 'not found' }, 404);
    const filePath = m[2].split('/').map(decodeURIComponent).join('/');

    if (method === 'PUT') {
      if (instance.files.has(filePath)) return answer({ message: 'sha required' }, 409);
      const body = JSON.parse(options.body);
      const bytes = Buffer.from(body.content, 'base64');
      instance.files.set(filePath, bytes.toString('utf8'));
      return answer({ content: { path: filePath } }, 201);
    }
    if (method === 'GET') {
      if (instance.files.has(filePath)) {
        return answer({
          type: 'file', encoding: 'base64',
          content: Buffer.from(instance.files.get(filePath)).toString('base64')
        });
      }
      const entries = [...instance.files.keys()]
        .filter(k => k.startsWith(filePath + '/') &&
          !k.slice(filePath.length + 1).includes('/'))
        .map(k => ({ type: 'file', name: k.slice(filePath.length + 1) }));
      return entries.length ? answer(entries) : answer({ message: 'not found' }, 404);
    }
    return answer({ message: 'method not allowed' }, 405);
  }
  return { repos, calls, fetchImpl };
}

function fixture() {
  const rest = fakeGitHubREST();
  const github = new GitHubAdapter({
    token: 'fake-token-never-real',
    owner: 'Funesterie',
    fetchImpl: rest.fetchImpl
  });
  let clock = Date.parse('2026-11-05T10:00:00Z');
  const key = Buffer.alloc(32, 17);
  const createRelay = () => new PrivateRepoRelay({
    github, sharedKey: key, allowedTools: ['lotus__search'],
    now: () => clock, allowDelete: false
  });
  return {
    ...rest, createRelay,
    advance(ms) { clock += ms; }
  };
}

test('REST integration: private repo, encrypted request/response, authenticated ACK, safe cleanup preview', async () => {
  const f = fixture();
  const sender = f.createRelay();
  const receiver = f.createRelay();
  const session = await sender.createSession();
  assert.equal(f.repos.get(session.repoName).private, true);

  const sent = await sender.sendMcpRequest(session, 'tools/call',
    { name: 'lotus__search', arguments: { q: 'Lotus' } }, 'lotus-req-1');
  const inbox = await receiver.listMessages(session, 'request');
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].payload.params.arguments.q, 'Lotus');
  assert.equal(inbox[0].payload.method, 'tools/call');

  await assert.rejects(
    receiver.acknowledge(session, [sent.messageId]),
    /without matching responses/
  );
  await receiver.sendMcpResponse(session, 'lotus-req-1', {
    result: { nodes: 3, origin: 'fake' }
  });
  const response = await sender.listMessages(session, 'response');
  assert.equal(response[0].payload.result.nodes, 3);

  await receiver.acknowledge(session, [sent.messageId]);
  f.advance(MIN_RETENTION_MS + 1);
  const result = await sender.cleanup(session);
  assert.equal(result.dryRun, true);
  assert.equal(result.eligible, true);
  assert.equal(f.repos.has(session.repoName), true);
  assert.equal(f.calls.some(c => c.method === 'DELETE'), false);

  const files = [...f.repos.get(session.repoName).files];
  const [requestPath, requestContents] =
    files.find(([path]) => path === sent.path);
  assert.equal(requestPath, sent.path);
  assert.equal(requestContents.includes('lotus__search'), false);
  assert.equal(requestContents.includes('Lotus'), false);
});

test('REST integration: visibility downgrade fails closed', async () => {
  const f = fixture();
  const relay = f.createRelay();
  const session = await relay.createSession();
  f.repos.get(session.repoName).private = false;
  await assert.rejects(
    relay.sendMcpRequest(session, 'ping', {}, 'ping-visibility'),
    /privacy mismatch/
  );
  assert.equal(f.calls.some(c => c.method === 'DELETE'), false);
});

test('REST integration: tool restrictions stop requests before GitHub writes', async () => {
  const f = fixture();
  const relay = f.createRelay();
  const session = await relay.createSession();
  const before = f.calls.filter(c => c.method === 'PUT').length;
  await assert.rejects(
    relay.sendMcpRequest(session, 'tools/call', {
      name: 'github__delete_repository', arguments: { repo: 'alphaonze' }
    }),
    /not explicitly allowed/
  );
  const after = f.calls.filter(c => c.method === 'PUT').length;
  assert.equal(after, before);
});
