import { logger } from '../utils/logger.js';
import { detectModules } from '../utils/detect.js';
import { httpProbe } from '../utils/health.js';
import { SERVICE_MAP } from '../utils/paths.js';
import { ensurePackageInstalled } from '../utils/exec.js';

export async function runDoctor(argv: string[] = []) {
  const fix = argv.includes('--fix') || argv.includes('-f');

  logger.info('qflash: running doctor checks...');
  const detected = await detectModules();
  for (const k of Object.keys(detected)) {
    const v = detected[k];
    logger.info(`${k}: installed=${v.installed} running=${v.running} path=${v.path || 'n/a'}`);
    if (v.bin && v.path) {
      logger.info(`  bin: ${v.bin}`);
    }
  }

  // check node version
  logger.info(`Node version: ${process.version}`);

  // simple http check example
  const httpOk = await httpProbe('http://localhost:80', 500);
  logger.info(`HTTP localhost:80 reachable: ${httpOk}`);

  if (fix) {
    logger.info('Doctor fix: attempting to install missing Funeste38 packages...');
    for (const name of Object.keys(SERVICE_MAP)) {
      const pkg = SERVICE_MAP[name].pkg;
      const detectedInfo = detected[name];
      if (!detectedInfo || !detectedInfo.installed) {
        logger.info(`Installing ${pkg} for service ${name}...`);
        const ok = ensurePackageInstalled(pkg);
        if (ok) logger.success(`Installed ${pkg}`);
        else logger.warn(`Failed to install ${pkg}`);
      } else {
        logger.info(`${pkg} already installed`);
      }
    }
  }

  logger.info('Doctor checks complete');
}
