const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveBindHost } = require('../src/network/bind-config.cjs');

test('resolveBindHost defaults to localhost', () => {
  assert.equal(resolveBindHost({}), '127.0.0.1');
});

test('resolveBindHost respects explicit HOST override first', () => {
  assert.equal(resolveBindHost({
    HOST: ' 192.168.1.44 ',
    HOST_SERVER: '0.0.0.0',
  }), '192.168.1.44');
});

test('resolveBindHost falls back to HOST_SERVER when HOST is unset', () => {
  assert.equal(resolveBindHost({
    HOST_SERVER: '0.0.0.0',
  }), '0.0.0.0');
});

test('resolveBindHost binds publicly on Render when no explicit host is set', () => {
  assert.equal(resolveBindHost({
    RENDER_SERVICE_ID: 'srv-example',
  }), '0.0.0.0');
});
