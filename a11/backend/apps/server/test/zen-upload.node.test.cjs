'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { encodeZenContainer } = require('@nossen/zen');
const { ingestUploadedFile } = require('../lib/file-ingestion.cjs');
const { analyzeUploadedResource, buildConversationResourceContext } = require('../lib/resource-reader.cjs');
const {
  ZEN_CONTENT_TYPE,
  inspectZenPublicHeader,
  prepareZenUpload,
  resolveZenUploadMaxBytes,
} = require('../lib/zen-upload.cjs');

const TEST_KEY = 'zen-upload-test-key-kept-outside-container';

function createEncryptedZen() {
  return encodeZenContainer({ message: 'payload-secret-never-exposed' }, {
    key: TEST_KEY,
    manifest: {
      intent: 'test-only',
      notes: ['private-manifest-never-exposed'],
    },
  });
}

test('ZEN upload accepts browser binary MIME and exposes only a sanitized public header', () => {
  const archive = createEncryptedZen();
  const prepared = prepareZenUpload({
    filename: 'corpus.zen',
    contentType: 'application/octet-stream',
    buffer: archive,
    maxBytes: archive.length + 1,
    globalMaxBytes: archive.length + 1,
  });

  assert.equal(prepared.isZen, true);
  assert.equal(prepared.contentType, ZEN_CONTENT_TYPE);
  assert.deepEqual(
    Object.keys(prepared.publicHeader).sort(),
    ['cipher', 'codec', 'encrypted', 'format', 'headerBytes', 'kdf', 'mode', 'payloadBytes', 'payloadDecoded', 'version'].sort()
  );
  assert.equal(prepared.publicHeader.format, 'zen');
  assert.equal(prepared.publicHeader.version, 1);
  assert.equal(prepared.publicHeader.encrypted, true);
  assert.equal(prepared.publicHeader.payloadDecoded, false);
  assert.equal(Object.hasOwn(prepared.publicHeader, 'salt'), false);
  assert.equal(Object.hasOwn(prepared.publicHeader, 'iv'), false);
  assert.equal(Object.hasOwn(prepared.publicHeader, 'tag'), false);
  assert.equal(Object.hasOwn(prepared.publicHeader, 'rawSha256'), false);
  assert.doesNotMatch(JSON.stringify(prepared), /payload-secret|private-manifest|test-key/);
});

test('ZEN upload rejects invalid MIME, missing extension, invalid header and plaintext fixtures', () => {
  const encrypted = createEncryptedZen();
  const plaintext = encodeZenContainer({ public: 'fixture' }, { allowPlaintext: true });

  assert.throws(() => prepareZenUpload({
    filename: 'corpus.zen',
    contentType: 'text/html',
    buffer: encrypted,
  }), { code: 'zen_content_type_invalid' });

  assert.throws(() => prepareZenUpload({
    filename: 'corpus.bin',
    contentType: ZEN_CONTENT_TYPE,
    buffer: encrypted,
  }), { code: 'zen_extension_required' });

  assert.throws(() => prepareZenUpload({
    filename: 'corpus.zen',
    contentType: ZEN_CONTENT_TYPE,
    buffer: Buffer.from('not-a-zen-container'),
  }), { code: 'zen_header_invalid' });

  assert.throws(() => prepareZenUpload({
    filename: 'fixture.zen',
    contentType: ZEN_CONTENT_TYPE,
    buffer: plaintext,
  }), { code: 'zen_plaintext_not_allowed' });
});

test('ZEN upload applies a dedicated size ceiling bounded by the global file limit', () => {
  assert.equal(resolveZenUploadMaxBytes(64, 32), 32);
  assert.equal(resolveZenUploadMaxBytes(16, 32), 16);

  assert.throws(() => prepareZenUpload({
    filename: 'large.zen',
    contentType: ZEN_CONTENT_TYPE,
    buffer: Buffer.alloc(17),
    maxBytes: 16,
    globalMaxBytes: 32,
  }), (error) => error?.code === 'zen_file_too_large' && error?.maxBytes === 16);
});

