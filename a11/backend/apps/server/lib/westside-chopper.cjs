'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const REPO_ROOT = path.resolve(A11_ROOT, '..');
const DEFAULT_RUNTIME_ROOT = path.resolve(A11_ROOT, 'runtime');
const SERVER_RUNTIME_ROOT = path.resolve(SERVER_ROOT, 'runtime');
const SCHEMA = 'funesterie.westside-chopper.v1';

const MODULE_ROLES = Object.freeze({
  allmight: {
    lane: 'quality',
    role: 'audit and duplicate detection',
    consumes: ['repo-files', 'package-manifests'],
    produces: ['audit-report', 'canonical-source-suggestions'],
  },
  bat: {
    lane: 'control',
    role: 'retry, sleep and request control',
    consumes: ['runtime-events'],
    produces: ['retry-policy', 'noise-score'],
  },
  beam: {
    lane: 'pipeline',
    role: 'pipeline composition layer',
    consumes: ['jobs', 'runtime-events'],
    produces: ['flow-steps', 'worker-chain'],
  },
  corpus: {
    lane: 'memory',
    role: 'source cards and knowledge material',
    consumes: ['documents', 'agent-notes', 'runtime-index'],
    produces: ['source-cards', 'knowledge-index'],
  },
  envaptex: {
    lane: 'configuration',
    role: 'typed environment normalization without exposing values',
    consumes: ['env-shapes'],
    produces: ['runtime-config-contract'],
  },
  freeland: {
    lane: 'normalization',
    role: 'universal value resolver',
    consumes: ['json', 'b64', 'file', 'archive', 'paths'],
    produces: ['normalized-values'],
  },
  'freeland-bros': {
    lane: 'diagnostics',
    role: 'cube diagnostics and RGBA explanations',
    consumes: ['freeland-values', 'morph-values'],
    produces: ['diagnostic-cube'],
  },
  'linguistic-core': {
    lane: 'semantics',
    role: 'scene graph and semantic weighting',
    consumes: ['user-text', 'identity-context'],
    produces: ['scene-graph', 'weighted-prompt'],
  },
  mask: {
    lane: 'image',
    role: 'image prompt and mask compiler',
    consumes: ['scene-graph', 'weighted-prompt'],
    produces: ['sd-prompt-bundle'],
  },
  morphing: {
    lane: 'media',
    role: 'controlled media/value transformation',
    consumes: ['media-input', 'morph-values'],
    produces: ['media-variant', 'rgba-value'],
  },
  nezlephant: {
    lane: 'security',
    role: 'capsule and OC8 payload encoding',
    consumes: ['safe-payload'],
    produces: ['capsule', 'oc8-payload'],
  },
  qflush: {
    lane: 'execution',
    role: 'bounded flow and hook runner',
    consumes: ['flow-plan', 'worker-chain'],
    produces: ['flow-result', 'bridge-command'],
  },
  rome: {
    lane: 'routing',
    role: 'workspace navigation and route linking',
    consumes: ['workspace-root', 'module-index'],
    produces: ['route-links', 'runtime-paths'],
  },
  scream: {
    lane: 'audio',
    role: 'semantic audio and WAZAA/MASK prototype bridge',
    consumes: ['audio-signal', 'semantic-text'],
    produces: ['audio-intent', 'sound-runtime-hints'],
  },
  spyder: {
    lane: 'bus',
    role: 'packet transport and agent bus protocol',
    consumes: ['agent-events', 'packets'],
    produces: ['bus-packet', 'protocol-trace'],
  },
});

const RUMBLE_BALLS = Object.freeze([
  {
    id: 'mind-ball',
    name: 'Mind Ball',
    role: 'understand and remember before acting',
    modules: ['corpus', 'rome', 'linguistic-core', 'allmight'],
    lanes: ['memory', 'routing', 'semantics', 'quality'],
    unlocks: ['context-aware-routing', 'source-card-grounding', 'semantic-scene-graph', 'audit-first-decisions'],
    guardrails: ['read-before-write', 'no-secret-corpus', 'module-index-first'],
  },
  {
    id: 'motion-ball',
    name: 'Motion Ball',
    role: 'run bounded flows and move work between agents',
    modules: ['qflush', 'beam', 'spyder', 'bat'],
    lanes: ['execution', 'pipeline', 'bus', 'control'],
    unlocks: ['worker-chain', 'agent-bus-packets', 'retry-policy', 'flow-supervision'],
    guardrails: ['no-shell-free-for-all', 'whitelisted-workers-only', 'dry-run-before-write'],
  },
  {
    id: 'media-ball',
    name: 'Media Ball',
    role: 'shape audio, image and capsule payloads',
    modules: ['mask', 'morphing', 'scream', 'nezlephant', 'freeland', 'freeland-bros'],
    lanes: ['image', 'media', 'audio', 'security', 'normalization', 'diagnostics'],
    unlocks: ['weighted-image-prompts', 'audio-intent-hints', 'controlled-media-variants', 'safe-payload-capsules'],
    guardrails: ['preserve-literal-subject', 'technical-modules-not-human-characters', 'secret-redaction'],
  },
]);

