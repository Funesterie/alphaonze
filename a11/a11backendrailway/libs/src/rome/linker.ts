// auto-generated linker for Rome index references
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { loadRomeIndexFromDisk } from './index-loader.js';
import { EventEmitter } from 'events';

export type LinkRef = {
  from: string;
  line: number;
  token: string;
  target: string | null;
  score: number;
};

export const romeLinksEmitter = new EventEmitter();

function walkDir(dir: string, filelist: string[] = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, filelist);
    } else {
      filelist.push(full);
    }
  }
  return filelist;
}

const tokenRe = /\[\[([a-zA-Z0-9_\-]+)\]\]/g;

export function computeRomeLinks(projectRoot: string): LinkRef[] {
  const srcDir = join(projectRoot, 'src');
  let files: string[] = [];
  try { files = walkDir(srcDir); } catch (e) { return []; }
  return computeRomeLinksForFiles(projectRoot, files);
}

export function computeRomeLinksForFiles(projectRoot: string, absFiles: string[]): LinkRef[] {
  const idx = loadRomeIndexFromDisk();
  const indexFiles = idx && (idx as any).files ? (idx as any).files : (idx as any);
  const links: LinkRef[] = [];

  for (const abs of absFiles) {
    if (!abs.endsWith('.ts') && !abs.endsWith('.js') && !abs.endsWith('.tsx') && !abs.endsWith('.jsx')) continue;
    let content: string;
    try { content = readFileSync(abs, 'utf8'); } catch (e) { continue; }
    const rel = relative(projectRoot, abs).replace(/\\/g, '/');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m: RegExpExecArray | null;
      tokenRe.lastIndex = 0;
      while ((m = tokenRe.exec(line)) !== null) {
        const token = m[1];
        const resolved = resolveTokenToFile(token, indexFiles, rel);
        links.push({ from: rel, line: i + 1, token, target: resolved ? resolved.path : null, score: resolved ? resolved.score : 0 });
      }
    }
  }

  return links;
}

function resolveTokenToFile(token: string, idx: any, fromPath: string): { path: string; score: number } | null {
  let best: { path: string; score: number } | null = null;
  for (const [p, info] of Object.entries<any>(idx || {})) {
    try {
      let score = 0;
      const base = p.split('/').pop() || '';
      const nameOnly = base.replace(/\.(ts|js|tsx|jsx)$/, '');
      if (nameOnly === token) score += 50;
      if (nameOnly.toLowerCase() === token.toLowerCase()) score += 20;
      const fromRoot = fromPath.split('/')[1] || '';
      if (p.startsWith(`src/${fromRoot}`)) score += 10;
      if (p.includes(token)) score += 5;
      // fuzzy: shorter edit distance => higher score
      const dist = levenshtein(nameOnly.toLowerCase(), token.toLowerCase());
      if (dist >= 0 && dist <= Math.max(1, Math.floor(nameOnly.length * 0.4))) score += Math.max(0, 8 - dist);
      // type matching heuristic
      if (info && info.type && token.toLowerCase().includes(info.type)) score += 3;
      if (score <= 0) continue;
      if (!best || score > best.score) best = { path: p, score };
    } catch (e) {
      continue;
    }
  }
  return best;
}

// simple Levenshtein distance - small implementation
function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const v0 = new Array(n + 1);
  const v1 = new Array(n + 1);
  for (let j = 0; j <= n; j++) v0[j] = j;
  for (let i = 0; i < m; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < n; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= n; j++) v0[j] = v1[j];
  }
  return v0[n];
}

export function resolveRomeToken(projectRoot: string, fromPath: string, token: string): { path: string | null; score: number } {
  const idx = loadRomeIndexFromDisk();
  const indexFiles = idx && (idx as any).files ? (idx as any).files : (idx as any);
  const res = resolveTokenToFile(token, indexFiles, fromPath);
  return res ? { path: res.path, score: res.score } : { path: null, score: 0 };
}

export function writeRomeLinks(projectRoot: string, links: LinkRef[]) {
  const outPath = join(projectRoot, '.qflush', 'rome-links.json');
  try {
    writeFileSync(outPath, JSON.stringify({ refs: links }, null, 2), 'utf8');
  } catch (e) {
    // ignore write errors
  }
}

export function readExistingLinks(projectRoot: string): LinkRef[] {
  const p = join(projectRoot, '.qflush', 'rome-links.json');
  try {
    if (!existsSync(p)) return [];
    const raw = readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    return obj && obj.refs ? obj.refs as LinkRef[] : [];
  } catch (e) {
    return [];
  }
}

export function mergeAndWrite(projectRoot: string, newLinks: LinkRef[]) {
  const existing = readExistingLinks(projectRoot);
  // remove existing refs from same files as newLinks
  const modifiedFiles = new Set(newLinks.map((l) => l.from));
  const filtered = existing.filter((r) => !modifiedFiles.has(r.from));
  const merged = [...filtered, ...newLinks];
  writeRomeLinks(projectRoot, merged);
  // notify listeners that links updated
  try {
    romeLinksEmitter.emit('updated', merged);
  } catch (e) {
    // ignore
  }
}
