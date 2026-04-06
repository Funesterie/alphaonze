import { logger } from '../utils/logger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export async function repairTsConfig() {
  logger.info('PICCOLO: vérification et réparation du tsconfig...');
  const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) return;
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  let changed = false;
  if (tsconfig.compilerOptions?.moduleResolution !== 'nodenext') {
    tsconfig.compilerOptions.moduleResolution = 'nodenext';
    changed = true;
  }
  if (!tsconfig.compilerOptions?.types?.includes('node')) {
    tsconfig.compilerOptions.types = tsconfig.compilerOptions.types || [];
    tsconfig.compilerOptions.types.push('node');
    changed = true;
  }
  if (!tsconfig.compilerOptions?.types?.includes('vitest')) {
    tsconfig.compilerOptions.types = tsconfig.compilerOptions.types || [];
    tsconfig.compilerOptions.types.push('vitest');
    changed = true;
  }
  // Vérifie les alias paths
  const expectedPaths = {
    '@utils/*': ['src/utils/*'],
    '@daemon/*': ['src/daemon/*'],
    '@commands/*': ['src/commands/*'],
    '@rome/*': ['src/rome/*'],
    '@supervisor/*': ['src/supervisor/*'],
    '@cortex/*': ['src/cortex/*']
  } as Record<string, string[]>;
  tsconfig.compilerOptions.paths = tsconfig.compilerOptions.paths || {};
  for (const k of Object.keys(expectedPaths)) {
    if (JSON.stringify(tsconfig.compilerOptions.paths[k]) !== JSON.stringify(expectedPaths[k])) {
      tsconfig.compilerOptions.paths[k] = expectedPaths[k];
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf8');
    logger.info('PICCOLO: tsconfig.json corrigé');
  }
}
