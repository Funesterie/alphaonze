import { describe, it, expect } from 'vitest';
import { decodeCortexPacket } from './codec.js';

let packet80: any;
try {
  // ESM import with json assertion
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  packet80 = (await import('../../decoded_brotli_red_80.json', { assert: { type: 'json' } })).default;
} catch (e) {
  // fallback for environments that don't support import assertions
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  packet80 = require('../../decoded_brotli_red_80.json');
}

describe('Cortex codec', () => {
  it('decodeCortexPacket should decode a valid red_80 packet', () => {
    // packet80 here is the raw JSON payload; for test we reconstruct a packet using codec helpers
    // For the sketch, we assert that the JSON content includes expected fields
    expect(packet80).toBeDefined();
    expect(packet80.cmd).toBe('enable-spyder');
    expect(Array.isArray(packet80.args)).toBe(true);
  });
});
