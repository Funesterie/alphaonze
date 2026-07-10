'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const {
  getCanonicalRuntimeRoot,
  getRuntimeRootCandidates,
} = require('../lib/runtime-root.cjs');
const {
  buildChopperStatus,
  buildMarkdown: buildChopperMarkdown,
} = require('../lib/westside-chopper.cjs');
const {
  buildMixerRoute,
  buildMixerStatus,
  buildMarkdown: buildMixerMarkdown,
} = require('../lib/funesterie-mixer.cjs');

const EXCLUDED_DIRS = new Set([
  '.git',
  '.vs',
  '.vscode',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.next',
]);

const KNOWN_CAPABILITIES = {
  allmight: ['audit doublons', 'canonicalisation', 'rapports de scan'],
  bat: ['timer asynchrone', 'echo radar', 'sleep guard', 'retry/noise scoring', 'profilage sensoriel'],
  beam: ['orchestration pipeline', 'etapes QFlush', 'composition de flux'],
  corpus: ['corpus local', 'codebook', 'encodage RGB', 'archives importables'],
  dragon: ['daemon', 'API', 'web cockpit', 'contrats', 'snapshots/actions'],
  envaptex: ['configuration env', 'normalisation dotenv', 'exports runtime'],
  freeland: ['normalisation valeurs', 'json/b64/file/exe/zip', 'registry cross-platform'],
  'freeland-bros': ['diagnostic cube', 'projection RGBA', 'runtime solving'],
  katana: ['analyse backend', 'plans extraction routes', 'refactor guide'],
  marvin: ['site module', 'Netlify', 'assets web'],
  mask: ['moteur Python', 'schema mask', 'conversion mask->python'],
  morphing: ['type valeur 4 bytes', 'RGBA', 'encodage binaire'],
  nezlephant: ['CLI helper', 'runtime utility'],
  premier: ['bibliotheque images', 'assets reference'],
  qflush: ['orchestrateur', 'daemon', 'memoire', 'cortex encode/decode', 'supervision'],
  rome: ['fixPath', 'command runner', 'duo/trio async', 'workspaces', 'deploiement web'],
  scream: ['prototype semantique', 'WAZAA', 'MASK'],
  shiryu: ['lame de sang', 'json vers zen RGBA', 'bruit contrôlé', 'découpe fumée conversation', 'anti-réponse recyclée'],
  spyder: ['graphe/protocole', 'memoire', 'miroir QFlush legacy'],
};

const KIND_BY_ID = {
  corpus: 'corpus',
  marvin: 'web-site',
  mask: 'python-module',
  premier: 'asset-library',
};

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function exists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

function countModuleDirs(modulesRoot) {
  try {
    return fs.readdirSync(modulesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name))
      .length;
  } catch {
    return 0;
  }
}

function resolveRuntimeRoot() {
  const candidates = getRuntimeRootCandidates(process.env);

  let firstExisting = '';
  for (const candidate of candidates) {
    const resolved = path.resolve(String(candidate));
    const modulesRoot = path.join(resolved, 'modules');
    if (exists(modulesRoot)) {
      if (!firstExisting) firstExisting = resolved;
      if (countModuleDirs(modulesRoot) > 0) {
        return resolved;
      }
    }
  }

  try {
    let cursor = process.cwd();
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = path.join(cursor, 'runtime');
      const modulesRoot = path.join(candidate, 'modules');
      if (exists(modulesRoot) && countModuleDirs(modulesRoot) > 0) {
        return candidate;
      }
      const next = path.dirname(cursor);
      if (next === cursor) break;
      cursor = next;
    }
  } catch {
    // ignore fallback discovery errors
  }

  try {
    let cursor = __dirname;
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = path.join(cursor, 'runtime');
      const modulesRoot = path.join(candidate, 'modules');
      if (exists(modulesRoot) && countModuleDirs(modulesRoot) > 0) {
        return candidate;
      }
      const next = path.dirname(cursor);
      if (next === cursor) break;
      cursor = next;
    }
  } catch {
    // ignore fallback discovery errors
  }

  try {
    const driveRoot = path.parse(process.cwd()).root;
    const likelyRoots = [
      path.join(driveRoot, 'projets', 'funesterie', 'runtime'),
      path.join(driveRoot, 'Users', 'Djeff', 'OneDrive - Funesterie', 'runtime'),
    ];
    for (const resolved of likelyRoots) {
      const modulesRoot = path.join(resolved, 'modules');
      if (exists(modulesRoot) && countModuleDirs(modulesRoot) > 0) {
        return resolved;
      }
    }
  } catch {
    // ignore fallback discovery errors
  }

  if (firstExisting) {
    return firstExisting;
  }

  return getCanonicalRuntimeRoot(process.env);
}