const RUMBLE_RECIPES = Object.freeze([
  {
    id: 'memory-import',
    name: 'Memory Import',
    combinationId: 'mind-ball',
    goal: 'Turn docs, discussions and briefs into grounded Corpus material before agents act.',
    moduleIds: ['corpus', 'rome', 'linguistic-core', 'allmight'],
    actionIds: ['ensure-runtime-modules', 'sync-ecosystem-corpus-dry-run', 'identity-archivist-dry-run'],
    outputs: ['source-cards', 'identity-tag-proposals', 'semantic-routes'],
    triggers: ['new discussion export', 'new repo brief', 'agent memory drift'],
    guardrails: ['no-secret-corpus', 'append-only-by-default', 'dry-run-before-write'],
  },
  {
    id: 'scene-compiler',
    name: 'Scene Compiler',
    combinationId: 'mind-ball+media-ball',
    goal: 'Preserve literal subject/action/object relations for image, audio and video prompts.',
    moduleIds: ['linguistic-core', 'mask', 'morphing', 'scream', 'freeland'],
    actionIds: ['chopper-doctor', 'test-mcp'],
    outputs: ['scene-graph', 'weighted-prompt', 'audio-intent-hints'],
    triggers: ['image prompt', 'Vivy audio prompt', 'video storyboard request'],
    guardrails: ['preserve-literal-subject', 'technical-modules-not-human-characters'],
  },
  {
    id: 'video-analysis',
    name: 'Video Analysis',
    combinationId: 'motion-ball+media-ball',
    goal: 'Route bounded audio/video analysis through QFlush, Janus-style media workers and safe payloads.',
    moduleIds: ['qflush', 'beam', 'spyder', 'mask', 'scream', 'morphing', 'nezlephant'],
    actionIds: ['chopper-doctor', 'sync-runtime-hooks-dry-run', 'test-mcp'],
    outputs: ['media-analysis-plan', 'flow-result', 'safe-media-capsule'],
    triggers: ['video upload', '502 backend media path', 'frame generation error'],
    guardrails: ['whitelisted-workers-only', 'secret-redaction', 'bounded-media-size'],
  },
  {
    id: 'worker-repair',
    name: 'Worker Repair',
    combinationId: 'mind-ball+motion-ball',
    goal: 'Find broken runtime paths, refresh module indexes and recover worker dispatch safely.',
    moduleIds: ['rome', 'corpus', 'qflush', 'beam', 'spyder', 'bat', 'allmight'],
    actionIds: ['ensure-runtime-modules', 'chopper-doctor', 'sync-runtime-hooks-dry-run', 'test-mcp'],
    outputs: ['runtime-config-contract', 'worker-chain', 'repair-report'],
    triggers: ['worker cannot start', 'module path mismatch', 'runtime hook drift'],
    guardrails: ['no-shell-free-for-all', 'module-index-first', 'lock-per-worker'],
  },
  {
    id: 'agent-demo',
    name: 'Agent Demo',
    combinationId: 'mind-ball+media-ball',
    goal: 'Generate a clean demo-ready surface with identity, source cards and visual rules aligned.',
    moduleIds: ['corpus', 'rome', 'linguistic-core', 'mask', 'morphing', 'allmight'],
    actionIds: ['chopper-assemble', 'briefing'],
    outputs: ['demo-briefing', 'source-card-map', 'visual-identity-rules'],
    triggers: ['public demo', 'Google review pass', 'new agent card'],
    guardrails: ['hide-internal-jargon', 'no-secret-screenshots', 'agent-cards-first'],
  },
  {
    id: 'operation-bb',
    name: 'Operation BB',
    combinationId: 'mind-ball+motion-ball+media-ball',
    goal: 'Full Body Building repair pass: modules, hooks, corpus, workers, MCP and briefing.',
    moduleIds: [],
    actionIds: [
      'ensure-runtime-modules',
      'chopper-assemble',
      'sync-runtime-hooks-dry-run',
      'sync-ecosystem-corpus-dry-run',
      'identity-archivist-dry-run',
      'test-mcp',
      'briefing',
    ],
    outputs: ['full-runtime-report', 'mcp-contract-report', 'ecosystem-briefing'],
    triggers: ['global drift', 'post-merge repair', 'before prod deploy'],
    guardrails: ['dry-run-before-write', 'no-shell-free-for-all', 'secret-redaction'],
  },
]);

const QUALITY_GATES = Object.freeze([
  {
    id: 'no-shell-free-for-all',
    status: 'required',
    summary: 'Only whitelisted npm scripts and MCP tools may run workers.',
  },
  {
    id: 'secret-redaction',
    status: 'required',
    summary: 'Artifacts must never contain token, password, bearer, key or raw env values.',
  },
  {
    id: 'module-index-first',
    status: 'required',
    summary: 'Agents must resolve modules from the generated runtime index before guessing paths.',
  },
  {
    id: 'dry-run-before-write',
    status: 'recommended',
    summary: 'Graph sync, workers and dispatch tasks should be planned in dry-run before writes.',
  },
]);

