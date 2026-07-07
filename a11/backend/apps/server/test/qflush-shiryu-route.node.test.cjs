'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const createQflushFlowRouter = require('../src/routes/qflush-flow.cjs');

async function withServer(runAssertions) {
  const app = express();
  app.use('/api/qflush', createQflushFlowRouter({
    workspaceRoot: process.cwd(),
    runtimeRoot: process.cwd(),
  }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runAssertions(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function getJson(baseUrl, route) {
  const response = await fetch(baseUrl + route);
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

async function postJson(baseUrl, route, body) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

test('Qflush publishes Shiryu V2 status and safe planning endpoints', async () => {
  await withServer(async (baseUrl) => {
    const status = await getJson(baseUrl, '/api/qflush/shiryu/v2/status');
    assert.equal(status.response.status, 200);
    assert.equal(status.json.ok, true);
    assert.equal(status.json.published, true);
    assert.equal(status.json.safeMode, true);

    const plan = await postJson(baseUrl, '/api/qflush/shiryu/v2/plan', {
      input: {
        currentMessage: 'Shiryu découpe la fumée',
        intent: 'prompt',
        payload: { style: 'anime violet' },
      },
      maxConcurrency: 2,
    });
    assert.equal(plan.response.status, 200);
    assert.equal(plan.json.ok, true);
    assert.equal(plan.json.schema, 'nossen.shiryu.v2_fanout.v1');
    assert.equal(plan.json.safeMode, true);
    assert.equal(plan.json.executed, false);
    assert.ok(plan.json.jobCount >= 2);
  });
});

test('Qflush Shiryu V2 dry-run executes without provider calls', async () => {
  await withServer(async (baseUrl) => {
    const dry = await postJson(baseUrl, '/api/qflush/shiryu/v2/dry-run', {
      input: {
        currentMessage: 'traduis et compose',
        intent: 'translate',
        payload: { source: 'test' },
      },
    });
    assert.equal(dry.response.status, 200);
    assert.equal(dry.json.ok, true);
    assert.equal(dry.json.safeMode, true);
    assert.equal(dry.json.providerCalls, 0);
    assert.equal(dry.json.run.ok, true);
    assert.equal(dry.json.run.results.length, dry.json.plan.jobCount);
  });
});

test('Qflush publishes Shiryu V3 cube-to-CUDA prepare endpoint on CPU fallback', async () => {
  await withServer(async (baseUrl) => {
    const prepared = await postJson(baseUrl, '/api/qflush/shiryu/v3/cuda/prepare', {
      input: {
        currentMessage: 'Robin mil fleurs encode les lames en RGBA',
        intent: 'compose',
        payload: { rgba: true },
      },
      op: 'sculpt',
    });
    assert.equal(prepared.response.status, 200);
    assert.equal(prepared.json.ok, true);
    assert.equal(prepared.json.schema, 'nossen.cube_to_cuda.v1');
    assert.equal(prepared.json.safeMode, true);
    assert.equal(prepared.json.executedOn, 'cpu-fallback');
    assert.ok(prepared.json.atomCount >= 1);
  });
});
