import { spawn } from "child_process";
import { logger } from "./logger.js";
import { unlinkSync, existsSync, rmSync } from "fs";
import { execSync } from "child_process";

export function spawnSafe(command: string, args: string[] = [], opts: any = {}) {
  try {
    const proc = spawn(command, args, { stdio: "inherit", shell: true, ...opts });
    proc.on("error", (err) => logger.error(`Process error: ${err.message}`));
    return proc;
  } catch (err: any) {
    logger.error(`Failed to spawn ${command}: ${err.message}`);
    throw err;
  }
}

export function rimrafSync(path: string) {
  if (!path) return;
  if (!existsSync(path)) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (err) {
    // fallback
    try {
      unlinkSync(path);
    } catch {}
  }
}

export function isPackageInstalled(pkgName: string) {
  try {
    execSync(`npm ls ${pkgName} --depth=0`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function ensurePackageInstalled(pkgName: string) {
  if (isPackageInstalled(pkgName)) return true;
  logger.info(`Installing missing package ${pkgName}...`);
  try {
    execSync(`npm install -g ${pkgName}`, { stdio: "inherit" });
    return true;
  } catch (err: any) {
    logger.warn(`Failed to install ${pkgName}: ${err.message}`);
    return false;
  }
}

// Helpers for CLI pre-launch checks
export function pathExists(pathStr: string) {
  return !!pathStr && existsSync(pathStr);
}

export function rebuildInstructionsFor(pkgPath?: string) {
  if (!pkgPath) return `Rebuild the package (cd <pkg> && npm install && npm run build && npm install -g .)`;
  return `Rebuild the package:\n  cd ${pkgPath}\n  npm install\n  npm run build\n  npm install -g .`;
}
