// ROME-TAG: 0xA0F9B4

import * as alias from '../utils/alias.js';
import { useHorn } from '../core/horn';
import { whiteLight } from '../core/gandalf-light';
import { resolveGollumPath } from '../rome/gollum-paths';
const fetch = alias.importUtil('../utils/fetch') || alias.importUtil('@utils/fetch') || (globalThis as any).fetch;
const logger = alias.importUtil('@utils/logger') || alias.importUtil('../utils/logger') || console;
import runTestHorn from './test-horn';

const DAEMON = process.env.QFLUSH_DAEMON || 'http://localhost:4500';

async function postJson(url: string, body: any): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } as any);
  const json: any = await res.json();
  return json;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  const json: any = await res.json();
  return json;
}

export default async function runChecksum(argv: string[] = []) {
  whiteLight('daemon.start', { phase: 'checksum-init', argv });
  const sub = argv[0];
  if (!sub) {
    logger.info('Usage: qflush checksum <store|verify|list|clear>');
    return 1;
  }

  if (sub === 'test-horn') {
    return await runTestHorn(argv.slice(1));
  }

  if (sub === 'store') {
    const id = argv[1];
    const checksum = argv[2];
    const ttlArg = argv.find((a) => a.startsWith('--ttl='));
    const ttlMs = ttlArg ? Number(ttlArg.split('=')[1]) : undefined;
    if (!id || !checksum) {
      logger.error('Usage: qflush checksum store <id> <checksum> [--ttl=ms]');
      return 1;
    }
    const body: any = { id, checksum };
    if (ttlMs) body.ttlMs = ttlMs;
    const res = await postJson(`${DAEMON.replace(/\/$/, '')}/npz/checksum/store`, body);
    logger.info(`store => ${JSON.stringify(res)}`);
    return 0;
  }

  if (sub === 'verify') {
    const id = argv[1];
    const checksum = argv[2];
    if (!id || !checksum) {
      logger.error('Usage: qflush checksum verify <id> <checksum>');
      return 1;
    }
    const res: any = await postJson(`${DAEMON.replace(/\/$/, '')}/npz/checksum/verify`, { id, checksum });
    if (res && (res as any).success) {
      logger.success('verify: OK');
      return 0;
    }
    logger.error(`verify failed: ${JSON.stringify(res)}`);
    return 2;
  }

  if (sub === 'list') {
    const res = await getJson(`${DAEMON.replace(/\/$/, '')}/npz/checksum/list`);
    logger.info(JSON.stringify(res, null, 2));
    return 0;
  }

  if (sub === 'clear') {
    const res = await fetch(`${DAEMON.replace(/\/$/, '')}/npz/checksum/clear`, { method: 'DELETE' } as any);
    const j: any = await res.json();
    logger.info(JSON.stringify(j));
    return 0;
  }

  logger.error('Unknown checksum command');
  return 1;
  // Ajoute ici la logique de résolution de chemin ou d'orchestration si pertinent
  whiteLight('daemon.start', { phase: 'checksum-done' });
}
