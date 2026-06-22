#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PRIVATE_EXCLUSIONS = new Set([
  '@funeste/logic-reduce-nossen',
  '@funeste/zen'
]);
const SAFE_ADAPTER_FILES = ['README.md', 'index.js', 'package.json'];

function parseArguments(argv) {
  const command = argv[0];
  const configIndex = argv.indexOf('--config');
  if (!command || configIndex === -1 || !argv[configIndex + 1]) {
    throw new Error('Usage: stage-nossen-release.cjs <audit|stage-public|stage-private|validate> --config <path>');
  }
  return { command, configPath: path.resolve(argv[configIndex + 1]) };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readConfig(configPath) {
  const config = readJson(configPath);
  if (config.schema !== 'nossen.release-train.v1') throw new Error('Unsupported release-train schema');
  const stageRoot = path.resolve(REPO_ROOT, config.stageRoot);
  const allowedRoot = path.join(REPO_ROOT, '.codex-tmp') + path.sep;
  if (!stageRoot.startsWith(allowedRoot)) throw new Error('stageRoot must stay under .codex-tmp');
  return { config, stageRoot };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(options.errorMessage || `${command} failed`);
  }
  return result.stdout;
}

function runNpm(args, options = {}) {
  if (process.platform === 'win32') {
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(npmCli)) throw new Error('Unable to locate the npm CLI');
    return run(process.execPath, [npmCli, ...args], options);
  }
  return run('npm', args, options);
}

function safeSlug(packageName) {
  return packageName.replace(/^@/, '').replace(/[^0-9A-Za-z.-]+/g, '-');
}

function assertSafeArchivePath(entry) {
  const normalized = entry.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (!normalized.startsWith('package/') || normalized.startsWith('/') || parts.includes('..') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Unsafe tar entry in npm artifact: ${entry}`);
  }
}

function listFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink rejected: ${fullPath}`);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(path.relative(root, fullPath).replace(/\\/g, '/'));
      else throw new Error(`Unsupported artifact entry: ${fullPath}`);
    }
  }
  visit(root);
  return files.sort();
}

function packAndExtract(packageName, version) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-npm-artifact-'));
  try {
    const stdout = runNpm([
      'pack', `${packageName}@${version}`, '--json', '--pack-destination', temporary
    ], { cwd: temporary, errorMessage: `Unable to fetch npm artifact ${packageName}@${version}` });
    const parsed = JSON.parse(stdout);
    const info = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!info || !info.filename || !Array.isArray(info.files)) throw new Error(`Invalid npm pack response for ${packageName}`);
    const tarball = path.join(temporary, info.filename);
    const entries = run('tar.exe', ['-tf', tarball], { errorMessage: `Unable to list npm artifact ${packageName}` })
      .split(/\r?\n/).filter(Boolean);
    entries.forEach(assertSafeArchivePath);
    const verbose = run('tar.exe', ['-tvf', tarball], { errorMessage: `Unable to inspect npm artifact ${packageName}` });
    if (verbose.split(/\r?\n/).some((line) => /^[lh]/.test(line))) {
      throw new Error(`Links are forbidden in npm artifact ${packageName}`);
    }

    const listedFiles = entries
      .filter((entry) => !entry.endsWith('/'))
      .map((entry) => entry.replace(/^package\//, ''))
      .sort();
    const declaredFiles = info.files.map((entry) => String(entry.path).replace(/\\/g, '/')).sort();
    if (JSON.stringify(listedFiles) !== JSON.stringify(declaredFiles)) {
      throw new Error(`Tar contents differ from npm manifest for ${packageName}`);
    }

    const extractRoot = path.join(temporary, 'extract');
    fs.mkdirSync(extractRoot);
    run('tar.exe', ['-xzf', tarball, '-C', extractRoot], { errorMessage: `Unable to extract npm artifact ${packageName}` });
    const packageRoot = path.join(extractRoot, 'package');
    if (JSON.stringify(listFiles(packageRoot)) !== JSON.stringify(declaredFiles)) {
      throw new Error(`Extracted files differ from npm manifest for ${packageName}`);
    }
    const snapshot = path.join(temporary, 'snapshot');
    fs.cpSync(packageRoot, snapshot, { recursive: true, errorOnExist: true });
    return { root: snapshot, cleanup: () => fs.rmSync(temporary, { recursive: true, force: true }), info };
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hashTree(root, excluded = new Set()) {
  return Object.fromEntries(listFiles(root)
    .filter((relative) => !excluded.has(relative))
    .map((relative) => [relative, hashFile(path.join(root, relative))]));
}

function assertExactInternalDependencies(manifest) {
  for (const [name, version] of Object.entries(manifest.dependencies || {})) {
    if ((name.startsWith('@nossen/') || name.startsWith('@funeste/')) && !EXACT_VERSION.test(String(version))) {
      throw new Error(`Non-exact internal dependency: ${manifest.name} -> ${name}@${version}`);
    }
  }
}

function viewPackage(packageSpec) {
  const stdout = runNpm(['view', packageSpec, 'version', 'dependencies', '--json'], {
    errorMessage: `Unable to read registry metadata for ${packageSpec}`
  });
  const value = JSON.parse(stdout);
  return normalizeViewResponse(value);
}

function normalizeViewResponse(value) {
  if (typeof value === 'string') return { version: value, dependencies: {} };
  const version = Array.isArray(value.version) ? value.version.at(-1) : value.version;
  if (!version) throw new Error('Registry metadata has no version');
  return { version: String(version), dependencies: value.dependencies || {} };
}

function copyPackage(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const relative of listFiles(source)) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(source, relative), destination);
  }
}

