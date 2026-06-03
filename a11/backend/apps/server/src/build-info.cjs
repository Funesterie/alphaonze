'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const STARTED_AT = new Date().toISOString();

function firstEnv(env, keys) {
  for (const key of keys) {
    const value = String(env?.[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function normalizeCommit(value) {
  const raw = String(value || '').trim();
  if (!/^[a-f0-9]{7,40}$/i.test(raw)) return '';
  return raw.toLowerCase();
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^\d+$/.test(raw)) {
    const number = Number(raw);
    if (Number.isFinite(number)) {
      const ms = number > 10_000_000_000 ? number : number * 1000;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return raw.slice(0, 80);
}

function readPackageVersion(cwd) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return String(packageJson.version || '').trim();
  } catch {
    return '';
  }
}

function readGitCommit(cwd) {
  try {
    return normalizeCommit(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }));
  } catch {
    return '';
  }
}

function readGitBranch(cwd) {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    return branch && branch !== 'HEAD' ? branch : '';
  } catch {
    return '';
  }
}

function buildRuntimeProvider(env = process.env) {
  if (env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_SERVICE_NAME) return 'render';
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID) return 'railway';
  if (env.VERCEL || env.VERCEL_ENV) return 'vercel';
  if (env.FLY_APP_NAME) return 'fly';
  return String(env.BACKEND || env.NODE_ENV || 'local').trim().toLowerCase();
}

function buildBuildInfo(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || path.resolve(__dirname, '..');
  const commit =
    normalizeCommit(firstEnv(env, [
      'A11_BUILD_COMMIT',
      'A11_COMMIT_SHA',
      'RENDER_GIT_COMMIT',
      'RENDER_GIT_COMMIT_SHA',
      'GIT_COMMIT',
      'COMMIT_SHA',
      'SOURCE_VERSION',
      'RAILWAY_GIT_COMMIT_SHA',
      'VERCEL_GIT_COMMIT_SHA',
    ]))
    || readGitCommit(cwd);

  const buildDate = normalizeIsoDate(firstEnv(env, [
    'A11_BUILD_DATE',
    'BUILD_DATE',
    'RENDER_BUILD_DATE',
    'SOURCE_DATE_EPOCH',
  ])) || STARTED_AT;

  const branch = firstEnv(env, [
    'A11_BUILD_BRANCH',
    'RENDER_GIT_BRANCH',
    'GIT_BRANCH',
    'RAILWAY_GIT_BRANCH',
    'VERCEL_GIT_COMMIT_REF',
  ]) || readGitBranch(cwd);

  return {
    ok: true,
    name: 'a11-server',
    version: readPackageVersion(cwd) || '0.0.0',
    commit: commit || null,
    commitShort: commit ? commit.slice(0, 8) : null,
    branch: branch || null,
    buildDate,
    startedAt: STARTED_AT,
    provider: buildRuntimeProvider(env),
    render: {
      serviceName: env.RENDER_SERVICE_NAME || null,
      serviceId: env.RENDER_SERVICE_ID || null,
      deployId: env.RENDER_DEPLOY_ID || null,
    },
    secretsExposed: false,
  };
}

module.exports = {
  buildBuildInfo,
  normalizeCommit,
  normalizeIsoDate,
};
