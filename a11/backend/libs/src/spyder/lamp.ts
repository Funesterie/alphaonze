// src/spyder/lamp.ts
import { scream } from '../core/horn';

export interface PathHint {
  from: string;
  to: string;
  maxDepth?: number;
}

export interface LampRoute {
  ok: boolean;
  steps: string[];
  reason?: string;
}

/**
 * Demande à la toile Spyder un chemin "éclairé" entre deux nœuds.
 * Ici on passe par un cri dans la corne → qui peut invoquer qflush spyder route.
 */
export async function lightRoute(hint: PathHint): Promise<LampRoute> {
  try {
    const res = await scream('spyder.route', hint, {
      bin: 'qflush',
      args: ['spyder', 'route', hint.from, hint.to, String(hint.maxDepth ?? 8)],
    });

    const data = JSON.parse(res.out || '{}');
    return {
      ok: !!data.ok,
      steps: data.steps || [],
      reason: data.reason,
    };
  } catch (e: any) {
    return {
      ok: false,
      steps: [],
      reason: e?.message || String(e),
    };
  }
}