function stagePublic(config, stageRoot) {
  const publicRoot = path.join(stageRoot, 'public');
  fs.rmSync(publicRoot, { recursive: true, force: true });
  fs.mkdirSync(publicRoot, { recursive: true });
  const records = [];

  for (const [packageName, rebase] of Object.entries(config.publicRebases)) {
    const artifact = packAndExtract(packageName, rebase.source);
    try {
      const before = hashTree(artifact.root, new Set(['package.json']));
      const manifestPath = path.join(artifact.root, 'package.json');
      const manifest = readJson(manifestPath);
      if (manifest.name !== packageName || manifest.version !== rebase.source) {
        throw new Error(`Unexpected source manifest for ${packageName}`);
      }
      manifest.version = rebase.target;
      manifest.dependencies = { ...(manifest.dependencies || {}) };
      for (const [dependency, version] of Object.entries(rebase.dependencies)) {
        if (!(dependency in manifest.dependencies)) throw new Error(`Missing configured dependency ${dependency} in ${packageName}`);
        manifest.dependencies[dependency] = version;
      }
      assertExactInternalDependencies(manifest);
      writeJson(manifestPath, manifest);
      const after = hashTree(artifact.root, new Set(['package.json']));
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Non-manifest files changed for ${packageName}`);

      const targetRoot = path.join(publicRoot, safeSlug(packageName));
      copyPackage(artifact.root, targetRoot);
      records.push({
        package: packageName,
        source: rebase.source,
        target: rebase.target,
        directory: path.relative(REPO_ROOT, targetRoot).replace(/\\/g, '/'),
        immutableFiles: before
      });
    } finally {
      artifact.cleanup();
    }
  }
  writeJson(path.join(publicRoot, 'stage-record.json'), records);
  return records;
}

const publicTargetCache = new Map();

function publicTarget(config, packageName) {
  if (config.publicTargets[packageName]) return config.publicTargets[packageName];
  if (!publicTargetCache.has(packageName)) publicTargetCache.set(packageName, viewPackage(packageName).version);
  return publicTargetCache.get(packageName);
}

function updateAdapterSource(source, targetVersion) {
  return source.replace(
    /(\b(?:version|publicVersion)\s*:\s*['"])[^'"]+(['"])/g,
    `$1${targetVersion}$2`
  );
}

function assertSafeAdapter(root, packageName) {
  const files = listFiles(root);
  if (JSON.stringify(files) !== JSON.stringify(SAFE_ADAPTER_FILES)) {
    throw new Error(`Unexpected files in private adapter ${packageName}`);
  }
  for (const relative of files) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    if (/npm_[0-9A-Za-z]|_authToken|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i.test(source)) {
      throw new Error(`Credential-like text rejected in ${packageName}/${relative}`);
    }
  }
}

function stagePrivate(config) {
  const privateMetaPath = path.join(REPO_ROOT, 'packages', 'npm-meta', 'funeste-all-in-one-nossen', 'package.json');
  const privateMeta = readJson(privateMetaPath);
  const adaptersRoot = path.join(REPO_ROOT, 'packages', 'funeste', 'adapters');
  fs.mkdirSync(adaptersRoot, { recursive: true });
  const targets = [];

  for (const [privatePackage, currentPrivateVersion] of Object.entries(privateMeta.dependencies || {}).sort()) {
    if (!privatePackage.startsWith('@funeste/') || PRIVATE_EXCLUSIONS.has(privatePackage)) continue;
    const artifact = packAndExtract(privatePackage, currentPrivateVersion);
    try {
      assertSafeAdapter(artifact.root, privatePackage);
      const manifestPath = path.join(artifact.root, 'package.json');
      const manifest = readJson(manifestPath);
      const publicDependencies = Object.entries(manifest.dependencies || {}).filter(([name]) => name.startsWith('@nossen/'));
      if (publicDependencies.length !== 1) throw new Error(`${privatePackage} must wrap exactly one public package`);
      const [publicPackage, currentPublicVersion] = publicDependencies[0];
      const targetPublicVersion = publicTarget(config, publicPackage);
      const stale = currentPrivateVersion !== targetPublicVersion || currentPublicVersion !== targetPublicVersion;

      manifest.version = targetPublicVersion;
      manifest.dependencies[publicPackage] = targetPublicVersion;
      if (!manifest.publishConfig || manifest.publishConfig.access !== 'restricted') {
        throw new Error(`${privatePackage} must remain restricted`);
      }
      writeJson(manifestPath, manifest);
      const indexPath = path.join(artifact.root, 'index.js');
      fs.writeFileSync(indexPath, updateAdapterSource(fs.readFileSync(indexPath, 'utf8'), targetPublicVersion), 'utf8');
      assertSafeAdapter(artifact.root, privatePackage);

      const folder = privatePackage.split('/')[1];
      const targetRoot = privatePackage === '@funeste/morphing-nossen'
        ? path.join(REPO_ROOT, 'packages', 'funeste', 'morphing-nossen')
        : path.join(adaptersRoot, folder);
      copyPackage(artifact.root, targetRoot);
      targets.push({
        privatePackage,
        publicPackage,
        sourcePrivateVersion: currentPrivateVersion,
        sourcePublicVersion: String(currentPublicVersion),
        targetPrivateVersion: targetPublicVersion,
        targetPublicVersion,
        publish: stale,
        directory: path.relative(REPO_ROOT, targetRoot).replace(/\\/g, '/')
      });
    } finally {
      artifact.cleanup();
    }
  }

  const train = {
    schema: 'funeste.adapter-train.v1',
    id: config.id,
    adapters: targets.sort((a, b) => a.privatePackage.localeCompare(b.privatePackage))
  };
  writeJson(path.join(adaptersRoot, 'adapter-train.json'), train);
  fs.writeFileSync(path.join(adaptersRoot, 'README.md'), [
    '# Generated Funesterie adapters',
    '',
    `Registry-derived adapter snapshot for release train ${config.id}.`,
    'Each directory contains the authenticated three-file private wrapper with an exact public dependency pin.',
    'Regenerate with `stage-nossen-release.cjs stage-private`; do not add credentials or environment files.',
    ''
  ].join('\n'), 'utf8');
  return train;
}

function validate(config, stageRoot) {
  const publicRoot = path.join(stageRoot, 'public');
  const recordPath = path.join(publicRoot, 'stage-record.json');
  if (!fs.existsSync(recordPath)) throw new Error('Public staging record is missing');
  const records = readJson(recordPath);
  for (const record of records) {
    const rebase = config.publicRebases[record.package];
    if (!rebase || rebase.target !== record.target) throw new Error(`Unexpected staging record for ${record.package}`);
    const root = path.resolve(REPO_ROOT, record.directory);
    const manifest = readJson(path.join(root, 'package.json'));
    if (manifest.name !== record.package || manifest.version !== record.target) throw new Error(`Staged manifest mismatch for ${record.package}`);
    for (const [dependency, version] of Object.entries(rebase.dependencies)) {
      if (manifest.dependencies?.[dependency] !== version) throw new Error(`Staged dependency mismatch: ${record.package} -> ${dependency}`);
    }
    assertExactInternalDependencies(manifest);
    const immutableFiles = hashTree(root, new Set(['package.json']));
    if (JSON.stringify(immutableFiles) !== JSON.stringify(record.immutableFiles)) {
      throw new Error(`Staged immutable files changed for ${record.package}`);
    }
  }
  return { valid: true, publicPackages: records.length };
}

function audit(config) {
  return {
    schema: config.schema,
    id: config.id,
    publicRebases: Object.entries(config.publicRebases).map(([name, value]) => ({ name, ...value })),
    metaTargets: config.metaTargets
  };
}

function main() {
  const { command, configPath } = parseArguments(process.argv.slice(2));
  const { config, stageRoot } = readConfig(configPath);
  let result;
  if (command === 'audit') result = audit(config);
  else if (command === 'stage-public') result = stagePublic(config, stageRoot);
  else if (command === 'stage-private') result = stagePrivate(config);
  else if (command === 'validate') result = validate(config, stageRoot);
  else throw new Error(`Unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`NOSSEN_STAGE_ERROR: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertExactInternalDependencies,
  normalizeViewResponse,
  readConfig,
  safeSlug,
  updateAdapterSource
};
