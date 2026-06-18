'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ONE_GIB } = require('../src/storage/account-storage-quota.cjs');

function createPcm16Wav({ frequency = 440, durationSec = 0.25, sampleRate = 16000, amplitude = 0.25 } = {}) {
  const sampleCount = Math.max(1, Math.floor(durationSec * sampleRate));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude * 32767);
    buffer.writeInt16LE(sample, 44 + (i * 2));
  }
  return buffer;
}

test('voice references can be saved, listed and compared without exposing private refs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-refs-'));
  const previousRoot = process.env.A11_VOICE_REFERENCE_DIR;
  const previousLibraryDisabled = process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
  process.env.A11_VOICE_REFERENCE_DIR = root;
  process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = '1';
  const store = require('../src/tts/voice-reference-store.cjs');

  try {
    const user = { id: 'u1', email: 'u1@example.com' };
    const other = { id: 'u2', email: 'u2@example.com' };
    const wav = createPcm16Wav();
    const reference = store.saveVoiceReference({
      user,
      file: { buffer: wav, mimetype: 'audio/wav', originalname: 'a11-ref.wav' },
      label: 'A11 ref',
    });

    assert.equal(reference.label, 'A11 ref');
    assert.equal(reference.analysis.ok, true);
    assert.equal(store.listVoiceReferences({ user }).length, 1);
    assert.equal(store.listVoiceReferences({ user: other }).length, 0);

    const found = store.findVoiceReference({ user, id: reference.id, includePath: true });
    assert.ok(found.filePath);
    assert.equal(store.findVoiceReference({ user: other, id: reference.id }), null);

    const comparison = store.compareAudioBuffers({
      generatedBuffer: createPcm16Wav({ amplitude: 0.23 }),
      referenceBuffer: wav,
      generatedFile: { mimetype: 'audio/wav' },
      referenceFile: { mimetype: 'audio/wav' },
    });
    assert.equal(comparison.ok, true);
    assert.ok(comparison.similarity > 0.8);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.A11_VOICE_REFERENCE_DIR;
    } else {
      process.env.A11_VOICE_REFERENCE_DIR = previousRoot;
    }
    if (previousLibraryDisabled === undefined) {
      delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
    } else {
      process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = previousLibraryDisabled;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('voice reference uploads enforce per-account storage quota', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-refs-quota-'));
  const previousRoot = process.env.A11_VOICE_REFERENCE_DIR;
  const previousLibraryDisabled = process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
  process.env.A11_VOICE_REFERENCE_DIR = root;
  process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = '1';
  const store = require('../src/tts/voice-reference-store.cjs');

  try {
    fs.mkdirSync(root, { recursive: true });
    const user = { id: 'quota-user', email: 'quota@example.com' };
    fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ references: [{
      id: 'quota-existing-reference',
      label: 'Existing quota block',
      scope: 'private',
      source: 'upload',
      ownerKey: store.getUserKey(user),
      bytes: ONE_GIB - 10,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }] }));

    assert.throws(() => store.saveVoiceReference({
      user,
      file: { buffer: createPcm16Wav({ durationSec: 0.05 }), mimetype: 'audio/wav', originalname: 'too-much.wav' },
      label: 'Too much',
    }), (error) => error?.code === 'account_storage_quota_exceeded');
  } finally {
    if (previousRoot === undefined) {
      delete process.env.A11_VOICE_REFERENCE_DIR;
    } else {
      process.env.A11_VOICE_REFERENCE_DIR = previousRoot;
    }
    if (previousLibraryDisabled === undefined) {
      delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
    } else {
      process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = previousLibraryDisabled;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('voice reference library exposes WAV files as audio references without transcription', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-library-'));
  const previousRuntimeRoot = process.env.A11_RUNTIME_ROOT;
  const previousReferenceRoot = process.env.A11_VOICE_REFERENCE_DIR;
  const previousLibraryDirs = process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS;
  const previousLibraryDir = process.env.A11_VOICE_REFERENCE_LIBRARY_DIR;
  const previousLibraryPaths = process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS;
  const previousLibraryDisabled = process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
  const previousImplicitLegacy = process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY;
  const store = require('../src/tts/voice-reference-store.cjs');

  try {
    const libraryDir = path.join(runtimeRoot, 'voice-library');
    fs.mkdirSync(libraryDir, { recursive: true });
    fs.writeFileSync(path.join(libraryDir, 'A11 ref.wav'), createPcm16Wav({ frequency: 220 }));

    process.env.A11_RUNTIME_ROOT = runtimeRoot;
    process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY = '1';
    process.env.A11_VOICE_REFERENCE_DIR = path.join(runtimeRoot, 'voice-references');
    delete process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS;
    delete process.env.A11_VOICE_REFERENCE_LIBRARY_DIR;
    delete process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS;
    delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;

    const user = { id: 'u1', email: 'u1@example.com' };
    const refs = store.listVoiceReferences({ user });
    const libraryRef = refs.find((ref) => ref.source === 'library' && ref.originalName === 'A11 ref.wav');

    assert.ok(libraryRef);
    assert.equal(libraryRef.scope, 'library');
    assert.equal(libraryRef.analysis.ok, true);
    assert.equal(libraryRef.analysis.kind, 'wav');
    assert.equal(Object.hasOwn(libraryRef, 'filePath'), false);

    const resolved = store.findVoiceReference({ user, id: libraryRef.id, includePath: true });
    assert.equal(resolved.id, libraryRef.id);
    assert.ok(resolved.filePath.endsWith('A11 ref.wav'));
  } finally {
    if (previousRuntimeRoot === undefined) delete process.env.A11_RUNTIME_ROOT;
    else process.env.A11_RUNTIME_ROOT = previousRuntimeRoot;
    if (previousReferenceRoot === undefined) delete process.env.A11_VOICE_REFERENCE_DIR;
    else process.env.A11_VOICE_REFERENCE_DIR = previousReferenceRoot;
    if (previousLibraryDirs === undefined) delete process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS;
    else process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS = previousLibraryDirs;
    if (previousLibraryDir === undefined) delete process.env.A11_VOICE_REFERENCE_LIBRARY_DIR;
    else process.env.A11_VOICE_REFERENCE_LIBRARY_DIR = previousLibraryDir;
    if (previousLibraryPaths === undefined) delete process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS;
    else process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS = previousLibraryPaths;
    if (previousLibraryDisabled === undefined) delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
    else process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = previousLibraryDisabled;
    if (previousImplicitLegacy === undefined) delete process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY;
    else process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY = previousImplicitLegacy;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('voice reference resolver prefers Vivy library samples when requested', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-library-vivy-'));
  const previousRuntimeRoot = process.env.A11_RUNTIME_ROOT;
  const previousReferenceRoot = process.env.A11_VOICE_REFERENCE_DIR;
  const previousLibraryDirs = process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS;
  const previousLibraryDir = process.env.A11_VOICE_REFERENCE_LIBRARY_DIR;
  const previousLibraryPaths = process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS;
  const previousLibraryDisabled = process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
  const previousImplicitLegacy = process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY;
  const store = require('../src/tts/voice-reference-store.cjs');

  try {
    const libraryDir = path.join(runtimeRoot, 'voice-library');
    fs.mkdirSync(libraryDir, { recursive: true });
    fs.writeFileSync(path.join(libraryDir, 'neutral-reference.wav'), createPcm16Wav({ frequency: 220 }));
    fs.writeFileSync(path.join(libraryDir, 'Vivy ref.wav'), createPcm16Wav({ frequency: 440 }));
    fs.writeFileSync(path.join(libraryDir, 'K44 Ref.wav'), createPcm16Wav({ frequency: 520 }));
    fs.writeFileSync(path.join(libraryDir, 'A11 ref.wav'), createPcm16Wav({ frequency: 110 }));
    fs.writeFileSync(path.join(libraryDir, 'Djeff ref.wav'), createPcm16Wav({ frequency: 180 }));

    process.env.A11_RUNTIME_ROOT = runtimeRoot;
    process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY = '1';
    process.env.A11_VOICE_REFERENCE_DIR = path.join(runtimeRoot, 'voice-references');
    delete process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS;
    delete process.env.A11_VOICE_REFERENCE_LIBRARY_DIR;
    delete process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS;
    delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;

    const user = { id: 'u1', email: 'u1@example.com' };
    const resolved = store.resolveVoiceReferenceForRequest({ user, preferredLabel: 'vivy' });
    const kaen44 = store.resolveVoiceReferenceForRequest({ user, preferredLabel: 'k44' });
    const a11 = store.resolveVoiceReferenceForRequest({ user, preferredLabel: 'a11' });
    const djeff = store.resolveVoiceReferenceForRequest({ user, preferredLabel: 'djeff' });

    assert.ok(resolved);
    assert.equal(resolved.source, 'library');
    assert.equal(resolved.originalName, 'Vivy ref.wav');
    assert.ok(resolved.filePath.endsWith('Vivy ref.wav'));
    assert.equal(kaen44.originalName, 'K44 Ref.wav');
    assert.ok(kaen44.filePath.endsWith('K44 Ref.wav'));
    assert.equal(a11.originalName, 'A11 ref.wav');
    assert.ok(a11.filePath.endsWith('A11 ref.wav'));
    assert.equal(djeff.originalName, 'Djeff ref.wav');
    assert.ok(djeff.filePath.endsWith('Djeff ref.wav'));
  } finally {
    if (previousRuntimeRoot === undefined) delete process.env.A11_RUNTIME_ROOT;
    else process.env.A11_RUNTIME_ROOT = previousRuntimeRoot;
    if (previousReferenceRoot === undefined) delete process.env.A11_VOICE_REFERENCE_DIR;
    else process.env.A11_VOICE_REFERENCE_DIR = previousReferenceRoot;
    if (previousLibraryDirs === undefined) delete process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS;
    else process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS = previousLibraryDirs;
    if (previousLibraryDir === undefined) delete process.env.A11_VOICE_REFERENCE_LIBRARY_DIR;
    else process.env.A11_VOICE_REFERENCE_LIBRARY_DIR = previousLibraryDir;
    if (previousLibraryPaths === undefined) delete process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS;
    else process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS = previousLibraryPaths;
    if (previousLibraryDisabled === undefined) delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
    else process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = previousLibraryDisabled;
    if (previousImplicitLegacy === undefined) delete process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY;
    else process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY = previousImplicitLegacy;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('voice catalog references require consent, unique names and explicit catalog access', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-catalog-'));
  const previousRoot = process.env.A11_VOICE_REFERENCE_DIR;
  const previousLibraryDisabled = process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
  process.env.A11_VOICE_REFERENCE_DIR = root;
  process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = '1';
  const store = require('../src/tts/voice-reference-store.cjs');

  try {
    const owner = { id: 'owner-lara', email: 'lara@example.com' };
    const premium = { id: 'premium-user', email: 'premium@example.com' };
    const wav = createPcm16Wav({ frequency: 330 });

    assert.throws(() => store.saveVoiceReference({
      user: owner,
      file: { buffer: wav, mimetype: 'audio/wav', originalname: 'lara.wav' },
      label: 'Lara',
      scope: 'catalog',
      catalogName: 'Lara',
      consent: '',
    }), (error) => error?.code === 'voice_catalog_consent_required');

    const reference = store.saveVoiceReference({
      user: owner,
      file: { buffer: wav, mimetype: 'audio/wav', originalname: 'lara.wav' },
      label: 'Lara',
      scope: 'catalog',
      catalogName: 'Lara',
      consent: store.VOICE_CATALOG_CONSENT,
    });

    assert.equal(reference.scope, 'catalog');
    assert.equal(reference.catalog.name, 'Lara');
    assert.equal(reference.catalog.rawAudioPublic, false);
    assert.equal(store.listVoiceCatalogReferences({ user: premium }).length, 1);
    assert.equal(store.findVoiceReference({ user: premium, id: reference.id, includePath: true }), null);

    const resolved = store.resolveVoiceReferenceForRequest({
      user: premium,
      requestedId: reference.id,
      includeCatalog: true,
    });
    assert.equal(resolved.id, reference.id);
    assert.ok(resolved.filePath);

    assert.throws(() => store.saveVoiceReference({
      user: { id: 'owner-2', email: 'owner2@example.com' },
      file: { buffer: createPcm16Wav({ frequency: 360 }), mimetype: 'audio/wav', originalname: 'lara-2.wav' },
      label: 'Lara',
      scope: 'catalog',
      catalogName: ' Lara ',
      consent: store.VOICE_CATALOG_CONSENT,
    }), (error) => error?.code === 'voice_catalog_name_taken');
  } finally {
    if (previousRoot === undefined) {
      delete process.env.A11_VOICE_REFERENCE_DIR;
    } else {
      process.env.A11_VOICE_REFERENCE_DIR = previousRoot;
    }
    if (previousLibraryDisabled === undefined) {
      delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
    } else {
      process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = previousLibraryDisabled;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
