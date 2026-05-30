#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT_DIR = path.join(SCRIPT_ROOT, 'runtime', 'nossen', 'cerbere');

const LANE_RULES = [
  {
    id: 'voice',
    title: 'Voice / persona audio',
    priority: 10,
    agent: 'codex',
    reviewers: ['claude', 'chopper'],
    patterns: [
      /voice-module/i,
      /\/tts\//i,
      /routes\/tts/i,
      /voice-provider/i,
      /voice-reference/i,
      /xtts/i,
      /rvc/i,
      /vivy-studio/i,
    ],
    tests: [
      'node --test test/tts-route.node.test.cjs test/voice-provider-manifest.node.test.cjs',
      'uv run pytest a11/backend/apps/voice-module/tests',
      'POST /api/tts/speak smoke for a11, kaen44, vivy',
    ],
    guards: [
      'No demo voice can be selected as A11/K44/Vivy persona.',
      'Keep XTTS/RVC bridge health separate from backend health.',
    ],
  },
  {
    id: 'auth-drive',
    title: 'Auth and Google/Microsoft Drive sessions',
    priority: 9,
    agent: 'codex',
    reviewers: ['kiro', 'claude'],
    patterns: [
      /routes\/auth/i,
      /account-connectors/i,
      /oauth-token-vault/i,
      /session-drive/i,
      /src\/storage/i,
      /files\/upload/i,
      /google/i,
      /microsoft/i,
      /onedrive/i,
    ],
    tests: [
      'node --test test/auth-local-fallback.node.test.cjs test/account-connectors.node.test.cjs',
      'node --test test/session-drive-storage.node.test.cjs test/session-drive-writer.node.test.cjs',
    ],
    guards: [
      'No OAuth token in logs or repo.',
      'Reuse remote secrets during deploy.',
    ],
  },
  {
    id: 'vivy-gate',
    title: 'Vivy login gate and protected studio',
    priority: 8,
    agent: 'codex',
    reviewers: ['kiro'],
    patterns: [
      /vivy/i,
      /protected-chat-proxy/i,
      /full-access/i,
      /session_required/i,
    ],
    tests: [
      'node --test test/vivy-studio-route.node.test.cjs',
      'frontend smoke: /vivy redirects when session is missing',
    ],
    guards: [
      'Vivy must follow the same auth boundary as A11/K44.',
      'Do not expose private studio routes to anonymous users.',
    ],
  },
  {
    id: 'frontend-ui',
    title: 'Frontend UI cleanup',
    priority: 6,
    agent: 'codex',
    reviewers: ['copilot'],
    patterns: [
      /frontend\/apps\/web\/src\/App\.tsx/i,
      /frontend\/apps\/web\/src\/index\.css/i,
      /frontend\/apps\/web\/public/i,
      /src\/lib\/api\.ts/i,
      /src\/lib\/speech\.ts/i,
    ],
    tests: [
      'npm --prefix a11/frontend/apps/web run build',
      'browser smoke on A11/K44/Vivy pages',
    ],
    guards: [
      'Avoid a full App.tsx rewrite.',
      'Keep changes domain-scoped.',
    ],
  },
  {
    id: 'backend-core',
    title: 'Backend routes and resolver core',
    priority: 7,
    agent: 'codex',
    reviewers: ['chopper'],
    patterns: [
      /backend\/apps\/server\/server\.cjs/i,
      /routes\/chat/i,
      /resolve-user-request/i,
      /qflush-integration/i,
      /mcp-client/i,
      /mcp-cockpit/i,
      /protected-chat-proxy/i,
    ],
    tests: [
      'npm --prefix a11/backend/apps/server run test:mcp',
      'node --test selected backend route tests',
    ],
    guards: [
      'Keep runtime data out of commits.',
      'No broad server.cjs harvest without a focused PR.',
    ],
  },
  {
    id: 'math-ocr',
    title: 'Math OCR and Djeff research curation',
    priority: 5,
    agent: 'codex',
    reviewers: ['gemini', 'claude'],
    patterns: [
      /math/i,
      /ocr/i,
      /prime/i,
      /mask/i,
      /research/i,
      /New-Math/i,
      /prime_spiral/i,
    ],
    tests: [
      'PowerShell OCR curator dry-run',
      'Generate compact research cards only',
    ],
    guards: [
      'Classify try/retry/fail separately from stable formulas.',
      'No raw image upload to external services by default.',
    ],
  },
  {
    id: 'ops-infra',
    title: 'Ops, deploy, Podman, runtime workers',
    priority: 6,
    agent: 'codex',
    reviewers: ['chopper'],
    patterns: [
      /ops\//i,
      /launchers\//i,
      /docker/i,
      /podman/i,
      /deploy/i,
      /worker/i,
      /cerbere/i,
      /qflush/i,
      /railway/i,
      /render/i,
    ],
    tests: [
      'prod health smoke',
      'worker supervisor status',
      'no secrets in deploy logs',
    ],
    guards: [
      'No deploy from dirty worktree.',
      'No raw secrets printed.',
    ],
  },
  {
    id: 'finance-billing',
    title: 'Finance and billing connectors',
    priority: 4,
    agent: 'codex',
    reviewers: [],
    patterns: [
      /qonto/i,
      /mollie/i,
      /billing/i,
      /invoice/i,
      /facture/i,
    ],
    tests: [
      'client tests with redacted fixtures',
      'route tests without real credentials',
    ],
    guards: [
      'Never print bank tokens or API keys.',
      'Never remove accounts/payments without explicit confirmation.',
    ],
  },
];

