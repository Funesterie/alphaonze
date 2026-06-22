'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { ZEN_CANON, cloneCanon } = require('./canon.cjs');
const { ZenError, zenError } = require('./errors.cjs');
const { DEFAULT_ZEN_LIMITS, resolveZenLimits } = require('./limits.cjs');

const MAGIC = Buffer.from('NOSSENZ1');
const FIXED_HEADER_BYTES = 12;
const DEFAULT_BROTLI_QUALITY = 11;
const DEFAULT_SCRYPT_COST = 16384;
const DEFAULT_SCRYPT_BLOCK_SIZE = 8;
const DEFAULT_SCRYPT_PARALLELIZATION = 1;
const ZEN_VERSION = 1;

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function toPayloadBuffer(input, options = {}) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === 'string') return Buffer.from(input, options.encoding || 'utf8');
  return Buffer.from(stableStringify(input), 'utf8');
}

function buildZenManifest(manifest = {}) {
  return {
    schema: 'nossen.zen.manifest.v1',
    createdAt: manifest.createdAt || new Date().toISOString(),
    intent: manifest.intent || 'corpus-container',
    source: manifest.source || null,
    corpus: manifest.corpus || null,
    axes: Array.isArray(manifest.axes) ? manifest.axes : [],
    zone: manifest.zone || null,
    fragments: Array.isArray(manifest.fragments) ? manifest.fragments : [],
    routes: Array.isArray(manifest.routes) ? manifest.routes : [],
    graphHints: Array.isArray(manifest.graphHints) ? manifest.graphHints : [],
    notes: Array.isArray(manifest.notes) ? manifest.notes : []
  };
}

function buildZenContainerPayload(input, options = {}) {
  return {
    schema: 'nossen.zen.container-payload.v1',
    canon: cloneCanon(),
    manifest: buildZenManifest(options.manifest || {}),
    data: Buffer.isBuffer(input) || input instanceof Uint8Array
      ? { encoding: 'base64', value: Buffer.from(input).toString('base64') }
      : { encoding: 'json', value: input }
  };
}

function asKeyBuffer(key) {
  if (!key) return null;
  if (Buffer.isBuffer(key)) return key;
  return Buffer.from(String(key), 'utf8');
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

function brotliCompress(raw, quality = DEFAULT_BROTLI_QUALITY) {
  const q = Math.max(0, Math.min(11, Number.isFinite(Number(quality)) ? Number(quality) : DEFAULT_BROTLI_QUALITY));
  return zlib.brotliCompressSync(raw, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: q
    }
  });
}

function makePublicHeader(fields) {
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

function encodeZen(input, options = {}) {
  const raw = toPayloadBuffer(
    options.container === true ? buildZenContainerPayload(input, options) : input,
    options
  );
  const compressed = brotliCompress(raw, options.brotliQuality);
  const rawSha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const payloadSha256 = crypto.createHash('sha256').update(compressed).digest('hex');
  const key = options.key || process.env.ZEN_KEY;
  const allowPlaintext = options.allowPlaintext === true;

  let body = compressed;
  let header;

  if (key) {
    const salt = options.salt ? Buffer.from(options.salt) : crypto.randomBytes(16);
    const iv = options.iv ? Buffer.from(options.iv) : crypto.randomBytes(12);
    const kdf = {
      name: 'scrypt',
      cost: options.scryptCost || DEFAULT_SCRYPT_COST,
      blockSize: options.scryptBlockSize || DEFAULT_SCRYPT_BLOCK_SIZE,
      parallelization: options.scryptParallelization || DEFAULT_SCRYPT_PARALLELIZATION
    };
    const cipherKey = deriveKey(key, salt, kdf);
    const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey, iv);
    body = Buffer.concat([cipher.update(compressed), cipher.final()]);
    header = makePublicHeader({
      mode: 'encrypted_multiload',
      cipher: 'aes-256-gcm',
      kdf,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      rawSha256,
      payloadSha256
    });
  } else {
    if (!allowPlaintext) {
      throw new Error('ZEN refuses plaintext containers by default; pass a key or set allowPlaintext for dev fixtures');
    }
    header = makePublicHeader({
      mode: 'plaintext_dev',
      cipher: 'none',
      kdf: 'none',
      rawSha256,
      payloadSha256
    });
  }

  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.alloc(FIXED_HEADER_BYTES);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(headerBytes.length, 8);
  return Buffer.concat([prefix, headerBytes, body]);
}

function throwLimit(limit, actual, maximum) {
  throw zenError('ZEN_ERR_LIMIT', `ZEN exceeded ${limit}`, { limit, actual, maximum });
}

