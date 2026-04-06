// ROME-TAG: 0xE2C435

import * as path from 'path';

export const ROME_TAG_VERSION = 1;
export const ROME_TAG_COMMENT_PREFIX = '// ROME-TAG:';

export interface RomeTagMeta {
  type: string;
  path: string;
  ext?: string;
}

export interface RomeTagRecord extends RomeTagMeta {
  tag: number;
  tagHex: string;
  savedAt: string;
  version: number;
}

export type RomeIndex = Record<string, RomeTagRecord>;

export function normalizeRomePath(p: string): string {
  let normalized = p.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.?\//, '');
  normalized = normalized.replace(/\/+/g, '/');
  return normalized;
}

export function extractExt(p: string): string | undefined {
  const ext = path.extname(p);
  return ext ? ext.slice(1) : undefined;
}

export function fnv1a24(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash & 0xffffff;
}

export function computeRomeTag(meta: RomeTagMeta): number {
  const type = meta.type || 'file';
  const p = normalizeRomePath(meta.path);
  const input = `${type}|${p}`;
  return fnv1a24(input);
}

export function toRomeTagHex(tag: number): string {
  return '0x' + (tag & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
}

export function fromRomeTagHex(hex: string): number | null {
  const m = /^0x([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  return parseInt(m[1], 16) & 0xffffff;
}

export function makeRomeTagRecord(meta: RomeTagMeta, date = new Date()): RomeTagRecord {
  const pathNorm = normalizeRomePath(meta.path);
  const ext = meta.ext ?? extractExt(pathNorm);
  const tag = computeRomeTag({ ...meta, path: pathNorm, ext });
  return {
    type: meta.type,
    path: pathNorm,
    ext,
    tag,
    tagHex: toRomeTagHex(tag),
    savedAt: date.toISOString(),
    version: ROME_TAG_VERSION,
  };
}

export function getOrCreateRomeTag(index: RomeIndex, meta: RomeTagMeta, date = new Date()): RomeTagRecord {
  const pathNorm = normalizeRomePath(meta.path);
  const existing = index[pathNorm];
  if (existing) return existing;
  const record = makeRomeTagRecord({ ...meta, path: pathNorm }, date);
  index[pathNorm] = record;
  return record;
}

export function buildRomeTagComment(tag: number): string {
  return `${ROME_TAG_COMMENT_PREFIX} ${toRomeTagHex(tag)}`;
}

export function parseRomeTagComment(line: string): number | null {
  const idx = line.indexOf(ROME_TAG_COMMENT_PREFIX);
  if (idx === -1) return null;
  const rest = line.slice(idx + ROME_TAG_COMMENT_PREFIX.length).trim();
  const maybeTag = rest.split(/\s+/)[0];
  return fromRomeTagHex(maybeTag);
}
