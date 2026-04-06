const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distLegacy = path.join(projectRoot, 'dist', 'legacy');
const publicLegacy = path.join(projectRoot, 'public', 'legacy');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) copyRecursive(srcPath, destPath);
    else if (e.isFile()) fs.copyFileSync(srcPath, destPath);
  }
}

try {
  if (fs.existsSync(distLegacy)) {
    console.log('Copying dist/legacy -> public/legacy');
    copyRecursive(distLegacy, publicLegacy);
    console.log('Done.');
  } else {
    console.log('No dist/legacy folder to copy.');
  }
} catch (err) {
  console.error('Failed to copy legacy assets:', err.message);
  process.exitCode = 1;
}
