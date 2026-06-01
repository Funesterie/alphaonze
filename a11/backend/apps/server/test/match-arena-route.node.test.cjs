const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const createMatchArenaRouter = require('../routes/match-arena.cjs');

async function withServer(registerRoutes, runAssertions) {
  const app = express();
  registerRoutes(app);
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

async function postJson(baseUrl, route, body, headers = {}) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

test('match arena scans local games and lets the local worker prepare a session', async () => {
  const previousEnv = {
    A11_MATCH_ARENA_GAMES_ROOT: process.env.A11_MATCH_ARENA_GAMES_ROOT,
    A11_MATCH_ARENA_WORKER_TOKEN: process.env.A11_MATCH_ARENA_WORKER_TOKEN,
    A11_MATCH_ARENA_WORKER_TOKEN_FILE: process.env.A11_MATCH_ARENA_WORKER_TOKEN_FILE,
    A11_MATCH_ARENA_ENABLED: process.env.A11_MATCH_ARENA_ENABLED,
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'match-arena-games-'));
  const gameDir = path.join(root, 'SNES - Test Fighter');
  fs.mkdirSync(path.join(gameDir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'test-fighter.smc'), Buffer.from('rom-placeholder'));
  fs.writeFileSync(path.join(gameDir, 'images', 'cover.png'), Buffer.from('png-placeholder'));

  process.env.A11_MATCH_ARENA_GAMES_ROOT = root;
  process.env.A11_MATCH_ARENA_WORKER_TOKEN = 'test-match-arena-worker-token';
  process.env.A11_MATCH_ARENA_ENABLED = '1';
  delete process.env.A11_MATCH_ARENA_WORKER_TOKEN_FILE;

  try {
    await withServer(
      (app) => {
        app.use('/api/match-arena', createMatchArenaRouter());
      },
      async (baseUrl) => {
        const gamesResponse = await fetch(baseUrl + '/api/match-arena/games');
        const games = await gamesResponse.json();
        assert.equal(gamesResponse.status, 200);
        assert.equal(games.ok, true);
        assert.equal(games.games.length, 1);
        assert.equal(games.games[0].title, 'SNES - Test Fighter');
        assert.equal(games.games[0].hasCover, true);
        assert.equal(games.games[0].playableFiles[0].extension, 'smc');

        const started = await postJson(baseUrl, '/api/match-arena/sessions', {
          gameId: games.games[0].id,
          priorityTier: 'family',
        });
        assert.equal(started.response.status, 202);
        assert.equal(started.json.session.state, 'queued');
        assert.equal(started.json.session.priorityTier, 'family');

        const unauthorized = await postJson(baseUrl, '/api/match-arena/local-worker/claim', {
          workerId: 'bad-worker',
        });
        assert.equal(unauthorized.response.status, 401);

        const claimed = await postJson(baseUrl, '/api/match-arena/local-worker/claim', {
          workerId: 'test-match-worker',
        }, {
          authorization: 'Bearer test-match-arena-worker-token',
        });
        assert.equal(claimed.response.status, 200);
        assert.equal(claimed.json.session.id, started.json.session.id);
        assert.equal(claimed.json.session.game.title, 'SNES - Test Fighter');

        const completed = await postJson(baseUrl, `/api/match-arena/local-worker/sessions/${started.json.session.id}/complete`, {
          workerId: 'test-match-worker',
          stream: {
            ready: true,
            mode: 'novnc',
            url: 'https://stream.example.test/vnc.html',
          },
          runtime: {
            playable: true,
            emulator: 'retroarch',
            stream: 'novnc',
            input: 'queued-json',
            capabilities: ['retroarch', 'input-event-pull'],
          },
          localExportPath: 'D:\\agent-bus\\match-arena\\sessions\\test',
          message: 'pret',
        }, {
          authorization: 'Bearer test-match-arena-worker-token',
        });
        assert.equal(completed.response.status, 200);
        assert.equal(completed.json.session.state, 'ready');
        assert.equal(completed.json.session.export.ready, true);
        assert.equal(completed.json.session.stream.ready, true);
        assert.equal(completed.json.session.runtime.playable, true);

        const input = await postJson(baseUrl, `/api/match-arena/sessions/${started.json.session.id}/input`, {
          control: 'a',
          action: 'press',
        });
        assert.equal(input.response.status, 200);
        assert.equal(input.json.eventSeq, 1);
        assert.equal(input.json.session.state, 'running');

        const inputEvents = await postJson(baseUrl, `/api/match-arena/local-worker/sessions/${started.json.session.id}/input-events`, {
          afterSeq: 0,
        }, {
          authorization: 'Bearer test-match-arena-worker-token',
        });
        assert.equal(inputEvents.response.status, 200);
        assert.equal(inputEvents.json.events.length, 1);
        assert.equal(inputEvents.json.events[0].control, 'a');

        const statusResponse = await fetch(baseUrl + '/api/match-arena/status');
        const status = await statusResponse.json();
        assert.equal(statusResponse.status, 200);
        assert.equal(status.ok, true);
        assert.equal(status.catalog.count, 1);
        assert.equal(status.queue.priorities.family, 1);
      }
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
