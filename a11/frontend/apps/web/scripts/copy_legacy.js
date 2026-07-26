import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const distLegacy = path.join(projectRoot, 'dist', 'legacy');
const publicLegacy = path.join(projectRoot, 'public', 'legacy');
const distRoot = path.join(projectRoot, 'dist');

const PLACEHOLDER_ASSETS = {
  'anonymous_code_placeholder.js': [
    '// Placeholder for anonymous injected script',
    '// The devtools or an injected script requested this path; provide a harmless placeholder',
    '',
  ].join('\n'),
  'installHook.js.map': JSON.stringify({
    version: 3,
    file: 'installHook.js',
    sources: ['installHook.js'],
    sourcesContent: ['// placeholder source for injected installHook.js'],
    names: [],
    mappings: '',
  }),
  'react_devtools_backend_compact.js.map': JSON.stringify({
    version: 3,
    file: 'react_devtools_backend_compact.js',
    sources: ['react_devtools_backend_compact.js'],
    sourcesContent: ['// placeholder source for injected react devtools backend'],
    names: [],
    mappings: '',
  }),
};

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) copyRecursive(srcPath, destPath);
    else if (e.isFile()) fs.copyFileSync(srcPath, destPath);
  }
}

function ensurePlaceholderAssets(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const [fileName, contents] of Object.entries(PLACEHOLDER_ASSETS)) {
    fs.writeFileSync(path.join(dest, fileName), contents, 'utf8');
  }
}

function ensureSpaRouteIndexes(dest, routes) {
  const indexPath = path.join(dest, 'index.html');
  if (!fs.existsSync(indexPath)) return;
  for (const route of routes) {
    const routeDir = path.join(dest, route);
    fs.mkdirSync(routeDir, { recursive: true });
    fs.copyFileSync(indexPath, path.join(routeDir, 'index.html'));
  }
}

try {
  ensurePlaceholderAssets(distRoot);
  ensureSpaRouteIndexes(distRoot, ['architecture', 'carte', 'graph']);
  ensurePlaceholderAssets(distLegacy);
  if (fs.existsSync(distLegacy)) {
    console.log('Copying dist/legacy -> public/legacy');
    copyRecursive(distLegacy, publicLegacy);
    ensurePlaceholderAssets(publicLegacy);
    console.log('Done.');
  } else {
    console.log('No dist/legacy folder to copy.');
  }
} catch (err) {
  console.error('Failed to copy legacy assets:', err.message);
  process.exitCode = 1;
}
