const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const createSelfRewriteRouter = require('../src/routes/self-rewrite.cjs');

const PROMPT_PATH = path.resolve(__dirname, '../system_prompt.txt');
const EVOLUTION_LOG_PATH = path.resolve(__dirname, '../evolution-log.json');
const PROMPT_BACKUP_PATH = path.resolve(__dirname, '../system_prompt.backup.txt');

function preserveFiles(t, files) {
  const snapshots = new Map();
  for (const file of files) {
    const exists = fs.existsSync(file);
    snapshots.set(file, {
      exists,
      content: exists ? fs.readFileSync(file, 'utf8') : null,
    });
  }

  t.after(() => {
    for (const [file, snapshot] of snapshots.entries()) {
      if (snapshot.exists) {
        fs.writeFileSync(file, snapshot.content, 'utf8');
      } else if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  });

  return snapshots;
}

async function withSelfRewriteServer(runAssertions) {
  const app = express();
  app.use(express.json());
  app.use('/api', createSelfRewriteRouter({ verifyJWT: (_req, _res, next) => next() }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runAssertions(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error_) => (error_ ? reject(error_) : resolve()));
    });
  }
}

async function postJson(baseUrl, path_, body) {
  const response = await fetch(baseUrl + path_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { response, json };
}

test('self-rewrite refuses immutable Nindo2 before touching the prompt', async (t) => {
  const snapshots = preserveFiles(t, [PROMPT_PATH, EVOLUTION_LOG_PATH, PROMPT_BACKUP_PATH]);
  const originalPrompt = snapshots.get(PROMPT_PATH).content;

  await withSelfRewriteServer(async (baseUrl) => {
    const { response, json } = await postJson(baseUrl, '/api/self-rewrite', {
      section: 'nindo2',
      content: 'Changed text that must never replace immutable Nindo2.',
      reference: 'Naruto keeps his nindo stable through every arc',
      reason: 'regression guard',
    });

    assert.equal(response.status, 403);
    assert.equal(json.error, 'section_immutable');
    assert.equal(fs.readFileSync(PROMPT_PATH, 'utf8'), originalPrompt);
  });
});

test('self-rewrite updates compact Nindo3 without adding duplicate headers', async (t) => {
  preserveFiles(t, [PROMPT_PATH, EVOLUTION_LOG_PATH, PROMPT_BACKUP_PATH]);

  await withSelfRewriteServer(async (baseUrl) => {
    const { response, json } = await postJson(baseUrl, '/api/self-rewrite', {
      section: 'nindo3',
      content: 'Je garde un fil clair dans le bruit.',
      reference: 'Naruto keeps a clear personal rule under pressure',
      reason: 'compact prompt format',
    });

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);

    const updatedPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');
    assert.match(updatedPrompt, /^Nindo3 : Je garde un fil clair dans le bruit\.$/m);
    assert.doesNotMatch(updatedPrompt, /^# Nindo3$/m);
  });
});
