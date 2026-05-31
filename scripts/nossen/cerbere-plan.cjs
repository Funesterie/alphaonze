#!/usr/bin/env node
'use strict';

/**
 * cerbere-plan.cjs
 * Sort un plan JSON secret-safe pour le plan de contrôle agentique Cerbère.
 *
 * Usage:
 *   node scripts/nossen/cerbere-plan.cjs
 *   node scripts/nossen/cerbere-plan.cjs --lane voice
 *   node scripts/nossen/cerbere-plan.cjs --out D:\agent-bus\cerbere-plan.json
 */

const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── Lanes ─────────────────────────────────────────────────────────────────────

const LANES = {
  'prod-smoke': {
    patterns: [],
    agent: 'qflush/chopper',
    tests: ['chopper doctor', 'qflush smoke'],
    description: 'Health checks prod endpoints',
  },
  'wip-harvest': {
    patterns: [/.*/],
    agent: 'codex',
    tests: ['git diff --stat', 'nossen-agriculture -Topic all -DryRun'],
    description: 'Collecte WIP dirty → tranches PR propres',
  },
  'voice': {
    patterns: [
      /a11\/backend\/apps\/voice-module/,
      /a11\/backend\/apps\/server\/routes\/tts/,
      /a11\/backend\/apps\/server\/src\/tts\//,
      /a11\/backend\/apps\/server\/src\/routes\/vivy-studio/,
    ],
    agent: 'codex',
    tests: ['npm run test:voice', 'chopper smoke voice'],
    description: 'Voice module + TTS routes + Vivy studio',
  },
  'auth-drive': {
    patterns: [
      /a11\/backend\/apps\/server\/src\/routes\/auth/,
      /a11\/backend\/apps\/server\/src\/routes\/protected-chat-proxy/,
      /a11\/backend\/apps\/server\/src\/routes\/chat/,
      /a11\/backend\/apps\/server\/server\.cjs/,
    ],
    agent: 'codex',
    tests: ['npm run test:auth', 'npm run test:contracts'],
    description: 'Auth session bridge + drive proxy',
  },
  'vivy-gate': {
    patterns: [
      /a11\/backend\/apps\/server\/src\/routes\/vivy-studio/,
      /a11\/backend\/apps\/server\/src\/chat\/a11-active-identity/,
    ],
    agent: 'a11',
    tests: ['npm run test:vivy', 'chopper smoke vivy'],
    description: 'Vivy gate + active identity',
  },
  'math-ocr': {
    patterns: [
      /scripts\/research\//,
      /docs\/research\/prime_spiral\//,
      /a11\/backend\/apps\/voice-module\/app\/prime_spiral/,
      /scripts\/nossen\/New-Math/,
    ],
    agent: 'codex',
    tests: ['node scripts/research/test-symetrie-op-table.js', 'python prime_spiral_morph.py --op-table'],
    description: 'Prime spiral + OCR + research corpus',
  },
};

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const laneFilter = args.includes('--lane') ? args[args.indexOf('--lane') + 1] : null;
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

if (laneFilter && !LANES[laneFilter]) {
  console.error(`Lane inconnue: "${laneFilter}". Valides: ${Object.keys(LANES).join(', ')}`);
  process.exit(1);
}

// ── Prod health ───────────────────────────────────────────────────────────────

function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      res.resume();
    });
    req.on('error', () => resolve({ ok: false, status: null }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'timeout' }); });
  });
}

async function checkProd() {
  const endpoints = {
    a11: 'https://a11.funesterie.me/health',
    kaen44: 'https://k44.funesterie.me/health',
    vivy: 'https://vivy.funesterie.me/health',
    mcp: 'https://mcp.funesterie.me/health',
  };
  const results = {};
  await Promise.all(
    Object.entries(endpoints).map(async ([name, url]) => {
      results[name] = await httpGet(url);
    })
  );
  return results;
}

// ── Git status → dirty files ──────────────────────────────────────────────────

function getDirtyFiles() {
  try {
    const out = execSync('git status --short', { cwd: REPO_ROOT, encoding: 'utf8' });
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim().replace(/\\/g, '/'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── Map files to lanes ────────────────────────────────────────────────────────

function assignToLanes(dirtyFiles, filter) {
  const lanesToProcess = filter ? { [filter]: LANES[filter] } : LANES;
  const result = {};

  for (const [laneName, lane] of Object.entries(lanesToProcess)) {
    if (laneName === 'prod-smoke' || laneName === 'wip-harvest') {
      result[laneName] = { dirty_files: [], ...buildLaneEntry(laneName, lane, []) };
      continue;
    }
    const matched = dirtyFiles.filter((f) =>
      lane.patterns.some((p) => p.test(f))
    );
    result[laneName] = { dirty_files: matched, ...buildLaneEntry(laneName, lane, matched) };
  }

  if (!filter && result['wip-harvest']) {
    result['wip-harvest'].dirty_files = dirtyFiles;
    result['wip-harvest'].tasks = dirtyFiles.length > 0
      ? [`${dirtyFiles.length} fichiers dirty → katana slice → PR`]
      : ['Aucun fichier dirty'];
    result['wip-harvest'].risks = dirtyFiles.length > 30
      ? ['Trop de fichiers dirty — logic-reduce recommandé avant slice']
      : [];
  }

  return result;
}

function buildLaneEntry(laneName, lane, matchedFiles) {
  const tasks = matchedFiles.length > 0
    ? matchedFiles.map((f) => `review + test: ${f}`)
    : laneName === 'prod-smoke'
      ? ['Vérifier endpoints health A11/K44/Vivy/MCP']
      : ['(aucun fichier dirty sur cette lane)'];

  const risks = [];
  if (matchedFiles.some((f) => /\.env/.test(f))) risks.push('Fichier .env modifié — vérifier avant commit');
  if (matchedFiles.some((f) => /server\.cjs/.test(f))) risks.push('server.cjs modifié — smoke test obligatoire');
  if (matchedFiles.some((f) => /auth/.test(f))) risks.push('Route auth modifiée — review sécurité recommandée');
  if (matchedFiles.length > 10) risks.push('Beaucoup de fichiers — envisager katana slice');

  return {
    description: lane.description,
    agent: lane.agent,
    tasks,
    risks,
    tests: lane.tests,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [prodStatus, dirtyFiles] = await Promise.all([
    checkProd(),
    Promise.resolve(getDirtyFiles()),
  ]);

  const lanes = assignToLanes(dirtyFiles, laneFilter);

  const plan = {
    generated_at: new Date().toISOString(),
    repo_root: REPO_ROOT,
    prod_status: prodStatus,
    dirty_total: dirtyFiles.length,
    lanes,
  };

  const json = JSON.stringify(plan, null, 2);

  if (outArg) {
    const dir = path.dirname(outArg);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outArg, json, 'utf8');
    console.log(`Plan écrit: ${outArg}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

main().catch((err) => {
  console.error('cerbere-plan error:', err.message);
  process.exit(1);
});
