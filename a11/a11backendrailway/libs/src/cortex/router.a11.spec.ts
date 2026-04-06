import { describe, it, expect } from 'vitest';
import { routeCortexPacket } from './router.js';

describe('cortex:a11-suggest handler', () => {
  it('returns suggestion from services.a11', async () => {
    const packet = { type: 'cortex:a11-suggest', payload: { prompt: 'Suggest 1 step' } } as any;
    const services = {
      a11: {
        ask: async (prompt: string) => ({ choices: [{ message: { content: 'Step 1: do something' } }] })
      }
    };

    const res = await routeCortexPacket(packet, services);
    expect(res).toBeDefined();
    expect(res.ok).toBe(true);
    expect(res.suggestion).toBeDefined();
    // suggestion is the raw response from a11.ask
    expect(res.suggestion.choices[0].message.content).toContain('Step 1');
  });

  it('returns error when service missing', async () => {
    const packet = { type: 'cortex:a11-suggest', payload: { prompt: 'Suggest' } } as any;
    const res = await routeCortexPacket(packet, undefined);
    expect(res).toBeDefined();
    expect(res.ok).toBe(false);
    expect(res.error).toBe('a11_service_missing');
  });
});
