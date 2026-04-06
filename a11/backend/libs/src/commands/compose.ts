import { readCompose } from '../compose/parser.js';
import { logger } from '../utils/logger.js';
import { runStart } from './start.js';
import { startProcess, listRunning, stopProcess } from '../supervisor/index.js';
import { runPurge } from './purge.js';
import * as fs from 'fs';
import { Tail } from 'tail';

export async function runCompose(argv: string[]) {
  const sub = argv[0];
  const compose = readCompose();
  if (!compose) {
    logger.error('No funesterie.yml or funesterie.fcl found');
    return;
  }
  if (sub === 'up') {
    // support --background flag
    const bg = argv.includes('--background') || argv.includes('-b');
    const modules = Object.keys(compose.modules);
    for (const m of modules) {
      const def = compose.modules[m];
      logger.info(`Bringing up ${m} from ${def.path || 'package'}`);
      if (bg) {
        // start in background using supervisor
        const logPath = `${process.cwd()}/.qflash/logs/${m}.log`;
        startProcess(m, def.path || m, [], { cwd: def.path || process.cwd(), detached: true, logPath });
      } else {
        await runStart({ services: [m], modulePaths: { [m]: def.path }, flags: {} } as any);
      }
    }
    return;
  }
  if (sub === 'down') {
    logger.info('Bringing down all modules');
    await runPurge();
    return;
  }
  if (sub === 'restart') {
    const name = argv[1];
    if (!name) {
      logger.info('Specify module to restart');
      return;
    }
    // naive: stop and start
    const running = listRunning();
    if (running.find((r: any) => r.name === name)) {
      // stop
      await stopProcess(name);
    }
    const def = compose.modules[name];
    if (!def) { logger.info('Unknown module'); return; }
    await runStart({ services: [name], modulePaths: { [name]: def.path }, flags: {} } as any);
    return;
  }
  if (sub === 'logs') {
    const name = argv[1];
    if (!name) { logger.info('Specify module name'); return; }
    const logFile = `${process.cwd()}/.qflash/logs/${name}.log`;
    if (!fs.existsSync(logFile)) { logger.info('No log file found'); return; }
    const t = new Tail(logFile, { fromBeginning: false });
    t.on('line', (data: any) => console.log(data));
    t.on('error', (err: any) => console.error(err));
    return;
  }
  logger.info('Usage: qflash compose [up|down|restart|logs]');
}
