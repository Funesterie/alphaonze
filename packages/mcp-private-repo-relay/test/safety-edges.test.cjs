'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GitHubAdapter, PrivateRepoRelay } = require('../src/index.cjs');

function fakeAdapterForListing(entries) {
  const fetchImpl = async (url, { method }) => {
    assert.equal(method, 'GET');
    assert.match(url, /\/contents\/messages$/);
    return new Response(JSON.stringify(entries), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };
  return new GitHubAdapter({
    token: 'fake-token-for-test-only', owner: 'Funesterie', fetchImpl
  });
}

test('refuses GitHub contents results at the pagination limit', async () => {
  const entries = Array.from({ length: 1000 }, (_, i) => ({
    type: 'file', name: 'request-' + String(i).padStart(36, '0') + '.json'
  }));
  const gh = fakeAdapterForListing(entries);
  await assert.rejects(
    gh.listJson('a11-mcp-relay-1122334455667788', 'messages'),
    /may be truncated/
  );
});

test('refuses extra files and subdirectories hidden inside a relay mailbox', async () => {
  for (const entries of [
    [{ type: 'file', name: 'unrecognized.txt' }],
    [{ type: 'dir', name: 'hidden' }]
  ]) {
    const gh = fakeAdapterForListing(entries);
    await assert.rejects(
      gh.listJson('a11-mcp-relay-1122334455667788', 'messages'),
      /Unexpected entry/
    );
  }
});

test('does not ignore unexpected JSON messages when listing a session', async () => {
  let sessionMarker;
  const gh = {
    owner: 'Funesterie',
    async createPrivateRepo(name) {
      return { id: 123, name, private: true, owner: { login: 'Funesterie' } };
    },
    async getRepo(name) {
      return { id: 123, name, private: true, owner: { login: 'Funesterie' } };
    },
    async putJson(name, path, payload) {
      if (path === '.a11-relay/session.json') sessionMarker = structuredClone(payload);
    },
    async getJson(name, path) {
      return path === '.a11-relay/session.json' ? structuredClone(sessionMarker) : null;
    },
    async listJson() { return ['unexpected.json']; },
    async deleteRepo() { throw new Error('must never delete'); }
  };
  const relay = new PrivateRepoRelay({
    github: gh, sharedKey: Buffer.alloc(32, 8),
    allowedTools: [], allowDelete: false
  });
  const session = await relay.createSession();
  await assert.rejects(relay.listMessages(session, 'request'), /Unexpected message filename/);
});