const ACTIONS = Object.freeze([
  {
    id: 'ensure-runtime-modules',
    phase: 1,
    command: 'npm run ensure:runtime-modules',
    mode: 'write-index',
    workerId: null,
    summary: 'Refresh the module descriptors, mirrors and knowledge-graph runtime index.',
  },
  {
    id: 'chopper-doctor',
    phase: 1,
    command: 'npm run chopper:doctor',
    mode: 'read-mostly',
    workerId: 'westside-chopper-doctor',
    summary: 'Build the capability graph and check required gates.',
  },
  {
    id: 'chopper-assemble',
    phase: 1,
    command: 'npm run chopper:assemble',
    mode: 'write-artifact',
    workerId: 'westside-chopper-assemble',
    summary: 'Run the full bounded module assembly and write the Chopper graph artifacts.',
  },
  {
    id: 'sync-runtime-hooks-dry-run',
    phase: 2,
    command: 'npm run sync:runtime-hooks-neo4j:dry-run',
    mode: 'dry-run',
    workerId: 'sync-runtime-hooks-neo4j-dry-run',
    summary: 'Preview hook graph sync before touching Neo4j.',
  },
  {
    id: 'sync-ecosystem-corpus-dry-run',
    phase: 2,
    command: 'npm run sync:ecosystem-corpus-neo4j:dry-run',
    mode: 'dry-run',
    workerId: 'sync-ecosystem-corpus-neo4j-dry-run',
    summary: 'Preview source-card/corpus sync before touching Neo4j.',
  },
  {
    id: 'identity-archivist-dry-run',
    phase: 3,
    command: 'npm run worker:archivist:dry-run',
    mode: 'dry-run',
    workerId: 'identity-archivist-dry-run',
    summary: 'Let Archiviste propose identity tags without writing corpus files.',
  },
  {
    id: 'test-mcp',
    phase: 4,
    command: 'npm run test:mcp',
    mode: 'read-only-test',
    workerId: 'test-mcp',
    summary: 'Verify MCP and worker supervisor contracts.',
  },
  {
    id: 'briefing',
    phase: 5,
    command: 'npm run generate:ecosystem-briefing',
    mode: 'write-artifact',
    workerId: 'generate-ecosystem-briefing',
    summary: 'Regenerate the executive and architecture briefing from the assembled graph.',
  },
]);

