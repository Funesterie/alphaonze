import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as router from './router.js';
import * as emit from './emit.js';

describe('Cortex router', () => {
  beforeEach(() => {
    try { vi.restoreAllMocks(); } catch (e) {}
  });

  it('routes NPZ-GRAPH to npz handler (noop stub)', async () => {
    const pkt: any = { totalLen: 0, payloadLen: 0, flags: 0, payload: { cmd: 'NPZ-GRAPH', path: '.' }, type: 'cortex:npz-graph' };
    const res = await router.routeCortexPacket(pkt);
    expect(res).toBeUndefined();
  });

  it('emits CORTEX-DRIP events (noop stub)', async () => {
    const spy = vi.spyOn(emit, 'cortexEmit').mockImplementation(() => {});
    const pkt: any = { totalLen: 0, payloadLen: 0, flags: 0, payload: { cmd: 'CORTEX-DRIP', data: 1 }, type: 'cortex:drip' };
    const res = await router.routeCortexPacket(pkt);
    expect(res).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
