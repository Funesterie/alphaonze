const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  classifyTagsFromText,
  collectMessages,
  readAssetManifest,
  readConversationFile,
  redactSensitiveText,
} = require('../scripts/index-chatgpt-export-neo4j.cjs');

test('ChatGPT export index redacts likely secrets before chunking', () => {
  const result = redactSensitiveText('token=sk-testsecretsecretsecretsecretsecret et hf_abcdefghijklmno123456789');
  assert.ok(result.redactionCount >= 2);
  assert.equal(result.text.includes('sk-test'), false);
  assert.equal(result.text.includes('hf_abcdefgh'), false);
});

test('ChatGPT export index classifies NUMA and runtime tags', () => {
  assert.deepEqual(classifyTagsFromText('NUMA force des nombres avec Neo4j et MCP Docker'), [
    'infra_runtime',
    'mcp_tools',
    'neo4j_memory',
    'numa',
  ]);
});

test('ChatGPT export index extracts conversation messages and chunks', () => {
  const conversation = {
    id: 'conv-1',
    title: 'NUMA test',
    mapping: {
      a: {
        id: 'a',
        parent: null,
        message: {
          id: 'msg-1',
          author: { role: 'user' },
          create_time: 1780000000,
          content: { content_type: 'text', parts: ['en NUMA 16 maison et 40 mort'] },
          status: 'finished_successfully',
        },
      },
    },
  };
  const messages = collectMessages(conversation, { chunkSize: 12, previewSize: 80 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].tags.includes('numa'), true);
  assert.ok(messages[0].chunks.length > 1);
});

test('ChatGPT export index reads conversation files and asset manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-export-index-'));
  fs.writeFileSync(path.join(dir, 'conversations-000.json'), JSON.stringify([{
    id: 'conv-1',
    title: 'Vivy NUMA',
    create_time: 1780000000,
    update_time: 1780000100,
    mapping: {
      a: {
        id: 'a',
        message: {
          id: 'msg-1',
          author: { role: 'assistant' },
          content: { parts: ['GHOST88 et ligne magenta'] },
        },
      },
    },
  }]), 'utf8');
  fs.writeFileSync(path.join(dir, 'export_manifest.json'), JSON.stringify({
    export_files: [{ path: 'conv-1/audio/test.wav', size_bytes: 123 }],
  }), 'utf8');

  const read = readConversationFile(path.join(dir, 'conversations-000.json'), { chunkSize: 5000, previewSize: 200 });
  assert.equal(read.conversationRows.length, 1);
  assert.equal(read.messageRows.length, 1);
  assert.equal(read.tags.includes('numa'), true);

  const assets = readAssetManifest(dir);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].conversationId, 'conv-1');
  assert.equal(assets[0].mediaKind, 'audio');
});
