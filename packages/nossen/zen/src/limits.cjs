'use strict';

const DEFAULT_ZEN_LIMITS = Object.freeze({
  maxContainerBytes: 8 * 1024 * 1024 * 1024,
  maxHeaderBytes: 1024 * 1024,
  maxPayloadBytes: 8 * 1024 * 1024 * 1024,
  maxRawBytes: 16 * 1024 * 1024 * 1024
});

function resolveZenLimits(options = {}) {
  const limits = {};
  for (const [name, fallback] of Object.entries(DEFAULT_ZEN_LIMITS)) {
    const value = options[name] === undefined ? fallback : Number(options[name]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
    limits[name] = value;
  }
  return limits;
}

module.exports = { DEFAULT_ZEN_LIMITS, resolveZenLimits };
