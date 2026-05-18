#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const REPO_ROOT = path.resolve(A11_ROOT, '..');
const SERVER_RUNTIME_ROOT = path.resolve(SERVER_ROOT, 'runtime');

const MINIMUM_MODULES = ['rome', 'corpus', 'linguistic-core'];

const FUNESTERIE_MODULES = [
  {
    id: 'allmight',
    packageName: '@nossen/allmight',
    capabilities: ['code-audit', 'duplicate-detection', 'safe-refactor-planning'],
  },
  {
    id: 'bat',
    packageName: '@nossen/bat',
    capabilities: ['request-control', 'retry-policy', 'backend-routing'],
  },
  {
    id: 'beam',
    packageName: '@nossen/beam',
    capabilities: ['signal-bridge', 'runtime-linking', 'agent-transport'],
  },
  {
    id: 'envaptex',
    packageName: '@nossen/envaptex',
    capabilities: ['env-config', 'typed-env', 'runtime-configuration'],
  },
  {
    id: 'freeland',
    packageName: '@nossen/freeland',
    capabilities: ['value-resolution', 'normalization', 'runtime-compatibility'],
  },
  {
    id: 'freeland-bros',
    packageName: '@nossen/freeland-bros',
    capabilities: ['diagnostics', 'visualization', 'freeland-explanations'],
  },
  {
    id: 'morphing',
    packageName: '@nossen/morphing',
    capabilities: ['media-transform', 'image-variation', 'controlled-morphing'],
  },
  {
    id: 'nezlephant',
    packageName: '@nossen/nezlephant',
    capabilities: ['capsule-encoding', 'oc8', 'payload-protection'],
  },
  {
    id: 'qflush',
    packageName: '@nossen/qflush',
    capabilities: ['flow-runner', 'bridge-hooks', 'gamepad-keyboard-mouse'],
  },
  {
    id: 'scream',
    packageName: '@nossen/scream',
    capabilities: ['audio-signal', 'voice-hooks', 'sound-runtime'],
  },
  {
    id: 'spyder',
    packageName: '@nossen/spyder',
    capabilities: ['protocol', 'packet-transport', 'agent-bus'],
  },
  {
    id: 'dragon',
    packageName: 'dragon',
    capabilities: ['legacy-runtime', 'compat-contracts', 'service-surface'],
  },
  {
    id: 'katana',
    packageName: 'funesterie-katana',
    capabilities: ['ops-tooling', 'sharp-actions', 'runtime-utility'],
  },
  {
    id: 'mask',
    capabilities: ['image-mask', 'prompt-structure', 'semantic-guard'],
  },
  {
    id: 'marvin',
    capabilities: ['agent-module', 'assistant-runtime', 'experimental'],
  },
  {
    id: 'premier',
    capabilities: ['agent-module', 'first-pass-routing', 'experimental'],
  },
  {
    id: 'a11-autostart-logs',
    capabilities: ['startup-logs', 'diagnostics', 'local-presence'],
  },
];

function toPosix(value = '') {
  return String(value || '').replace(/\\/g, '/');
}

