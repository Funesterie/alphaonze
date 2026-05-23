#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'nossen-package-liaisons.manifest.json');
const GOOGLE_MANIFEST_PATH = path.join(ROOT, 'scripts', 'google', 'google-artifact-packages.manifest.json');
const args = new Set(process.argv.slice(2));
const jsonMode = args.has('--json');
const strictSources = args.has('--strict-sources');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function addCount(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`;
}

function packageNames(entry) {
  return [entry.publicPackage, entry.privatePackage].filter(Boolean);
}

function relativeSourceExists(source) {
  if (!source || path.isAbsolute(source)) {
    return false;
  }
  return fs.existsSync(path.join(ROOT, source));
}

function main() {
  const manifest = readJson(MANIFEST_PATH);
  const googleManifest = readJson(GOOGLE_MANIFEST_PATH);
  const errors = [];
  const warnings = [];
  const lanes = {};
  const statuses = {};
  const seenPackages = new Map();
  const publicScope = manifest.publicScope || '@nossen';
  const privateScopes = new Set(asArray(manifest.privateScopes));
  const packages = asArray(manifest.packages);

  if (!packages.length) {
    errors.push('manifest.packages is empty');
  }

  for (const entry of packages) {
    const label = entry.id || '<missing-id>';
    addCount(lanes, entry.lane || '<missing-lane>');
    addCount(statuses, entry.status || '<missing-status>');

    if (!entry.id) errors.push('package entry is missing id');
    if (!entry.lane) errors.push(`${label}: missing lane`);
    if (!entry.status) errors.push(`${label}: missing status`);
    if (!entry.source) errors.push(`${label}: missing source`);
    if (!entry.nextAction) errors.push(`${label}: missing nextAction`);
    if (!entry.privacy) errors.push(`${label}: missing privacy`);

    if (entry.lane === 'public' && !entry.publicPackage) {
      errors.push(`${label}: public lane requires publicPackage`);
    }
    if (entry.lane === 'private' && !entry.privatePackage) {
      errors.push(`${label}: private lane requires privatePackage`);
    }
    if (entry.lane === 'dual' && (!entry.publicPackage || !entry.privatePackage)) {
      errors.push(`${label}: dual lane requires publicPackage and privatePackage`);
    }

    if (entry.publicPackage && !entry.publicPackage.startsWith(`${publicScope}/`)) {
      errors.push(`${label}: publicPackage must use ${publicScope}/*`);
    }

    if (entry.privatePackage) {
      const privateScope = entry.privatePackage.split('/')[0];
      if (!privateScopes.has(privateScope)) {
        errors.push(`${label}: privatePackage must use one of ${Array.from(privateScopes).join(', ')}`);
      }
    }

    for (const name of packageNames(entry)) {
      if (seenPackages.has(name)) {
        errors.push(`${label}: duplicate package name ${name} also used by ${seenPackages.get(name)}`);
      } else {
        seenPackages.set(name, label);
      }
    }

    if (entry.source && !entry.sourceExternal && !relativeSourceExists(entry.source)) {
      const message = `${label}: source not present in checkout: ${entry.source}`;
      if (strictSources) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  const googlePackages = asArray(googleManifest.packages).filter((entry) => entry.enabled !== false);
  const googleByName = new Map(googlePackages.map((entry) => [entry.publishedName, entry]));
  const publishedPublic = packages.filter((entry) => entry.status === 'published' && entry.publicPackage);

  for (const entry of publishedPublic) {
    const googleEntry = googleByName.get(entry.publicPackage);
    if (!googleEntry) {
      errors.push(`${entry.id}: published public package missing from Google manifest`);
      continue;
    }
    if (entry.version && googleEntry.publishedVersion !== entry.version) {
      errors.push(
        `${entry.id}: version mismatch package manifest=${entry.version} google=${googleEntry.publishedVersion}`
      );
    }
  }

  const manifestPublishedNames = new Set(publishedPublic.map((entry) => entry.publicPackage));
  for (const googleEntry of googlePackages) {
    if (!manifestPublishedNames.has(googleEntry.publishedName)) {
      errors.push(`${googleEntry.publishedName}: Google manifest package missing from liaison manifest`);
    }
  }

  const summary = {
    ok: errors.length === 0,
    manifest: path.relative(ROOT, MANIFEST_PATH),
    total: packages.length,
    lanes,
    statuses,
    publishedPublic: publishedPublic.length,
    notPublishedYet: packages.filter((entry) => entry.status !== 'published').length,
    warnings,
    errors
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    console.log('NOSSEN package liaison map');
    console.log(`manifest: ${summary.manifest}`);
    console.log(`total: ${summary.total}`);
    console.log(`published public: ${summary.publishedPublic}`);
    console.log(`not published yet: ${summary.notPublishedYet}`);
    console.log('');
    console.log('lanes');
    for (const [lane, count] of Object.entries(lanes).sort()) {
      console.log(`- ${pad(lane, 8)} ${count}`);
    }
    console.log('');
    console.log('statuses');
    for (const [status, count] of Object.entries(statuses).sort()) {
      console.log(`- ${pad(status, 10)} ${count}`);
    }
    if (warnings.length) {
      console.log('');
      console.log('warnings');
      for (const warning of warnings) {
        console.log(`- ${warning}`);
      }
    }
    if (errors.length) {
      console.log('');
      console.log('errors');
      for (const error of errors) {
        console.log(`- ${error}`);
      }
    }
  }

  if (errors.length) {
    process.exitCode = 1;
  }
}

main();
