// ROME-TAG: 0x1553F0

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { logger } from './logger.js';
import { SERVICE_MAP } from './paths.js';

export type ResolveResult = { gate: 'green' | 'yellow' | 'dlx' | 'fail'; cmd?: string; args?: string[]; cwd?: string };

function isWindows() {
  return process.platform === 'win32';
}

function findLocalBin(moduleName: string, cwd: string): string | null {
  // try node_modules/.bin/<name> or <pkg>/bin
  const localBin = path.join(cwd, 'node_modules', '.bin', moduleName + (isWindows() ? '.cmd' : ''));
  if (existsSync(localBin)) return localBin;
  // try package bin entry via require.resolve
  try {
    const pkgPath = require.resolve(moduleName, { paths: [cwd] });
    return pkgPath;
  } catch (error_) {
    logger.warn && logger.warn(`[NPZ] findLocalBin.resolve failed for ${moduleName}: ${String(error_)}`);
    return null;
  }
}

function resolveViaModuleGate(pkgName: string): { cmd: string; args: string[]; cwd?: string } | null {
  try {
    const pkgPath = require.resolve(pkgName);
    // run via node <pkgPath>
    return { cmd: process.execPath, args: [pkgPath], cwd: path.dirname(pkgPath) };
  } catch (error_) {
    logger.warn && logger.warn(`[NPZ] resolveViaModuleGate failed for ${pkgName}: ${String(error_)}`);
    return null;
  }
}

export function npzResolve(nameOrPkg: string, opts: { cwd?: string } = {}): ResolveResult {
  const cwd = opts.cwd || process.cwd();

  // Gate 0: if nameOrPkg matches a known SERVICE_MAP package, prefer local candidates in workspace
  try {
    for (const key of Object.keys(SERVICE_MAP)) {
      if (SERVICE_MAP[key].pkg === nameOrPkg) {
        const tries = SERVICE_MAP[key].candidates || [];
        for (const t of tries) {
          const candidatePath = path.join(cwd, t);
          try {
            if (!existsSync(candidatePath)) continue;
            // prefer dist entry if exists
            const distEntry = path.join(candidatePath, 'dist', 'index.js');
            if (existsSync(distEntry)) {
              logger.info && logger.info(`[NPZ:JOKER] ${nameOrPkg} -> local dist ${distEntry}`);
              return { gate: 'green', cmd: process.execPath, args: [distEntry], cwd: path.dirname(distEntry) };
            }
            // otherwise if package.json with start script exists, prefer npm --prefix <candidate> run start
            const pkgJsonPath = path.join(candidatePath, 'package.json');
            if (existsSync(pkgJsonPath)) {
              try {
                const pj = require(pkgJsonPath);
                if (pj && pj.scripts && pj.scripts.start) {
                  logger.info && logger.info(`[NPZ:JOKER] ${nameOrPkg} -> local start script at ${candidatePath}`);
                  return { gate: 'green', cmd: 'npm', args: ['--prefix', candidatePath, 'run', 'start'], cwd: candidatePath };
                }
              } catch (error_) {
                logger.warn && logger.warn(`[NPZ] failed to read package.json at ${pkgJsonPath}: ${String(error_)}`);
              }
            }
          } catch (error_) {
            logger.warn && logger.warn(`[NPZ] candidate check failed for ${candidatePath}: ${String(error_)}`);
          }
        }
        break;
      }
    }
  } catch (error_) {
    logger.warn && logger.warn(`[NPZ] SERVICE_MAP gate failed: ${String(error_)}`);
  }

  // Gate 1: GREEN - local bin
  const local = findLocalBin(nameOrPkg, cwd);
  if (local) {
    logger.info && logger.info(`[NPZ:JOKER] ${nameOrPkg} -> ${local}`);
    return { gate: 'green', cmd: local, args: [], cwd };
  }

  // Gate 2: YELLOW - module resolution
  const mod = resolveViaModuleGate(nameOrPkg);
  if (mod) {
    logger.info && logger.info(`[NPZ:JOKER] ${nameOrPkg} -> ${mod.cmd} ${mod.args.join(' ')}`);
    return { gate: 'yellow', cmd: mod.cmd, args: mod.args, cwd: mod.cwd };
  }

  // Gate 3: DLX - use npm exec as modern fallback, fallback to npx if needed
  try {
    // prefer `npm exec -- <pkg>` which is the modern replacement for npx (npm v7+)
    // This will allow running installed or remote packages consistently.
    logger.info && logger.info(`[NPZ:JOKER] ${nameOrPkg} -> npm exec`);
    return { gate: 'dlx', cmd: 'npm', args: ['exec', '--', nameOrPkg], cwd };
  } catch (error_) {
    // last-resort: npx
    try {
      logger.info && logger.info(`[NPZ:JOKER] ${nameOrPkg} -> npx`);
      return { gate: 'dlx', cmd: 'npx', args: [nameOrPkg], cwd };
    } catch (error2) {
      logger.warn && logger.warn(`[NPZ:JOKER][FAIL] ${nameOrPkg} cannot be resolved: ${String(error2)}`);
      return { gate: 'fail' };
    }
  }
}

export function runResolved(res: ResolveResult): { ok: boolean; status?: number } {
  if (!res.cmd) return { ok: false };
  const args = res.args || [];
  logger.info && logger.info(`running ${res.cmd} ${args.join(' ')}`);
  try {
    const r = spawnSync(res.cmd, args, { stdio: 'inherit', cwd: res.cwd || process.cwd(), shell: false });
    return { ok: r.status === 0, status: r.status ?? undefined };
  } catch (error_) {
    logger.error && logger.error(`[NPZ:JOKER] failed to run ${String(error_)}`);
    return { ok: false };
  }
}

export default { npzResolve, runResolved };
