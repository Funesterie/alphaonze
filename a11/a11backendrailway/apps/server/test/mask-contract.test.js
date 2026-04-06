// mask-contract.test.js
// Tests de contrat API pour MASK (compile, from-text, compilateur)

const request = require('supertest');
const assert = require('assert');
const express = require('express');
const maskRouter = require('../src/routes/mask.cjs');
const compileMaskToPython = require('../src/mask/compile-mask-to-python.cjs');

// Setup minimal Express app for route tests
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/mask', maskRouter);

// --- 1. Contrat /api/mask/compile ---
describe('/api/mask/compile', () => {
  it('refuse un body texte brut', async () => {
    const res = await request(app)
      .post('/api/mask/compile')
      .send({ text: 'trie les png par date' });
    assert.strictEqual(res.status, 400);
    assert(res.body.error);
  });

  it('refuse un MASK incomplet', async () => {
    const res = await request(app)
      .post('/api/mask/compile')
      .send({ version: '1.0' });
    assert.strictEqual(res.status, 400);
    assert(res.body.error && res.body.error.includes('missing required field'));
  });

  it('accepte un MASK valide', async () => {
    const mask = {
      version: 'mask-1',
      intent: 'code.python.generate',
      task: { domain: 'filesystem', action: 'sort_images' },
      compiler: { target: 'python', version: '1.0' },
      inputs: { path: '.', extensions: ['png'] },
      options: { sort_by: 'date', recursive: false },
      constraints: { safe_mode: true, no_delete: true }
    };
    const res = await request(app)
      .post('/api/mask/compile')
      .send(mask);
    assert.strictEqual(res.status, 200);
    assert(res.body.code && typeof res.body.code === 'string');
  });

  it('échoue proprement si compiler.target non supporté', async () => {
    const mask = {
      version: 'mask-1',
      intent: 'code.python.generate',
      task: { domain: 'filesystem', action: 'sort_images' },
      compiler: { target: 'bash', version: '1.0' },
      inputs: { path: '.', extensions: ['png'] },
      options: { sort_by: 'date', recursive: false },
      constraints: { safe_mode: true, no_delete: true }
    };
    const res = await request(app)
      .post('/api/mask/compile')
      .send(mask);
    assert.strictEqual(res.status, 400);
    assert(res.body.error);
  });
});

// --- 2. Contrat /api/mask/from-text ---
describe('/api/mask/from-text', () => {
  it('refuse text manquant', async () => {
    const res = await request(app)
      .post('/api/mask/from-text')
      .send({});
    assert.strictEqual(res.status, 400);
    assert(res.body.error);
  });

  it('refuse text vide', async () => {
    const res = await request(app)
      .post('/api/mask/from-text')
      .send({ text: '' });
    assert.strictEqual(res.status, 400);
    assert(res.body.error);
  });

  it('retourne mask + code pour un pattern reconnu', async () => {
    const res = await request(app)
      .post('/api/mask/from-text')
      .send({ text: 'trie les png de ce dossier par date' });
    assert.strictEqual(res.status, 200);
    assert(res.body.mask && res.body.code);
  });

  it('retourne une erreur explicite pour un texte non reconnu', async () => {
    const res = await request(app)
      .post('/api/mask/from-text')
      .send({ text: 'fais un truc bizarre' });
    assert.strictEqual(res.status, 400);
    assert(res.body.error);
  });
});

// --- 3. Contrat du compilateur ---
describe('compileMaskToPython', () => {
  it('gère extensions png/.png/["png","jpg"]', () => {
    const mask = {
      version: 'mask-1',
      intent: 'code.python.generate',
      task: { domain: 'filesystem', action: 'sort_images' },
      compiler: { target: 'python', version: '1.0' },
      inputs: { path: '.', extensions: ['.png', 'jpg'] },
      options: { sort_by: 'name', recursive: false },
      constraints: { safe_mode: true, no_delete: true }
    };
    const code = compileMaskToPython(mask);
    assert(code.includes(".png"));
    assert(code.includes(".jpg"));
  });

  it('gère sort_by = date | name | size', () => {
    const mask = {
      version: 'mask-1',
      intent: 'code.python.generate',
      task: { domain: 'filesystem', action: 'sort_images' },
      compiler: { target: 'python', version: '1.0' },
      inputs: { path: '.', extensions: ['png'] },
      options: { sort_by: 'date', recursive: false },
      constraints: { safe_mode: true, no_delete: true }
    };
    const code = compileMaskToPython(mask);
    assert(code.includes('getmtime'));
  });

  it('gère recursive = true/false', () => {
    const mask = {
      version: 'mask-1',
      intent: 'code.python.generate',
      task: { domain: 'filesystem', action: 'sort_images' },
      compiler: { target: 'python', version: '1.0' },
      inputs: { path: '.', extensions: ['png'] },
      options: { sort_by: 'name', recursive: true },
      constraints: { safe_mode: true, no_delete: true }
    };
    const code = compileMaskToPython(mask);
    assert(code.includes('recursive = true'));
  });

  it('échoue proprement si tâche non supportée', () => {
    const mask = {
      version: 'mask-1',
      intent: 'code.python.generate',
      task: { domain: 'filesystem', action: 'delete_all' },
      compiler: { target: 'python', version: '1.0' },
      inputs: { path: '.', extensions: ['png'] },
      options: { sort_by: 'name', recursive: false },
      constraints: { safe_mode: true, no_delete: true }
    };
    assert.throws(() => compileMaskToPython(mask), /Unsupported task/);
  });
});