const SPECIAL_LANES = {
  'prod-smoke': {
    id: 'prod-smoke',
    title: 'Production smoke and release gate',
    priority: 8,
    agent: 'codex',
    reviewers: ['claude', 'chopper'],
    tests: [
      'GET /health on funesterie.me, a11, k44, vivy, mcp',
      'POST /api/tts/speak smoke for a11, kaen44, vivy',
      'deploy only from a clean release worktree',
    ],
    guards: [
      'Do not deploy from the dirty main repo.',
      'Do not print secrets from remote env or logs.',
    ],
  },
  'wip-harvest': {
    id: 'wip-harvest',
    title: 'WIP harvest and PR slicing',
    priority: 8,
    agent: 'codex',
    reviewers: ['claude', 'gemini'],
    tests: [
      'node scripts/nossen/cerbere-plan.cjs --repo-root <dirty-root>',
      'one clean worktree per selected lane',
    ],
    guards: [
      'Never git add -A from the dirty main repo.',
      'Runtime/generated data stays out of PRs.',
    ],
  },
};

const SECRET_PATH_PATTERNS = [
  /(^|[\\/])\.env/i,
  /(^|[\\/])\.npmrc/i,
  /(^|[\\/])\.jfrog/i,
  /(^|[\\/])\.netlify/i,
  /\.pem$/i,
  /\.key$/i,
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
];

const RUNTIME_PATH_PATTERNS = [
  /knowledge-graph[\\/]tasks\.json/i,
  /(^|[\\/])logs?[\\/]/i,
  /(^|[\\/])tmp[\\/]/i,
  /(^|[\\/])runtime[\\/]/i,
  /(^|[\\/])node_modules[\\/]/i,
  /__pycache__/i,
  /\.log$/i,
];

function parseArgs(argv) {
  const options = {
    repoRoot: SCRIPT_ROOT,
    outDir: DEFAULT_OUT_DIR,
    jsonOnly: false,
    markdownOnly: false,
    stdout: false,
    maxFilesPerLane: 16,
    includeUntracked: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--repo-root') options.repoRoot = path.resolve(requireValue(argv, i += 1, arg));
    else if (arg === '--out-dir') options.outDir = path.resolve(requireValue(argv, i += 1, arg));
    else if (arg === '--json') options.jsonOnly = true;
    else if (arg === '--markdown') options.markdownOnly = true;
    else if (arg === '--stdout') options.stdout = true;
    else if (arg === '--max-files-per-lane') options.maxFilesPerLane = Number(requireValue(argv, i += 1, arg));
    else if (arg === '--tracked-only') options.includeUntracked = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.maxFilesPerLane) || options.maxFilesPerLane < 1) {
    options.maxFilesPerLane = 16;
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function printHelp() {
  console.log(`Cerbere agentic plan

Usage:
  node scripts/nossen/cerbere-plan.cjs [options]

Options:
  --repo-root <path>          Repository to inspect. Default: current repo.
  --out-dir <path>            Output directory. Default: runtime/nossen/cerbere.
  --json                      Print JSON only.
  --markdown                  Print Markdown only.
  --stdout                    Print selected output to stdout.
  --tracked-only              Ignore untracked files.
  --max-files-per-lane <n>    Max sample files per lane. Default: 16.
  --help                      Show this help.
`);
}

function runGit(repoRoot, args, fallback = '') {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return fallback;
  }
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^"+|"+$/g, '').trim();
}

function parseStatusLine(line) {
  const raw = String(line || '');
  if (!raw.trim()) return null;
  const status = raw.slice(0, 2);
  let file = raw.slice(3).trim();
  if (file.includes(' -> ')) file = file.split(' -> ').pop();
  file = normalizePath(file);
  if (!file) return null;
  return {
    path: file,
    status: status.trim() || 'modified',
    tracked: !status.startsWith('??'),
    secretLike: isSecretLikePath(file),
    runtimeLike: isRuntimeLikePath(file),
  };
}

