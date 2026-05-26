#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'runtime', 'nossen', 'source-index', 'nossen-source-index.json');

function parseArgs(argv) {
  const args = {
    query: [],
    limit: 25,
    manifest: DEFAULT_MANIFEST,
    category: [],
    root: [],
    kind: [],
    extension: [],
    recent: false,
    json: false,
    stats: false,
    showPath: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };

    if (token === '--help' || token === '-h') args.help = true;
    else if (token === '--json') args.json = true;
    else if (token === '--stats') args.stats = true;
    else if (token === '--recent') args.recent = true;
    else if (token === '--show-path') args.showPath = true;
    else if (token === '--manifest') args.manifest = next();
    else if (token === '--query' || token === '--q') args.query.push(...splitList(next()));
    else if (token === '--category') args.category.push(...splitList(next()));
    else if (token === '--root') args.root.push(...splitList(next()));
    else if (token === '--kind') args.kind.push(...splitList(next()));
    else if (token === '--extension' || token === '--ext') args.extension.push(...splitList(next()));
    else if (token === '--limit') args.limit = parseLimit(next(), args.limit);
    else if (token.startsWith('--')) throw new Error(`Option inconnue: ${token}`);
    else args.query.push(token);
  }

  args.query = normalizeTerms(args.query);
  args.category = normalizeTerms(args.category);
  args.root = normalizeTerms(args.root);
  args.kind = normalizeTerms(args.kind);
  args.extension = normalizeTerms(args.extension).map(normalizeExtension);
  args.limit = clamp(args.limit, 1, 500);
  return args;
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(/[;,]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeTerms(values) {
  return values
    .flatMap(splitList)
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
}

function normalizeExtension(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return '';
  return clean.startsWith('.') ? clean : `.${clean}`;
}

function parseLimit(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readManifest(manifestPath) {
  const resolved = path.resolve(manifestPath || DEFAULT_MANIFEST);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Manifest introuvable: ${resolved}. Lance d'abord npm run nossen:index:dry ou npm run nossen:index.`);
  }

  const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!Array.isArray(manifest.entries)) {
    throw new Error(`Manifest invalide: ${resolved} ne contient pas entries[].`);
  }

  return { manifest, manifestPath: resolved };
}

function makeRootMap(manifest) {
  return new Map((manifest.roots || []).map((root) => [root.id, root]));
}

