'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DEFAULT_RUNTIME_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..', 'runtime');
const DEFAULT_MAX_LOG_CHARS = 4000;

const KNOWN_AGENT_IDS = [
  'a11',
  'chatgpt',
  'chatgpt-enterprise',
  'claude',
  'codex',
  'copilot',
  'gemini',
  'github-copilot',
  'grok',
  'janus',
  'kaen44',
  'kiro',
  'qflush',
  'vivy',
];

const ALLOWED_WORKERS = Object.freeze({
  'identity-archivist': {
    id: 'identity-archivist',
    npmScript: 'worker:archivist',
    description: 'Writes identity hashtags into ecosystem-corpus artifacts.',
    category: 'corpus',
  },
  'identity-archivist-dry-run': {
    id: 'identity-archivist-dry-run',
    npmScript: 'worker:archivist:dry-run',
    description: 'Plans identity hashtag updates without writing corpus files.',
    category: 'corpus',
  },
  'orchestrator-once': {
    id: 'orchestrator-once',
    npmScript: 'worker:orchestrator',
    description: 'Runs one bounded orchestrator pass over dispatched tasks.',
    category: 'orchestration',
  },
  'orchestrator-loop': {
    id: 'orchestrator-loop',
    npmScript: 'worker:orchestrator:loop',
    description: 'Runs the orchestrator polling loop.',
    category: 'orchestration',
    longRunning: true,
  },
  'orchestrator-status': {
    id: 'orchestrator-status',
    npmScript: 'worker:orchestrator:status',
    description: 'Reads orchestrator state through the existing status script.',
    category: 'orchestration',
    readOnly: true,
  },
  'dispatch-agents': {
    id: 'dispatch-agents',
    npmScript: 'dispatch:agents',
    description: 'Lists dispatcher-visible agents.',
    category: 'dispatch',
    readOnly: true,
  },
  'dispatch-status': {
    id: 'dispatch-status',
    npmScript: 'dispatch:status',
    description: 'Reads the persisted dispatcher state.',
    category: 'dispatch',
    readOnly: true,
  },
  'westside-chopper-status': {
    id: 'westside-chopper-status',
    npmScript: 'chopper:status',
    description: 'Reads the WestSide Chopper module assembly status.',
    category: 'assembly',
    readOnly: true,
  },
  'westside-chopper-plan': {
    id: 'westside-chopper-plan',
    npmScript: 'chopper:plan',
    description: 'Reads the bounded WestSide Chopper action plan.',
    category: 'assembly',
    readOnly: true,
  },
  'westside-chopper-rumble': {
    id: 'westside-chopper-rumble',
    npmScript: 'chopper:rumble',
    description: 'Reads the WestSide Chopper Rumble Ball combinations.',
    category: 'assembly',
    readOnly: true,
  },
  'westside-chopper-recipes': {
    id: 'westside-chopper-recipes',
    npmScript: 'chopper:recipes',
    description: 'Reads the WestSide Chopper operation recipes.',
    category: 'assembly',
    readOnly: true,
  },
  'funesterie-mixer-status': {
    id: 'funesterie-mixer-status',
    npmScript: 'mixer:status',
    description: 'Reads the Funesterie Mixer default routing status.',
    category: 'routing',
    readOnly: true,
  },
  'funesterie-mixer-write': {
    id: 'funesterie-mixer-write',
    npmScript: 'mixer:write',
    description: 'Writes the Funesterie Mixer route artifacts.',
    category: 'routing',
  },
  'westside-chopper-doctor': {
    id: 'westside-chopper-doctor',
    npmScript: 'chopper:doctor',
    description: 'Builds the module capability graph and writes the Chopper status artifacts.',
    category: 'assembly',
  },
  'westside-chopper-assemble': {
    id: 'westside-chopper-assemble',
    npmScript: 'chopper:assemble',
    description: 'Refreshes runtime modules and writes the assembled Chopper graph artifacts.',
    category: 'assembly',
  },
  'sync-runtime-hooks-neo4j-dry-run': {
    id: 'sync-runtime-hooks-neo4j-dry-run',
    npmScript: 'sync:runtime-hooks-neo4j:dry-run',
    description: 'Previews runtime hook Neo4j sync.',
    category: 'neo4j',
  },
  'sync-runtime-hooks-neo4j': {
    id: 'sync-runtime-hooks-neo4j',
    npmScript: 'sync:runtime-hooks-neo4j',
    description: 'Syncs runtime hook metadata to Neo4j.',
    category: 'neo4j',
  },
  'sync-ecosystem-scope-neo4j-dry-run': {
    id: 'sync-ecosystem-scope-neo4j-dry-run',
    npmScript: 'sync:ecosystem-scope-neo4j:dry-run',
    description: 'Previews ecosystem scope Neo4j sync.',
    category: 'neo4j',
  },
  'sync-ecosystem-scope-neo4j': {
    id: 'sync-ecosystem-scope-neo4j',
    npmScript: 'sync:ecosystem-scope-neo4j',
    description: 'Syncs ecosystem scope metadata to Neo4j.',
    category: 'neo4j',
  },
  'sync-ecosystem-corpus-neo4j-dry-run': {
    id: 'sync-ecosystem-corpus-neo4j-dry-run',
    npmScript: 'sync:ecosystem-corpus-neo4j:dry-run',
    description: 'Previews ecosystem corpus Neo4j sync.',
    category: 'neo4j',
  },
  'sync-ecosystem-corpus-neo4j': {
    id: 'sync-ecosystem-corpus-neo4j',
    npmScript: 'sync:ecosystem-corpus-neo4j',
    description: 'Syncs ecosystem corpus source cards to Neo4j.',
    category: 'neo4j',
  },
  'generate-ecosystem-briefing': {
    id: 'generate-ecosystem-briefing',
    npmScript: 'generate:ecosystem-briefing',
    description: 'Generates the ecosystem briefing artifacts.',
    category: 'briefing',
  },
  'test-mcp': {
    id: 'test-mcp',
    npmScript: 'test:mcp',
    description: 'Runs the focused MCP and worker supervisor tests.',
    category: 'test',
    readOnly: true,
  },
});

