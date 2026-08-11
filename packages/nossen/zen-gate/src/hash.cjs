'use strict';
const crypto = require('node:crypto');
module.exports = {
  sha256: (buf) => crypto.createHash('sha256').update(buf).digest(),
  sha256Hex: (buf) => crypto.createHash('sha256').update(buf).digest('hex'),
};
