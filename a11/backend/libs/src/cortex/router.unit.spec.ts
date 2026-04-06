import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('cortex/router handlers', () => {
  beforeEach(() => { try { vi.restoreAllMocks(); delete (globalThis as any).__importUtilMock; } catch (e) {} });

  it('npz-graph handler calls executor', async () => {
    const fakeExec = { executeAction: vi.fn(async (a:any, b:any) => ({ success: true, action: a, ctx: b })) };
    (globalThis as any).__importUtilMock = (name: string) => {
      if (name.includes('executor')) return fakeExec;
      return undefined;
    };

    const router = await import('./router.js');
    const pkt: any = { type: 'cortex:npz-graph', payload: { path: 'some/path' } };
    const res = await router.routeCortexPacket(pkt as any);
    expect(res && (res as any).success).toBe(true);
    expect((fakeExec.executeAction as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('vision handler calls vision.processVisionImage', async () => {
    const fakeVision = { processVisionImage: vi.fn(async (p:string) => ({ ok: true, path: p })) };
    (globalThis as any).__importUtilMock = (name: string) => {
      if (name.includes('vision')) return fakeVision;
      return undefined;
    };

    const router = await import('./router.js');
    const pkt: any = { type: 'cortex:spyder-vision', payload: { path: 'img.png' } };
    const res = await router.routeCortexPacket(pkt as any);
    expect(res && (res as any).ok).toBe(true);
    expect((fakeVision.processVisionImage as any).mock.calls.length).toBe(1);
  });

  it('apply handler calls applyCortexPacket', async () => {
    const fakeApply = { applyCortexPacket: vi.fn(async (p:any) => ({ ok: true })) };
    (globalThis as any).__importUtilMock = (name: string) => {
      if (name.includes('applyPacket')) return fakeApply;
      return undefined;
    };

    const router = await import('./router.js');
    const pkt: any = { type: 'qflush:apply', payload: { patch: {} } };
    const res = await router.routeCortexPacket(pkt as any);
    expect(res && (res as any).ok).toBe(true);
    expect((fakeApply.applyCortexPacket as any).mock.calls.length).toBe(1);
  });
});
