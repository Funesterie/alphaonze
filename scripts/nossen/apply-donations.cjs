#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const DONATIONS = {
  wero: '+33783463761',
  weroDisplay: '+33 7 83 46 37 61',
  paypal: 'https://paypal.me/funeste38',
  stripe: 'https://funesterie.me/subscription',
  contact: 'https://funesterie.me/contact/',
};

const FUNDING = {
  type: 'custom',
  url: DONATIONS.paypal,
};

const README_BLOCK = `<!-- funesterie-donations:start -->
## Support Funesterie / NOSSEN

Support is voluntary, but it keeps the public modules, registry, compute, and maintenance work alive.

- Wero: \`${DONATIONS.weroDisplay}\`
- PayPal: ${DONATIONS.paypal}
- Stripe/card checkout: ${DONATIONS.stripe}
- Custom support/contact: ${DONATIONS.contact}
<!-- funesterie-donations:end -->`;

function shouldSkipDir(name) {
  return name === '.git' || name === 'node_modules' || name === '.codex-tmp' || name === 'dist' || name === 'build';
}

function walk(dir, filename, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) walk(path.join(dir, entry.name), filename, out);
      continue;
    }
    if (entry.isFile() && entry.name === filename) out.push(path.join(dir, entry.name));
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function syncPackageJson(file) {
  const json = readJson(file);
  let changed = false;

  if (JSON.stringify(json.funding) !== JSON.stringify(FUNDING)) {
    json.funding = FUNDING;
    changed = true;
  }
  if (JSON.stringify(json.donations) !== JSON.stringify(DONATIONS)) {
    json.donations = DONATIONS;
    changed = true;
  }

  if (changed) writeJson(file, json);
  return changed;
}

function syncReadme(readmePath, packageName) {
  let text = '';
  if (fs.existsSync(readmePath)) {
    text = fs.readFileSync(readmePath, 'utf8').trimEnd();
  } else {
    text = `# ${packageName || path.basename(path.dirname(readmePath))}`;
  }

  const blockPattern = /\n*<!-- funesterie-donations:start -->[\s\S]*?<!-- funesterie-donations:end -->/gm;
  const nossenSupportPattern = /\n*## Support NOSSEN[\s\S]*?(?=\n## |\n# |\s*$)/gm;
  const legacySupportPattern = /\n*NOSSEN packages stay public[\s\S]*?Support is voluntary, but it keeps the registry, compute, and maintenance work alive\.\s*/gm;

  let next = text
    .replace(blockPattern, '')
    .replace(nossenSupportPattern, '')
    .replace(legacySupportPattern, '')
    .trimEnd();

  const licenseMatch = next.match(/\n## License\b/);
  if (licenseMatch && licenseMatch.index !== undefined) {
    next = `${next.slice(0, licenseMatch.index).trimEnd()}\n\n${README_BLOCK}${next.slice(licenseMatch.index)}`;
  } else {
    next = `${next}\n\n${README_BLOCK}`;
  }

  next = `${next.trimEnd()}\n`;
  if (!fs.existsSync(readmePath) || fs.readFileSync(readmePath, 'utf8') !== next) {
    fs.writeFileSync(readmePath, next);
    return true;
  }
  return false;
}

function writeStaticFiles() {
  const docsDir = path.join(ROOT, 'docs');
  const githubDir = path.join(ROOT, '.github');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(githubDir, { recursive: true });

  const donationDoc = `# Donations Funesterie / NOSSEN

These links are the canonical public support channels for Funesterie, A11, and the NOSSEN packages.

- Wero: \`${DONATIONS.weroDisplay}\`
- PayPal: ${DONATIONS.paypal}
- Stripe/card checkout: ${DONATIONS.stripe}
- Custom support/contact: ${DONATIONS.contact}

Never commit private payment keys, OAuth secrets, registry tokens, bank documents, or raw customer data. Public packages may include the links above only.
`;
  fs.writeFileSync(path.join(docsDir, 'DONATIONS.md'), donationDoc);

  const funding = `# GitHub renders these links in the Sponsor button.
custom:
  - ${DONATIONS.paypal}
  - ${DONATIONS.stripe}
  - ${DONATIONS.contact}
`;
  fs.writeFileSync(path.join(githubDir, 'FUNDING.yml'), funding);
}

function main() {
  const packageFiles = walk(ROOT, 'package.json').filter((file) => !file.includes(`${path.sep}.codex-tmp${path.sep}`));
  let packagesChanged = 0;
  let readmesChanged = 0;

  for (const file of packageFiles) {
    const json = readJson(file);
    if (syncPackageJson(file)) packagesChanged += 1;
    const readmePath = path.join(path.dirname(file), 'README.md');
    if (syncReadme(readmePath, json.name)) readmesChanged += 1;
  }

  for (const readmePath of [path.join(ROOT, 'README.md'), path.join(ROOT, 'a11', 'README.md')]) {
    if (fs.existsSync(readmePath) && syncReadme(readmePath, path.basename(path.dirname(readmePath)))) {
      readmesChanged += 1;
    }
  }

  writeStaticFiles();

  console.log(JSON.stringify({
    packageFiles: packageFiles.length,
    packagesChanged,
    readmesChanged,
    staticFiles: ['docs/DONATIONS.md', '.github/FUNDING.yml'],
  }, null, 2));
}

main();
