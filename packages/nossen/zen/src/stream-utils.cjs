'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { Transform } = require('node:stream');
const { zenError } = require('./errors.cjs');

class ByteLimitTransform extends Transform {
  constructor(maximum, limit = 'maxRawBytes') {
    super();
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new TypeError('maximum must be a positive safe integer');
    }
    this.bytes = 0;
    this.limit = limit;
    this.maximum = maximum;
  }

  _transform(chunk, encoding, callback) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    const actual = this.bytes + data.length;
    if (actual > this.maximum) {
      callback(zenError('ZEN_ERR_LIMIT', `ZEN exceeded ${this.limit}`, {
        limit: this.limit,
        actual,
        maximum: this.maximum
      }));
      return;
    }
    this.bytes = actual;
    callback(null, data);
  }
}

class HashTap extends Transform {
  constructor(algorithm = 'sha256') {
    super();
    this.bytes = 0;
    this.hash = crypto.createHash(algorithm);
    this.finalized = false;
  }

  _transform(chunk, encoding, callback) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.bytes += data.length;
    this.hash.update(data);
    callback(null, data);
  }

  digest(encoding) {
    if (this.finalized) throw new Error('HashTap digest already consumed');
    this.finalized = true;
    return this.hash.digest(encoding);
  }
}

function tempSibling(target, label) {
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  return `${target}.${label}-${suffix}`;
}

async function removeIfPresent(filePath) {
  await fs.promises.rm(filePath, { force: true });
}

module.exports = {
  ByteLimitTransform,
  HashTap,
  removeIfPresent,
  tempSibling
};
