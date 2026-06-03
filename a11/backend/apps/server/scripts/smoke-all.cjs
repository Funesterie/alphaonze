#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dotenv = require('dotenv');
  dotenv.config({ path: filePath, override: false });
}

loadEnvFile(path.join(SERVER_ROOT, '.env.local'));
loadEnvFile(path.resolve(SERVER_ROOT, '../../.env'));

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has('--json');
const strict = args.has('--strict') || !args.has('--no-strict');

function withTimeout(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

async function fetchJson(url, timeoutMs = 10000) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: withTimeout(timeoutMs),
  });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { rawPreview: raw.slice(0, 160) };
  }
  return { ok: response.ok, status: response.status, body };
}

function envUrl(name, fallback) {
  return String(process.env[name] || fallback || '').trim().replace(/\/+$/, '');
}

function runCommand(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || SERVER_ROOT,
    encoding: 'utf8',
    timeout: options.timeoutMs || 30000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? String(result.error.message || result.error) : '',
  };
}

async function checkHttp(name, url, expectedOk = true) {
  try {
    const result = await fetchJson(url);
    const status = result.ok === expectedOk ? 'ok' : 'fail';
    return { name, status, url, httpStatus: result.status, ok: result.ok, bodyKind: typeof result.body };
  } catch (error) {
    return { name, status: 'fail', url, error: String(error?.message || error) };
  }
}

function checkCommand(name, command, commandArgs, options = {}) {
  const result = runCommand(command, commandArgs, options);
  if (!result.ok) {
    return {
      name,
      status: options.warnOnly ? 'warn' : 'fail',
      command,
      error: result.error || result.stderr.slice(0, 240) || `exit ${result.status}`,
    };
  }
  return {
    name,
    status: 'ok',
    command,
    version: result.stdout.split(/\r?\n/)[0].slice(0, 120),
  };
}

function checkChopper() {
  const result = runCommand(process.execPath, ['scripts/westside-chopper.cjs', 'doctor', '--json'], {
    cwd: SERVER_ROOT,
    timeoutMs: 60000,
  });
  if (!result.ok) {
    return {
      name: 'chopper',
      status: 'fail',
      error: result.error || result.stderr.slice(0, 240) || `exit ${result.status}`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      name: 'chopper',
      status: parsed.ok ? 'ok' : 'fail',
      score: parsed.score ?? parsed.summary?.doctorScore ?? parsed.doctor?.score ?? null,
      state: parsed.status?.status || parsed.summary?.doctorStatus || parsed.doctor?.status || parsed.state || null,
    };
  } catch {
    return { name: 'chopper', status: 'fail', error: 'invalid_json' };
  }
}

function checkStripeEnv() {
  const required = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PREMIUM_PRICE_ID',
    'STRIPE_FOUNDER_PRICE_ID',
  ];
  const optional = ['STRIPE_PRICE_ID', 'STRIPE_PUBLISHABLE_KEY'];
  const present = required.filter((key) => Boolean(String(process.env[key] || '').trim()));
  const missing = required.filter((key) => !present.includes(key));
  const optionalPresent = optional.filter((key) => Boolean(String(process.env[key] || '').trim()));
  return {
    name: 'stripe-env',
    status: missing.length ? 'fail' : 'ok',
    present,
    optionalPresent,
    missing,
    secretsExposed: false,
  };
}

function isOnDriveE(value) {
  return /^e:\\/i.test(String(value || '').trim());
}

function checkStoragePolicy() {
  const keys = [
    'OLLAMA_MODELS',
    'A11_RUNTIME_ROOT',
    'A11_VIDEO_WORK_ROOT',
    'A11_MATCH_ARENA_EXPORT_ROOT',
    'A11_EXPORT_ROOT',
    'A11_CACHE_ROOT',
  ];
  const gamesRoot = String(process.env.A11_MATCH_ARENA_GAMES_ROOT || '').trim();
  const configured = keys
    .map((key) => ({ key, value: String(process.env[key] || '').trim() }))
    .filter((entry) => entry.value);
  const offDrive = configured.filter((entry) => !isOnDriveE(entry.value));
  return {
    name: 'storage-e-drive',
    status: fs.existsSync('E:\\') && offDrive.length === 0 ? 'ok' : 'warn',
    drivePresent: fs.existsSync('E:\\'),
    checkedKeys: configured.map((entry) => entry.key),
    gamesRootConfigured: Boolean(gamesRoot),
    offDriveKeys: offDrive.map((entry) => entry.key),
  };
}

async function main() {
  const checks = [];
  const a11Url = envUrl('A11_SMOKE_A11_URL', 'https://a11.funesterie.me');
  const k44Url = envUrl('A11_SMOKE_K44_URL', 'https://k44.funesterie.me');
  const vivyUrl = envUrl('A11_SMOKE_VIVY_URL', 'https://vivy.funesterie.me');
  const mcpUrl = envUrl('A11_SMOKE_MCP_HEALTH_URL', 'https://mcp.funesterie.me/health');

  checks.push(await checkHttp('a11-health', `${a11Url}/health`));
  checks.push(await checkHttp('k44-health', `${k44Url}/health`));
  checks.push(await checkHttp('vivy-health', `${vivyUrl}/health`));
  checks.push(await checkHttp('mcp-health', mcpUrl));
  checks.push(await checkHttp('llm-active', `${a11Url}/api/llm/active`));
  checks.push(checkCommand('docker', 'docker', ['version', '--format', '{{.Server.Version}}']));
  checks.push(checkCommand('podman', 'podman', ['version', '--format', '{{.Client.Version}}'], { warnOnly: true }));
  checks.push(checkChopper());
  checks.push(checkStripeEnv());
  checks.push(checkStoragePolicy());

  const summary = {
    ok: checks.every((check) => check.status === 'ok' || check.status === 'warn'),
    failed: checks.filter((check) => check.status === 'fail').map((check) => check.name),
    warnings: checks.filter((check) => check.status === 'warn').map((check) => check.name),
    checkedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    checks,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const check of checks) {
      const suffix = check.status === 'ok' ? 'OK' : check.status === 'warn' ? 'WARN' : 'FAIL';
      console.log(`${suffix.padEnd(5)} ${check.name}`);
    }
    console.log(`\nSmoke ${summary.ok ? 'passed' : 'failed'}: ${checks.length - summary.failed.length}/${checks.length} checks non-failing`);
  }

  if (strict && summary.failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(`smoke-all failed: ${String(error?.message || error)}`);
  process.exit(1);
});
