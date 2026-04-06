import { promises as fs } from "fs";
import { logger } from "../utils/logger.js";
import { resolvePaths } from "../utils/paths.js";
import { QFlushOptions } from "../chain/smartChain.js";

export async function runConfig(opts?: QFlushOptions) {
  logger.info("qflash: generating default configs...");
  const detected = opts?.detected || {};
  const paths = resolvePaths(detected);
  for (const key of Object.keys(paths)) {
    const p = paths[key];
    if (!p) continue;
    const envFile = `${p}/.env`;
    try {
      await fs.access(envFile);
      logger.info(`${key}: .env already exists`);
    } catch {
      const content = `# ${key} default env\nPORT=3000\nTOKEN=changeme\n`;
      await fs.mkdir(p, { recursive: true });
      await fs.writeFile(envFile, content, { encoding: "utf8" });
      logger.success(`Created ${envFile}`);
    }
  }
}