function resolveRuntimeRoot(options = {}) {
  return path.resolve(options.runtimeRoot || process.env.A11_RUNTIME_ROOT || DEFAULT_RUNTIME_ROOT);
}

function resolveSupervisorRoot(options = {}) {
  return path.join(resolveRuntimeRoot(options), 'worker-supervisor');
}

function ensureSupervisorDirs(root) {
  for (const dir of ['audit', 'jobs', 'locks', 'logs', 'tasks']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
}

function auditFile(root) {
  return path.join(root, 'audit', 'worker-supervisor.audit.jsonl');
}

function jobsFile(root) {
  return path.join(root, 'jobs', 'agent-jobs.jsonl');
}

function lockFile(root, workerId) {
  return path.join(root, 'locks', `${workerId}.lock.json`);
}

function sanitizeAgentId(agent) {
  const value = String(agent || '').trim().toLowerCase();
  if (!value) throw new Error('agent is required');
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(value)) {
    throw new Error('agent must be a short safe identifier');
  }
  return value;
}

function normalizeWorkerId(workerId) {
  const value = String(workerId || '').trim();
  if (!value) throw new Error('workerId is required');
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_WORKERS, value)) {
    throw new Error(`workerId is not whitelisted: ${value}`);
  }
  return value;
}

function assertNoSecretText(value, label = 'text') {
  const text = String(value || '');
  const secretPattern = /(bearer\s+[a-z0-9._~+/=-]{16,}|hf_[a-z0-9]{16,}|sk-[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9_]{20,}|api[_-]?key|token\s*[:=]|password\s*[:=]|mot de passe\s*[:=])/i;
  if (secretPattern.test(text)) {
    throw new Error(`${label}: secret-looking content refused`);
  }
}