function parseZen(input, options = {}) {
  const limits = resolveZenLimits(options);
  let buf;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    buf = Buffer.from(input);
  } else {
    const size = fs.statSync(input).size;
    if (size > limits.maxContainerBytes) {
      throwLimit('maxContainerBytes', size, limits.maxContainerBytes);
    }
    buf = fs.readFileSync(input);
  }

  if (buf.length > limits.maxContainerBytes) {
    throwLimit('maxContainerBytes', buf.length, limits.maxContainerBytes);
  }
  if (buf.length < FIXED_HEADER_BYTES) {
    throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: too short');
  }
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: bad magic');
  }

  const headerLength = buf.readUInt32BE(8);
  const headerStart = FIXED_HEADER_BYTES;
  const headerEnd = headerStart + headerLength;
  if (headerLength > limits.maxHeaderBytes) {
    throwLimit('maxHeaderBytes', headerLength, limits.maxHeaderBytes);
  }
  if (headerLength <= 0 || headerEnd > buf.length) {
    throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: bad header length');
  }
  const payloadLength = buf.length - headerEnd;
  if (payloadLength > limits.maxPayloadBytes) {
    throwLimit('maxPayloadBytes', payloadLength, limits.maxPayloadBytes);
  }

  let header;
  try {
    header = JSON.parse(buf.subarray(headerStart, headerEnd).toString('utf8'));
  } catch (error) {
    throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN container: malformed header', { cause: error });
  }
  return {
    header,
    body: buf.subarray(headerEnd),
    limits
  };
}

function decryptBody(body, header, key) {
  if (header.cipher === 'none') return body;
  if (header.cipher !== 'aes-256-gcm') {
    throw zenError('ZEN_ERR_FORMAT', `Unsupported ZEN cipher: ${header.cipher}`);
  }

  try {
    const salt = Buffer.from(header.salt || '', 'base64');
    const iv = Buffer.from(header.iv || '', 'base64');
    const tag = Buffer.from(header.tag || '', 'base64');
    const cipherKey = deriveKey(key || process.env.ZEN_KEY, salt, header.kdf || {});
    const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch (error) {
    if (error instanceof ZenError) throw error;
    throw zenError('ZEN_ERR_AUTH', 'ZEN authentication failed', { cause: error });
  }
}

function decodeZen(input, options = {}) {
  const { header, body, limits } = parseZen(input, options);
  if (header.format !== 'zen') {
    throw zenError('ZEN_ERR_FORMAT', 'Unsupported ZEN container format');
  }
  if (header.version !== ZEN_VERSION) {
    throw zenError('ZEN_ERR_VERSION', 'Unsupported ZEN container version', { version: header.version });
  }

  const compressed = decryptBody(body, header, options.key);
  const payloadSha256 = crypto.createHash('sha256').update(compressed).digest('hex');
  if (header.payloadSha256 && payloadSha256 !== header.payloadSha256) {
    throw zenError('ZEN_ERR_CHECKSUM', 'ZEN payload checksum mismatch', { checksum: 'payloadSha256' });
  }

  let raw;
  try {
    raw = zlib.brotliDecompressSync(compressed, { maxOutputLength: limits.maxRawBytes });
  } catch (error) {
    if (error && (error.code === 'ERR_BUFFER_TOO_LARGE' || error.code === 'ERR_OUT_OF_RANGE')) {
      throwLimit('maxRawBytes', limits.maxRawBytes + 1, limits.maxRawBytes);
    }
    throw zenError('ZEN_ERR_FORMAT', 'Invalid ZEN Brotli payload', { cause: error });
  }
  if (raw.length > limits.maxRawBytes) {
    throwLimit('maxRawBytes', raw.length, limits.maxRawBytes);
  }
  const rawSha256 = crypto.createHash('sha256').update(raw).digest('hex');
  if (header.rawSha256 && rawSha256 !== header.rawSha256) {
    throw zenError('ZEN_ERR_CHECKSUM', 'ZEN raw checksum mismatch', { checksum: 'rawSha256' });
  }

  if (options.materialize === false) {
    return { header };
  }

  const text = raw.toString(options.encoding || 'utf8');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    header,
    raw,
    text,
    json,
    container: isZenContainerPayload(json) ? json : null
  };
}

function isZenContainerPayload(value) {
  return Boolean(value && value.schema === 'nossen.zen.container-payload.v1');
}

function encodeZenContainer(input, options = {}) {
  return encodeZen(input, { ...options, container: true });
}

function decodeZenContainer(input, options = {}) {
  const decoded = decodeZen(input, options);
  if (!decoded.container) {
    throw zenError('ZEN_ERR_FORMAT', 'ZEN payload is not a nossen.zen.container-payload.v1 envelope');
  }
  return decoded;
}

function encodeZenFile(inputPath, outputPath, options = {}) {
  const raw = fs.readFileSync(inputPath);
  const out = outputPath || `${inputPath}.zen`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, encodeZen(raw, options));
  return out;
}

function decodeZenFile(inputPath, outputPath, options = {}) {
  const decoded = decodeZen(inputPath, options);
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, decoded.raw);
  }
  return decoded;
}

module.exports = {
  DEFAULT_BROTLI_QUALITY,
  DEFAULT_ZEN_LIMITS,
  MAGIC,
  ZenError,
  ZEN_CANON,
  ZEN_VERSION,
  buildZenContainerPayload,
  buildZenManifest,
  cloneCanon,
  decodeZen,
  decodeZenContainer,
  decodeZenFile,
  encodeZen,
  encodeZenContainer,
  encodeZenFile,
  isZenContainerPayload,
  parseZen,
  resolveZenLimits,
  stableStringify
};