function entryHaystack(entry, root) {
  return [
    entry.name,
    entry.label,
    entry.relativePath,
    entry.category,
    entry.kind,
    entry.extension,
    root && root.id,
    root && root.label,
    root && root.name,
    root && root.kind
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function entryScore(entry, root, queryTerms) {
  if (!queryTerms.length) return 0;

  const name = String(entry.name || '').toLowerCase();
  const relativePath = String(entry.relativePath || '').toLowerCase();
  const category = String(entry.category || '').toLowerCase();
  const extension = String(entry.extension || '').toLowerCase();
  const rootText = [root && root.id, root && root.label, root && root.name].filter(Boolean).join(' ').toLowerCase();

  return queryTerms.reduce((score, term) => {
    if (name === term) return score + 12;
    if (name.includes(term)) return score + 8;
    if (relativePath.includes(term)) return score + 5;
    if (category.includes(term)) return score + 3;
    if (extension.includes(term)) return score + 2;
    if (rootText.includes(term)) return score + 1;
    return score;
  }, 0);
}

function matchesFilters(entry, root, args) {
  const category = String(entry.category || '').toLowerCase();
  const kind = String(entry.kind || '').toLowerCase();
  const extension = normalizeExtension(entry.extension || '');
  const rootText = [root && root.id, root && root.label, root && root.name, root && root.normalizedPath]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const haystack = entryHaystack(entry, root);

  if (args.category.length && !args.category.includes(category)) return false;
  if (args.kind.length && !args.kind.includes(kind)) return false;
  if (args.extension.length && !args.extension.includes(extension)) return false;
  if (args.root.length && !args.root.some((term) => rootText.includes(term))) return false;
  if (args.query.length && !args.query.every((term) => haystack.includes(term))) return false;
  return true;
}

function compareEntries(a, b, args) {
  if (!args.recent) {
    const scoreDelta = b.__score - a.__score;
    if (scoreDelta !== 0) return scoreDelta;
  }

  const bTime = Date.parse(b.modifiedAt || b.updatedAt || '') || 0;
  const aTime = Date.parse(a.modifiedAt || a.updatedAt || '') || 0;
  if (bTime !== aTime) return bTime - aTime;

  return String(a.relativePath || a.name || '').localeCompare(String(b.relativePath || b.name || ''));
}

function sanitizeEntry(entry, root, args) {
  const base = {
    id: entry.id,
    rootId: entry.rootId,
    rootLabel: root && (root.label || root.name),
    kind: entry.kind,
    category: entry.category,
    name: entry.name,
    relativePath: entry.relativePath,
    extension: entry.extension,
    sizeBytes: entry.sizeBytes,
    modifiedAt: entry.modifiedAt,
    privacy: entry.privacy,
    hasSha256: Boolean(entry.sha256)
  };

  if (args.showPath) {
    base.path = entry.path;
    base.normalizedPath = entry.normalizedPath;
  }

  return base;
}

function summarize(manifest, rootsById) {
  const summary = {
    generatedAt: manifest.generatedAt,
    roots: (manifest.roots || []).length,
    entries: (manifest.entries || []).length,
    stats: manifest.stats || {},
    byCategory: {},
    byRoot: {}
  };

  for (const entry of manifest.entries || []) {
    const category = entry.category || 'unknown';
    summary.byCategory[category] = (summary.byCategory[category] || 0) + 1;

    const root = rootsById.get(entry.rootId);
    const rootLabel = (root && (root.label || root.name || root.id)) || entry.rootId || 'unknown';
    summary.byRoot[rootLabel] = (summary.byRoot[rootLabel] || 0) + 1;
  }

  return summary;
}

function printStats(summary, args) {
  if (args.json) {
    console.log(JSON.stringify({ ok: true, summary }, null, 2));
    return;
  }

  console.log('NOSSEN source index');
  console.log(`generatedAt: ${summary.generatedAt || 'unknown'}`);
  console.log(`roots: ${summary.roots}`);
  console.log(`entries: ${summary.entries}`);

  if (summary.stats && Object.keys(summary.stats).length) {
    console.log('\nstats:');
    for (const [key, value] of Object.entries(summary.stats)) {
      console.log(`  ${key}: ${value}`);
    }
  }

  console.log('\nby category:');
  for (const [key, value] of sortCountMap(summary.byCategory)) {
    console.log(`  ${key}: ${value}`);
  }

  console.log('\nby root:');
  for (const [key, value] of sortCountMap(summary.byRoot)) {
    console.log(`  ${key}: ${value}`);
  }
}

function sortCountMap(map) {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function printResults(results, args, manifest) {
  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      generatedAt: manifest.generatedAt,
      count: results.length,
      query: args.query,
      results
    }, null, 2));
    return;
  }

  if (!results.length) {
    console.log('Aucune entree NOSSEN ne correspond a cette recherche.');
    return;
  }

  for (const item of results) {
    const when = item.modifiedAt ? item.modifiedAt.slice(0, 10) : 'date inconnue';
    const size = formatBytes(item.sizeBytes);
    const root = item.rootLabel || item.rootId || 'root';
    const pathText = args.showPath && item.path ? item.path : item.relativePath;
    console.log(`${when}  ${item.category || item.kind || 'entry'}  ${size}  ${root} :: ${pathText}`);
  }
}

function printHelp() {
  console.log(`NOSSEN source search

Usage:
  node scripts/nossen/nossen-source-search.cjs [query] [options]

Options:
  --query, --q <text>       Mots a chercher dans les metadonnees
  --category <name>         Filtre category, ex: image, document, file, directory
  --kind <name>             Filtre kind, ex: file, directory
  --extension, --ext <ext>  Filtre extension, ex: .md ou png
  --root <text>             Filtre racine par id/label/chemin
  --limit <n>               Nombre de resultats, defaut 25, max 500
  --recent                  Trie par date de modification
  --stats                   Affiche le resume du manifeste
  --json                    Sortie JSON
  --show-path               Inclut les chemins absolus dans la sortie
  --manifest <path>         Manifeste a lire

Exemples:
  npm run nossen:search -- vivy
  npm run nossen:search -- --category image --recent --limit 20
  npm run nossen:stats
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const { manifest, manifestPath } = readManifest(args.manifest);
  const rootsById = makeRootMap(manifest);

  if (args.stats) {
    printStats({ ...summarize(manifest, rootsById), manifestPath }, args);
    return;
  }

  const scored = manifest.entries
    .map((entry) => ({ ...entry, __score: entryScore(entry, rootsById.get(entry.rootId), args.query) }))
    .filter((entry) => matchesFilters(entry, rootsById.get(entry.rootId), args))
    .sort((a, b) => compareEntries(a, b, args))
    .slice(0, args.limit)
    .map((entry) => sanitizeEntry(entry, rootsById.get(entry.rootId), args));

  printResults(scored, args, manifest);
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
}
