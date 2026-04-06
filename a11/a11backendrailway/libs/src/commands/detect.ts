import { detectModules } from "../utils/detect.js";
import { logger } from "../utils/logger.js";
import { QFlushOptions } from "../chain/smartChain.js";

export async function runDetect(_opts?: QFlushOptions) {
  logger.info("qflash: detecting modules...");
  const detected = await detectModules();
  for (const k of Object.keys(detected)) {
    const v = detected[k];
    logger.info(`${k}: ${v.running ? 'running' : 'stopped'}`);
  }
  // return a normalized object
  return { detected, paths: {} };
}
