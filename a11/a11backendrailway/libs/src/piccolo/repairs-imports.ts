import { logger } from '../utils/logger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function getAllSourceFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllSourceFiles(fullPath));
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function fixImportExtensions(file: string) {
  let changed = false;
  let content = fs.readFileSync(file, 'utf8');
  // Corrige les imports sans extension .js pour ESM
  content = content.replace(/(import\s+[^'";]+['"])(\.\/.+?)(['"])/g, (match, p1, p2, p3) => {
    if (!p2.endsWith('.js') && fs.existsSync(path.resolve(path.dirname(file), p2 + '.js'))) {
      changed = true;
      return p1 + p2 + '.js' + p3;
    }
    return match;
  });
  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    logger.info(`PICCOLO: import corrigé dans ${file}`);
  }
}

function ensureDepsInstalled() {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const needed = ['vitest', 'canvas'];
  let toInstall: string[] = [];
  for (const dep of needed) {
    if (!pkg.dependencies?.[dep] && !pkg.devDependencies?.[dep]) {
      toInstall.push(dep);
    }
  }
  if (toInstall.length) {
    logger.info(`PICCOLO: installation des dépendances manquantes: ${toInstall.join(', ')}`);
    require('child_process').execSync(`npm install --save-dev ${toInstall.join(' ')}`, { stdio: 'inherit' });
  }
}

export async function repairImportsAndDeps() {
  logger.info('PICCOLO: scan et réparation des imports/dépendances...');
  const files = getAllSourceFiles(path.join(process.cwd(), 'src'));
  for (const file of files) {
    fixImportExtensions(file);
  }
  ensureDepsInstalled();
}
