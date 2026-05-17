'use strict';

/**
 * Funesterie Forge
 *
 * Local, safe-by-default Copilot-style coordinator.
 * It maps repos, creates bounded task files, and prepares the path for MCP/workers
 * without exposing secrets, deleting files, deploying, or running arbitrary shell.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VERSION = '0.1.0';
const ROOT = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(ROOT, 'tasks', 'forge');
const JOBS_JSONL = path.join(TASKS_DIR, 'jobs.jsonl');
const SECRET_PATH_RE = /(^|[\\/])(\.env(\.|$)|secrets?([\\/]|$)|.*\.pem$|.*\.key$|.*\.p12$|.*\.pfx$|client_secret|credentials?)/i;
const DEFAULT_TESTS = [
  npmCommand('mcp-smoke', path.join(ROOT, 'a11', 'backend', 'apps', 'server'), ['run', 'test:mcp']),
  npmCommand('a11mcp-typecheck', path.join(ROOT, 'a11mcp'), ['run', 'check'])
];

function usage() {
  return `Funesterie Forge ${VERSION}

Usage:
  npm run forge -- status [--json]
  npm run forge -- repo-map [--repo <path>] [--json]
  npm run forge -- task --title <title> --goal <goal> [--mode diagnostic] [--repo <path>] [--json]
  npm run forge -- doctor [--run-checks] [--json]

Safety:
  - no secret file content reads
  - no raw .env/token/key output
  - no delete/deploy
  - no arbitrary shell
  - task artifacts stay under tasks/forge
`;
}

function parseArgs(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      flags._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

function npmCommand(id, cwd, args) {
  if (process.platform !== 'win32') {
    return { id, cwd, command: 'npm', args };
  }
  return { id, cwd, command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args] };
}

function run(command, args, options = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, {
        cwd: options.cwd || ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: options.maxBuffer || 2 * 1024 * 1024
      }).trim()
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || '').trim(),
      stderr: redactText(String(error.stderr || error.message || error).trim()),
      code: typeof error.status === 'number' ? error.status : 1
    };
  }
}

function git(repo, args) {
  return run('git', args, { cwd: repo });
}

function readJson(file) {
  if (isSecretPath(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function appendJsonl(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

function writeFileSafe(file, content) {
  const resolved = path.resolve(file);
  const allowed = path.resolve(TASKS_DIR);
  if (!resolved.startsWith(`${allowed}${path.sep}`) && resolved !== allowed) {
    throw new Error('Forge write refused: output must stay under tasks/forge.');
  }
  ensureDir(path.dirname(resolved));
  fs.writeFileSync(resolved, content, 'utf8');
}

function isSecretPath(file) {
  return SECRET_PATH_RE.test(String(file || ''));
}

function redactText(text) {
  return String(text || '')
    .replace(/gh[opsu]_[A-Za-z0-9_]+/g, 'gh_***')
    .replace(/(token|secret|password|api[_-]?key)(\s*[:=]\s*)([^\s"'`]+)/gi, '$1$2***')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[redacted private key]');
}

function shortSha(repo) {
  const result = git(repo, ['rev-parse', '--short', 'HEAD']);
  return result.ok ? result.stdout : null;
}

function branch(repo) {
  const result = git(repo, ['branch', '--show-current']);
  return result.ok ? result.stdout || '(detached)' : null;
}

function gitStatus(repo) {
  const result = git(repo, ['status', '--short']);
  if (!result.ok) return { ok: false, error: result.stderr };
  const lines = result.stdout ? result.stdout.split(/\r?\n/).filter(Boolean) : [];
  const redacted = lines.filter((line) => isSecretPath(line)).length;
  return {
    ok: true,
    clean: lines.length === 0,
    changedCount: lines.length,
    redactedCount: redacted,
    sample: lines.filter((line) => !isSecretPath(line)).slice(0, 20)
  };
}

function listTrackedFiles(repo) {
  const result = git(repo, ['ls-files']);
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => !isSecretPath(file));
}

function packageInfo(repo) {
  const file = path.join(repo, 'package.json');
  const pkg = readJson(file);
  if (!pkg) return null;
  return {
    name: pkg.name || path.basename(repo),
    private: Boolean(pkg.private),
    scripts: Object.keys(pkg.scripts || {}).sort().slice(0, 120),
    dependencies: Object.keys(pkg.dependencies || {}).sort().slice(0, 120),
    devDependencies: Object.keys(pkg.devDependencies || {}).sort().slice(0, 120)
  };
}

function repoMap(repoPath) {
  const repo = path.resolve(repoPath || ROOT);
  const files = listTrackedFiles(repo);
  const packageFiles = files.filter((file) => file.endsWith('package.json'));
  const testFiles = files.filter((file) => /(^|[\\/])(test|tests)[\\/]|\.test\./i.test(file)).slice(0, 80);
  const workflowFiles = files.filter((file) => file.startsWith('.github/workflows/')).slice(0, 80);
  const routeLikeFiles = files.filter((file) => /(server|route|router|mcp|worker|orchestrator|dispatcher|qflush|forge)/i.test(file)).slice(0, 120);

  return {
    schema: 'funesterie.forge.repo-map.v1',
    repo,
    branch: branch(repo),
    head: shortSha(repo),
    status: gitStatus(repo),
    package: packageInfo(repo),
    counts: {
      trackedFiles: files.length,
      packageFiles: packageFiles.length,
      testFiles: testFiles.length,
      workflowFiles: workflowFiles.length,
      routeLikeFiles: routeLikeFiles.length
    },
    packageFiles: packageFiles.slice(0, 40),
    testFiles,
    workflowFiles,
    routeLikeFiles
  };
}

function forgeStatus() {
  const knownRepos = [
    ROOT,
    path.join(ROOT, 'a11mcp'),
    path.join(ROOT, 'a11', 'backend', 'apps', 'server')
  ].filter((repo) => fs.existsSync(repo));

  return {
    schema: 'funesterie.forge.status.v1',
    version: VERSION,
    safety: {
      arbitraryShell: false,
      secrets: false,
      delete: false,
      deploy: false,
      writeScope: 'tasks/forge only'
    },
    root: ROOT,
    taskStore: TASKS_DIR,
    repos: knownRepos.map((repo) => ({
      repo,
      branch: branch(repo),
      head: shortSha(repo),
      status: gitStatus(repo)
    })),
    commands: ['status', 'repo-map', 'task', 'doctor']
  };
}

function slug(value) {
  return String(value || 'task')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'task';
}

function createTask(flags) {
  const title = String(flags.title || '').trim();
  const goal = String(flags.goal || '').trim();
  const mode = String(flags.mode || 'diagnostic').trim();
  const repo = path.resolve(String(flags.repo || ROOT));
  if (!title) throw new Error('--title is required');
  if (!goal) throw new Error('--goal is required');
  if (isSecretPath(title) || isSecretPath(goal)) throw new Error('Task text looks secret-related; refusing.');
  if (!fs.existsSync(repo)) throw new Error(`Repo not found: ${repo}`);

  const id = `forge-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const task = {
    schema: 'funesterie.forge.task.v1',
    id,
    createdAt: new Date().toISOString(),
    title,
    goal,
    mode,
    repo,
    branch: branch(repo),
    head: shortSha(repo),
    status: 'queued',
    safety: {
      noSecrets: true,
      noDelete: true,
      noDeploy: true,
      noFreeShell: true,
      worktreeRequiredForPatch: true
    },
    nextActions: [
      'Run forge repo-map for context.',
      'Create an isolated git worktree before editing.',
      'Produce a diff and test report before any PR.',
      'Never include secrets or raw env values.'
    ]
  };

  const md = [
    `# ${title}`,
    '',
    `- id: ${id}`,
    `- status: queued`,
    `- mode: ${mode}`,
    `- repo: ${repo}`,
    `- branch: ${task.branch || 'unknown'}`,
    `- head: ${task.head || 'unknown'}`,
    '',
    '## Goal',
    '',
    goal,
    '',
    '## Guardrails',
    '',
    '- No secrets, tokens, .env values, private keys, or credentials.',
    '- No delete, deploy, or destructive commands.',
    '- Patch work must happen in an isolated git worktree.',
    '- Output must include summary, files touched, tests run, and residual risks.',
    '',
    '## Suggested First Command',
    '',
    '```powershell',
    `npm run forge -- repo-map --repo "${repo}"`,
    '```',
    ''
  ].join('\n');

  appendJsonl(JOBS_JSONL, task);
  const mdFile = path.join(TASKS_DIR, `${id}.md`);
  writeFileSafe(mdFile, md);
  return { ok: true, task, files: { markdown: mdFile, jobsJsonl: JOBS_JSONL } };
}

function runCheck(check) {
  const started = Date.now();
  const result = run(check.command, check.args, { cwd: check.cwd, maxBuffer: 4 * 1024 * 1024 });
  return {
    id: check.id,
    cwd: check.cwd,
    command: [check.command, ...check.args].join(' '),
    ok: result.ok,
    durationMs: Date.now() - started,
    summary: result.ok ? lastLines(result.stdout, 12) : lastLines(`${result.stdout}\n${result.stderr}`, 20)
  };
}

function lastLines(text, count) {
  return redactText(String(text || '').split(/\r?\n/).filter(Boolean).slice(-count).join('\n'));
}

function doctor(flags) {
  const runChecks = Boolean(flags['run-checks']);
  const maps = [ROOT, path.join(ROOT, 'a11mcp')].filter((repo) => fs.existsSync(repo)).map(repoMap);
  return {
    schema: 'funesterie.forge.doctor.v1',
    checkedAt: new Date().toISOString(),
    status: forgeStatus(),
    maps: maps.map((map) => ({
      repo: map.repo,
      branch: map.branch,
      head: map.head,
      clean: map.status.clean,
      changedCount: map.status.changedCount,
      scripts: map.package?.scripts || [],
      counts: map.counts
    })),
    checksRun: runChecks,
    checks: runChecks ? DEFAULT_TESTS.filter((check) => fs.existsSync(check.cwd)).map(runCheck) : []
  };
}

function print(value, flags) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === 'string') {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const command = flags._[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') {
    print(usage(), flags);
    return;
  }
  if (command === 'status') {
    print(forgeStatus(), flags);
    return;
  }
  if (command === 'repo-map') {
    print(repoMap(flags.repo || ROOT), flags);
    return;
  }
  if (command === 'task') {
    print(createTask(flags), flags);
    return;
  }
  if (command === 'doctor') {
    print(doctor(flags), flags);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(redactText(error && error.stack ? error.stack : String(error)));
  process.exit(1);
});
