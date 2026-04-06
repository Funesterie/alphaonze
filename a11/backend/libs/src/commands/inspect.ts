import { logger } from "../utils/logger";
import { detectModules } from "../utils/detect";
import { listRunning } from "../supervisor";
import { QFlushOptions } from "../chain/smartChain";

export async function runInspect(opts?: QFlushOptions) {
  logger.info("qflash: inspecting ecosystem...");
  const detected = opts?.detected || (await detectModules());
  for (const key of Object.keys(detected)) {
    const v = detected[key];
    logger.info(`${key}: ${v.running ? `running (pid=${v.pid || 'unknown'})` : 'stopped'}`);
    if (v.port) logger.info(`  port: ${v.port}`);
    if (v.installed) logger.info(`  installed: true`);
  }
  const running = listRunning();
  if (running.length) {
    logger.info("Supervisor running processes:");
    for (const r of running) logger.info(`  ${r.name}: pid=${r.pid} cmd=${r.cmd}`);
  }
}
