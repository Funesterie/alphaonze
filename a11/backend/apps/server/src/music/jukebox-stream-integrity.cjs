'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readAudioStreamIntegrity, validateAudioStreamIntegrity } = require('./audio-stream-integrity.cjs');
const { localAudioUrl } = require('./jukebox-history.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function buildGoldenThread(sourceRecord, assetRecord, recipe) {
  const source = validateAudioStreamIntegrity(sourceRecord), asset = validateAudioStreamIntegrity(assetRecord);
  return { schema: 'funesterie.audio.golden-thread.v1', relationship: 'derived-from',
    sourceStreamSha256: source.sha256, assetStreamSha256: asset.sha256,
    sameEncodedStream: source.sha256 === asset.sha256 && source.codec === asset.codec,
    recipe: String(recipe || '').slice(0, 200) };
}

function resolveJukeboxAsset(url, assetDir) {
  const normalized = localAudioUrl(url);
  if (!normalized.startsWith('/api/vivy/studio/assets/')) throw Error('unsupported_source_route');
  const file = path.join(path.resolve(assetDir), decodeURIComponent(normalized.split('/').pop()));
  // Reject symlinks, including links out of the allowed assets directory.
  if (!fs.lstatSync(file).isFile() || path.dirname(fs.realpathSync(file)) !== fs.realpathSync(assetDir)) throw Error('unsafe_audio_path');
  return file;
}

async function inspectMasterRecord(record, assetDir, options = {}) {
  if (!record?.verified || !/^[a-f0-9]{64}$/.test(record.sourceSha256 || '') || !/^[a-f0-9]{64}$/.test(record.outputSha256 || '')) throw Error('unverified_master_record');
  const sourcePath = resolveJukeboxAsset(record.sourceTrackUrl, assetDir);
  const outputPath = resolveJukeboxAsset(record.trackUrl, assetDir);
  const checkFiles = () => {
    if (hash(fs.readFileSync(sourcePath)) !== record.sourceSha256 || hash(fs.readFileSync(outputPath)) !== record.outputSha256) throw Error('master_file_integrity_mismatch');
  };
  checkFiles();
  const read = options.readAudioStreamIntegrity || readAudioStreamIntegrity;
  const source = await read(sourcePath), asset = await read(outputPath);
  checkFiles();
  return { schema: 'funesterie.jukebox.stream-sidecar.v1', sourceTrackUrl: record.sourceTrackUrl,
    trackUrl: record.trackUrl, sourceSha256: record.sourceSha256, outputSha256: record.outputSha256,
    sourceStreamIntegrity: source, outputStreamIntegrity: asset,
    goldenThread: buildGoldenThread(source, asset, record.recipe), verifiedAt: new Date().toISOString() };
}

module.exports = { buildGoldenThread, resolveJukeboxAsset, inspectMasterRecord };
