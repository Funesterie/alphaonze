'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { searchChatGptHistory } = require('../src/knowledge/chatgpt-keyword-search.cjs');
const { buildDjeffMemoryContext } = require('../src/persona/djeff-memory.cjs');

// Index minuscule : deux reponses de ChatGPT longues, un message de Djeff court.
function writeIndex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djeff-memory-'));
  const file = path.join(dir, 'chatgpt-keyword-index.json');
  fs.writeFileSync(file, JSON.stringify({
    // 10 passages au total : un terme present dans plus de la moitie est ignore par la recherche.
    schema: 'test', passages: 10,
    index: { memoire: [0, 1, 2], couteau: [0, 1, 2], miroir: [0, 1, 2] },
    passages_meta: [
      { title: 'GPT', role: 'assistant', preview: 'Une longue reponse de ChatGPT sur la memoire, le couteau et le miroir.' },
      { title: 'GPT', role: 'assistant', preview: 'Encore ChatGPT : memoire, couteau, miroir, et beaucoup de mots.' },
      { title: 'Vivy', role: 'user', preview: 'Moi je veux que Vivy soit mon couteau, pas mon miroir, et qu elle garde la memoire.' },
    ],
  }));
  return { dir, file };
}

test('le filtre par role remonte les mots de Djeff, pas ceux de ChatGPT', () => {
  const { dir, file } = writeIndex();
  try {
    const env = { A11_CHATGPT_KEYWORD_INDEX: file };
    const tous = searchChatGptHistory('memoire couteau miroir', { limit: 3, env });
    assert.equal(tous.results.length, 3);
    const siens = searchChatGptHistory('memoire couteau miroir', { limit: 3, role: 'user', env });
    assert.deepEqual(siens.results.map((r) => r.role), ['user']);
    assert.match(siens.results[0].preview, /mon couteau, pas mon miroir/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('la memoire de Djeff cite ses propres mots, et se coupe par variable', async () => {
  const { dir, file } = writeIndex();
  try {
    const env = { A11_CHATGPT_KEYWORD_INDEX: file, A11_CHAT_GRAPH_CONTEXT: '0', A11_DJEFF_LEXICON: '0' };
    const memoire = await buildDjeffMemoryContext('Vivy est-elle mon couteau ou mon miroir, avec sa memoire ?', env);
    assert.match(memoire, /TES PROPRES MOTS/);
    assert.match(memoire, /mon couteau, pas mon miroir/);
    assert.doesNotMatch(memoire, /Une longue reponse de ChatGPT/);
    assert.equal(await buildDjeffMemoryContext('Vivy couteau miroir memoire', { ...env, DJEFF_ENGINE_MEMORY: '0' }), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Djeff Engine ouvre sa memoire au seul compte fondateur', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/vivy-studio.cjs'), 'utf8');
  assert.match(source, /const memoire = !technicalAudit && isVivyFounderUser\(req\?\.user \|\| \{\}\)/);
});
