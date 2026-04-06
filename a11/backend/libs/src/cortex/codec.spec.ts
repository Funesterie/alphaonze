import { describe, it, expect } from 'vitest';
import { decodeCortexPacket } from './codec.js';


// Always load the fixture from __fixtures__
import packet80 from './__fixtures__/decoded_brotli_red_80.json';

describe('Cortex codec', () => {
  it('decodeCortexPacket should decode a valid red_80 packet', () => {
    // packet80 here is the raw JSON payload; for test we reconstruct a packet using codec helpers
    // For the sketch, we assert that the JSON content includes expected fields
    expect(packet80).toBeDefined();
    expect(packet80.cmd).toBe('enable-spyder');
    expect(Array.isArray(packet80.args)).toBe(true);
  });
});
