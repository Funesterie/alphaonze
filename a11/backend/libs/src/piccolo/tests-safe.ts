import { logger } from '../utils/logger.js';
import { execSync } from 'node:child_process';

export async function runTestsSafe() {
  logger.info('PICCOLO: lancement des tests en mode safe...');
  try {
    execSync('npx vitest run', { stdio: 'inherit' });
    return true;
  } catch (e) {
    logger.warn('PICCOLO: tests échoués ou erreur: ' + String(e));
    return false;
  }
}