function readPackage(modulePath) {
  const direct = path.join(modulePath, 'package.json');
  if (exists(direct)) {
    return { packagePath: direct, packageJson: safeReadJson(direct) };
  }

  const packagesDir = path.join(modulePath, 'packages');
  if (!exists(packagesDir)) {
    return { packagePath: null, packageJson: null };
  }

  try {
    const nested = fs.readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(packagesDir, entry.name, 'package.json'))
      .find((packagePath) => exists(packagePath));
    return nested ? { packagePath: nested, packageJson: safeReadJson(nested) } : { packagePath: null, packageJson: null };
  } catch {
    return { packagePath: null, packageJson: null };
  }
}

function summarizePackageDescription(packageJson, id) {
  const description = String(packageJson?.description || '').trim();
  if (description) {
    return description.length > 220 ? `${description.slice(0, 217)}...` : description;
  }
  if (id === 'Corpus') return 'Corpus local et codebooks pour encodage/decodage des archives.';
  if (id === 'mask') return 'Module Python pour transformer et valider les schemas mask.';
  if (id === 'premier') return 'Bibliotheque locale d images de reference.';
  if (id === 'marvin') return 'Module web statique et assets Netlify.';
  return 'Module runtime local Funesterie.';
}

function listScriptNames(packageJson) {
  return Object.keys(packageJson?.scripts || {}).sort();
}

function hasAny(modulePath, names) {
  return names.some((name) => exists(path.join(modulePath, name)));
}

function countShallowEntries(modulePath) {
  const result = { files: 0, directories: 0 };
  try {
    for (const entry of fs.readdirSync(modulePath, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.isDirectory()) result.directories += 1;
      else if (entry.isFile()) result.files += 1;
    }
  } catch {}
  return result;
}

function inferKind(id, packageJson, modulePath) {
  const normalizedId = String(id || '').toLowerCase();
  if (KIND_BY_ID[normalizedId]) return KIND_BY_ID[normalizedId];
  if (packageJson) return packageJson.type === 'module' ? 'node-esm-package' : 'node-package';
  if (hasAny(modulePath, ['mask_engine.py', 'code.py', 'cbook_io.py'])) return 'python-module';
  return 'runtime-folder';
}

function buildEntrypoints(packageJson, modulePath) {
  const entrypoints = [];
  for (const key of ['main', 'module', 'types']) {
    const value = packageJson?.[key];
    if (typeof value === 'string' && value.trim()) {
      entrypoints.push({ kind: key, value: value.trim() });
    }
  }
  if (packageJson?.bin) {
    const binNames = typeof packageJson.bin === 'string'
      ? ['cli']
      : Object.keys(packageJson.bin || {}).sort();
    for (const binName of binNames.slice(0, 6)) {
      entrypoints.push({ kind: 'bin', value: binName });
    }
  }

  const safeFiles = [
    'README.md',
    'netlify.toml',
    'mask_engine.py',
    'mask_schema.json',
    'cbook_io.py',
    'smart_encode_rgb.py',
    'smart_decode_rgb.py',
  ];
  for (const fileName of safeFiles) {
    if (exists(path.join(modulePath, fileName))) {
      entrypoints.push({ kind: 'file', value: fileName });
    }
  }

  return entrypoints.slice(0, 12);
}

function inferCapabilities(id, packageJson, modulePath) {
  const normalizedId = String(id || '').toLowerCase();
  const known = KNOWN_CAPABILITIES[normalizedId] || [];
  const capabilities = new Set(known);
  const text = [
    packageJson?.description,
    ...(packageJson?.keywords || []),
    Object.keys(packageJson?.scripts || {}).join(' '),
  ].join(' ').toLowerCase();

  if (/async|daemon|spawn|runner|duo|trio|sleep|timeout/.test(text)) capabilities.add('execution asynchrone');
  if (/memory|memoire|corpus|graph|kg/.test(text)) capabilities.add('memoire/corpus');
  if (/image|rgba|vision|mask|png|jpg/.test(text) || hasAny(modulePath, ['mask_engine.py', 'smart_encode_rgb.py'])) capabilities.add('media/vision');
  if (/deploy|netlify|railway|web/.test(text) || exists(path.join(modulePath, 'netlify.toml'))) capabilities.add('web/deploiement');
  if (/test|vitest|node --test/.test(text)) capabilities.add('tests');
  if (/build|tsc|tsup/.test(text)) capabilities.add('build');

  return Array.from(capabilities).slice(0, 10);
}

function buildModuleState(modulePath, packageJson) {
  const hasPackage = !!packageJson;
  const hasSource = hasAny(modulePath, ['src', 'packages', 'apps', 'mask_engine.py', 'code.py']);
  const hasDist = hasAny(modulePath, ['dist', 'site']);
  const hasDocs = hasAny(modulePath, ['README.md', 'docs']);
  const hasTests = hasAny(modulePath, ['test', 'tests']);

  let status = 'partial';
  if (hasPackage && (hasDist || hasSource)) status = 'ready';
  if (!hasPackage && hasSource) status = 'source-only';
  if (!hasPackage && !hasSource && hasDist) status = 'asset-only';
  if (!hasPackage && !hasSource && !hasDist) status = 'raw';

  return { status, hasPackage, hasSource, hasDist, hasDocs, hasTests };
}

