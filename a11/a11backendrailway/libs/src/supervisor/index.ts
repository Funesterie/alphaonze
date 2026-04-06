import { spawn } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, createWriteStream } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

type ProcRecord = {
  name: string;
  pid: number;
  cmd: string;
  args: string[];
  cwd?: string;
  log?: string;
  detached?: boolean;
};

const STATE_DIR = join(process.cwd(), '.qflash');
const LOGS_DIR = join(STATE_DIR, 'logs');
const STATE_FILE = join(STATE_DIR, 'services.json');
let procs: Record<string, ProcRecord> = {};

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
}

function persist() {
  try {
    ensureStateDir();
    writeFileSync(STATE_FILE, JSON.stringify(procs, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`Failed to persist supervisor state: ${err}`);
  }
}

function load() {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = readFileSync(STATE_FILE, 'utf8');
      procs = JSON.parse(raw);
    }
  } catch (err) {
    logger.warn(`Failed to load supervisor state: ${err}`);
  }
}

load();

export function listRunning() {
  return Object.values(procs);
}

export function startProcess(name: string, cmd: string, args: string[] = [], opts: any = {}) {
  ensureStateDir();
  logger.info(`supervisor: starting ${name} -> ${cmd} ${args.join(' ')}`);

  const logFile = opts.logPath || join(LOGS_DIR, `${name}.log`);
  const outStream = createWriteStream(logFile, { flags: 'a' });

  const spawnOpts: any = { cwd: opts.cwd || process.cwd(), shell: true };

  // decide stdio based on detached/background
  if (opts.detached) {
    spawnOpts.detached = true;
    // ignore stdin, pipe stdout/stderr to log
    spawnOpts.stdio = ['ignore', 'pipe', 'pipe'];
  } else {
    spawnOpts.stdio = ['ignore', 'pipe', 'pipe'];
  }

  const child = spawn(cmd, args, spawnOpts);

  if (child.stdout) child.stdout.pipe(outStream);
  if (child.stderr) child.stderr.pipe(outStream);

  child.on('error', (err) => logger.error(`supervisor: ${name} process error ${err.message}`));
  child.on('exit', (code) => {
    logger.warn(`supervisor: ${name} exited with ${code}`);
    if (procs[name]) delete procs[name];
    persist();
  });

  // if detached, allow process to continue after this parent exits
  if (spawnOpts.detached) {
    try { child.unref(); } catch {}
  }

  procs[name] = { name, pid: child.pid || -1, cmd, args, cwd: opts.cwd, log: logFile, detached: !!spawnOpts.detached };
  persist();
  return child;
}

export function stopProcess(name: string) {
  const entry = procs[name];
  if (!entry) return false;
  try {
    process.kill(entry.pid, 'SIGTERM');
    try { delete procs[name]; persist(); } catch {}
    return true;
  } catch (err) {
    logger.warn(`supervisor: failed to kill ${name} pid=${entry.pid} (${err})`);
    return false;
  }
}

export function stopAll() {
  const names = Object.keys(procs);
  for (const n of names) {
    stopProcess(n);
  }
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch {}
}

export function clearState() {
  procs = {};
  try { if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE); } catch {}
}