function redactText(value) {
  return String(value || '')
    .replace(/bearer\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b(hf_|sk-|gh[pousr]_)[a-z0-9_-]{8,}\b/gi, '$1[redacted]')
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*([^\s"',;]+)/gi, '$1=[redacted]');
}

function sanitizeForAudit(value) {
  if (Array.isArray(value)) return value.map(sanitizeForAudit);
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactText(value) : value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|authorization|api[_-]?key/i.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = sanitizeForAudit(item);
    }
  }
  return out;
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function appendAudit(root, event) {
  appendJsonl(auditFile(root), sanitizeForAudit({
    at: new Date().toISOString(),
    ...event,
  }));
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readJsonl(file, limit = 50) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(500, Number(limit) || 50)))
      .map((line) => {
        try { return JSON.parse(line); } catch { return { parseError: true }; }
      });
  } catch {
    return [];
  }
}

function latestJsonlRecords(records, limit = 50) {
  const byId = new Map();
  let anonymous = 0;
  for (const record of records) {
    const id = record && typeof record === 'object' && (record.id || record.jobId)
      ? String(record.id || record.jobId)
      : `anonymous-${anonymous++}`;
    byId.set(id, record);
  }
  return Array.from(byId.values()).slice(-Math.max(1, Math.min(500, Number(limit) || 50)));
}

function tailFile(file, maxChars = DEFAULT_MAX_LOG_CHARS) {
  try {
    return redactText(fs.readFileSync(file, 'utf8').slice(-Math.max(500, maxChars)));
  } catch {
    return '';
  }
}

function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function getPackageScripts() {
  const pkg = readJsonSafe(path.join(SERVER_ROOT, 'package.json')) || {};
  return pkg.scripts || {};
}

function assertScriptExists(npmScript) {
  const scripts = getPackageScripts();
  if (!Object.prototype.hasOwnProperty.call(scripts, npmScript)) {
    throw new Error(`Whitelisted npm script is missing from package.json: ${npmScript}`);
  }
}

function resolveNpmLauncher() {
  if (process.platform === 'win32') {
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(npmCli)) {
      return { file: process.execPath, baseArgs: [npmCli] };
    }
  }
  return { file: process.platform === 'win32' ? 'npm.cmd' : 'npm', baseArgs: [] };
}

function buildNpmCommand(npmScript, extraArgs = []) {
  assertScriptExists(npmScript);
  const launcher = resolveNpmLauncher();
  const args = [...launcher.baseArgs, 'run', npmScript];
  if (extraArgs.length) args.push('--', ...extraArgs.map(String));
  return {
    file: launcher.file,
    args,
    public: `npm run ${npmScript}${extraArgs.length ? ` -- ${extraArgs.map(String).join(' ')}` : ''}`,
  };
}

