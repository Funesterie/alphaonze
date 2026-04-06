import * as fs from 'fs';
import * as path from 'path';

const ROUTES_PATH = path.join(process.cwd(), '.qflush', 'cortex.routes.json');

export type RouteInfo = { enabled?: boolean; score?: number; [k:string]: any };

export function loadRoutesConfig(): Record<string, RouteInfo> | null {
  try {
    if (!fs.existsSync(ROUTES_PATH)) return null;
    const raw = fs.readFileSync(ROUTES_PATH, 'utf8') || '{}';
    const parsed = JSON.parse(raw);
    // support two shapes: { routes: [...] } or { cortexActions: { name: true } } or object map
    if (parsed && parsed.routes && Array.isArray(parsed.routes)) {
      const out: Record<string, RouteInfo> = {};
      for (const r of parsed.routes) out[r] = { enabled: true, score: 0 };
      return out;
    }
    if (parsed && parsed.cortexActions && typeof parsed.cortexActions === 'object' && !Array.isArray(parsed.cortexActions)) {
      const out: Record<string, RouteInfo> = {};
      for (const [k,v] of Object.entries(parsed.cortexActions)) {
        if (typeof v === 'boolean') out[k] = { enabled: v, score: 0 };
        else out[k] = v as RouteInfo;
      }
      return out;
    }
    if (parsed && typeof parsed === 'object') {
      // assume mapping directly
      return parsed as Record<string, RouteInfo>;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export function isRouteEnabled(name: string): boolean {
  try {
    const cfg = loadRoutesConfig();
    if (!cfg) return true; // default allow
    const entry = cfg[name];
    if (!entry) return true;
    if (typeof entry.enabled === 'boolean') return entry.enabled;
    return true;
  } catch (e) {
    return true;
  }
}

export function getRouteScore(name: string): number {
  try {
    const cfg = loadRoutesConfig();
    if (!cfg) return 0;
    const entry = cfg[name];
    if (!entry) return 0;
    const s = Number(entry.score || 0);
    return Number.isFinite(s) ? s : 0;
  } catch (e) {
    return 0;
  }
}

export function pickBestRoute(candidates: string[]): string | null {
  if (!candidates || !candidates.length) return null;
  const scores: { name: string; score: number }[] = candidates.map(n => ({ name: n, score: getRouteScore(n) }));
  // filter enabled
  const enabled = scores.filter(s => isRouteEnabled(s.name));
  if (!enabled.length) return null;
  enabled.sort((a,b) => b.score - a.score);
  return enabled[0].name;
}

export default { loadRoutesConfig, isRouteEnabled, getRouteScore, pickBestRoute };
