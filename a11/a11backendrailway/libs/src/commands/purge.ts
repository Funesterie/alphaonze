import { logger } from "../utils/logger.js";
import { resolvePaths } from "../utils/paths.js";
import { rimrafSync } from "../utils/exec.js";
import { clearState } from "../supervisor/index.js";
import { QFlushOptions } from "../chain/smartChain.js";

export async function runPurge(opts?: QFlushOptions) {
  logger.info("qflash: purging caches, logs, sessions and supervisor state...");
  const paths = resolvePaths(opts?.detected || {});
  const targets = [] as string[];
  for (const key of Object.keys(paths)) {
    const p = paths[key];
    if (!p) continue;
    targets.push(`${p}/.cache`);
    targets.push(`${p}/logs`);
    targets.push(`${p}/tmp`);
    targets.push(`${p}/sessions`);
  }
  for (const t of targets) {
    try {
      rimrafSync(t);
      logger.success(`Removed ${t}`);
    } catch (err) {
      logger.warn(`Failed to remove ${t}: ${err}`);
    }
  }
  // clear supervisor state
  clearState();
  logger.info("Purge complete.");
}
