'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const zlib = require('node:zlib');
const { ZenError, zenError } = require('./errors.cjs');
const { resolveZenLimits } = require('./limits.cjs');
const {
  ByteLimitTransform,
  HashTap,
  removeIfPresent,
  tempSibling
} = require('./stream-utils.cjs');

const MAGIC = Buffer.from('NOSSENZ1');
const FIXED_HEADER_BYTES = 12;
const ZEN_VERSION = 1;
const DEFAULT_BROTLI_QUALITY = 11;
const DEFAULT_SCRYPT_COST = 16384;
const DEFAULT_SCRYPT_BLOCK_SIZE = 8;
const DEFAULT_SCRYPT_PARALLELIZATION = 1;

function throwLimit(limit, actual, maximum) {
  throw zenError('ZEN_ERR_LIMIT', `ZEN exceeded ${limit}`, { limit, actual, maximum });
}

function asKeyBuffer(key) {
  if (!key) return null;
  return Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'utf8');
}

function deriveKey(key, salt, kdf = {}) {
  const secret = asKeyBuffer(key);
  if (!secret || secret.length === 0) {
    throw zenError('ZEN_ERR_AUTH', 'ZEN key is required for encrypted containers');
  }
  return crypto.scryptSync(secret, salt, 32, {
    N: kdf.cost || DEFAULT_SCRYPT_COST,
    r: kdf.blockSize || DEFAULT_SCRYPT_BLOCK_SIZE,
    p: kdf.parallelization || DEFAULT_SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024
  });
}

function publicHeader(fields) {
  return {
    format: 'zen',
    version: ZEN_VERSION,
    mode: fields.mode,
    codec: 'brotli',
    cipher: fields.cipher,
    kdf: fields.kdf,
    salt: fields.salt,
    iv: fields.iv,
    tag: fields.tag,
    rawSha256: fields.rawSha256,
    payloadSha256: fields.payloadSha256
  };
}

function brotliOptions(quality) {
  const value = Math.max(0, Math.min(11, Number.isFinite(Number(quality)) ? Number(quality) : DEFAULT_BROTLI_QUALITY));
  return { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: value } };
}

async function replaceFile(source, destination) {
  await fs.promises.mkdir(path.dirname(path.resolve(destination)), { recursive: true });
  await fs.promises.rename(source, destination);
}

async function encodeZenFileAsync(inputPath, outputPath, options = {}) {
  if (!outputPath) throw new TypeError('outputPath is required');
  const limits = resolveZenLimits(options);
  const stat = await fs.promises.stat(inputPath);
  if (!stat.isFile()) throw zenError('ZEN_ERR_FORMAT', 'ZEN input must be a file');
  if (stat.size > limits.maxRawBytes) throwLimit('maxRawBytes', stat.size, limits.maxRawBytes);

  const key = options.key || process.env.ZEN_KEY;
  if (!key && options.allowPlaintext !== true) {
    throw zenError('ZEN_ERR_AUTH', 'ZEN refuses plaintext containers by default; pass a key or set allowPlaintext for dev fixtures');
  }

  const bodyPath = tempSibling(outputPath, 'zen-body');
  const temporaryOutput = tempSibling(outputPath, 'zen-output');
  await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });

  try {
    const rawTap = new HashTap('sha256');
    const payloadLimit = new ByteLimitTransform(limits.maxPayloadBytes, 'maxPayloadBytes');
    const payloadTap = new HashTap('sha256');
    const transforms = [
      fs.createReadStream(inputPath),
      rawTap,
      zlib.createBrotliCompress(brotliOptions(options.brotliQuality)),
      payloadLimit,
      payloadTap
    ];

    let cipher = null;
    let kdf = 'none';
    let salt;
    let iv;
    if (key) {
      salt = options.salt ? Buffer.from(options.salt) : crypto.randomBytes(16);
      iv = options.iv ? Buffer.from(options.iv) : crypto.randomBytes(12);
      kdf = {
        name: 'scrypt',
        cost: options.scryptCost || DEFAULT_SCRYPT_COST,
        blockSize: options.scryptBlockSize || DEFAULT_SCRYPT_BLOCK_SIZE,
        parallelization: options.scryptParallelization || DEFAULT_SCRYPT_PARALLELIZATION
      };
      cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(key, salt, kdf), iv);
      transforms.push(cipher);
    }
    transforms.push(fs.createWriteStream(bodyPath, { flags: 'wx' }));
    await pipeline(...transforms);

    const header = publicHeader({
      mode: key ? 'encrypted_multiload' : 'plaintext_dev',
      cipher: key ? 'aes-256-gcm' : 'none',
      kdf,
      salt: salt && salt.toString('base64'),
      iv: iv && iv.toString('base64'),
      tag: cipher && cipher.getAuthTag().toString('base64'),
      rawSha256: rawTap.digest('hex'),
      payloadSha256: payloadTap.digest('hex')
    });
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    if (headerBytes.length > limits.maxHeaderBytes) {
      throwLimit('maxHeaderBytes', headerBytes.length, limits.maxHeaderBytes);
    }
    const bodyStat = await fs.promises.stat(bodyPath);
    const containerBytes = FIXED_HEADER_BYTES + headerBytes.length + bodyStat.size;
    if (containerBytes > limits.maxContainerBytes) {
      throwLimit('maxContainerBytes', containerBytes, limits.maxContainerBytes);
    }

    const prefix = Buffer.alloc(FIXED_HEADER_BYTES);
    MAGIC.copy(prefix, 0);
    prefix.writeUInt32BE(headerBytes.length, 8);
    await fs.promises.writeFile(temporaryOutput, Buffer.concat([prefix, headerBytes]), { flag: 'wx' });
    await pipeline(
      fs.createReadStream(bodyPath),
      fs.createWriteStream(temporaryOutput, { flags: 'a' })
    );
    await replaceFile(temporaryOutput, outputPath);
    return outputPath;
  } finally {
    await Promise.all([removeIfPresent(bodyPath), removeIfPresent(temporaryOutput)]);
  }
}

