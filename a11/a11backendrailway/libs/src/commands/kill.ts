import { logger } from "../utils/logger.js";
import { findAndKill } from "../utils/detect.js";
import { stopAll } from "../supervisor.js";
import { QFlushOptions } from "../chain/smartChain.js";

export async function runKill(_opts?: QFlushOptions) {
  logger.info("qflash: killing modules...");
  const killed = await findAndKill();
  stopAll();
  logger.info(`Killed ${killed.length} processes`);
}