function normalizeId(value = '') {
  return String(value || '')
    .trim()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function exists(candidate) {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function readJsonSafe(candidate) {
  try {
    return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch {
    return null;
  }
}

function statSafe(candidate) {
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

function resolveRuntimeRoot(options = {}) {
  const configured = String(options.runtimeRoot || process.env.A11_RUNTIME_ROOT || '').trim();
  if (configured) return path.resolve(configured);
  if (SERVER_ROOT === '/app' && exists(SERVER_RUNTIME_ROOT)) return SERVER_RUNTIME_ROOT;
  return DEFAULT_RUNTIME_ROOT;
}

function runtimeIndexPath(runtimeRoot) {
  return path.join(runtimeRoot, 'knowledge-graph', 'a11-runtime-module-index.json');
}

function chopperJsonPath(runtimeRoot) {
  return path.join(runtimeRoot, 'knowledge-graph', 'westside-chopper.json');
}

function chopperMarkdownPath(runtimeRoot) {
  return path.join(runtimeRoot, 'knowledge-graph', 'westside-chopper.md');
}

function packageJsonPathFromPackageName(packageName = '') {
  const parts = String(packageName || '').split('/').filter(Boolean);
  if (!parts.length) return '';
  return path.join(SERVER_ROOT, 'node_modules', ...parts, 'package.json');
}

function readPackageForModule(moduleInfo = {}) {
  const entryPackage = moduleInfo.entrypoints?.packageJson;
  const packageFromEntry = entryPackage ? readJsonSafe(entryPackage) : null;
  if (packageFromEntry) {
    return {
      path: entryPackage,
      packageJson: packageFromEntry,
    };
  }

  const packageName = String(moduleInfo.name || moduleInfo.packageName || '').startsWith('@')
    ? String(moduleInfo.name || moduleInfo.packageName)
    : String(moduleInfo.source || '').replace(/^npm:/, '');
  const packagePath = packageJsonPathFromPackageName(packageName);
  const packageJson = packagePath ? readJsonSafe(packagePath) : null;
  return packageJson ? { path: packagePath, packageJson } : { path: null, packageJson: null };
}

function dependencyIds(packageJson = {}) {
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.peerDependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };
  return Object.keys(deps)
    .filter((name) => name.startsWith('@funeste38/') || name.startsWith('@funesterie/'))
    .map(normalizeId)
    .filter(Boolean)
    .sort();
}

function buildFallbackIndex(runtimeRoot) {
  const modules = Object.entries(MODULE_ROLES).map(([id, role]) => {
    const funeste38Path = packageJsonPathFromPackageName(`@funeste38/${id}`);
    const funesteriePath = packageJsonPathFromPackageName(`@funesterie/${id}`);
    const packagePath = exists(funeste38Path) ? funeste38Path : (exists(funesteriePath) ? funesteriePath : '');
    const packageJson = packagePath ? readJsonSafe(packagePath) : null;
    const moduleDir = id === 'corpus'
      ? path.join(runtimeRoot, 'modules', 'Corpus')
      : path.join(runtimeRoot, 'modules', id);
    return {
      id,
      name: packageJson?.name || id,
      kind: 'runtime-module',
      installed: Boolean(packageJson || exists(moduleDir)),
      minimumRequired: ['rome', 'corpus', 'linguistic-core'].includes(id),
      source: packageJson ? `npm:${packageJson.name}` : (exists(moduleDir) ? 'runtime-module-mirror' : 'missing'),
      version: packageJson?.version || null,
      entrypoints: {
        packageJson: packagePath || null,
        mirror: exists(moduleDir) ? moduleDir : null,
      },
      capabilities: [],
      status: {
        packageJson: statSafe(packagePath),
        mirror: statSafe(moduleDir),
      },
      role,
    };
  });

  return {
    ok: modules.every((moduleInfo) => !moduleInfo.minimumRequired || moduleInfo.installed),
    schema: 'a11.runtime-modules.v1.fallback',
    generatedAt: nowIso(),
    workspaceRoot: REPO_ROOT,
    runtimeRoot,
    modulesRoot: path.join(runtimeRoot, 'modules'),
    minimumRequired: ['rome', 'corpus', 'linguistic-core'],
    modules,
  };
}

function readRuntimeIndex(options = {}) {
  const runtimeRoot = resolveRuntimeRoot(options);
  const indexPath = runtimeIndexPath(runtimeRoot);
  const index = readJsonSafe(indexPath) || buildFallbackIndex(runtimeRoot);
  return {
    runtimeRoot,
    indexPath,
    index,
  };
}

function buildModuleNode(moduleInfo = {}) {
  const id = normalizeId(moduleInfo.id || moduleInfo.name);
  const role = MODULE_ROLES[id] || {
    lane: 'extension',
    role: 'runtime extension',
    consumes: [],
    produces: [],
  };
  const packageInfo = readPackageForModule(moduleInfo);
  const packageJson = packageInfo.packageJson || {};
  const declaredDeps = dependencyIds(packageJson);
  const installed = Boolean(moduleInfo.installed);
  const required = Boolean(moduleInfo.minimumRequired);
  const entrypoints = moduleInfo.entrypoints || {};
  const checks = {
    installed,
    required,
    hasPackageJson: Boolean(packageInfo.path),
    hasRuntimeMirror: Boolean(entrypoints.mirror || entrypoints.sourceRoot || entrypoints.corpusRoot),
    hasCapabilities: Array.isArray(moduleInfo.capabilities) && moduleInfo.capabilities.length > 0,
  };
  const warnings = [];
  if (required && !installed) warnings.push('required module is missing');
  if (!packageInfo.path && !checks.hasRuntimeMirror) warnings.push('no package.json or runtime mirror resolved');
  if (id === 'qflush') warnings.push('qflush is treated as a controlled runner; do not import it at top level');

  return {
    id,
    name: moduleInfo.name || packageJson.name || id,
    version: moduleInfo.version || packageJson.version || null,
    lane: role.lane,
    role: role.role,
    consumes: role.consumes || [],
    produces: role.produces || [],
    installed,
    required,
    source: moduleInfo.source || null,
    capabilities: Array.from(new Set([
      ...(Array.isArray(moduleInfo.capabilities) ? moduleInfo.capabilities : []),
      ...(role.produces || []),
    ])).sort(),
    dependencies: declaredDeps,
    entrypoints: {
      packageJson: packageInfo.path || entrypoints.packageJson || null,
      main: entrypoints.main || packageJson.main || null,
      bin: entrypoints.bin || packageJson.bin || null,
      mirror: entrypoints.mirror || entrypoints.sourceRoot || entrypoints.corpusRoot || null,
    },
    checks,
    warnings,
  };
}

function buildLinks(nodes = []) {
  const ids = new Set(nodes.map((node) => node.id));
  const links = [];

  for (const node of nodes) {
    for (const dep of node.dependencies || []) {
      if (ids.has(dep)) {
        links.push({ from: node.id, to: dep, type: 'DEPENDS_ON' });
      }
    }
  }

  const requiredLinks = [
    ['corpus', 'rome', 'FEEDS'],
    ['rome', 'qflush', 'ROUTES_TO'],
    ['qflush', 'beam', 'RUNS'],
    ['beam', 'spyder', 'EMITS_TO'],
    ['spyder', 'bat', 'CONTROLLED_BY'],
    ['linguistic-core', 'mask', 'COMPILES_FOR'],
    ['mask', 'morphing', 'HANDOFFS_MEDIA_TO'],
    ['scream', 'linguistic-core', 'ADDS_AUDIO_CONTEXT_TO'],
    ['freeland', 'freeland-bros', 'EXPLAINED_BY'],
    ['morphing', 'nezlephant', 'CAN_BE_CAPSULED_BY'],
    ['allmight', 'corpus', 'AUDITS'],
  ];

  for (const [from, to, type] of requiredLinks) {
    if (ids.has(from) && ids.has(to)) {
      links.push({ from, to, type });
    }
  }

  const unique = new Map();
  for (const link of links) {
    unique.set(`${link.from}:${link.type}:${link.to}`, link);
  }
  return Array.from(unique.values()).sort((a, b) => `${a.from}${a.type}${a.to}`.localeCompare(`${b.from}${b.type}${b.to}`));
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function pickNodesByIds(nodes = [], ids = []) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function combinationPowerName(ids = []) {
  const key = ids.slice().sort().join('+');
  const names = {
    'mind-ball': 'Brain Point',
    'motion-ball': 'Horn Point',
    'media-ball': 'Guard Point',
    'mind-ball+motion-ball': 'Scope Point',
    'media-ball+mind-ball': 'Signal Point',
    'media-ball+motion-ball': 'Arm Point',
    'media-ball+mind-ball+motion-ball': 'Monster Point',
  };
  return names[key] || ids.join(' + ');
}

function buildRumbleCombinations(nodes = []) {
  const combos = [];
  const total = 1 << RUMBLE_BALLS.length;

  for (let mask = 1; mask < total; mask += 1) {
    const balls = RUMBLE_BALLS.filter((_, index) => (mask & (1 << index)) !== 0);
    const ballIds = balls.map((ball) => ball.id);
    const moduleIds = unique(balls.flatMap((ball) => ball.modules));
    const moduleNodes = pickNodesByIds(nodes, moduleIds);
    const installedModules = moduleNodes.filter((node) => node.installed).map((node) => node.id);
    const missingModules = moduleIds.filter((id) => !moduleNodes.some((node) => node.id === id && node.installed));
    const lanes = unique([
      ...balls.flatMap((ball) => ball.lanes),
      ...moduleNodes.map((node) => node.lane),
    ]).sort();
    const guardrails = unique(balls.flatMap((ball) => ball.guardrails)).sort();
    const unlocks = unique(balls.flatMap((ball) => ball.unlocks)).sort();
    const produces = unique(moduleNodes.flatMap((node) => node.produces || [])).sort();
    const consumes = unique(moduleNodes.flatMap((node) => node.consumes || [])).sort();

    combos.push({
      id: ballIds.join('+'),
      name: combinationPowerName(ballIds),
      kind: balls.length === 1 ? 'single-rumble' : balls.length === 2 ? 'hybrid-rumble' : 'triple-rumble',
      level: balls.length,
      ready: missingModules.length === 0,
      balls: balls.map((ball) => ({
        id: ball.id,
        name: ball.name,
        role: ball.role,
      })),
      modules: moduleIds,
      installedModules,
      missingModules,
      lanes,
      consumes,
      produces,
      unlocks,
      guardrails,
      operatingMode: balls.length === 1
        ? 'focused module family'
        : balls.length === 2
          ? 'cross-lane coordinated workflow'
          : 'full Chopper assembly mode',
    });
  }

  return combos.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
}

function buildRumbleRecipes(nodes = [], combinations = [], actionPlan = { actions: [] }) {
  const byNode = new Map(nodes.map((node) => [node.id, node]));
  const byCombination = new Map(combinations.map((combo) => [combo.id, combo]));
  const byAction = new Map((actionPlan.actions || ACTIONS).map((action) => [action.id, action]));
  const monsterModules = unique(RUMBLE_BALLS.flatMap((ball) => ball.modules));

  return RUMBLE_RECIPES.map((recipe) => {
    const combination = byCombination.get(recipe.combinationId) || null;
    const moduleIds = recipe.moduleIds.length ? recipe.moduleIds : monsterModules;
    const modules = moduleIds.map((id) => {
      const node = byNode.get(id);
      return {
        id,
        installed: Boolean(node?.installed),
        lane: node?.lane || null,
        role: node?.role || null,
      };
    });
    const actions = recipe.actionIds.map((id) => {
      const action = byAction.get(id);
      return action ? {
        id: action.id,
        phase: action.phase,
        command: action.command,
        mode: action.mode,
        workerId: action.workerId,
        status: action.status || 'ready',
      } : {
        id,
        phase: null,
        command: null,
        mode: null,
        workerId: null,
        status: 'missing-action',
      };
    });
    const missingModules = modules.filter((moduleInfo) => !moduleInfo.installed).map((moduleInfo) => moduleInfo.id);
    const missingActions = actions.filter((action) => !action.command).map((action) => action.id);
    const blockedActions = actions
      .filter((action) => action.status && action.status !== 'ready')
      .map((action) => action.id);
    const ready = Boolean(combination?.ready) && missingModules.length === 0 && missingActions.length === 0 && blockedActions.length === 0;

    return {
      id: recipe.id,
      name: recipe.name,
      goal: recipe.goal,
      combinationId: recipe.combinationId,
      combinationName: combination?.name || null,
      ready,
      status: ready ? 'ready' : (missingModules.length ? 'blocked' : 'degraded'),
      modules,
      missingModules,
      actions,
      workerIds: actions.map((action) => action.workerId).filter(Boolean),
      commands: actions.map((action) => action.command).filter(Boolean),
      outputs: recipe.outputs,
      triggers: recipe.triggers,
      guardrails: unique([
        ...(recipe.guardrails || []),
        ...(combination?.guardrails || []),
      ]).sort(),
      missingActions,
      blockedActions,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function moduleDoctorScore(node = {}, links = [], allIds = new Set()) {
  const linked = links.some((link) => link.from === node.id || link.to === node.id);
  const missingDependencies = (node.dependencies || []).filter((id) => !allIds.has(id));
  const warnings = node.warnings || [];
  const blockingWarnings = warnings.filter((warning) => !/controlled runner/i.test(warning));
  const checks = [
    {
      id: 'installed',
      ok: Boolean(node.installed),
      points: 30,
      earned: node.installed ? 30 : 0,
      summary: 'module is installed or mirrored',
    },
    {
      id: 'entrypoint',
      ok: Boolean(node.checks?.hasPackageJson || node.checks?.hasRuntimeMirror),
      points: 20,
      earned: node.checks?.hasPackageJson || node.checks?.hasRuntimeMirror ? 20 : 0,
      summary: 'package.json or runtime mirror resolves',
    },
    {
      id: 'capabilities',
      ok: Boolean(node.checks?.hasCapabilities),
      points: 10,
      earned: node.checks?.hasCapabilities ? 10 : 0,
      summary: 'capabilities are visible in the index',
    },
    {
      id: 'role-contract',
      ok: Boolean((node.consumes || []).length && (node.produces || []).length),
      points: 15,
      earned: (node.consumes || []).length && (node.produces || []).length ? 15 : 0,
      summary: 'role declares inputs and outputs',
    },
    {
      id: 'dependencies',
      ok: missingDependencies.length === 0,
      points: 10,
      earned: missingDependencies.length === 0 ? 10 : 0,
      summary: missingDependencies.length ? `missing linked deps: ${missingDependencies.join(', ')}` : 'dependencies resolve inside Chopper',
    },
    {
      id: 'graph-link',
      ok: linked,
      points: 10,
      earned: linked ? 10 : 0,
      summary: 'module participates in the Chopper graph',
    },
    {
      id: 'warnings',
      ok: blockingWarnings.length === 0,
      points: 5,
      earned: blockingWarnings.length === 0 ? 5 : 0,
      summary: blockingWarnings.length ? blockingWarnings.join('; ') : 'no blocking warning',
    },
  ];
  const score = checks.reduce((sum, check) => sum + check.earned, 0);
  const status = node.required && !node.installed
    ? 'blocked'
    : !node.installed
      ? 'missing'
      : blockingWarnings.length || missingDependencies.length || score < 75
        ? 'degraded'
        : warnings.length
          ? 'guarded'
          : 'ready';
  const suggestions = [];
  if (!node.installed) suggestions.push(`run npm run ensure:runtime-modules and verify ${node.id}`);
  if (!(node.checks?.hasPackageJson || node.checks?.hasRuntimeMirror)) suggestions.push('add a package entrypoint or runtime mirror');
  if (!node.checks?.hasCapabilities) suggestions.push('enrich the runtime descriptor with capabilities');
  if (!linked) suggestions.push('link the module to a recipe or lane relationship');
  if (missingDependencies.length) suggestions.push(`install or mirror dependencies: ${missingDependencies.join(', ')}`);

  return {
    id: node.id,
    lane: node.lane,
    status,
    score,
    required: Boolean(node.required),
    warnings,
    missingDependencies,
    checks,
    suggestions,
  };
}

function buildDoctorReport(nodes = [], links = [], gates = {}, recipes = []) {
  const allIds = new Set(nodes.map((node) => node.id));
  const modules = nodes.map((node) => moduleDoctorScore(node, links, allIds));
  const averageScore = modules.length
    ? Math.round(modules.reduce((sum, moduleInfo) => sum + moduleInfo.score, 0) / modules.length)
    : 0;
  const blocked = modules.filter((moduleInfo) => moduleInfo.status === 'blocked' || moduleInfo.status === 'missing');
  const degraded = modules.filter((moduleInfo) => moduleInfo.status === 'degraded');
  const guarded = modules.filter((moduleInfo) => moduleInfo.status === 'guarded');
  const readyRecipes = recipes.filter((recipe) => recipe.ready);
  const status = blocked.length
    ? 'blocked'
    : degraded.length
      ? 'degraded'
      : guarded.length
        ? 'guarded'
        : 'ready';

  return {
    ok: status === 'ready' || status === 'guarded',
    status,
    score: averageScore,
    generatedAt: nowIso(),
    summary: {
      modules: modules.length,
      ready: modules.filter((moduleInfo) => moduleInfo.status === 'ready').length,
      guarded: guarded.length,
      degraded: degraded.length,
      blocked: blocked.length,
      recipes: recipes.length,
      readyRecipes: readyRecipes.length,
      requiredMissing: Array.isArray(gates.requiredMissing) ? gates.requiredMissing.length : 0,
    },
    modules,
    recipeHealth: recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      status: recipe.status,
      ready: recipe.ready,
      missingModules: recipe.missingModules,
      blockedActions: recipe.blockedActions,
    })),
    nextActions: [
      ...(blocked.length ? ['run npm run ensure:runtime-modules', 'run npm run chopper:assemble'] : []),
      ...(degraded.length ? ['run npm run chopper:doctor', 'check degraded module suggestions'] : []),
      ...(recipes.length !== readyRecipes.length ? ['review blocked recipe actions before Operation BB'] : []),
    ],
  };
}

function buildLanes(nodes = []) {
  const lanes = new Map();
  for (const node of nodes) {
    const lane = node.lane || 'extension';
    if (!lanes.has(lane)) {
      lanes.set(lane, {
        id: lane,
        modules: [],
        installed: 0,
        warnings: 0,
      });
    }
    const entry = lanes.get(lane);
    entry.modules.push(node.id);
    if (node.installed) entry.installed += 1;
    entry.warnings += node.warnings.length;
  }
  return Array.from(lanes.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function evaluateGates(nodes = [], links = [], index = {}) {
  const requiredMissing = nodes.filter((node) => node.required && !node.installed).map((node) => node.id);
  const packageCount = nodes.filter((node) => node.checks.hasPackageJson).length;
  const mirrorCount = nodes.filter((node) => node.checks.hasRuntimeMirror).length;
  return {
    ok: requiredMissing.length === 0 && packageCount >= 8 && links.length > 0,
    requiredMissing,
    packageCount,
    mirrorCount,
    indexOk: Boolean(index.ok || index.minimumOk),
    policies: QUALITY_GATES,
  };
}

function buildActionPlan(gates) {
  const actions = ACTIONS.map((action) => ({
    ...action,
    status: gates.requiredMissing.length && action.id !== 'ensure-runtime-modules' ? 'blocked-until-index-ok' : 'ready',
  }));
  return {
    id: 'westside-chopper-action-plan',
    phases: Array.from(new Set(actions.map((action) => action.phase))).sort((a, b) => a - b),
    actions,
  };
}

function buildChopperStatus(options = {}) {
  const { runtimeRoot, indexPath, index } = readRuntimeIndex(options);
  const modules = Array.isArray(index.modules) ? index.modules : [];
  const nodes = modules.map(buildModuleNode).filter((node) => node.id);
  const links = buildLinks(nodes);
  const lanes = buildLanes(nodes);
  const rumbleCombinations = buildRumbleCombinations(nodes);
  const gates = evaluateGates(nodes, links, index);
  const actionPlan = buildActionPlan(gates);
  const recipes = buildRumbleRecipes(nodes, rumbleCombinations, actionPlan);
  const doctor = buildDoctorReport(nodes, links, gates, recipes);
  const summary = {
    modules: nodes.length,
    installed: nodes.filter((node) => node.installed).length,
    requiredMissing: gates.requiredMissing.length,
    links: links.length,
    lanes: lanes.length,
    rumbleBalls: RUMBLE_BALLS.length,
    rumbleCombinations: rumbleCombinations.length,
    rumbleReady: rumbleCombinations.filter((combo) => combo.ready).length,
    rumbleRecipes: recipes.length,
    rumbleRecipesReady: recipes.filter((recipe) => recipe.ready).length,
    doctorScore: doctor.score,
    doctorStatus: doctor.status,
    warnings: nodes.reduce((sum, node) => sum + node.warnings.length, 0),
  };

  return {
    ok: gates.ok,
    schema: SCHEMA,
    id: 'westside-chopper',
    name: 'WestSide Chopper',
    generatedAt: nowIso(),
    runtimeRoot,
    serverRoot: SERVER_ROOT,
    sourceIndex: {
      path: indexPath,
      status: statSafe(indexPath),
      schema: index.schema || null,
      generatedAt: index.generatedAt || null,
    },
    summary,
    gates,
    lanes,
    rumbleBalls: RUMBLE_BALLS,
    rumbleCombinations,
    recipes,
    doctor,
    modules: nodes,
    links,
    actionPlan,
    mcpContract: {
      statusTool: 'a11_chopper_status',
      planTool: 'a11_chopper_plan',
      rumbleTool: 'a11_chopper_rumble',
      recipesTool: 'a11_chopper_recipes',
      doctorTool: 'a11_chopper_doctor',
      workerStatusTool: 'a11_worker_status',
      workerStartTool: 'a11_worker_start',
      allowedWorkerIds: ACTIONS.map((action) => action.workerId).filter(Boolean),
    },
  };
}

function buildMarkdown(status) {
  const lines = [
    '# WestSide Chopper',
    '',
    `Generated: ${status.generatedAt}`,
    `Runtime root: \`${status.runtimeRoot}\``,
    `Status: ${status.ok ? 'OK' : 'NEEDS_ATTENTION'}`,
    '',
    '## Summary',
    '',
    `- Modules: ${status.summary.modules}`,
    `- Installed: ${status.summary.installed}`,
    `- Links: ${status.summary.links}`,
    `- Lanes: ${status.summary.lanes}`,
    `- Rumble combinations: ${status.summary.rumbleReady}/${status.summary.rumbleCombinations} ready`,
    `- Rumble recipes: ${status.summary.rumbleRecipesReady}/${status.summary.rumbleRecipes} ready`,
    `- Doctor: ${status.summary.doctorStatus} (${status.summary.doctorScore}/100)`,
    `- Required missing: ${status.summary.requiredMissing}`,
    `- Warnings: ${status.summary.warnings}`,
    '',
    '## Doctor',
    '',
    `- Status: ${status.doctor.status}`,
    `- Score: ${status.doctor.score}/100`,
    `- Ready modules: ${status.doctor.summary.ready}`,
    `- Guarded modules: ${status.doctor.summary.guarded}`,
    `- Degraded modules: ${status.doctor.summary.degraded}`,
    `- Blocked modules: ${status.doctor.summary.blocked}`,
    '',
    '## Lanes',
    '',
  ];

  for (const lane of status.lanes) {
    lines.push(`- ${lane.id}: ${lane.modules.join(', ')}`);
  }

  lines.push('', '## Rumble Combinations', '');
  for (const combo of status.rumbleCombinations) {
    lines.push(`- ${combo.name}: ${combo.ready ? 'ready' : 'missing'} | ${combo.modules.join(', ')}`);
  }

  lines.push('', '## Rumble Recipes', '');
  for (const recipe of status.recipes) {
    lines.push(`- ${recipe.name}: ${recipe.status} | ${recipe.commands.join(' -> ')}`);
  }

  lines.push('', '## Modules', '');
  for (const node of status.modules) {
    const warnings = node.warnings.length ? ` warnings=${node.warnings.join('; ')}` : '';
    lines.push(`- ${node.id}: ${node.installed ? 'installed' : 'missing'} | ${node.lane} | ${node.role}${warnings}`);
  }

  lines.push('', '## Action Plan', '');
  for (const action of status.actionPlan.actions) {
    lines.push(`- P${action.phase} ${action.id}: ${action.command} (${action.mode})`);
  }

  lines.push('', '## Security Gates', '');
  for (const gate of status.gates.policies) {
    lines.push(`- ${gate.id}: ${gate.status} - ${gate.summary}`);
  }

  lines.push('', 'No secrets, tokens, passwords or raw environment values belong in this artifact.', '');
  return lines.join('\n');
}

async function writeChopperArtifacts(status, options = {}) {
  const runtimeRoot = resolveRuntimeRoot(options);
  const jsonPath = chopperJsonPath(runtimeRoot);
  const markdownPath = chopperMarkdownPath(runtimeRoot);
  await fsp.mkdir(path.dirname(jsonPath), { recursive: true });
  await fsp.writeFile(jsonPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await fsp.writeFile(markdownPath, buildMarkdown(status), 'utf8');
  return {
    jsonPath,
    markdownPath,
  };
}

function runNodeScript(scriptPath, args = [], options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: SERVER_ROOT,
    env: process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 120_000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal || null,
    stdout: String(result.stdout || '').slice(-12_000),
    stderr: String(result.stderr || '').slice(-12_000),
    error: result.error ? result.error.message : null,
  };
}

async function assembleChopper(options = {}) {
  const steps = [];
  if (options.refreshIndex !== false) {
    const ensurePath = path.join(SERVER_ROOT, 'scripts', 'ensure-runtime-modules.cjs');
    steps.push({
      id: 'ensure-runtime-modules',
      result: runNodeScript(ensurePath, [], { timeoutMs: 180_000 }),
    });
  }

  const status = buildChopperStatus(options);
  const artifacts = options.write === false ? null : await writeChopperArtifacts(status, options);
  steps.push({
    id: 'build-chopper-status',
    result: {
      ok: status.ok,
      summary: status.summary,
      artifacts,
    },
  });

  return {
    ok: steps.every((step) => step.result?.ok !== false) && status.ok,
    schema: `${SCHEMA}.assembly`,
    generatedAt: nowIso(),
    status,
    artifacts,
    steps,
  };
}

module.exports = {
  ACTIONS,
  MODULE_ROLES,
  QUALITY_GATES,
  RUMBLE_BALLS,
  RUMBLE_RECIPES,
  assembleChopper,
  buildDoctorReport,
  buildRumbleCombinations,
  buildRumbleRecipes,
  buildChopperStatus,
  buildMarkdown,
  chopperJsonPath,
  chopperMarkdownPath,
  resolveRuntimeRoot,
  writeChopperArtifacts,
};
