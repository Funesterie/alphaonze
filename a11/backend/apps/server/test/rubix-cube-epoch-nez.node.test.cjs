'use strict';
/**
 * Test : RubixCube RGBA + Epoch Sync + NEZ Levels + Quinté Key
 *
 * Full fortress pipeline test.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const rubix = require('../src/dump/rubix-cube.cjs');
const epoch = require('../src/dump/epoch-sync.cjs');
const nez = require('../src/dump/nez-levels.cjs');
const quinte = require('../src/dump/quinte-key.cjs');
const stego = require('../src/dump/rgba-stego.cjs');

const TEST_SALT = 'funesterie-fortress-test-salt';

// ─── RubixCube ──────────────────────────────────────────────────────────────

test('RubixCube: fragment and reassemble', () => {
  const data = Buffer.from('La forteresse bouge sans deplacer les donnees', 'utf8');
  const frags = rubix.fragment(data);
  assert.strictEqual(frags.length, 3);
  const reassembled = rubix.reassemble(frags);
  assert.deepStrictEqual(reassembled, data);
});

test('RubixCube: cube rotation is deterministic', () => {
  const seed = 'abc123';
  const r1 = rubix.cubeRotation(seed);
  const r2 = rubix.cubeRotation(seed);
  assert.strictEqual(r1, r2);
  assert.ok([0, 120, 240].includes(r1), 'Rotation should be 0, 120, or 240');
});

test('RubixCube: different seeds can give different rotations', () => {
  const rotations = new Set();
  for (let i = 0; i < 50; i++) {
    rotations.add(rubix.cubeRotation(`seed-${i}`));
  }
  assert.ok(rotations.size >= 2, 'Multiple seeds should produce at least 2 different rotations');
});

test('RubixCube: faceMap changes with rotation', () => {
  const fm0 = rubix.faceMap(0);
  const fm120 = rubix.faceMap(120);
  assert.notDeepStrictEqual(fm0, fm120, 'Different rotations should give different face maps');
});

test('RubixCube: encode/decode round-trip', () => {
  const data = 'Les plans de la cathedrale sont dans le cube';
  const seed = crypto.randomBytes(16).toString('hex');
  const epochId = '2026-08-04T20';
  const packet = rubix.encodeCube(data, seed, epochId);

  assert.strictEqual(packet.schema, 'nossen.rubix_cube.rgba.v1');
  assert.strictEqual(packet.epoch, epochId);
  assert.ok(packet.channels.R && packet.channels.G && packet.channels.B);
  assert.strictEqual(packet.channels.A.length, 32, 'Checksum should be 32 bytes');

  const result = rubix.decodeCube(packet, seed);
  assert.ok(result.ok, 'Decode should succeed');
  assert.ok(result.checksumMatch, 'Checksum should match');
  assert.strictEqual(result.data.toString('utf8'), data, 'Data should match');
});

test('RubixCube: wrong seed fails decode (rotation mismatch)', () => {
  const data = 'Secret';
  const seed1 = crypto.randomBytes(16).toString('hex');
  const seed2 = crypto.randomBytes(16).toString('hex');
  const packet = rubix.encodeCube(data, seed1, '2026-08-04T20');
  const result = rubix.decodeCube(packet, seed2);
  if (rubix.cubeRotation(seed1) !== rubix.cubeRotation(seed2)) {
    assert.ok(!result.ok, 'Decode should fail with wrong seed (different rotation)');
  }
});

test('RubixCube: extractPipelineFragment gives only one fragment', () => {
  const data = 'Pipeline isolation test';
  const seed = crypto.randomBytes(16).toString('hex');
  const packet = rubix.encodeCube(data, seed, '2026-08-04T20');
  const memoryFrag = rubix.extractPipelineFragment(packet, 'memory');
  assert.ok(memoryFrag, 'Memory fragment should exist');
  assert.ok(memoryFrag.length > 0, 'Fragment should not be empty');
});

// ─── Epoch Sync ─────────────────────────────────────────────────────────────

test('Epoch: current epoch ID format', () => {
  const id = epoch.epochId(new Date('2026-08-04T20:30:00Z'));
  assert.strictEqual(id, '2026-08-04T20');
});

test('Epoch: previous/next epoch', () => {
  const d = new Date('2026-08-04T20:30:00Z');
  assert.strictEqual(epoch.previousEpochId(d), '2026-08-04T19');
  assert.strictEqual(epoch.nextEpochId(d), '2026-08-04T21');
});

test('Epoch: seed is deterministic', () => {
  const id = '2026-08-04T20';
  const pubEvent = { type: 'quinte', numbers: '07-03-12-05-09' };
  const s1 = epoch.computeSeed(id, pubEvent, TEST_SALT);
  const s2 = epoch.computeSeed(id, pubEvent, TEST_SALT);
  assert.strictEqual(s1, s2, 'Same epoch + same event + same salt = same seed');
});

test('Epoch: different public events produce different seeds', () => {
  const id = '2026-08-04T20';
  const s1 = epoch.computeSeed(id, { type: 'quinte', numbers: '07-03-12-05-09' }, TEST_SALT);
  const s2 = epoch.computeSeed(id, { type: 'loto', numbers: '03-12-27-38-44+07' }, TEST_SALT);
  assert.notStrictEqual(s1, s2, 'Different events should give different seeds');
});

test('Epoch: different salt produces different seeds', () => {
  const id = '2026-08-04T20';
  const pubEvent = { type: 'quinte', numbers: '07-03-12-05-09' };
  const s1 = epoch.computeSeed(id, pubEvent, 'salt-A');
  const s2 = epoch.computeSeed(id, pubEvent, 'salt-B');
  assert.notStrictEqual(s1, s2);
});

test('Epoch: circuit description', () => {
  const circuit = epoch.describeCircuit('2026-08-04T20', { type: 'quinte', numbers: '07-03-12-05-09' }, TEST_SALT);
  assert.ok(circuit.epoch);
  assert.ok([0, 120, 240].includes(circuit.rotation));
  assert.ok(circuit.faceMap);
  assert.ok(circuit.pipelines);
});

// ─── NEZ Levels ─────────────────────────────────────────────────────────────

test('NEZ: level 1 (visitor) has no write/shell/admin', () => {
  const def = nez.getLevel(1);
  assert.strictEqual(def.name, 'visitor');
  assert.strictEqual(def.canWrite, false);
  assert.strictEqual(def.canShell, false);
  assert.strictEqual(def.canAdmin, false);
});

test('NEZ: level 10 (account manager) has all access', () => {
  const def = nez.getLevel(10);
  assert.strictEqual(def.name, 'account_manager');
  assert.strictEqual(def.canWrite, true);
  assert.strictEqual(def.canShell, true);
  assert.strictEqual(def.canAdmin, true);
  assert.ok(def.pipelines.includes('*'));
  assert.ok(def.mcpTools.includes('*'));
});

test('NEZ: level 3 can access dialogue but not tools_extended', () => {
  assert.ok(nez.canAccessPipeline(3, 'dialogue'), 'Level 3 should access dialogue');
  assert.ok(!nez.canAccessPipeline(3, 'tools_extended'), 'Level 3 should NOT access tools_extended');
});

test('NEZ: level 10 can access everything', () => {
  assert.ok(nez.canAccessPipeline(10, 'deploy_production'));
  assert.ok(nez.canUseTool(10, 'neo4j_write_query'));
  assert.ok(nez.hasCapability(10, 'canAdmin'));
});

test('NEZ: level 1 cannot write', () => {
  assert.ok(!nez.hasCapability(1, 'canWrite'));
  assert.ok(!nez.canUseTool(1, 'a11_chat'));
});

test('NEZ: resolveLevel by persona', () => {
  assert.strictEqual(nez.resolveLevel({ persona: 'chatgpt' }), 1);
  assert.strictEqual(nez.resolveLevel({ persona: 'claude' }), 3);
  assert.strictEqual(nez.resolveLevel({ persona: 'a11' }), 10);
  assert.strictEqual(nez.resolveLevel({ persona: 'djeff' }), 10);
  assert.strictEqual(nez.resolveLevel({ persona: 'unknown' }), 1);
});

test('NEZ: explicit level overrides persona default', () => {
  assert.strictEqual(nez.resolveLevel({ persona: 'chatgpt', level: 7 }), 7);
});

test('NEZ: levels escalate progressively', () => {
  const tools3 = nez.availableTools(3).length;
  const tools5 = nez.availableTools(5).length;
  const tools8 = nez.availableTools(8).length;
  const tools10 = nez.availableTools(10).length;
  assert.ok(tools3 < tools5, 'Level 5 should have more tools than 3');
  assert.ok(tools5 < tools8, 'Level 8 should have more tools than 5');
  // Level 10 has '*' which counts as 1, so we check it includes '*'
  const def10 = nez.getLevel(10);
  assert.ok(def10.mcpTools.includes('*'), 'Level 10 should have wildcard tools');
});

// ─── Full fortress pipeline ────────────────────────────────────────────────

test('FULL PIPELINE: data → quinté key → RubixCube → epoch sync → stego → extract → decode → decrypt', () => {
  // 1. Secret data to transport
  const secretData = JSON.stringify({
    vault: 'funesterie',
    key: 'NEO4J_PASSWORD',
    pipeline: 'memory',
    level: 8,
    hint: 'look behind the cathedral',
  });

  // 2. Epoch and quinté setup
  const epochId = '2026-08-04T20';
  const quinteNumbers = [7, 3, 12, 5, 9];
  const quinteCanonical = quinte.formatQuinte(quinteNumbers);
  const pubEvent = { type: 'quinte', numbers: quinteCanonical };

  // 3. Compute epoch seed
  const seed = epoch.computeSeed(epochId, pubEvent, TEST_SALT);

  // 4. Encrypt with quinté key
  const keyHint = `quinte-${epochId}-R1`;
  const encrypted = quinte.encrypt(secretData, keyHint, quinteCanonical, TEST_SALT);

  // 5. Fragment with RubixCube using epoch seed
  const cubePacket = rubix.encodeCube(encrypted, seed, epochId);

  // 6. Each pipeline gets only its fragment (capsule)
  const memoryFrag = rubix.extractPipelineFragment(cubePacket, 'memory');
  const toolsFrag = rubix.extractPipelineFragment(cubePacket, 'tools');
  const dataFrag = rubix.extractPipelineFragment(cubePacket, 'data');
  assert.ok(memoryFrag && memoryFrag.length > 0, 'Memory pipeline should get a fragment');
  assert.ok(toolsFrag && toolsFrag.length > 0, 'Tools pipeline should get a fragment');
  assert.ok(dataFrag && dataFrag.length > 0, 'Data pipeline should get a fragment');

  // 7. Embed cube packet in image using steganography
  const fullPayload = Buffer.concat([
    cubePacket.channels.R,
    cubePacket.channels.G,
    cubePacket.channels.B,
    cubePacket.channels.A,
  ]);
  const width = 64, height = 64;
  const image = Buffer.alloc(width * height * 4, 0x8a);
  const stegoImage = stego.encodeStego(image, fullPayload, {
    keyHint: keyHint,
    useAlpha: false,
    encrypted: true,
  });

  // 8. Extract from image
  const extracted = stego.decodeStego(stegoImage);
  assert.ok(extracted.found, 'Stego data should be found in image');
  assert.strictEqual(extracted.keyHint, keyHint, 'Key hint should be preserved');
  assert.ok(extracted.sha256Match, 'SHA-256 should match');

  // 9. Reconstruct cube packet from extracted data
  // The extracted data is the concatenated channels
  const fragLen = Math.ceil(extracted.data.length / 4) - 8; // subtract checksum (32 bytes)
  const reconstructedPacket = {
    schema: 'nossen.rubix_cube.rgba.v1',
    epoch: epochId,
    rotation: cubePacket.rotation,
    faceMap: cubePacket.faceMap,
    channels: {
      R: extracted.data.slice(0, cubePacket.channels.R.length),
      G: extracted.data.slice(cubePacket.channels.R.length, cubePacket.channels.R.length + cubePacket.channels.G.length),
      B: extracted.data.slice(cubePacket.channels.R.length + cubePacket.channels.G.length, cubePacket.channels.R.length + cubePacket.channels.G.length + cubePacket.channels.B.length),
      A: extracted.data.slice(cubePacket.channels.R.length + cubePacket.channels.G.length + cubePacket.channels.B.length),
    },
    meta: cubePacket.meta,
  };

  // 10. Decode cube (verify checksum + reassemble)
  const cubeResult = rubix.decodeCube(reconstructedPacket, seed);
  assert.ok(cubeResult.ok, 'Cube decode should succeed');
  assert.ok(cubeResult.checksumMatch, 'Cube checksum should match');

  // 11. Decrypt with quinté key
  const decrypted = quinte.decrypt(cubeResult.data, keyHint, quinteCanonical, TEST_SALT);
  const result = JSON.parse(decrypted.toString('utf8'));

  assert.strictEqual(result.vault, 'funesterie');
  assert.strictEqual(result.key, 'NEO4J_PASSWORD');
  assert.strictEqual(result.pipeline, 'memory');
  assert.strictEqual(result.level, 8);
  assert.strictEqual(result.hint, 'look behind the cathedral');

  // 12. NEZ level check: only level 8+ can access this pipeline
  assert.ok(nez.canAccessPipeline(8, 'deploy_staging'), 'Level 8 should access deploy_staging');
  assert.ok(!nez.canAccessPipeline(3, 'deploy_staging'), 'Level 3 should NOT access deploy_staging');
});

// ─── HENRY fortress mobility ────────────────────────────────────────────────

test('HENRY: cube rotation changes corridor mapping between epochs', () => {
  const epoch1 = '2026-08-04T20';
  const epoch2 = '2026-08-04T21';
  const pubEvent = { type: 'quinte', numbers: '07-03-12-05-09' };

  const seed1 = epoch.computeSeed(epoch1, pubEvent, TEST_SALT);
  const seed2 = epoch.computeSeed(epoch2, pubEvent, TEST_SALT);

  const rot1 = rubix.cubeRotation(seed1);
  const rot2 = rubix.cubeRotation(seed2);
  const fm1 = rubix.faceMap(rot1);
  const fm2 = rubix.faceMap(rot2);

  // The face maps should differ (corridors have moved)
  // Note: it's possible (but unlikely) that two consecutive epochs get the same rotation
  // In that case, the seeds are still different, so the steganography is still different
  if (rot1 !== rot2) {
    assert.notDeepStrictEqual(fm1, fm2, 'Different epochs should have different face maps (corridors moved)');
  }
  // Even if rotations are the same, the seeds are different
  assert.notStrictEqual(seed1, seed2, 'Seeds should always differ between epochs');
});
