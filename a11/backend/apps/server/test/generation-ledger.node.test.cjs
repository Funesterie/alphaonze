'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createGenerationLedger,
  hashGenerationUserId,
} = require('../src/telemetry/generation-ledger.cjs');

test('generation ledger JSONL survives recreation and isolates account stats', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-ledger-'));
  const auditPath = path.join(dir, 'events.jsonl');
  let now = 1_800_000_000_000;
  try {
    const first = createGenerationLedger({ db: null, auditPath, now: () => now });
    const lyrics = await first.start({ kind: 'lyrics', userId: 'user-a', provider: 'ollama' });
    now += 1_250;
    await first.finish(lyrics, { status: 'succeeded', provider: 'ollama-cloud', stage: 'lyrics-ready' });
    const clip = await first.start({ kind: 'full_clip', userId: 'user-b', provider: 'ffmpeg' });
    now += 500;
    await first.finish(clip, { status: 'failed', errorCode: 'ffmpeg_exit_1' });

    const second = createGenerationLedger({ db: null, auditPath, now: () => now });
    const own = await second.getStats({ userId: 'user-a', hours: 24 });
    assert.equal(own.attempts, 1);
    assert.equal(own.succeeded, 1);
    assert.equal(own.failed, 0);
    assert.equal(own.byKind.find((entry) => entry.kind === 'lyrics').averageDurationMs, 1250);

    const global = await second.getStats({ userId: 'founder', global: true, hours: 24 });
    assert.equal(global.attempts, 2);
    assert.equal(global.succeeded, 1);
    assert.equal(global.failed, 1);
    const raw = await fs.readFile(auditPath, 'utf8');
    assert.doesNotMatch(raw, /user-a|user-b/);
    assert.match(raw, new RegExp(hashGenerationUserId('user-a')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('generation ledger creates constrained postgres schema and writes lifecycle', async () => {
  const queries = [];
  const db = {
    async query(text, params = []) {
      queries.push({ text: String(text), params });
      if (/SELECT kind/i.test(text)) {
        return { rows: [{
          kind: 'full_clip', attempts: 3, succeeded: 1, failed: 1, rejected: 1,
          active: 0, average_duration_ms: 4200, p95_duration_ms: 9000,
        }] };
      }
      return { rows: [] };
    },
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-ledger-db-'));
  try {
    let now = 10_000;
    const ledger = createGenerationLedger({ db, auditPath: path.join(dir, 'events.jsonl'), now: () => now });
    const record = await ledger.start({ kind: 'full_clip', userId: 'founder', provider: 'ffmpeg' });
    now += 250;
    await ledger.finish(record, { status: 'succeeded', provider: 'comfyui-ffmpeg-r2' });
    const stats = await ledger.getStats({ userId: 'founder', global: true });

    const ddl = queries[0].text;
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS vivy_generation_requests/i);
    assert.match(ddl, /CHECK \(kind IN \('lyrics', 'full_clip'\)\)/i);
    assert.match(ddl, /WHERE status = 'running'/i);
    assert.ok(queries.some((entry) => /INSERT INTO vivy_generation_requests/i.test(entry.text)));
    assert.ok(queries.some((entry) => /UPDATE vivy_generation_requests/i.test(entry.text)));
    assert.equal(stats.attempts, 3);
    assert.equal(stats.byKind.find((entry) => entry.kind === 'full_clip').p95DurationMs, 9000);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