function uniquePaths(paths = []) {
  const out = [];
  const seen = new Set();
  for (const candidate of paths) {
    const resolved = path.resolve(String(candidate || '').trim());
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!resolved || seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function pathExists(candidate) {
  try {
    fs.accessSync(candidate);
    return true;
  } catch {
    return false;
  }
}

function statSummary(candidate) {
  try {
    const stat = fs.statSync(candidate);
    return {
      exists: true,
      kind: stat.isDirectory() ? 'directory' : 'file',
      modifiedAt: stat.mtime.toISOString(),
      sizeBytes: stat.isDirectory() ? null : stat.size,
    };
  } catch {
    return {
      exists: false,
      kind: 'missing',
      modifiedAt: null,
      sizeBytes: null,
    };
  }
}

function readJsonOptional(candidate) {
  try {
    return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch {
    return null;
  }
}

function packagePathFromName(packageName = '') {
  const parts = String(packageName || '').split('/').filter(Boolean);
  return parts.length ? path.join(...parts) : '';
}

function pickWorkspaceRoot() {
  const configured = String(process.env.A11_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT || '').trim();
  const candidates = uniquePaths([
    configured,
    configured ? path.resolve(configured, '..') : '',
    REPO_ROOT,
    A11_ROOT,
    process.cwd(),
  ]);

  return candidates.find((candidate) => (
    pathExists(path.join(candidate, 'a11', 'backend', 'apps', 'server', 'package.json'))
  )) || REPO_ROOT;
}

function pickRuntimeRoot(workspaceRoot) {
  const configured = String(process.env.A11_RUNTIME_ROOT || '').trim();
  if (configured) return path.resolve(configured);
  if (SERVER_ROOT === '/app' && pathExists(SERVER_RUNTIME_ROOT)) return SERVER_RUNTIME_ROOT;
  return path.resolve(
    path.join(A11_ROOT, 'runtime')
    || path.join(workspaceRoot, 'runtime')
  );
}

function candidateRuntimeRoots({ workspaceRoot, runtimeRoot }) {
  return uniquePaths([
    runtimeRoot,
    path.join(workspaceRoot, 'runtime'),
    path.join(REPO_ROOT, 'runtime'),
    path.join(A11_ROOT, 'runtime'),
    path.join(SERVER_ROOT, 'runtime'),
  ]);
}

function candidateModuleSourceRoots({ workspaceRoot, runtimeRoot }) {
  const userProfile = String(process.env.USERPROFILE || process.env.HOME || '').trim();
  return uniquePaths([
    String(process.env.A11_MODULES_SOURCE_ROOT || '').trim(),
    path.join(runtimeRoot, 'modules'),
    path.join(workspaceRoot, 'runtime', 'modules'),
    path.join(REPO_ROOT, 'runtime', 'modules'),
    path.join(A11_ROOT, 'runtime', 'modules'),
    userProfile ? path.join(userProfile, 'OneDrive - Funesterie', 'Bureau', 'modules') : '',
    userProfile ? path.join(userProfile, 'OneDrive - Funesterie', 'Funesterie-Backups', 'dev-rescue', '_latest', 'funesterie-modules') : '',
    userProfile ? path.join(userProfile, 'OneDrive - Funesterie', 'Funesterie-Backups', 'dev-rescue', '_latest', 'funesterie-project', 'runtime', 'modules') : '',
  ]);
}

function findFirstExisting(candidates = []) {
  return candidates.find((candidate) => pathExists(candidate)) || '';
}

function resolveFunesterieModuleDescriptor(moduleSpec = {}, context = {}) {
  const id = String(moduleSpec.id || '').trim();
  const packageName = String(moduleSpec.packageName || '').trim();
  const sourceRoot = findFirstExisting(
    (context.moduleSourceRoots || []).map((root) => path.join(root, moduleSpec.sourceDir || id))
  );
  const packageRoot = packageName
    ? path.join(SERVER_ROOT, 'node_modules', packagePathFromName(packageName))
    : '';
  const packageJsonPath = packageRoot ? path.join(packageRoot, 'package.json') : '';
  const packageJson = readJsonOptional(packageJsonPath);
  const sourcePackageJson = readJsonOptional(path.join(sourceRoot, 'package.json'));

  return {
    id,
    name: String(packageJson?.name || sourcePackageJson?.name || packageName || id).trim(),
    kind: 'runtime-module',
    installed: Boolean(packageJson || sourceRoot),
    minimumRequired: MINIMUM_MODULES.includes(id),
    source: packageJson
      ? `npm:${packageJson.name}`
      : (sourceRoot ? 'module-source-mirror' : 'missing'),
    version: String(packageJson?.version || sourcePackageJson?.version || '').trim() || null,
    entrypoints: {
      packageRoot: packageJson ? packageRoot : null,
      sourceRoot: sourceRoot || null,
      packageJson: packageJson ? packageJsonPath : (sourcePackageJson ? path.join(sourceRoot, 'package.json') : null),
      main: packageJson?.main ? path.join(packageRoot, packageJson.main) : null,
      bin: packageJson?.bin || null,
    },
    capabilities: Array.isArray(moduleSpec.capabilities) ? moduleSpec.capabilities : [],
    status: {
      npmPackage: statSummary(packageJsonPath),
      sourceRoot: statSummary(sourceRoot),
    },
  };
}

function resolveRomeDescriptor(runtimeRoots) {
  const packageRoot = path.join(SERVER_ROOT, 'node_modules', '@nossen', 'rome');
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJson = readJsonOptional(packageJsonPath);
  const sourceMirror = findFirstExisting(runtimeRoots.map((root) => path.join(root, 'modules', 'rome')));

  return {
    id: 'rome',
    name: 'Rome',
    kind: 'runtime-module',
    installed: Boolean(packageJson || sourceMirror),
    minimumRequired: true,
    source: packageJson ? 'npm:@nossen/rome' : (sourceMirror ? 'runtime-module-mirror' : 'missing'),
    version: String(packageJson?.version || '').trim() || null,
    entrypoints: {
      cli: pathExists(path.join(packageRoot, 'dist', 'cli.js')) ? path.join(packageRoot, 'dist', 'cli.js') : null,
      index: pathExists(path.join(packageRoot, 'dist', 'index.js')) ? path.join(packageRoot, 'dist', 'index.js') : null,
      mirror: sourceMirror || null,
    },
    capabilities: ['workspace-paths', 'route-links', 'runtime-navigation', 'agent-context'],
    status: {
      npmPackage: statSummary(packageJsonPath),
      sourceMirror: statSummary(sourceMirror),
    },
  };
}

function resolveCorpusDescriptor(runtimeRoots) {
  const corpusRoot = findFirstExisting(runtimeRoots.map((root) => path.join(root, 'Corpus')));
  const corpusModuleMirror = findFirstExisting(runtimeRoots.map((root) => path.join(root, 'modules', 'Corpus')));
  const knowledgeGraphRoot = findFirstExisting(runtimeRoots.map((root) => path.join(root, 'knowledge-graph')));

  return {
    id: 'corpus',
    name: 'Corpus',
    kind: 'runtime-module',
    installed: Boolean(corpusRoot || corpusModuleMirror || knowledgeGraphRoot),
    minimumRequired: true,
    source: corpusRoot ? 'runtime-corpus' : (corpusModuleMirror ? 'runtime-module-mirror' : 'knowledge-graph'),
    entrypoints: {
      corpusRoot: corpusRoot || null,
      mirror: corpusModuleMirror || null,
      knowledgeGraph: knowledgeGraphRoot || null,
    },
    capabilities: ['source-cards', 'safe-memory', 'knowledge-index', 'agent-context'],
    status: {
      corpusRoot: statSummary(corpusRoot),
      sourceMirror: statSummary(corpusModuleMirror),
      knowledgeGraph: statSummary(knowledgeGraphRoot),
    },
  };
}

function resolveLinguisticCoreDescriptor(runtimeRoots) {
  const sourceFile = path.join(SERVER_ROOT, 'src', 'linguistics', 'linguistic-scene-parser.cjs');
  const weightEngineFile = path.join(SERVER_ROOT, 'src', 'linguistics', 'semantic-weight-engine.cjs');
  const sourceMirror = findFirstExisting(runtimeRoots.map((root) => path.join(root, 'modules', 'linguistic-core')));

  return {
    id: 'linguistic-core',
    name: 'A11 Linguistic Core',
    kind: 'runtime-module',
    installed: pathExists(sourceFile) || Boolean(sourceMirror),
    minimumRequired: false,
    source: pathExists(sourceFile) ? 'server-src:src/linguistics' : (sourceMirror ? 'runtime-module-mirror' : 'missing'),
    entrypoints: {
      sceneParser: pathExists(sourceFile) ? sourceFile : null,
      semanticWeightEngine: pathExists(weightEngineFile) ? weightEngineFile : null,
      mirror: sourceMirror || null,
    },
    capabilities: ['language-detection', 'scene-graph', 'subject-action-object', 'semantic-weighting', 'image-prompt-guard'],
    status: {
      sourceFile: statSummary(sourceFile),
      weightEngineFile: statSummary(weightEngineFile),
      sourceMirror: statSummary(sourceMirror),
    },
  };
}

async function writeJson(targetPath, payload) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildMarkdown(index) {
  const lines = [
    '# A11 Runtime Module Index',
    '',
    `Generated: ${index.generatedAt}`,
    `Runtime root: \`${index.runtimeRoot}\``,
    `Workspace root: \`${index.workspaceRoot}\``,
    '',
    '## Minimum Modules',
    '',
  ];

  for (const moduleInfo of index.modules) {
    lines.push(`- ${moduleInfo.name}: ${moduleInfo.installed ? 'installed' : 'missing'} (${moduleInfo.source})`);
  }

  lines.push('', '## Agent Contract', '');
  lines.push('- Agents must use this index before assuming a module is missing.');
  lines.push('- Rome resolves paths and runtime links.');
  lines.push('- Corpus exposes source cards, safe memory and knowledge graph material.');
  lines.push('- A11 Linguistic Core exposes a bounded scene graph parser for image/audio/video workers.');
  lines.push('- Secrets and raw env values are not stored here.');
  lines.push('');

  return lines.join('\n');
}

async function materializeModuleDescriptor(runtimeRoot, moduleInfo) {
  const moduleDirName = moduleInfo.id === 'corpus' ? 'Corpus' : moduleInfo.id;
  const moduleDir = path.join(runtimeRoot, 'modules', moduleDirName);
  await fsp.mkdir(moduleDir, { recursive: true });
  await writeJson(path.join(moduleDir, 'module.json'), moduleInfo);
  await fsp.writeFile(
    path.join(moduleDir, 'README.md'),
    [
      `# ${moduleInfo.name}`,
      '',
      `Status: ${moduleInfo.installed ? 'installed' : 'missing'}`,
      `Source: ${moduleInfo.source}`,
      '',
      'This descriptor is generated by `scripts/ensure-runtime-modules.cjs` so agents can resolve runtime modules from the active A11 runtime root.',
      '',
    ].join('\n'),
    'utf8'
  );
}

async function main() {
  const workspaceRoot = pickWorkspaceRoot();
  const runtimeRoot = pickRuntimeRoot(workspaceRoot);
  const modulesRoot = path.join(runtimeRoot, 'modules');
  const graphDir = path.join(runtimeRoot, 'knowledge-graph');

  await fsp.mkdir(modulesRoot, { recursive: true });
  await fsp.mkdir(graphDir, { recursive: true });
  await fsp.mkdir(path.join(modulesRoot, 'Corpus'), { recursive: true });

  const runtimeRoots = candidateRuntimeRoots({ workspaceRoot, runtimeRoot });
  const moduleSourceRoots = candidateModuleSourceRoots({ workspaceRoot, runtimeRoot });
  const modules = [
    resolveRomeDescriptor(runtimeRoots),
    resolveCorpusDescriptor(runtimeRoots),
    resolveLinguisticCoreDescriptor(runtimeRoots),
    ...FUNESTERIE_MODULES.map((moduleSpec) => resolveFunesterieModuleDescriptor(moduleSpec, {
      moduleSourceRoots,
    })),
  ];
  const minimumOk = MINIMUM_MODULES.every((id) => modules.some((moduleInfo) => moduleInfo.id === id && moduleInfo.installed));
  const generatedAt = new Date().toISOString();
  const index = {
    ok: minimumOk,
    schema: 'a11.runtime-modules.v1',
    id: 'a11-runtime-module-index',
    generatedAt,
    workspaceRoot,
    runtimeRoot,
    runtimeRoots,
    moduleSourceRoots,
    modulesRoot,
    minimumRequired: MINIMUM_MODULES,
    minimumOk,
    modules,
  };

  for (const moduleInfo of modules) {
    await materializeModuleDescriptor(runtimeRoot, moduleInfo);
  }

  await writeJson(path.join(graphDir, 'a11-runtime-module-index.json'), index);
  await fsp.writeFile(path.join(graphDir, 'a11-runtime-module-index.md'), buildMarkdown(index), 'utf8');

  const publicSummary = {
    ok: index.ok,
    runtimeRoot: index.runtimeRoot,
    modulesRoot: index.modulesRoot,
    minimumOk: index.minimumOk,
    modules: index.modules.map((moduleInfo) => ({
      id: moduleInfo.id,
      installed: moduleInfo.installed,
      source: moduleInfo.source,
      version: moduleInfo.version || null,
    })),
  };
  console.log(JSON.stringify(publicSummary, null, 2));
  process.exitCode = index.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[RuntimeModules] ${String(error?.message || error)}`);
  process.exit(1);
});
