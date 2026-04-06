// ROME-TAG: 0x925520

import * as crypto from 'crypto';

export function getNpzNamespace(): string {
  // allow override
  const env = process.env.NPZ_NAMESPACE;
  if (env && env.trim().length > 0) return env.trim();

  const seed = 'npz';
  try {
    // try to require the nezlephant package directly to avoid loading the whole lib index
    // which may pull packages that are not compatible in the runner.
     
    const nez = require('@funeste38/nezlephant');
    if (nez) {
      if (typeof nez.encode === 'function') {
        const out = nez.encode(seed);
        if (typeof out === 'string' && out.length >= 8) return out.slice(0, 8);
      }
      if (typeof nez.hash === 'function') {
        const h = nez.hash(seed);
        if (typeof h === 'string' && h.length >= 8) return h.slice(0, 8);
      }
    }
  } catch (e) {
    // ignore and fallback
  }

  // fallback: sha256(seed) and take first 4 bytes (8 hex chars)
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8);
  return hash;
}

export default { getNpzNamespace };
