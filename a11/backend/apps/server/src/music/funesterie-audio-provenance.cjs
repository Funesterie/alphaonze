'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalJson,
  resolveSigningKey,
} = require('../persona/persona-capsule.cjs');

const AUDIO_PROVENANCE_SCHEMA = 'funesterie.audio.provenance.v1';
const DEFAULT_SILENT_TAIL_SECONDS = 1;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function resolveSilentTailSeconds(env = process.env) {
  const value = Number(env.VIVY_AUDIO_PROVENANCE_SILENCE_SECONDS);
  if (!Number.isFinite(value)) return DEFAULT_SILENT_TAIL_SECONDS;
  return Math.max(0.25, Math.min(5, value));
}

function createAudioProvenancePlan(filePath, options = {}) {
  const sourceSha256 = sha256File(filePath);
  const generatedAt = String(options.generatedAt || new Date().toISOString());
  const silentTailSeconds = Number(options.silentTailSeconds || resolveSilentTailSeconds(options.env));
  const provenanceId = crypto.createHash('sha256')
    .update(`${AUDIO_PROVENANCE_SCHEMA}\0${generatedAt}\0${sourceSha256}`)
    .digest('hex')
    .slice(0, 32);
  return {
    schema: AUDIO_PROVENANCE_SCHEMA,
    brand: 'Funesterie',
    provenanceId,
    generatedAt,
    silentTailSeconds,
    sourceSha256,
  };
}

function buildAudioProvenanceMetadataArgs(plan = {}) {
  const provenanceId = String(plan.provenanceId || 'funesterie');
  return [
    '-metadata', 'encoded_by=Funesterie',
    '-metadata', 'copyright=Funesterie',
    '-metadata', `comment=Funesterie provenance ${provenanceId}`,
    '-metadata', `funesterie_provenance_id=${provenanceId}`,
  ];
}

function buildSignedAudioProvenanceManifest(audioPath, plan, options = {}) {
  const keyPair = options.keyPair || resolveSigningKey(options.env);
  const manifest = {
    schema: AUDIO_PROVENANCE_SCHEMA,
    brand: 'Funesterie',
    provenanceId: plan.provenanceId,
    generatedAt: plan.generatedAt,
    silentTailSeconds: plan.silentTailSeconds,
    sourceSha256: plan.sourceSha256,
    assetSha256: sha256File(audioPath),
    assetBytes: fs.statSync(audioPath).size,
    audioFile: String(options.audioFileName || path.basename(audioPath)),
    embeddedMetadata: {
      encodedBy: 'Funesterie',
      copyright: 'Funesterie',
      provenanceId: plan.provenanceId,
    },
  };
  const signedBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  const signature = crypto.sign(null, signedBytes, keyPair.privateKey).toString('hex');
  return {
    ...manifest,
    signature: {
      algorithm: 'ed25519',
      keyId: keyPair.keyId,
      publicKey: keyPair.publicKey,
      signedOver: 'canonical manifest without signature',
      value: signature,
      signedAt: new Date().toISOString(),
    },
  };
}

function writeAudioProvenanceManifest(manifestPath, manifest) {
  const targetPath = String(manifestPath || '').trim();
  if (!targetPath) throw new Error('audio_provenance_manifest_path_missing');
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${canonicalJson(manifest)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, targetPath);
  return targetPath;
}

function verifyAudioProvenanceManifest(manifest) {
  try {
    const { signature, ...unsigned } = manifest || {};
    if (signature?.algorithm !== 'ed25519' || !signature.publicKey || !signature.value) return false;
    return crypto.verify(
      null,
      Buffer.from(canonicalJson(unsigned), 'utf8'),
      crypto.createPublicKey(signature.publicKey),
      Buffer.from(signature.value, 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = {
  AUDIO_PROVENANCE_SCHEMA,
  DEFAULT_SILENT_TAIL_SECONDS,
  resolveSilentTailSeconds,
  createAudioProvenancePlan,
  buildAudioProvenanceMetadataArgs,
  buildSignedAudioProvenanceManifest,
  writeAudioProvenanceManifest,
  verifyAudioProvenanceManifest,
};