test('ZEN resource analysis reads the public header without decoding payload content', async () => {
  const archive = createEncryptedZen();
  const analysis = await analyzeUploadedResource({
    filename: 'corpus.zen',
    contentType: ZEN_CONTENT_TYPE,
    buffer: archive,
  });

  assert.equal(analysis.fileKind, 'zen');
  assert.equal(analysis.parser, 'zen_public_header');
  assert.equal(analysis.readableInChatContext, true);
  assert.equal(analysis.payloadOpaque, true);
  assert.equal(analysis.payloadDecoded, false);
  assert.equal(analysis.executable, false);
  assert.equal(analysis.actionInference.intent, 'zen_container_reference');
  assert.deepEqual(analysis.actionInference.routeHints, ['zen_header_inspect', 'file_reference']);
  assert.match(analysis.preview, /Header public ZEN/);
  assert.match(analysis.preview, /payload=opaque_non_decode/);
  assert.doesNotMatch(JSON.stringify(analysis), /payload-secret|private-manifest|test-key/);

  const context = buildConversationResourceContext([{
    id: 9,
    filename: 'corpus.zen',
    resourceKind: 'zen',
    contentType: ZEN_CONTENT_TYPE,
    metadata: { analysis },
  }]);
  assert.match(context, /Header public ZEN/);
  assert.match(context, /zen_header_inspect/);
  assert.doesNotMatch(context, /payload-secret|private-manifest|test-key/);
});

test('file ingestion canonicalizes ZEN MIME before content-addressed storage', async () => {
  const archive = createEncryptedZen();
  const calls = { upload: null, record: null, memory: null };

  const result = await ingestUploadedFile({
    userId: 'vivy-user',
    filename: 'mon corpus.zen',
    contentType: 'application/x-zen',
    contentBase64: archive.toString('base64'),
    maxBytes: archive.length + 1,
    maxZenBytes: archive.length + 1,
    conversationId: 'vivy-zen-test',
    resourceKind: 'zen',
    sanitizeFileName: (value) => String(value).replace(/\s+/g, '-'),
    analyzeResourceContent: analyzeUploadedResource,
    uploadBufferToR2: async (payload) => {
      calls.upload = payload;
      return { storageKey: payload.storageKey, url: 'https://files.example/corpus.zen' };
    },
    saveFileRecord: async (payload) => {
      calls.record = payload;
      return payload;
    },
    saveUserFileMemory: async (payload) => {
      calls.memory = payload;
    },
    linkConversationResource: async (payload) => payload,
  });

  assert.equal(calls.upload.contentType, ZEN_CONTENT_TYPE);
  assert.equal(calls.record.contentType, ZEN_CONTENT_TYPE);
  assert.equal(calls.memory.contentType, ZEN_CONTENT_TYPE);
  assert.match(calls.upload.storageKey, /^users\/vivy-user\/uploads\/[a-f0-9]{64}-mon-corpus\.zen$/);
  assert.equal(result.file.contentType, ZEN_CONTENT_TYPE);
  assert.equal(result.analysis.parser, 'zen_public_header');
  assert.equal(result.conversationResource.metadata.zen.payloadOpaque, true);
  assert.equal(result.conversationResource.metadata.zen.payloadDecoded, false);
  assert.doesNotMatch(JSON.stringify(result.analysis), /payload-secret|private-manifest|test-key/);
});

test('direct public-header inspection never accepts a decryption key option', () => {
  const archive = createEncryptedZen();
  const inspected = inspectZenPublicHeader(archive, {
    maxContainerBytes: archive.length + 1,
    // Deliberately ignored: the API has no key parameter and never calls decode.
    key: TEST_KEY,
  });
  assert.equal(inspected.payloadDecoded, false);
  assert.equal(inspected.encrypted, true);
});