function getLoadedModuleNames(moduleLoader) {
  try {
    const loader = typeof moduleLoader === 'function' ? moduleLoader() : moduleLoader;
    return new Set((loader?.listModules?.() || []).map((entry) => String(entry.name || '').toLowerCase()));
  } catch {
    return new Set();
  }
}

function buildRuntimeModulesStatus({ moduleLoader } = {}) {
  const runtimeRoot = resolveRuntimeRoot();
  const modulesRoot = path.join(runtimeRoot, 'modules');
  const loadedNames = getLoadedModuleNames(moduleLoader);
  const modules = [];

  if (exists(modulesRoot)) {
    const entries = fs.readdirSync(modulesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const modulePath = path.join(modulesRoot, entry.name);
      const { packageJson } = readPackage(modulePath);
      const state = buildModuleState(modulePath, packageJson);
      const shallow = countShallowEntries(modulePath);
      const id = entry.name;
      const normalizedId = id.toLowerCase();

      modules.push({
        id,
        name: packageJson?.name || id,
        version: packageJson?.version || null,
        kind: inferKind(id, packageJson, modulePath),
        summary: summarizePackageDescription(packageJson, id),
        capabilities: inferCapabilities(id, packageJson, modulePath),
        scripts: listScriptNames(packageJson),
        entrypoints: buildEntrypoints(packageJson, modulePath),
        state: {
          ...state,
          loaded: loadedNames.has(normalizedId) || loadedNames.has(String(packageJson?.name || '').toLowerCase()),
          shallowFiles: shallow.files,
          shallowDirectories: shallow.directories,
        },
      });
    }
  }

  const summary = {
    total: modules.length,
    ready: modules.filter((moduleInfo) => moduleInfo.state.status === 'ready').length,
    packages: modules.filter((moduleInfo) => moduleInfo.state.hasPackage).length,
    sourceOnly: modules.filter((moduleInfo) => moduleInfo.state.status === 'source-only').length,
    assetOnly: modules.filter((moduleInfo) => moduleInfo.state.status === 'asset-only').length,
    raw: modules.filter((moduleInfo) => moduleInfo.state.status === 'raw').length,
    loaded: modules.filter((moduleInfo) => moduleInfo.state.loaded).length,
  };

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    runtimeRoot,
    modulesRoot,
    summary,
    modules,
  };
}

function createRuntimeModulesRouter({ moduleLoader } = {}) {
  const router = express.Router();
  router.get('/modules', (_req, res) => {
    try {
      return res.json(buildRuntimeModulesStatus({ moduleLoader }));
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: 'runtime_modules_status_failed',
        message: String(err?.message || err),
      });
    }
  });
  router.get('/chopper/doctor', (_req, res) => {
    try {
      const status = buildChopperStatus();
      return res.json({
        ok: status.doctor.ok,
        generatedAt: status.generatedAt,
        summary: status.summary,
        doctor: status.doctor,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: 'westside_chopper_doctor_failed',
        message: String(err?.message || err),
      });
    }
  });
  router.get('/chopper/recipes', (_req, res) => {
    try {
      const status = buildChopperStatus();
      return res.json({
        ok: status.ok,
        generatedAt: status.generatedAt,
        summary: {
          recipes: status.summary.rumbleRecipes,
          ready: status.summary.rumbleRecipesReady,
          doctorStatus: status.summary.doctorStatus,
          doctorScore: status.summary.doctorScore,
        },
        recipes: status.recipes,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: 'westside_chopper_recipes_failed',
        message: String(err?.message || err),
      });
    }
  });
  router.get('/chopper', (req, res) => {
    try {
      const status = buildChopperStatus();
      if (String(req.query?.format || '').toLowerCase() === 'markdown') {
        res.type('text/markdown');
        return res.send(buildChopperMarkdown(status));
      }
      return res.json(status);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: 'westside_chopper_status_failed',
        message: String(err?.message || err),
      });
    }
  });
  router.get('/mixer/status', (req, res) => {
    try {
      const status = buildMixerStatus({
        request: String(req.query?.request || ''),
        topN: Number(req.query?.top || req.query?.topN || 12),
      });
      if (String(req.query?.format || '').toLowerCase() === 'markdown') {
        res.type('text/markdown');
        return res.send(buildMixerMarkdown(status));
      }
      return res.json(status);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: 'funesterie_mixer_status_failed',
        message: String(err?.message || err),
      });
    }
  });
  router.get('/mixer', (req, res) => {
    try {
      const route = buildMixerRoute({
        request: String(req.query?.request || req.query?.q || ''),
        topN: Number(req.query?.top || req.query?.topN || 12),
      });
      if (String(req.query?.format || '').toLowerCase() === 'markdown') {
        res.type('text/markdown');
        return res.send(buildMixerMarkdown(route));
      }
      return res.json(route);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: 'funesterie_mixer_route_failed',
        message: String(err?.message || err),
      });
    }
  });
  return router;
}

module.exports = {
  createRuntimeModulesRouter,
  buildRuntimeModulesStatus,
  resolveRuntimeRoot,
};
