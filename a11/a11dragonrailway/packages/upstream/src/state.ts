import { closeSync, openSync } from "node:fs";
import { exec, spawn } from "node:child_process";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DragonActionExecution, DragonIntegrationTarget } from "@funeste38/dragon-contracts";

export const A11_PORT = 3000;
export const CERBERE_PORT = 4545;
export const QFLUSH_PORT = 43421;
export const MAX_WAIT_START_MS = 20_000;
export const MAX_WAIT_STOP_MS = 12_000;
export const STARTING_GRACE_MS = 90_000;

export type ManagedServiceTarget = "a11" | "cerbere";
export type ManagedServiceStatus = "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface ManagedServiceState {
  target: ManagedServiceTarget;
  projectPath: string;
  command: string[];
  pid?: number;
  port?: number;
  healthUrl?: string;
  status: ManagedServiceStatus;
  startedAt?: string;
  updatedAt: string;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function findDragonRoot(startDir = process.cwd()): Promise<string> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const manifestPath = path.join(currentDir, "DRAGON_MANIFEST.json");
    if (await pathExists(manifestPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Unable to locate DRAGON_MANIFEST.json from the current workspace.");
    }

    currentDir = parentDir;
  }
}

export async function resolveDragonRoot(manifestPath?: string): Promise<string> {
  if (manifestPath) {
    return path.dirname(path.resolve(manifestPath));
  }

  return await findDragonRoot();
}

export async function ensureDragonRuntimeDir(manifestPath?: string): Promise<string> {
  const runtimeDir = path.join(await resolveDragonRoot(manifestPath), ".dragon", "runtime");
  await mkdir(runtimeDir, { recursive: true });
  return runtimeDir;
}

async function ensureDragonServicesDir(manifestPath?: string): Promise<string> {
  const servicesDir = path.join(await ensureDragonRuntimeDir(manifestPath), "services");
  await mkdir(servicesDir, { recursive: true });
  return servicesDir;
}

function getManagedServiceStatePath(servicesDir: string, target: ManagedServiceTarget): string {
  return path.join(servicesDir, `${target}.json`);
}

export async function loadJsonFile<T>(targetPath: string): Promise<T | undefined> {
  if (!(await pathExists(targetPath))) {
    return undefined;
  }

  try {
    const raw = await readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function writeJsonFile(targetPath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(data, null, 2), "utf8");
}

export async function deleteFileIfExists(targetPath: string): Promise<void> {
  try {
    await unlink(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function readManagedServiceState(
  target: ManagedServiceTarget,
  manifestPath?: string
): Promise<ManagedServiceState | undefined> {
  const servicesDir = await ensureDragonServicesDir(manifestPath);
  return await loadJsonFile<ManagedServiceState>(getManagedServiceStatePath(servicesDir, target));
}

export async function writeManagedServiceState(
  target: ManagedServiceTarget,
  state: ManagedServiceState,
  manifestPath?: string
): Promise<void> {
  const servicesDir = await ensureDragonServicesDir(manifestPath);
  await writeJsonFile(getManagedServiceStatePath(servicesDir, target), state);
}

export async function clearManagedServiceState(
  target: ManagedServiceTarget,
  manifestPath?: string
): Promise<void> {
  const servicesDir = await ensureDragonServicesDir(manifestPath);
  await deleteFileIfExists(getManagedServiceStatePath(servicesDir, target));
}

export function parsePortFromUrl(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    return parsed.port ? Number(parsed.port) : undefined;
  } catch {
    return undefined;
  }
}

export async function findListeningProcessId(port?: number): Promise<number | undefined> {
  if (!port || process.platform !== "win32") {
    return undefined;
  }

  return await new Promise<number | undefined>((resolve) => {
    exec("netstat -ano -p tcp", { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }

      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        const normalized = line.replace(/\s+/g, " ");
        if (!normalized.includes(`:${port} `) || !normalized.includes("LISTENING")) {
          continue;
        }

        const parts = normalized.split(" ");
        const processId = Number(parts[parts.length - 1]);
        if (Number.isFinite(processId) && processId > 0) {
          resolve(processId);
          return;
        }
      }

      resolve(undefined);
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runProjectCommand(
  projectPath: string,
  command: string,
  target: DragonIntegrationTarget,
  actionId: string,
  timeout = 20_000
): Promise<DragonActionExecution> {
  return await new Promise<DragonActionExecution>((resolve) => {
    exec(
      command,
      {
        cwd: projectPath,
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode =
            typeof (error as NodeJS.ErrnoException & { code?: string | number }).code === "number"
              ? Number((error as NodeJS.ErrnoException & { code?: string | number }).code)
              : undefined;

          resolve({
            actionId,
            target,
            ok: false,
            ranAt: new Date().toISOString(),
            detail: error.message,
            exitCode,
            stdout,
            stderr
          });
          return;
        }

        resolve({
          actionId,
          target,
          ok: true,
          ranAt: new Date().toISOString(),
          detail: "Command completed",
          exitCode: 0,
          stdout,
          stderr
        });
      }
    );
  });
}

export async function runNpmScript(
  projectPath: string,
  scriptName: string,
  target: DragonIntegrationTarget,
  actionId: string
): Promise<DragonActionExecution> {
  return await runProjectCommand(projectPath, `npm run ${scriptName}`, target, actionId);
}

export async function runTaskKill(processId: number): Promise<DragonActionExecution> {
  if (process.platform === "win32") {
    return await runProjectCommand(
      process.cwd(),
      `taskkill /PID ${processId} /T /F`,
      "dragon",
      `kill-${processId}`,
      15_000
    );
  }

  try {
    process.kill(processId);
    return {
      actionId: `kill-${processId}`,
      target: "dragon",
      ok: true,
      ranAt: new Date().toISOString(),
      detail: `Killed process ${processId}`,
      exitCode: 0
    };
  } catch (error) {
    return {
      actionId: `kill-${processId}`,
      target: "dragon",
      ok: false,
      ranAt: new Date().toISOString(),
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function spawnDetachedNodeProcess(
  projectPath: string,
  args: string[],
  stdoutPath: string,
  stderrPath: string,
  envOverrides: NodeJS.ProcessEnv
): Promise<number> {
  await mkdir(path.dirname(stdoutPath), { recursive: true });
  await mkdir(path.dirname(stderrPath), { recursive: true });

  const stdoutFd = openSync(stdoutPath, "a");
  const stderrFd = openSync(stderrPath, "a");

  try {
    const child = spawn(process.execPath, args, {
      cwd: projectPath,
      env: {
        ...process.env,
        ...envOverrides
      },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd]
    });

    child.unref();

    if (!child.pid || child.pid <= 0) {
      throw new Error("Detached child process did not expose a PID.");
    }

    return child.pid;
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
}
