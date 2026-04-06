// src/rome/gollum-paths.ts
import fs from 'node:fs';
import path from 'node:path';

export interface GollumOptions {
  root?: string;
  indexFile?: string;  // ex: ".qflush/rome.index.json"
}

interface RomeIndex {
  aliases?: Record<string, string>;
  services?: Record<string, { path: string }>;
}

let cache: RomeIndex | null = null;
let cacheRoot: string | null = null;

/**
 * Charge l’index Rome (aliases / services).
 */
export function loadRomeIndex(opts: GollumOptions = {}): RomeIndex {
  const root = opts.root || process.cwd();
  if (cache && cacheRoot === root) return cache;

  const indexPath = path.join(root, opts.indexFile || '.qflush/rome.index.json');
  if (!fs.existsSync(indexPath)) {
    cache = { aliases: {}, services: {} };
    cacheRoot = root;
    return cache;
  }

  const raw = fs.readFileSync(indexPath, 'utf8');
  cache = JSON.parse(raw);
  cacheRoot = root;
  return cache!;
}

/**
 * Gollum qui chuchote le bon chemin.
 * - cherche dans aliases
 * - cherche dans services
 * - sinon tente un chemin brut relatif au root
 */
export function resolveGollumPath(name: string, opts: GollumOptions = {}): string | null {
  const root = opts.root || process.cwd();
  const index = loadRomeIndex(opts);

  if (index.aliases?.[name]) {
    return path.resolve(root, index.aliases[name]);
  }

  if (index.services?.[name]?.path) {
    return path.resolve(root, index.services[name].path);
  }

  const candidate = path.resolve(root, name);
  if (fs.existsSync(candidate)) return candidate;

  return null;
}
