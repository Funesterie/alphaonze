'use strict';

class ZenError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ZenError';
    this.code = code;
    Object.assign(this, details);
  }
}

function zenError(code, message, details) {
  return new ZenError(code, message, details);
}

module.exports = { ZenError, zenError };
