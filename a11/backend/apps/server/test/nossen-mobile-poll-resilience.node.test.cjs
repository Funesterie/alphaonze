'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const htmlSource = fs.readFileSync(
  path.join(__dirname, '..', 'nossen-index.html'),
  'utf8'
);

test('nossen mobile front registers a visibilitychange listener that resumes polling on foreground return', () => {
  // A visibilitychange listener must exist.
  assert.match(htmlSource, /document\.addEventListener\(\s*"visibilitychange"/);
  // The visibilitychange handler must be gated on the "visible" state.
  assert.match(
    htmlSource,
    /document\.addEventListener\(\s*"visibilitychange"[\s\S]*?document\.visibilityState === "visible"[\s\S]*?resumePollingFromForeground\(\)/
  );
});

test('nossen mobile front registers a pageshow listener for Safari iOS bfcache restore', () => {
  // A pageshow listener must exist (covers bfcache restore).
  assert.match(htmlSource, /window\.addEventListener\(\s*"pageshow"/);
  // The pageshow handler must inspect event.persisted and resume tracking.
  assert.match(
    htmlSource,
    /window\.addEventListener\(\s*"pageshow"[\s\S]*?event\.persisted[\s\S]*?resumePollingFromForeground\(\)/
  );
});

test('foreground recovery reuses the existing resumePolling state machine and guards the max window', () => {
  const fnStart = htmlSource.indexOf('function resumePollingFromForeground()');
  assert.notEqual(fnStart, -1, 'resumePollingFromForeground() must be defined');
  const fnBlock = htmlSource.slice(fnStart, fnStart + 1200);
  // Reuses resumePolling()/pollJob() rather than duplicating the poll loop.
  assert.match(fnBlock, /resumePolling\(\)/);
  // Respects the in-flight guard so it never starts a second concurrent loop.
  assert.match(fnBlock, /if \(pollInFlight\) return;/);
  // Mirrors resumePolling()'s max-window check before resurrecting a job.
  assert.match(fnBlock, /POLL_FULL_MAX_MS/);
  assert.match(fnBlock, /Date\.now\(\) - Number\(saved\.startedAt\) >= maxDuration/);
  // sessionStorage access is wrapped defensively like savePollState/clearPollState.
  assert.match(fnBlock, /try \{ saved = JSON\.parse\(sessionStorage\.getItem\(POLL_STORAGE_KEY\)[\s\S]*?\} catch \(_\) \{ return; \}/);
});
