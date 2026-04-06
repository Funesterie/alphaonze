import { logger } from '../utils/logger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export async function repairWorkflows() {
  logger.info('PICCOLO: scan et réparation des workflows CI...');
  const wfDir = path.join(process.cwd(), '.github', 'workflows');
  if (!fs.existsSync(wfDir)) return;
  const files = fs.readdirSync(wfDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  for (const file of files) {
    const fullPath = path.join(wfDir, file);
    let content = fs.readFileSync(fullPath, 'utf8');
    let changed = false;
    // Runner DJEFF
    if (!content.includes('runs-on: [self-hosted, Windows, X64, funesterie, DJEFF]')) {
      content = content.replace(/runs-on: .*/g, 'runs-on: [self-hosted, Windows, X64, funesterie, DJEFF]');
      changed = true;
    }
    // Étapes install/build/test
    if (!content.includes('npm install')) {
      content = content.replace(/steps:/, 'steps:\n      - name: Install deps\n        run: npm install');
      changed = true;
    }
    if (!content.includes('npm run build')) {
      content = content.replace(/steps:/, 'steps:\n      - name: Build\n        run: npm run build');
      changed = true;
    }
    if (!content.includes('npm test')) {
      content = content.replace(/steps:/, 'steps:\n      - name: Test\n        run: npm test');
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(fullPath, content, 'utf8');
      logger.info(`PICCOLO: workflow corrigé: ${file}`);
    }
  }
}
