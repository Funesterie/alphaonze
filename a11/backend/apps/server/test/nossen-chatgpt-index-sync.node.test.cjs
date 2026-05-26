const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseCsvLine,
  readCsvRecords,
  splitTags,
} = require('../../../../../scripts/nossen/nossen-chatgpt-index-sync.cjs');

test('nossen ChatGPT index sync parses quoted CSV rows', () => {
  assert.deepEqual(parseCsvLine('id,"titre, avec virgule",2026,1,"a;b","rome,qflush"'), [
    'id',
    'titre, avec virgule',
    '2026',
    '1',
    'a;b',
    'rome,qflush',
  ]);
});

test('nossen ChatGPT index sync reads metadata-only records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-chatgpt-index-'));
  const file = path.join(dir, 'neo4j_conversations.csv');
  fs.writeFileSync(file, [
    'id,title,updated,score,themes,modules',
    'abc,"Titre test",2026-05-22T00:00:00Z,42,"neo4j_memory;modules_npm","rome,qflush"',
    'abc,"Duplicate ignored",2026-05-22T00:00:00Z,1,"media_generation","bat"',
    'def,"Autre titre",2026-05-23T00:00:00Z,7,"security_access","nezlephant"',
  ].join('\n'), 'utf8');

  const records = readCsvRecords(file);

  assert.equal(records.length, 2);
  assert.equal(records[0].externalId, 'abc');
  assert.equal(records[0].title, 'Titre test');
  assert.equal(records[0].score, 42);
  assert.deepEqual(records[0].themes, ['neo4j_memory', 'modules_npm']);
  assert.deepEqual(records[0].modules, ['rome', 'qflush']);
});

test('nossen ChatGPT index sync splits compact tag strings', () => {
  assert.deepEqual(splitTags('neo4j_memory; modules_npm, qflush'), [
    'neo4j_memory',
    'modules_npm',
    'qflush',
  ]);
});