function spawnNpmCommand({ npmScript, extraArgs = [], logFile }) {
  const command = buildNpmCommand(npmScript, extraArgs);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `\n[worker-supervisor] ${new Date().toISOString()} ${command.public}\n`);
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(command.file, command.args, {
    cwd: SERVER_ROOT,
    detached: true,
    env: {
      ...process.env,
      A11_SUPERVISOR_STARTED: '1',
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  fs.closeSync(fd);
  child.unref();
  return { child, command };
}

function makeLogFile(root, prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(3).toString('hex');
  return path.join(root, 'logs', `${prefix}-${stamp}-${suffix}.log`);
}

function publicWorker(worker) {
  return {
    id: worker.id,
    npmScript: worker.npmScript,
    description: worker.description,
    category: worker.category,
    longRunning: Boolean(worker.longRunning),
    readOnly: Boolean(worker.readOnly),
  };
}

function getAllowedWorkers() {
  return Object.values(ALLOWED_WORKERS).map(publicWorker);
}

function getWorkerLock(root, workerId) {
  return readJsonSafe(lockFile(root, workerId));
}

function clearWorkerLock(root, workerId) {
  try {
    fs.rmSync(lockFile(root, workerId), { force: true });
  } catch {
    // ignore
  }
}

function getWorkerStatus(payload = {}, options = {}) {
  const root = resolveSupervisorRoot(options);
  ensureSupervisorDirs(root);
  const maxLogChars = Math.min(12_000, Number(payload.maxLogChars) || DEFAULT_MAX_LOG_CHARS);
  const requestedWorkerId = payload.workerId ? normalizeWorkerId(payload.workerId) : null;
  const workerIds = requestedWorkerId ? [requestedWorkerId] : Object.keys(ALLOWED_WORKERS);
  const workers = workerIds.map((workerId) => {
    const worker = ALLOWED_WORKERS[workerId];
    const lock = getWorkerLock(root, workerId);
    const running = lock?.pid ? isPidAlive(lock.pid) : false;
    if (lock?.pid && !running) {
      appendAudit(root, { action: 'stale-lock-observed', workerId, pid: lock.pid });
    }
    return {
      ...publicWorker(worker),
      state: running ? 'running' : lock ? 'stale-lock' : 'idle',
      pid: running ? lock.pid : null,
      startedAt: lock?.startedAt || null,
      startedBy: lock?.agent || null,
      logFile: lock?.logFile || null,
      logTail: payload.includeLogs && lock?.logFile ? tailFile(lock.logFile, maxLogChars) : undefined,
    };
  });

  return {
    ok: true,
    runtimeRoot: resolveRuntimeRoot(options),
    supervisorRoot: root,
    workers,
    allowedAgents: KNOWN_AGENT_IDS,
    audit: {
      file: auditFile(root),
      recent: readJsonl(auditFile(root), Number(payload.auditLimit) || 10),
    },
  };
}

function startWorker(payload = {}, options = {}) {
  const root = resolveSupervisorRoot(options);
  ensureSupervisorDirs(root);
  const agent = sanitizeAgentId(payload.agent);
  const workerId = normalizeWorkerId(payload.workerId);
  const worker = ALLOWED_WORKERS[workerId];
  const lock = getWorkerLock(root, workerId);
  if (lock?.pid && isPidAlive(lock.pid)) {
    const result = {
      ok: false,
      code: 'worker_already_running',
      worker: publicWorker(worker),
      pid: lock.pid,
      startedAt: lock.startedAt,
      logFile: lock.logFile,
    };
    appendAudit(root, { action: 'start-refused', agent, workerId, reason: result.code, dryRun: Boolean(payload.dryRun) });
    return result;
  }
  if (lock?.pid) clearWorkerLock(root, workerId);

  const command = buildNpmCommand(worker.npmScript);
  const plan = {
    ok: true,
    action: 'start',
    dryRun: Boolean(payload.dryRun),
    agent,
    worker: publicWorker(worker),
    command: command.public,
    cwd: SERVER_ROOT,
  };

  if (payload.dryRun) {
    appendAudit(root, { action: 'start-dry-run', agent, workerId, command: command.public });
    return plan;
  }

  const logFile = makeLogFile(root, workerId);
  const spawned = spawnNpmCommand({ npmScript: worker.npmScript, logFile });
  const record = {
    workerId,
    npmScript: worker.npmScript,
    pid: spawned.child.pid,
    agent,
    startedAt: new Date().toISOString(),
    logFile,
    command: spawned.command.public,
    reason: payload.reason ? String(payload.reason).slice(0, 300) : null,
  };
  writeJsonAtomic(lockFile(root, workerId), record);
  if (!worker.longRunning) {
    spawned.child.on('exit', (code, signal) => {
      clearWorkerLock(root, workerId);
      appendAudit(root, { action: 'worker-exit', workerId, pid: record.pid, code, signal });
    });
  }
  spawned.child.on('error', (err) => {
    appendAudit(root, { action: 'worker-spawn-error', workerId, pid: record.pid, message: err.message });
  });
  appendAudit(root, { action: 'start', agent, workerId, pid: record.pid, logFile });

  return {
    ...plan,
    dryRun: false,
    pid: record.pid,
    logFile,
  };
}

function stopWorker(payload = {}, options = {}) {
  const root = resolveSupervisorRoot(options);
  ensureSupervisorDirs(root);
  const agent = sanitizeAgentId(payload.agent);
  const workerId = normalizeWorkerId(payload.workerId);
  const lock = getWorkerLock(root, workerId);
  const pid = Number(lock?.pid);
  const running = isPidAlive(pid);
  const plan = {
    ok: true,
    action: 'stop',
    dryRun: Boolean(payload.dryRun),
    agent,
    workerId,
    pid: running ? pid : null,
  };

  if (payload.dryRun) {
    appendAudit(root, { action: 'stop-dry-run', agent, workerId, pid: plan.pid });
    return plan;
  }

  if (!lock) {
    appendAudit(root, { action: 'stop-noop', agent, workerId, reason: 'no-lock' });
    return { ...plan, state: 'not-running' };
  }

  if (!running) {
    clearWorkerLock(root, workerId);
    appendAudit(root, { action: 'stop-stale-lock-cleared', agent, workerId, pid });
    return { ...plan, state: 'stale-lock-cleared' };
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
  }
  clearWorkerLock(root, workerId);
  appendAudit(root, { action: 'stop', agent, workerId, pid });
  return { ...plan, state: 'stop-requested' };
}

function restartWorker(payload = {}, options = {}) {
  const root = resolveSupervisorRoot(options);
  ensureSupervisorDirs(root);
  const agent = sanitizeAgentId(payload.agent);
  const workerId = normalizeWorkerId(payload.workerId);
  if (payload.dryRun) {
    const worker = ALLOWED_WORKERS[workerId];
    const command = buildNpmCommand(worker.npmScript);
    appendAudit(root, { action: 'restart-dry-run', agent, workerId, command: command.public });
    return {
      ok: true,
      action: 'restart',
      dryRun: true,
      agent,
      worker: publicWorker(worker),
      command: command.public,
      cwd: SERVER_ROOT,
    };
  }

  const stopped = stopWorker({ agent, workerId }, options);
  const started = startWorker({ agent, workerId, reason: payload.reason }, options);
  appendAudit(root, { action: 'restart', agent, workerId, stopped: stopped.state, startedPid: started.pid || null });
  return {
    ok: Boolean(started.ok),
    action: 'restart',
    stopped,
    started,
  };
}

function normalizeProject(project) {
  const value = String(project || 'Funesterie').trim().slice(0, 120);
  assertNoSecretText(value, 'project');
  return value || 'Funesterie';
}

function buildTaskMarkdown(payload = {}) {
  if (payload.markdown) {
    const text = String(payload.markdown).trim();
    assertNoSecretText(text, 'markdown');
    return text.slice(0, 20_000);
  }

  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  if (!tasks.length) throw new Error('tasks or markdown is required');
  if (tasks.length > 50) throw new Error('tasks is limited to 50 items');

  return tasks.map((task, index) => {
    const text = typeof task === 'string'
      ? task
      : String(task?.text || task?.title || task?.body || '').trim();
    if (!text) throw new Error(`tasks[${index}] is empty`);
    assertNoSecretText(text, `tasks[${index}]`);
    return `- [ ] ${index + 1} ${text.replace(/\s+/g, ' ').slice(0, 700)}`;
  }).join('\n');
}

function taskSummaryFromMarkdown(markdown) {
  const lines = String(markdown || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    count: lines.filter((line) => /^[-*]\s*\[[ x~-]?\]/i.test(line)).length || lines.length,
    preview: lines.slice(0, 5),
  };
}

function dispatchTasks(payload = {}, options = {}) {
  const root = resolveSupervisorRoot(options);
  ensureSupervisorDirs(root);
  const agent = sanitizeAgentId(payload.agent);
  const project = normalizeProject(payload.project);
  const markdown = buildTaskMarkdown(payload);
  const summary = taskSummaryFromMarkdown(markdown);
  const targetAgents = Array.isArray(payload.targetAgents)
    ? payload.targetAgents.map(sanitizeAgentId).slice(0, 20)
    : [];
  const jobId = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const taskFile = path.join(root, 'tasks', `${jobId}.md`);
  const extraArgs = ['--file', taskFile, '--project', project];
  const command = buildNpmCommand('dispatch', extraArgs);
  const planned = {
    ok: true,
    action: 'dispatch',
    dryRun: Boolean(payload.dryRun),
    agent,
    job: {
      id: jobId,
      project,
      status: payload.dryRun ? 'planned' : 'running',
      priority: String(payload.priority || 'normal').slice(0, 40),
      taskCount: summary.count,
      taskFile,
      targetAgents,
    },
    command: command.public,
    taskPreview: summary.preview,
  };

  if (payload.dryRun) {
    appendAudit(root, { action: 'dispatch-dry-run', agent, jobId, project, taskCount: summary.count });
    return planned;
  }

  fs.writeFileSync(taskFile, `${markdown.trim()}\n`);
  const logFile = makeLogFile(root, `task-dispatch-${jobId}`);
  const spawned = spawnNpmCommand({ npmScript: 'dispatch', extraArgs, logFile });
  const job = {
    id: jobId,
    type: 'task-dispatch',
    project,
    agent,
    status: 'running',
    priority: String(payload.priority || 'normal').slice(0, 40),
    taskCount: summary.count,
    taskFile,
    logFile,
    pid: spawned.child.pid,
    createdAt: new Date().toISOString(),
    command: spawned.command.public,
    targetAgents,
  };
  appendJsonl(jobsFile(root), job);
  spawned.child.on('exit', (code, signal) => {
    appendJsonl(jobsFile(root), {
      ...job,
      status: code === 0 ? 'done' : 'failed',
      completedAt: new Date().toISOString(),
      exitCode: code,
      signal,
    });
    appendAudit(root, { action: 'dispatch-exit', agent, jobId, pid: job.pid, code, signal });
  });
  spawned.child.on('error', (err) => {
    appendJsonl(jobsFile(root), {
      ...job,
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: err.message,
    });
    appendAudit(root, { action: 'dispatch-spawn-error', agent, jobId, pid: job.pid, message: err.message });
  });
  appendAudit(root, { action: 'dispatch', agent, jobId, project, pid: job.pid, taskCount: job.taskCount, logFile });
  return {
    ...planned,
    dryRun: false,
    job,
  };
}

function agentJobsStatus(payload = {}, options = {}) {
  const root = resolveSupervisorRoot(options);
  ensureSupervisorDirs(root);
  if (payload.agent) sanitizeAgentId(payload.agent);
  const limit = Number(payload.limit) || 50;
  const jobs = latestJsonlRecords(readJsonl(jobsFile(root), limit * 5), limit).map((job) => ({
    ...job,
    logTail: payload.includeLogs && job.logFile ? tailFile(job.logFile, Number(payload.maxLogChars) || DEFAULT_MAX_LOG_CHARS) : undefined,
    running: job.pid ? isPidAlive(job.pid) : false,
  }));
  const counts = jobs.reduce((acc, job) => {
    const status = job.running ? 'running' : (job.status || 'unknown');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    supervisorRoot: root,
    counts,
    jobs,
    workers: getWorkerStatus({ includeLogs: false, auditLimit: 5 }, options).workers,
    knownAgents: KNOWN_AGENT_IDS.map((id) => ({
      id,
      launchRole: ['claude', 'copilot', 'gemini', 'grok'].includes(id) ? 'external-agent-caller' : 'funesterie-agent',
    })),
  };
}

module.exports = {
  ALLOWED_WORKERS,
  KNOWN_AGENT_IDS,
  agentJobsStatus,
  dispatchTasks,
  getAllowedWorkers,
  getWorkerStatus,
  restartWorker,
  startWorker,
  stopWorker,
};
