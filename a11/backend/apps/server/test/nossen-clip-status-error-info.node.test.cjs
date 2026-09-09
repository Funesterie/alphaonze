'use strict';

/**
 * CI-ONLY integration test.
 *
 * Ce test requiert express + http.createServer. Dans le sandbox de
 * développement, l'installation npm est bloquée (registre 403) donc ce
 * fichier NE PEUT PAS s'exécuter localement. Il est correct et s'exécutera
 * dans la CI où les dépendances s'installent. La logique pure de parsing du
 * node_type est couverte sans dépendance par nossen-clip-error-info.node.test.cjs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isole le store de jobs sur disque.
process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-status-errinfo-'));

const { createClipRouter } = require('../src/clips/clip-router.cjs');

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
      server.close((error_) => (error_ ? reject(error_) : resolve()));
    });
  }
}

async function getJson(baseUrl, route) {
  const response = await fetch(baseUrl + route);
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null };
}

async function postJson(baseUrl, route, body) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null };
}

function waitForTerminal(baseUrl, jobId, { timeoutMs = 4000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      const { json } = await getJson(baseUrl, '/status/' + encodeURIComponent(jobId));
      if (json && (json.status === 'error' || json.status === 'done')) return resolve(json);
      if (Date.now() > deadline) return reject(new Error('timeout waiting for terminal status'));
      setTimeout(tick, 50);
    };
    tick().catch(reject);
  });
}

test('GET /status/:id expose errorInfo {node_type, message} pour un job échoué (préfixe de code)', async () => {
  await withServer(
    (app) => {
      const router = createClipRouter({
        generateClipImpl: async () => {
          throw new Error('clip_video_generation_failed: API key is invalid or expired');
        },
      });
      app.use('/', router);
    },
    async (baseUrl) => {
      const { json: started } = await postJson(baseUrl, '/start', { songUrl: '/api/vivy/studio/assets/test.mp3', title: 'errinfo' });
      assert.ok(started.jobId, 'jobId doit être renvoyé');
      const terminal = await waitForTerminal(baseUrl, started.jobId);
      assert.equal(terminal.status, 'error');
      // Le champ legacy `error` reste une chaîne (rétrocompatibilité).
      assert.equal(typeof terminal.error, 'string');
      assert.match(terminal.error, /clip_video_generation_failed/);
      // Le nouveau champ structuré errorInfo est présent.
      assert.ok(terminal.errorInfo, 'errorInfo doit être présent');
      assert.equal(terminal.errorInfo.node_type, 'clip_video_generation_failed');
      assert.match(terminal.errorInfo.message, /API key is invalid or expired/);
    }
  );
});

test('GET /status/:id retombe sur node_type clip_generation_failed pour une erreur sans préfixe', async () => {
  await withServer(
    (app) => {
      const router = createClipRouter({
        generateClipImpl: async () => {
          throw new Error('Aucune vidéo générée — dernier échec : timeout');
        },
      });
      app.use('/', router);
    },
    async (baseUrl) => {
      const { json: started } = await postJson(baseUrl, '/start', { songUrl: '/api/vivy/studio/assets/test.mp3', title: 'errinfo-noprefix' });
      const terminal = await waitForTerminal(baseUrl, started.jobId);
      assert.equal(terminal.status, 'error');
      assert.ok(terminal.errorInfo);
      assert.equal(terminal.errorInfo.node_type, 'clip_generation_failed');
      assert.match(terminal.errorInfo.message, /Aucune vidéo générée/);
    }
  );
});
