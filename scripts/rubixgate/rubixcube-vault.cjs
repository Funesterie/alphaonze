#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const SCHEMA = 'funesterie.rubixcube-vault.v1';
const MAGIC = Buffer.from('A11RCV1\0', 'ascii');
const AAD = Buffer.from(SCHEMA, 'utf8');
const BYTES_PER_PIXEL = 4;
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const FACES = ['front', 'right', 'top', 'left', 'bottom', 'back', 'inner', 'core'];

function defaultVaultDir() {
  if (process.env.RUBIXCUBE_VAULT_DIR) return path.resolve(process.env.RUBIXCUBE_VAULT_DIR);
  if (process.env.AGENT_STATE_DIR) return path.join(path.resolve(process.env.AGENT_STATE_DIR), 'rubixgate', 'vault');
  if (process.platform === 'win32') return 'D:\\agent-bus\\rubixgate\\vault';
  return path.join(os.homedir(), '.funesterie', 'rubixgate', 'vault');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === 'json') {
      args.json = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function usage() {
  return [
    'RubixCube vault stores an encrypted secret bundle as PNG shards.',
    '',
    'Commands:',
    '  create  --name <id> --input <file> --confirm STORE_SECRET_BUNDLE [--parts 4] [--out <dir>]',
    '  status  --manifest <file>',
    '  recover --manifest <file> --out <file> --confirm WRITE_SECRET_OUTPUT',
    '',
    'Passphrase:',
    '  Set RUBIXCUBE_VAULT_PASSPHRASE in the current process, or pass --passphrase-env <ENV_NAME>.',
    '  The passphrase is never printed by this tool.',
  ].join('\n');
}

function passphraseFromEnv(args) {
  const name = String(args['passphrase-env'] || 'RUBIXCUBE_VAULT_PASSPHRASE');
  const value = process.env[name];
  if (!value || value.length < 12) {
    throw new Error(`Missing or too-short passphrase in ${name}.`);
  }
  return value;
}

function safeName(value) {
  const name = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!name) throw new Error('Vault name is required.');
  return name.slice(0, 80);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
}

function encryptBundle(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
}

function decryptBundle(container, passphrase) {
  if (!Buffer.isBuffer(container) || container.length < MAGIC.length + 16 + 12 + 16) {
    throw new Error('Invalid RubixCube vault container.');
  }
  if (!container.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Invalid RubixCube vault magic.');
  }
  let offset = MAGIC.length;
  const salt = container.subarray(offset, offset + 16);
  offset += 16;
  const iv = container.subarray(offset, offset + 12);
  offset += 12;
  const tag = container.subarray(offset, offset + 16);
  offset += 16;
  const ciphertext = container.subarray(offset);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function xorInto(target, source) {
  for (let i = 0; i < target.length; i += 1) target[i] ^= source[i];
  return target;
}

function splitContainer(container, parts) {
  if (!Number.isInteger(parts) || parts < 2 || parts > FACES.length) {
    throw new Error(`parts must be between 2 and ${FACES.length}.`);
  }
  const shares = [];
  for (let i = 0; i < parts - 1; i += 1) shares.push(crypto.randomBytes(container.length));
  let last = Buffer.from(container);
  for (const share of shares) last = xorInto(last, share);
  shares.push(last);
  return shares;
}

function joinContainer(shares, expectedLength) {
  if (!Array.isArray(shares) || shares.length < 2) throw new Error('At least two shares are required.');
  let joined = Buffer.alloc(expectedLength, 0);
  for (const share of shares) xorInto(joined, share.subarray(0, expectedLength));
  return joined;
}

function encodeToPng(data, file) {
  const pixelCount = Math.ceil(data.length / BYTES_PER_PIXEL);
  const side = Math.ceil(Math.sqrt(pixelCount));
  const rgba = Buffer.alloc(side * side * BYTES_PER_PIXEL, 0);
  data.copy(rgba);
  fs.writeFileSync(file, buildPng(rgba, side, side));
  return { width: side, height: side, sizeBytes: fs.statSync(file).size };
}

function decodeFromPng(file) {
  return extractRgba(fs.readFileSync(file));
}

function buildPng(rgba, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  const ihdr = chunk('IHDR', ihdrData);
  const rowSize = width * 4;
  const rawLines = Buffer.alloc(height * (rowSize + 1));
  for (let y = 0; y < height; y += 1) {
    rawLines[y * (rowSize + 1)] = 0;
    rgba.copy(rawLines, y * (rowSize + 1) + 1, y * rowSize, (y + 1) * rowSize);
  }
  const idat = chunk('IDAT', zlib.deflateSync(rawLines, { level: 1 }));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function extractRgba(png) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idats = [];
  while (offset < png.length - 12) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height || idats.length === 0) throw new Error('Invalid PNG shard.');
  const rawLines = zlib.inflateSync(Buffer.concat(idats));
  const rowSize = width * 4;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    rawLines.copy(rgba, y * rowSize, y * (rowSize + 1) + 1, (y + 1) * (rowSize + 1));
  }
  return rgba;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(buffer) {
  const table = crcTable();
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

let cachedCrcTable;
function crcTable() {
  if (cachedCrcTable) return cachedCrcTable;
  cachedCrcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    cachedCrcTable[n] = c;
  }
  return cachedCrcTable;
}

