'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  agentJobsStatus,
  dispatchTasks,
  getAllowedWorkers,
  getWorkerStatus,
  startWorker,
} = require('../lib/worker-supervisor.cjs');

function withTempRuntime(fn) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-worker-supervisor-'));
  try {
    return fn(runtimeRoot);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

test('worker supervisor exposes only npm-script whitelist entries', () => withTempRuntime((runtimeRoot) => {
  const workers = getAllowedWorkers();
  assert.ok(workers.some((worker) => worker.id === 'identity-archivist'));
  assert.ok(workers.some((worker) => worker.id === 'westside-chopper-doctor'));
  assert.ok(workers.some((worker) => worker.id === 'westside-chopper-recipes'));
  assert.ok(workers.some((worker) => worker.id === 'westside-chopper-rumble'));
  assert.ok(workers.some((worker) => worker.id === 'funesterie-mixer-status'));
  assert.ok(workers.some((worker) => worker.id === 'funesterie-mixer-write'));
  assert.ok(workers.some((worker) => worker.id === 'sync-runtime-hooks-neo4j-dry-run'));
  assert.ok(workers.some((worker) => worker.id === 'test-mcp'));
  assert.ok(workers.every((worker) => worker.npmScript && !worker.npmScript.includes(' ')));

  const status = getWorkerStatus({ auditLimit: 2 }, { runtimeRoot });
  assert.equal(status.ok, true);
  assert.equal(status.workers.length, workers.length);
  assert.ok(status.allowedAgents.includes('claude'));
  assert.ok(status.allowedAgents.includes('copilot'));
  assert.ok(status.allowedAgents.includes('grok'));
  assert.ok(status.allowedAgents.includes('gemini'));
}));

test('worker supervisor dry-run start plans without creating a worker lock', () => withTempRuntime((runtimeRoot) => {
  const result = startWorker({
    agent: 'codex',
    workerId: 'identity-archivist-dry-run',
    dryRun: true,
    reason: 'unit test',
  }, { runtimeRoot });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.command, 'npm run worker:archivist:dry-run');

  const lockPath = path.join(runtimeRoot, 'worker-supervisor', 'locks', 'identity-archivist-dry-run.lock.json');
  assert.equal(fs.existsSync(lockPath), false);
}));

test('worker supervisor refuses non-whitelisted worker ids', () => withTempRuntime((runtimeRoot) => {
  assert.throws(
    () => startWorker({ agent: 'codex', workerId: 'powershell-free-for-all', dryRun: true }, { runtimeRoot }),
    /not whitelisted/
  );
}));

test('task dispatch dry-run accepts external agents without writing task files', () => withTempRuntime((runtimeRoot) => {
  const result = dispatchTasks({
    agent: 'claude',
    project: 'Funesterie',
    tasks: [
      'Verifier les source cards pour A11',
      { text: 'Preparer un briefing agents externes' },
    ],
    targetAgents: ['copilot', 'grok', 'gemini'],
    dryRun: true,
  }, { runtimeRoot });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.job.taskCount, 2);
  assert.match(result.command, /^npm run dispatch -- --file /);
  assert.equal(fs.existsSync(result.job.taskFile), false);

  const jobs = agentJobsStatus({ agent: 'codex' }, { runtimeRoot });
  assert.equal(jobs.ok, true);
  assert.ok(jobs.knownAgents.some((agent) => agent.id === 'copilot' && agent.launchRole === 'external-agent-caller'));
}));

test('worker supervisor rejects secret-looking task payloads', () => withTempRuntime((runtimeRoot) => {
  const secretLikeTask = [
    'Ajouter ',
    'token',
    '=',
    'abc',
    '123',
    '456',
    '789',
    'SECRET',
    ' dans le corpus',
  ].join('');

  assert.throws(
    () => dispatchTasks({
      agent: 'codex',
      tasks: [secretLikeTask],
      dryRun: true,
    }, { runtimeRoot }),
    /secret-looking content refused/
  );
}));
