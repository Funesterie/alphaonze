'use strict';

const path = require('node:path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const APPS_ROOT = path.resolve(SERVER_ROOT, '..');
const BACKEND_ROOT = path.resolve(APPS_ROOT, '..');
const A11_ROOT = path.resolve(BACKEND_ROOT, '..');
const REPO_ROOT = path.resolve(A11_ROOT, '..');

function cleanPath(value = '') {
  const raw = String(value || '').trim();
  return raw ? path.resolve(raw) : '';
}

function splitPathList(value = '') {
  return String(value || '')
    .split(/[;\n]+/g)
    .map(cleanPath)
    .filter(Boolean);
}

function uniqueResolvedPaths(paths = []) {
  const seen = new Set();
  const out = [];
  for (const candidate of paths) {
    const resolved = cleanPath(candidate);
    if (!resolved) continue;
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function getServerRoot() {
  return SERVER_ROOT;
}

function getAppsRoot() {
  return APPS_ROOT;
}

function getBackendRoot() {
  return BACKEND_ROOT;
}

function getA11Root() {
  return A11_ROOT;
}

function getRepoRoot() {
  return REPO_ROOT;
}

function getCanonicalRuntimeRoot(env = process.env) {
  return cleanPath(env.A11_RUNTIME_ROOT || env.A11_RUNTIME_DIR || env.RUNTIME_ROOT || env.RUNTIME_DIR)
    || path.join(A11_ROOT, 'runtime');
}

function isTruthy(value = '') {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getLocalDriveRuntimeCandidates() {
  if (process.platform !== 'win32') return [];
  return ['C', 'D', 'E', 'G'].flatMap((drive) => [
    `${drive}:\\Funesterie\\runtime`,
    `${drive}:\\runtime`,
  ]);
}

function getRuntimeRootCandidates(env = process.env, { includeImplicitLegacy = true } = {}) {
  const shouldIncludeImplicitLegacy = includeImplicitLegacy && !isTruthy(env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY);
  const explicitLegacy = [
    ...splitPathList(env.A11_RUNTIME_ROOT_LEGACY_DIRS),
    ...splitPathList(env.A11_RUNTIME_ROOTS),
    ...splitPathList(env.A11_LOCAL_RUNTIME_ROOTS),
  ];
  const implicitLegacy = shouldIncludeImplicitLegacy ? [
    path.join(A11_ROOT, 'runtime'),
    path.join(BACKEND_ROOT, 'runtime'),
    path.join(SERVER_ROOT, 'runtime'),
    path.join(REPO_ROOT, 'runtime'),
    ...getLocalDriveRuntimeCandidates(),
    '/app/runtime',
    '/srv/a11/runtime',
  ] : [];

  return uniqueResolvedPaths([
    env.A11_RUNTIME_ROOT,
    env.A11_RUNTIME_DIR,
    env.RUNTIME_ROOT,
    env.RUNTIME_DIR,
    getCanonicalRuntimeRoot(env),
    ...explicitLegacy,
    ...implicitLegacy,
  ]);
}

function resolveRuntimePath(...segments) {
  return path.join(getCanonicalRuntimeRoot(process.env), ...segments);
}

module.exports = {
  getA11Root,
  getAppsRoot,
  getBackendRoot,
  getCanonicalRuntimeRoot,
  getRepoRoot,
  getRuntimeRootCandidates,
  getServerRoot,
  resolveRuntimePath,
  splitPathList,
  uniqueResolvedPaths,
};