function isSecretLikePath(filePath) {
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isRuntimeLikePath(filePath) {
  return RUNTIME_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function getGitStatus(repoRoot, includeUntracked) {
  const raw = runGit(repoRoot, ['status', '--short'], '');
  return raw
    .split(/\r?\n/)
    .map(parseStatusLine)
    .filter(Boolean)
    .filter((entry) => includeUntracked || entry.tracked);
}

function getBranch(repoRoot) {
  return runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown').trim() || 'unknown';
}

function getHead(repoRoot) {
  return runGit(repoRoot, ['rev-parse', '--short=12', 'HEAD'], 'unknown').trim() || 'unknown';
}

function getWorktreeSummary(repoRoot) {
  const raw = runGit(repoRoot, ['worktree', 'list', '--porcelain'], '');
  const worktrees = [];
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length), branch: '', head: '' };
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length, 'HEAD '.length + 12);
    }
  }
  if (current) worktrees.push(current);

  let dirty = 0;
  let clean = 0;
  for (const worktree of worktrees) {
    if (!fs.existsSync(worktree.path)) continue;
    const status = runGit(worktree.path, ['status', '--short'], '');
    if (status.trim()) dirty += 1;
    else clean += 1;
  }

  return {
    total: worktrees.length,
    dirty,
    clean,
    samples: worktrees.slice(0, 20).map((worktree) => ({
      path: worktree.path,
      branch: worktree.branch || 'detached',
      head: worktree.head,
    })),
  };
}

function getDiffStats(repoRoot) {
  const raw = runGit(repoRoot, ['diff', '--stat', 'HEAD'], '');
  return raw
    .split(/\r?\n/)
    .filter((line) => line.includes('|'))
    .map((line) => line.trim())
    .slice(0, 30);
}

function classifyFile(entry) {
  const filePath = entry.path;
  const matches = [];
  for (const rule of LANE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(filePath))) {
      matches.push(rule.id);
    }
  }
  if (!matches.length) matches.push('wip-harvest');
  return matches;
}

function getLaneDefinition(laneId) {
  return LANE_RULES.find((item) => item.id === laneId) || SPECIAL_LANES[laneId];
}

function buildPlan(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const status = getGitStatus(repoRoot, options.includeUntracked);
  const laneFiles = new Map();
  for (const rule of LANE_RULES) laneFiles.set(rule.id, []);
  laneFiles.set('wip-harvest', []);

  for (const entry of status) {
    for (const lane of classifyFile(entry)) {
      laneFiles.get(lane).push(entry);
    }
  }

  const lanePlans = [];
  for (const laneId of ['prod-smoke', ...LANE_RULES.map((rule) => rule.id), 'wip-harvest']) {
    if (lanePlans.some((lane) => lane.id === laneId)) continue;
    const rule = getLaneDefinition(laneId);

    const files = laneId === 'prod-smoke' ? [] : (laneFiles.get(laneId) || []);
    const visibleFiles = files
      .filter((file) => !file.secretLike)
      .slice(0, options.maxFilesPerLane)
      .map((file) => ({
        path: file.path,
        status: file.status,
        tracked: file.tracked,
        runtimeLike: file.runtimeLike,
      }));
    const hiddenSecretLike = files.filter((file) => file.secretLike).length;
    const runtimeLike = files.filter((file) => file.runtimeLike).length;
    const shouldInclude = laneId === 'prod-smoke' || files.length > 0 || laneId === 'wip-harvest';
    if (!shouldInclude) continue;

    lanePlans.push({
      id: laneId,
      title: rule.title,
      priority: rule.priority,
      agent: rule.agent,
      reviewers: rule.reviewers || [],
      fileCount: files.length,
      runtimeLike,
      hiddenSecretLike,
      files: visibleFiles,
      tests: rule.tests || [],
      guards: rule.guards || [],
      recommendedAction: recommendAction(laneId, files),
    });
  }

  const trackedCount = status.filter((entry) => entry.tracked).length;
  const untrackedCount = status.filter((entry) => !entry.tracked).length;
  const secretLikeCount = status.filter((entry) => entry.secretLike).length;
  const runtimeLikeCount = status.filter((entry) => entry.runtimeLike).length;

  return {
    schema: 'funesterie.cerbere-agentic-plan.v1',
    generatedAt: new Date().toISOString(),
    repoRoot,
    branch: getBranch(repoRoot),
    head: getHead(repoRoot),
    summary: {
      changedFiles: status.length,
      trackedFiles: trackedCount,
      untrackedFiles: untrackedCount,
      secretLikePathsHidden: secretLikeCount,
      runtimeLikePaths: runtimeLikeCount,
    },
    worktrees: getWorktreeSummary(repoRoot),
    diffStats: getDiffStats(repoRoot),
    policy: {
      primaryAnswerPath: 'A11 first',
      fallbackGuard: 'Cerbere routes, reduces, and protects when A11/local routes are busy',
      implementationOwner: 'Codex',
      noInlineSecrets: true,
      cleanWorktreeRequired: true,
    },
    lanes: lanePlans.sort((a, b) => b.priority - a.priority || b.fileCount - a.fileCount),
  };
}

