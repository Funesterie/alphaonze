#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '..');
const nodeBin = process.execPath;

function flagDisabled(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function runBlocking(label, args, options = {}) {
  console.log(`[Startup] ${label}`);
  const result = spawnSync(nodeBin, args, {
    cwd: serverRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    if (options.bestEffort) {
      console.warn(`[Startup] ${label} skipped: ${result.error.message}`);
      return;
    }
    throw result.error;
  }

  if (result.status !== 0) {
    const message = `${label} exited with code ${result.status}`;
    if (options.bestEffort) {
      console.warn(`[Startup] ${message}`);
      return;
    }
    throw new Error(message);
  }
}

function startServer() {
  const entry = process.argv[2] || process.env.A11_SERVER_ENTRY || 'server.cjs';
  const child = spawn(nodeBin, [entry], {
    cwd: serverRoot,
    env: {
      ...process.env,
      A11_STARTUP_WORKERS_DONE: '1',
    },
    stdio: 'inherit',
    windowsHide: true,
  });

  child.on('error', (error) => {
    console.error(`[Startup] Server failed to start: ${error.message}`);
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[Startup] Server stopped by ${signal}`);
      process.exit(0);
    }
    process.exit(code || 0);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }
}

try {
  runBlocking('applying startup schema', ['scripts/apply-startup-schema.cjs']);

  if (!flagDisabled(process.env.A11_RUN_STARTUP_WORKERS)) {
    runBlocking(
      'running identity archivist worker',
      ['scripts/identity-archivist-worker.cjs', '--write-corpus'],
      { bestEffort: true }
    );
  } else {
    console.log('[Startup] identity archivist worker disabled by A11_RUN_STARTUP_WORKERS');
  }

  if (process.env.A11_START_WITH_WORKERS_SKIP_SERVER === '1') {
    console.log('[Startup] skip-server requested; startup checks complete');
    process.exit(0);
  }

  startServer();
} catch (error) {
  console.error(`[Startup] Fatal startup step failed: ${error.message}`);
  process.exit(1);
}
