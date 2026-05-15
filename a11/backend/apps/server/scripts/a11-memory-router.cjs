'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  Neo4jMemoryRouter,
  resolveRouterConfig,
} = require('../lib/neo4j-memory-router.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PASS_FILE = 'C:\\Users\\Djeff\\Desktop\\pass.txt';

function loadEnvFile(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    if (options.override || process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

function loadRouterEnv() {
  loadEnvFile(path.join(SERVER_ROOT, '.env'));
  loadEnvFile(path.join(SERVER_ROOT, '.env.local'), { override: true });
  loadEnvFile(process.env.A11_MEMORY_PASS_FILE || DEFAULT_PASS_FILE, { override: true });
}

function parseOption(args, name) {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value || '';
}

function redact(value) {
  return String(value || '').replace(/(password|token|secret|key)[^",}]*/gi, '$1:[redacted]');
}

async function main() {
  loadRouterEnv();
  const args = process.argv.slice(2);
  const command = args.shift() || 'status';
  const outputRoot = parseOption(args, 'output');
  const limit = Number(parseOption(args, 'limit') || 12);
  const router = new Neo4jMemoryRouter(resolveRouterConfig());

  let result;
  if (command === 'status') {
    result = await router.status();
  } else if (command === 'search') {
    const query = args.join(' ').trim();
    if (!query) throw new Error('Usage: node scripts/a11-memory-router.cjs search "texte"');
    result = await router.searchMemory(query, { limit, includeLocal: true });
  } else if (command === 'write-note') {
    const content = args.join(' ').trim();
    if (!content) throw new Error('Usage: node scripts/a11-memory-router.cjs write-note "note"');
    result = await router.writeMemoryNote(content, {
      source: 'a11-memory-router-cli',
      writtenBy: 'codex',
    });
  } else if (command === 'sync-local') {
    result = await router.syncAuraToLocal();
  } else if (command === 'backup-seagate') {
    result = await router.backupToSeagate(outputRoot ? { outputRoot } : {});
  } else {
    throw new Error(`Unknown command "${command}". Use status, search, write-note, sync-local, backup-seagate.`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${redact(error.stack || error.message || error)}\n`);
  process.exitCode = 1;
});