function createVault(options) {
  const name = safeName(options.name);
  const parts = Number.parseInt(String(options.parts || 4), 10);
  const inputPath = path.resolve(options.inputPath || '');
  if (!fs.existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);
  const plain = fs.readFileSync(inputPath);
  if (plain.length === 0) throw new Error('Input file is empty.');
  const outDir = path.resolve(options.outDir || defaultVaultDir(), name);
  ensureDir(outDir);
  const createdAt = options.createdAt || new Date().toISOString();
  const container = encryptBundle(plain, options.passphrase);
  const shares = splitContainer(container, parts);
  const shardDir = path.join(outDir, 'images');
  ensureDir(shardDir);
  const shardRecords = shares.map((share, index) => {
    const face = FACES[index];
    const file = path.join(shardDir, `${name}.${face}.png`);
    const image = encodeToPng(share, file);
    return {
      index,
      face,
      file: path.relative(outDir, file).replace(/\\/g, '/'),
      width: image.width,
      height: image.height,
      sizeBytes: image.sizeBytes,
      sha256: sha256File(file),
    };
  });
  const manifest = {
    schema: SCHEMA,
    name,
    createdAt,
    updatedAt: createdAt,
    mode: 'encrypted-png-shards',
    secretPolicy: {
      noPlaintextInManifest: true,
      noPlaintextInPng: true,
      requiredConfirmForRecover: 'WRITE_SECRET_OUTPUT',
    },
    crypto: {
      algorithm: 'AES-256-GCM',
      kdf: 'scrypt',
      parts,
      threshold: parts,
      encryptedLength: container.length,
      encryptedSha256: sha256Buffer(container),
      aad: SCHEMA,
    },
    shards: shardRecords,
  };
  const manifestPath = path.join(outDir, `${name}.manifest.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifestPath, manifest };
}

function readManifest(manifestPath) {
  const fullPath = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (manifest.schema !== SCHEMA) throw new Error('Unsupported RubixCube manifest schema.');
  return { fullPath, baseDir: path.dirname(fullPath), manifest };
}

function statusVault(manifestPath) {
  const { baseDir, manifest } = readManifest(manifestPath);
  const shards = manifest.shards.map((shard) => {
    const file = path.resolve(baseDir, shard.file);
    const exists = fs.existsSync(file);
    return {
      index: shard.index,
      face: shard.face,
      exists,
      hashOk: exists ? sha256File(file) === shard.sha256 : false,
      sizeBytes: exists ? fs.statSync(file).size : 0,
    };
  });
  return {
    ok: shards.every((shard) => shard.exists && shard.hashOk),
    schema: manifest.schema,
    name: manifest.name,
    mode: manifest.mode,
    parts: manifest.crypto.parts,
    threshold: manifest.crypto.threshold,
    encryptedLength: manifest.crypto.encryptedLength,
    shards,
  };
}

function recoverVault(options) {
  if (!options.outPath) throw new Error('Recover output path is required.');
  const { baseDir, manifest } = readManifest(options.manifestPath);
  const shares = manifest.shards
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((shard) => {
      const file = path.resolve(baseDir, shard.file);
      if (!fs.existsSync(file)) throw new Error(`Missing shard: ${shard.face}`);
      if (sha256File(file) !== shard.sha256) throw new Error(`Shard hash mismatch: ${shard.face}`);
      return decodeFromPng(file);
    });
  const container = joinContainer(shares, manifest.crypto.encryptedLength);
  if (sha256Buffer(container) !== manifest.crypto.encryptedSha256) {
    throw new Error('Encrypted container hash mismatch.');
  }
  const plain = decryptBundle(container, options.passphrase);
  const outPath = path.resolve(options.outPath);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, plain, { flag: 'wx' });
  return { outPath, bytes: plain.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    console.log(usage());
    return;
  }
  try {
    if (command === 'create') {
      if (args.confirm !== 'STORE_SECRET_BUNDLE') throw new Error('create requires --confirm STORE_SECRET_BUNDLE');
      const result = createVault({
        name: args.name,
        inputPath: args.input,
        outDir: args.out,
        parts: args.parts,
        passphrase: passphraseFromEnv(args),
      });
      console.log(JSON.stringify({
        ok: true,
        manifestPath: result.manifestPath,
        name: result.manifest.name,
        parts: result.manifest.crypto.parts,
        encryptedSha256: result.manifest.crypto.encryptedSha256,
      }, null, 2));
      return;
    }
    if (command === 'status') {
      console.log(JSON.stringify(statusVault(args.manifest), null, 2));
      return;
    }
    if (command === 'recover') {
      if (args.confirm !== 'WRITE_SECRET_OUTPUT') throw new Error('recover requires --confirm WRITE_SECRET_OUTPUT');
      const result = recoverVault({
        manifestPath: args.manifest,
        outPath: args.out,
        passphrase: passphraseFromEnv(args),
      });
      console.log(JSON.stringify({ ok: true, outPath: result.outPath, bytes: result.bytes }, null, 2));
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  SCHEMA,
  defaultVaultDir,
  encryptBundle,
  decryptBundle,
  splitContainer,
  joinContainer,
  createVault,
  recoverVault,
  statusVault,
};
