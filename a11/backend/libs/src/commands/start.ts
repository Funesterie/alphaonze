import { detectModules } from "../utils/detect.js";
import { logger } from "../utils/logger.js";
import { ensurePackageInstalled, pathExists, rebuildInstructionsFor } from "../utils/exec.js";
import { resolvePaths, SERVICE_MAP } from "../utils/paths.js";
import { QFlushOptions } from "../chain/smartChain.js";
import { resolvePackagePath, readPackageJson } from "../utils/package.js";
import { startProcess } from "../supervisor/index.js";
import { waitForService } from "../utils/health.js";
import * as path from "node:path";

interface SpyderConfig { adminPort?: string; [key: string]: any; }
let config: SpyderConfig = {};

function getRunCommand(pkgJson: any, pkgPath: string, pkg: string | undefined, mod: string): { cmd: string; args: string[]; cwd?: string } | null {
  if (pkgJson?.bin) {
    const binEntry = typeof pkgJson.bin === "string" ? pkgJson.bin : Object.values(pkgJson.bin)[0];
    const binPath = path.join(pkgPath, binEntry);
    if (binPath.endsWith(".js") && pathExists(binPath)) {
      return { cmd: process.execPath, args: [binPath], cwd: pkgPath };
    }
    if (pathExists(binPath)) {
      return { cmd: binPath, args: [], cwd: pkgPath };
    }
    logger.warn(`${mod} bin entry not found at ${binPath}. ${rebuildInstructionsFor(pkgPath)}`);
    return null;
  }
  if (pkg) {
    logger.warn(`${mod} has no local bin; will run via npx which may fail if package not globally installed.`);
    return { cmd: "npx", args: [pkg], cwd: process.cwd() };
  }
  return null;
}

async function launchModule(mod: string, opts: QFlushOptions | undefined, paths: Record<string, string>, flags: Record<string, unknown>, waitForStart: boolean) {
  const p = opts?.modulePaths?.[mod] ?? paths?.[mod];
  const pkg = SERVICE_MAP?.[mod]?.pkg;

  let pkgPath = p || (pkg ? resolvePackagePath(pkg) : "");
  if (!pkgPath && pkg) {
    if (!ensurePackageInstalled(pkg)) {
      logger.warn(`${mod} not found and failed to install ${pkg}, skipping`);
      return;
    }
    pkgPath = resolvePackagePath(pkg);
  }
  if (!pkgPath) {
    logger.warn(`${mod} path and package not found, skipping`);
    return;
  }

  const pkgJson = readPackageJson(pkgPath);
  const runCmd = getRunCommand(pkgJson, pkgPath, pkg, mod);
  if (!runCmd) {
    logger.warn(`${mod} has no runnable entry, skipping`);
    return;
  }

  logger.info(`Launching ${mod} -> ${runCmd.cmd} ${runCmd.args.join(" ")}`);
  startProcess(mod, runCmd.cmd, runCmd.args, { cwd: runCmd.cwd });

  if (waitForStart) {
    await handleHealthCheck(mod, flags);
  }
}

async function handleHealthCheck(mod: string, flags: Record<string, unknown>) {
  const svcUrl = flags["health-url"] ?? flags["health"];
  let svcPort: number | undefined = undefined;
  if (typeof flags["health-port"] === "string") {
    const parsed = Number.parseInt(flags["health-port"] as string, 10);
    svcPort = Number.isNaN(parsed) ? undefined : parsed;
  } else if (typeof flags["health-port"] === "number") {
    svcPort = flags["health-port"];
  }
  if (svcUrl) {
    const ok = await waitForService(svcUrl as string, svcPort);
    if (ok) logger.success(`${mod} passed health check`);
    else logger.warn(`${mod} failed health check`);
  } else {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    logger.info(`${mod} started (delayed wait).`);
  }
}

export async function runStart(opts?: QFlushOptions) {
  logger.info("qflash: starting modules...");
  const detected = opts?.detected ?? (await detectModules());
  // Filtrer les paths undefined pour respecter Record<string, string>
  const rawPaths = resolvePaths(detected);
  const paths: Record<string, string> = Object.fromEntries(
    Object.entries(rawPaths)
      .filter(([_, v]) => typeof v === "string")
      .map(([k, v]) => [k, v as string])
  );
  const services = opts?.services?.length ? opts.services : Object.keys(SERVICE_MAP);
  const flags = opts?.flags ?? {};
  const waitForStart = Boolean(flags["wait"] ?? flags["--wait"] ?? false);

  await Promise.all(
    services.map((mod) => launchModule(mod, opts, paths, flags, waitForStart))
  );

  logger.success("qflash: start sequence initiated for selected modules");
}