function recommendAction(laneId, files) {
  if (laneId === 'prod-smoke') {
    return 'Run health and voice smoke checks before and after every deploy.';
  }
  if (!files.length) {
    return 'Keep lane available; no current files detected.';
  }
  if (files.some((file) => file.secretLike)) {
    return 'Inspect only paths, never contents, then isolate safe code changes in a clean worktree.';
  }
  if (files.some((file) => file.runtimeLike)) {
    return 'Separate generated/runtime data from code before creating a PR.';
  }
  return 'Harvest this lane into one clean worktree and run the listed tests.';
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push('# Cerbere Agentic Plan');
  lines.push('');
  lines.push(`Generated: ${plan.generatedAt}`);
  lines.push(`Repo: \`${plan.repoRoot}\``);
  lines.push(`Branch: \`${plan.branch}\` @ \`${plan.head}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Changed files: ${plan.summary.changedFiles}`);
  lines.push(`- Tracked: ${plan.summary.trackedFiles}`);
  lines.push(`- Untracked: ${plan.summary.untrackedFiles}`);
  lines.push(`- Secret-like paths hidden: ${plan.summary.secretLikePathsHidden}`);
  lines.push(`- Runtime/generated-like paths: ${plan.summary.runtimeLikePaths}`);
  lines.push(`- Worktrees: ${plan.worktrees.total} total, ${plan.worktrees.dirty} dirty, ${plan.worktrees.clean} clean`);
  lines.push('');
  lines.push('## Policy');
  lines.push('');
  lines.push('- A11 is the priority answer path.');
  lines.push('- Cerbere is fallback, router, reducer, and guard.');
  lines.push('- Codex owns implementation, tests, and deploy orchestration.');
  lines.push('- Claude/Gemini/Copilot are reviewers/helpers, not the source of truth.');
  lines.push('- Use one clean worktree per lane.');
  lines.push('- Never inline secrets or large dumps.');
  lines.push('');
  lines.push('## Lanes');
  lines.push('');

  for (const lane of plan.lanes) {
    lines.push(`### ${lane.id}: ${lane.title}`);
    lines.push('');
    lines.push(`- Priority: ${lane.priority}`);
    lines.push(`- Agent: ${lane.agent}`);
    lines.push(`- Reviewers: ${lane.reviewers.length ? lane.reviewers.join(', ') : 'none'}`);
    lines.push(`- Files detected: ${lane.fileCount}`);
    if (lane.hiddenSecretLike) lines.push(`- Secret-like paths hidden: ${lane.hiddenSecretLike}`);
    if (lane.runtimeLike) lines.push(`- Runtime/generated-like paths: ${lane.runtimeLike}`);
    lines.push(`- Recommended action: ${lane.recommendedAction}`);
    lines.push('');
    if (lane.files.length) {
      lines.push('Files:');
      for (const file of lane.files) {
        const flags = [file.status, file.tracked ? 'tracked' : 'untracked', file.runtimeLike ? 'runtime-like' : '']
          .filter(Boolean)
          .join(', ');
        lines.push(`- \`${file.path}\` (${flags})`);
      }
      lines.push('');
    }
    if (lane.tests.length) {
      lines.push('Tests / checks:');
      for (const test of lane.tests) lines.push(`- ${test}`);
      lines.push('');
    }
    if (lane.guards.length) {
      lines.push('Guards:');
      for (const guard of lane.guards) lines.push(`- ${guard}`);
      lines.push('');
    }
  }

  if (plan.diffStats.length) {
    lines.push('## Top Diff Stats');
    lines.push('');
    for (const stat of plan.diffStats) lines.push(`- ${stat}`);
    lines.push('');
  }

  lines.push('## Next Move');
  lines.push('');
  lines.push('Pick exactly one lane, create a clean worktree from `origin/master`, harvest only that lane, run tests, then PR.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeOutputs(plan, markdown, options) {
  ensureDir(options.outDir);
  const jsonPath = path.join(options.outDir, 'cerbere-plan.json');
  const mdPath = path.join(options.outDir, 'cerbere-plan.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(mdPath, markdown);
  return { jsonPath, mdPath };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const plan = buildPlan(options);
  const markdown = renderMarkdown(plan);
  const outputs = writeOutputs(plan, markdown, options);

  if (options.stdout || options.jsonOnly || options.markdownOnly) {
    if (options.markdownOnly) process.stdout.write(markdown);
    else process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    console.log(`Cerbere plan written:`);
    console.log(`  ${outputs.jsonPath}`);
    console.log(`  ${outputs.mdPath}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[cerbere-plan] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildPlan,
  renderMarkdown,
};