async function readPublicHeader(inputPath, options = {}) {
  const limits = resolveZenLimits(options);
  const stat = await fs.promises.stat(inputPath);
  if (!stat.isFile()) throw zenError('ZEN_ERR_FORMAT', 'ZEN input must be a file');
  if (stat.size > limits.maxContainerBytes) throwLimit('maxContainerBytes', stat.size, limits.maxContainerBytes);
  if (stat.size < FIXED_HEADER_BYTES) throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: too short');

  const handle = await fs.promises.open(inputPath, 'r');
  try {
    const prefix = Buffer.alloc(FIXED_HEADER_BYTES);
    const prefixRead = await handle.read(prefix, 0, prefix.length, 0);
    if (prefixRead.bytesRead !== prefix.length || !prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: bad magic');
    }
    const headerLength = prefix.readUInt32BE(8);
    if (headerLength <= 0) throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: bad header length');
    if (headerLength > limits.maxHeaderBytes) throwLimit('maxHeaderBytes', headerLength, limits.maxHeaderBytes);
    const bodyStart = FIXED_HEADER_BYTES + headerLength;
    if (bodyStart > stat.size) throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: bad header length');
    const bodyBytes = stat.size - bodyStart;
    if (bodyBytes > limits.maxPayloadBytes) throwLimit('maxPayloadBytes', bodyBytes, limits.maxPayloadBytes);

    const headerBytes = Buffer.alloc(headerLength);
    const headerRead = await handle.read(headerBytes, 0, headerLength, FIXED_HEADER_BYTES);
    if (headerRead.bytesRead !== headerLength) throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: truncated header');
    let header;
    try {
      header = JSON.parse(headerBytes.toString('utf8'));
    } catch (error) {
      throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: malformed header', { cause: error });
    }
    require('./index.cjs').validatePublicHeader(header);
    return { header, bodyStart, bodyBytes, limits };
  } finally {
    await handle.close();
  }
}

function discardSink() {
  return new Writable({ write(chunk, encoding, callback) { callback(); } });
}

async function streamDecodedFile(inputPath, outputPath, options = {}) {
  const { header, bodyStart, bodyBytes, limits } = await readPublicHeader(inputPath, options);
  const temporaryOutput = outputPath ? tempSibling(outputPath, 'zen-output') : null;
  if (outputPath) await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });

  try {
    const transforms = [fs.createReadStream(inputPath, { start: bodyStart, end: bodyStart + bodyBytes - 1 })];
    const encrypted = header.cipher !== 'none';
    if (encrypted) {
      const salt = Buffer.from(header.salt, 'base64');
      const iv = Buffer.from(header.iv, 'base64');
      const tag = Buffer.from(header.tag, 'base64');
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        deriveKey(options.key || process.env.ZEN_KEY, salt, header.kdf || {}),
        iv
      );
      decipher.setAuthTag(tag);
      transforms.push(decipher);
    }

    const payloadTap = new HashTap('sha256');
    const rawLimit = new ByteLimitTransform(limits.maxRawBytes, 'maxRawBytes');
    const rawTap = new HashTap('sha256');
    transforms.push(payloadTap, zlib.createBrotliDecompress(), rawLimit, rawTap);
    transforms.push(outputPath ? fs.createWriteStream(temporaryOutput, { flags: 'wx' }) : discardSink());

    try {
      await pipeline(...transforms);
    } catch (error) {
      if (error instanceof ZenError) throw error;
      if (encrypted) throw zenError('ZEN_ERR_AUTH', 'ZEN authentication failed', { cause: error });
      throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN Brotli payload', { cause: error });
    }

    const payloadSha256 = payloadTap.digest('hex');
    if (payloadSha256 !== header.payloadSha256) {
      throw zenError('ZEN_ERR_CHECKSUM', 'ZEN payload checksum mismatch', { checksum: 'payloadSha256' });
    }
    const rawSha256 = rawTap.digest('hex');
    if (rawSha256 !== header.rawSha256) {
      throw zenError('ZEN_ERR_CHECKSUM', 'ZEN raw checksum mismatch', { checksum: 'rawSha256' });
    }
    if (outputPath) await replaceFile(temporaryOutput, outputPath);
    return { header, outputPath: outputPath || null, rawBytes: rawTap.bytes };
  } finally {
    if (temporaryOutput) await removeIfPresent(temporaryOutput);
  }
}

async function decodeZenFileAsync(inputPath, outputPath, options = {}) {
  if (!outputPath) throw new TypeError('outputPath is required');
  return streamDecodedFile(inputPath, outputPath, options);
}

async function verifyZenFileAsync(inputPath, options = {}) {
  const decoded = await streamDecodedFile(inputPath, null, options);
  return {
    valid: true,
    format: decoded.header.format,
    version: decoded.header.version,
    mode: decoded.header.mode,
    rawBytes: decoded.rawBytes
  };
}

module.exports = {
  decodeZenFileAsync,
  encodeZenFileAsync,
  verifyZenFileAsync
};
