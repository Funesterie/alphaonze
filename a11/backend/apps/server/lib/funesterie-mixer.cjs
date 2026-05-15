'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const chopper = require('./westside-chopper.cjs');

const SCHEMA = 'funesterie.mixer.v1';
const DEFAULT_REQUEST = 'Operation BB Funesterie full repair: modules, workers, MCP, corpus, media and safe deployment.';

const INTENT_RULES = Object.freeze([
  {
    id: 'worker-repair',
    label: 'Worker Repair',
    keywords: ['worker', 'workers', 'runtime', 'hook', 'hooks', 'path', 'paths', 'chemin', 'erreur', 'error', 'module', 'modules', 'install', 'repair', 'fix', 'ci', 'test', 'prod', '502', 'operation', 'bb'],
    preferredRecipes: ['worker-repair', 'operation-bb'],
    preferredLanes: ['execution', 'routing', 'pipeline', 'bus', 'control', 'memory', 'quality'],
    preferredAgents: ['codex', 'a11', 'kiro', 'copilot'],
  },
  {
    id: 'media-analysis',
    label: 'Media Analysis',
    keywords: ['video', 'videos', 'frame', 'frames', 'image', 'images', 'audio', 'vivy', 'janus', 'analyser', 'analyse', 'media', 'generate', 'generation', 'voice', 'voix'],
    preferredRecipes: ['video-analysis', 'scene-compiler'],
    preferredLanes: ['media', 'image', 'audio', 'security', 'execution', 'semantics'],
    preferredAgents: ['a11', 'vivy', 'janus', 'grok'],
  },
  {
    id: 'memory-corpus',
    label: 'Memory And Corpus',
    keywords: ['corpus', 'neo4j', 'graph', 'memoire', 'memory', 'conversation', 'discussion', 'identity', 'identite', 'hashtag', 'source', 'card', 'cards', 'archive'],
    preferredRecipes: ['memory-import'],
    preferredLanes: ['memory', 'routing', 'semantics', 'quality'],
    preferredAgents: ['a11', 'codex', 'kiro'],
  },
  {
    id: 'demo-ui',
    label: 'Demo And UI',
    keywords: ['demo', 'google', 'ui', 'homepage', 'home', 'cockpit', 'kaen', 'kaen44', 'vivy', 'public', 'front', 'interface', 'mobile', 'desktop'],
    preferredRecipes: ['agent-demo', 'scene-compiler'],
    preferredLanes: ['image', 'media', 'memory', 'semantics', 'routing'],
    preferredAgents: ['kaen44', 'vivy', 'a11', 'codex'],
  },
  {
    id: 'scene-compiler',
    label: 'Scene Compiler',
    keywords: ['prompt', 'scene', 'linguistic', 'linguistique', 'semantic', 'semantique', 'sd', 'mask', 'sujet', 'verbe', 'objet', 'poids', 'weight', 'lapin'],
    preferredRecipes: ['scene-compiler'],
    preferredLanes: ['semantics', 'image', 'media', 'normalization', 'audio'],
    preferredAgents: ['a11', 'vivy', 'codex'],
  },
  {
    id: 'global-orchestration',
    label: 'Global Orchestration',
    keywords: ['funesterie', 'mixer', 'orchestrator', 'orchestration', 'tout', 'all', 'global', 'assemble', 'systeme', 'ecosysteme'],
    preferredRecipes: ['operation-bb', 'worker-repair', 'memory-import'],
    preferredLanes: ['memory', 'routing', 'execution', 'pipeline', 'bus', 'quality', 'semantics'],
    preferredAgents: ['a11', 'codex', 'kiro', 'gemini'],
  },
]);

const STOPWORDS = new Set([
  'a', 'ai', 'au', 'aux', 'avec', 'ce', 'ces', 'ca', 'dans', 'de', 'des', 'du', 'en', 'et', 'fait',
  'faire', 'il', 'je', 'la', 'le', 'les', 'me', 'mon', 'nous', 'on', 'pour', 'que', 'qui', 'quoi',
  'se', 'si', 'sur', 'ta', 'te', 'tu', 'un', 'une', 'va', 'the', 'to', 'and', 'or', 'for', 'of',
  'in', 'is', 'it', 'with', 'this', 'that',
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenize(value = '') {
  return normalizeText(value)
    .split(/[^a-z0-9._-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function mixerJsonPath(runtimeRoot) {
  return path.join(runtimeRoot, 'knowledge-graph', 'funesterie-mixer.json');
}

function mixerMarkdownPath(runtimeRoot) {
  return path.join(runtimeRoot, 'knowledge-graph', 'funesterie-mixer.md');
}

function textScore(tokens = [], haystack = '') {
  if (!tokens.length) return 0.15;
  const text = ` ${normalizeText(haystack)} `;
  const hits = tokens.filter((token) => text.includes(token));
  return clamp(hits.length / Math.max(3, Math.min(tokens.length, 12)));
}

function detectIntent(request = DEFAULT_REQUEST) {
  const tokens = tokenize(request);
  const matches = INTENT_RULES.map((rule) => {
    const score = textScore(tokens, [...rule.keywords, rule.id, rule.label].join(' '));
    return {
      id: rule.id,
      label: rule.label,
      score,
      preferredRecipes: rule.preferredRecipes,
      preferredLanes: rule.preferredLanes,
      preferredAgents: rule.preferredAgents,
    };
  }).filter((intent) => intent.score > 0)
    .sort((a, b) => b.score - a.score);

  const primary = matches[0] || INTENT_RULES.find((rule) => rule.id === 'global-orchestration');
  return {
    primary: {
      id: primary.id,
      label: primary.label,
      score: round(primary.score || 0.15),
      preferredRecipes: primary.preferredRecipes,
      preferredLanes: primary.preferredLanes,
      preferredAgents: primary.preferredAgents,
    },
    matches: matches.slice(0, 5).map((intent) => ({
      ...intent,
      score: round(intent.score),
    })),
    tokens,
  };
}

function actionRisk(action = {}) {
  const mode = String(action.mode || '').toLowerCase();
  if (mode.includes('dry-run') || mode.includes('read-only')) return 0.08;
  if (mode.includes('read-mostly')) return 0.12;
  if (mode.includes('write-artifact')) return 0.24;
  if (mode.includes('write-index')) return 0.28;
  if (mode.includes('write')) return 0.4;
  return 0.18;
}

function candidateRisk(candidate = {}) {
  if (candidate.kind === 'module') {
    const qflushGuard = candidate.id === 'qflush' ? 0.12 : 0;
    const statusRisk = candidate.status === 'blocked' || candidate.status === 'missing'
      ? 0.8
      : candidate.status === 'degraded'
        ? 0.45
        : candidate.status === 'guarded'
          ? 0.18
          : 0.08;
    return clamp(statusRisk + qflushGuard);
  }

  if (candidate.kind === 'action') return actionRisk(candidate.action);

  const actions = candidate.actions || [];
  const actionAverage = actions.length
    ? actions.reduce((sum, action) => sum + actionRisk(action), 0) / actions.length
    : 0.12;
  const missingRisk = (candidate.missingModules || []).length ? 0.55 : 0;
  return clamp(actionAverage + missingRisk);
}

function laneScore(candidate = {}, preferredLanes = []) {
  const lanes = candidate.lanes || candidate.modules?.map((moduleInfo) => moduleInfo.lane) || [candidate.lane];
  if (!preferredLanes.length) return 0.2;
  const hits = unique(lanes).filter((lane) => preferredLanes.includes(lane));
  return clamp(hits.length / Math.max(1, Math.min(preferredLanes.length, 4)));
}

function readinessScore(candidate = {}) {
  if (candidate.ready === true) return 1;
  if (candidate.installed === true) return 0.85;
  if (candidate.status === 'ready') return 1;
  if (candidate.status === 'guarded') return 0.82;
  if (candidate.status === 'degraded') return 0.45;
  if (candidate.status === 'blocked' || candidate.status === 'missing') return 0.05;
  return 0.65;
}

function healthScore(candidate = {}, doctorByModule = new Map()) {
  if (candidate.kind === 'module') return (candidate.score || 75) / 100;
  const moduleIds = candidate.moduleIds || candidate.modules?.map((moduleInfo) => moduleInfo.id) || [];
  if (!moduleIds.length) return 0.75;
  const scores = moduleIds.map((id) => doctorByModule.get(id)?.score || 75);
  return scores.reduce((sum, score) => sum + score, 0) / (scores.length * 100);
}

function estimateCost(candidate = {}) {
  const moduleCount = candidate.moduleIds?.length || candidate.modules?.length || 1;
  const actionCount = candidate.actions?.length || (candidate.action ? 1 : 0);
  return clamp((moduleCount * 0.035) + (actionCount * 0.06));
}

function estimateLatency(candidate = {}) {
  const actionCount = candidate.actions?.length || (candidate.action ? 1 : 0);
  const commandText = candidate.commands?.join(' ') || candidate.action?.command || '';
  const testPenalty = /test|briefing|sync/i.test(commandText) ? 0.12 : 0;
  return clamp((actionCount * 0.08) + testPenalty);
}

function candidateText(candidate = {}) {
  return [
    candidate.id,
    candidate.name,
    candidate.kind,
    candidate.goal,
    candidate.role,
    candidate.lane,
    ...(candidate.triggers || []),
    ...(candidate.outputs || []),
    ...(candidate.guardrails || []),
    ...(candidate.lanes || []),
    ...(candidate.moduleIds || []),
    ...(candidate.commands || []),
  ].join(' ');
}

function buildCandidates(chopperStatus = {}) {
  const doctorByModule = new Map((chopperStatus.doctor?.modules || []).map((moduleInfo) => [moduleInfo.id, moduleInfo]));
  const recipeCandidates = (chopperStatus.recipes || []).map((recipe) => ({
    kind: 'recipe',
    id: recipe.id,
    name: recipe.name,
    goal: recipe.goal,
    ready: recipe.ready,
    status: recipe.status,
    moduleIds: recipe.modules.map((moduleInfo) => moduleInfo.id),
    modules: recipe.modules,
    actions: recipe.actions,
    workerIds: recipe.workerIds,
    commands: recipe.commands,
    outputs: recipe.outputs,
    triggers: recipe.triggers,
    guardrails: recipe.guardrails,
    combinationId: recipe.combinationId,
    combinationName: recipe.combinationName,
    missingModules: recipe.missingModules,
  }));

  const rumbleCandidates = (chopperStatus.rumbleCombinations || []).map((combo) => ({
    kind: 'rumble',
    id: combo.id,
    name: combo.name,
    goal: combo.operatingMode,
    ready: combo.ready,
    status: combo.ready ? 'ready' : 'blocked',
    moduleIds: combo.modules,
    lanes: combo.lanes,
    outputs: combo.produces,
    triggers: combo.unlocks,
    guardrails: combo.guardrails,
    missingModules: combo.missingModules,
  }));

  const moduleCandidates = (chopperStatus.modules || []).map((node) => {
    const doctor = doctorByModule.get(node.id) || {};
    return {
      kind: 'module',
      id: node.id,
      name: node.name,
      goal: node.role,
      role: node.role,
      lane: node.lane,
      lanes: [node.lane],
      installed: node.installed,
      ready: node.installed && !['blocked', 'missing'].includes(doctor.status),
      status: doctor.status || (node.installed ? 'ready' : 'missing'),
      score: doctor.score || 0,
      moduleIds: [node.id],
      outputs: node.produces || [],
      triggers: [...(node.consumes || []), ...(node.capabilities || [])],
      guardrails: node.id === 'qflush' ? ['controlled-runner-only'] : [],
      warnings: node.warnings || [],
    };
  });

  const actionCandidates = (chopperStatus.actionPlan?.actions || []).map((action) => ({
    kind: 'action',
    id: action.id,
    name: action.id,
    goal: action.summary,
    ready: action.status === 'ready',
    status: action.status || 'ready',
    action,
    actions: [action],
    workerIds: action.workerId ? [action.workerId] : [],
    commands: [action.command].filter(Boolean),
    outputs: [action.mode],
    triggers: [action.summary],
    guardrails: action.mode === 'dry-run' ? ['dry-run-before-write'] : [],
  }));

  const mcpCandidates = Object.entries(chopperStatus.mcpContract || {})
    .filter(([, value]) => typeof value === 'string' && value.startsWith('a11_'))
    .map(([key, tool]) => ({
      kind: 'mcp-tool',
      id: tool,
      name: tool,
      goal: `MCP contract endpoint for ${key}`,
      ready: true,
      status: 'ready',
      outputs: ['mcp-contract'],
      triggers: [key, tool],
      guardrails: ['mcp-contract-only'],
    }));

  return [
    ...recipeCandidates,
    ...rumbleCandidates,
    ...moduleCandidates,
    ...actionCandidates,
    ...mcpCandidates,
  ];
}

function scoreCandidate(candidate = {}, intent = {}, tokens = [], doctorByModule = new Map()) {
  const preferredRecipes = intent.preferredRecipes || [];
  const preferredLanes = intent.preferredLanes || [];
  const relevance = clamp(
    textScore(tokens, candidateText(candidate))
    + (preferredRecipes.includes(candidate.id) ? 0.35 : 0)
    + (candidate.combinationId && preferredRecipes.includes(candidate.combinationId) ? 0.15 : 0)
  );
  const capability = clamp(laneScore(candidate, preferredLanes) + (candidate.kind === 'recipe' ? 0.12 : 0));
  const health = healthScore(candidate, doctorByModule);
  const readiness = readinessScore(candidate);
  const risk = candidateRisk(candidate);
  const cost = estimateCost(candidate);
  const latency = estimateLatency(candidate);
  const final = clamp(
    (relevance * 0.38)
    + (capability * 0.22)
    + (health * 0.18)
    + (readiness * 0.12)
    - (risk * 0.07)
    - (cost * 0.02)
    - (latency * 0.01)
  );

  return {
    relevance: round(relevance),
    capability: round(capability),
    health: round(health),
    readiness: round(readiness),
    risk: round(risk),
    cost: round(cost),
    latency: round(latency),
    final: Math.round(final * 100),
  };
}

function buildSelection(ranked = [], intent = {}) {
  const topRecipe = ranked.find((candidate) => candidate.kind === 'recipe') || null;
  const topRumble = ranked.find((candidate) => candidate.kind === 'rumble') || null;
  const modules = ranked.filter((candidate) => candidate.kind === 'module').slice(0, 6);
  const tools = ranked.filter((candidate) => candidate.kind === 'mcp-tool').slice(0, 4);
  const actions = topRecipe?.actions?.length
    ? topRecipe.actions
    : ranked.filter((candidate) => candidate.kind === 'action').slice(0, 5).flatMap((candidate) => candidate.actions || []);
  const workerIds = unique([
    ...(topRecipe?.workerIds || []),
    ...actions.map((action) => action.workerId).filter(Boolean),
  ]);
  const commands = unique([
    ...(topRecipe?.commands || []),
    ...actions.map((action) => action.command).filter(Boolean),
  ]);
  const guardrails = unique([
    ...(topRecipe?.guardrails || []),
    ...(topRumble?.guardrails || []),
    'no-shell-free-for-all',
    'secret-redaction',
    'dry-run-before-write',
  ]).sort();

  return {
    primaryIntent: intent.id,
    primaryRecipe: topRecipe ? {
      id: topRecipe.id,
      name: topRecipe.name,
      score: topRecipe.score.final,
      status: topRecipe.status,
    } : null,
    primaryRumble: topRumble ? {
      id: topRumble.id,
      name: topRumble.name,
      score: topRumble.score.final,
      status: topRumble.status,
    } : null,
    modules: modules.map((moduleInfo) => ({
      id: moduleInfo.id,
      lane: moduleInfo.lane,
      status: moduleInfo.status,
      score: moduleInfo.score.final,
    })),
    mcpTools: tools.map((tool) => tool.id),
    executionPlan: {
      dryRunFirst: commands.some((command) => !/dry-run|test:mcp|chopper:doctor|chopper:status|chopper:recipes|chopper:rumble/.test(command)),
      workerIds,
      commands,
      steps: actions.map((action, index) => ({
        index: index + 1,
        id: action.id,
        command: action.command,
        mode: action.mode,
        workerId: action.workerId,
        safeMode: /dry-run|read-only|read-mostly/.test(String(action.mode || '')),
      })),
    },
    guardrails,
  };
}

function buildMixerRoute(options = {}) {
  const request = String(options.request || DEFAULT_REQUEST).trim() || DEFAULT_REQUEST;
  const topN = Number.isFinite(Number(options.topN)) ? Math.max(1, Math.min(50, Number(options.topN))) : 12;
  const chopperStatus = options.chopperStatus || chopper.buildChopperStatus(options);
  const intent = detectIntent(request);
  const doctorByModule = new Map((chopperStatus.doctor?.modules || []).map((moduleInfo) => [moduleInfo.id, moduleInfo]));
  const candidates = buildCandidates(chopperStatus);
  const ranked = candidates.map((candidate) => ({
    ...candidate,
    score: scoreCandidate(candidate, intent.primary, intent.tokens, doctorByModule),
  })).sort((a, b) => b.score.final - a.score.final || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const topCandidates = ranked.slice(0, topN);
  const selection = buildSelection(ranked, intent.primary);

  return {
    ok: chopperStatus.ok,
    schema: SCHEMA,
    id: 'funesterie-mixer',
    name: 'Funesterie Mixer',
    generatedAt: nowIso(),
    request,
    source: {
      chopperSchema: chopperStatus.schema,
      chopperGeneratedAt: chopperStatus.generatedAt,
      doctorStatus: chopperStatus.summary?.doctorStatus,
      doctorScore: chopperStatus.summary?.doctorScore,
      modules: chopperStatus.summary?.modules,
      recipes: chopperStatus.summary?.rumbleRecipes,
    },
    intent,
    summary: {
      candidates: candidates.length,
      returned: topCandidates.length,
      topScore: topCandidates[0]?.score?.final || 0,
      primaryRecipe: selection.primaryRecipe?.id || null,
      primaryRumble: selection.primaryRumble?.name || null,
      dryRunFirst: selection.executionPlan.dryRunFirst,
    },
    selection,
    candidates: topCandidates.map((candidate) => ({
      kind: candidate.kind,
      id: candidate.id,
      name: candidate.name,
      status: candidate.status,
      score: candidate.score,
      goal: candidate.goal,
      lanes: candidate.lanes || (candidate.lane ? [candidate.lane] : []),
      commands: candidate.commands || [],
      workerIds: candidate.workerIds || [],
      guardrails: candidate.guardrails || [],
    })),
  };
}

function buildMixerStatus(options = {}) {
  const route = buildMixerRoute({
    ...options,
    request: options.request || DEFAULT_REQUEST,
    topN: options.topN || 12,
  });
  return {
    ok: route.ok,
    schema: SCHEMA,
    id: route.id,
    name: route.name,
    generatedAt: route.generatedAt,
    runtimeRoot: chopper.resolveRuntimeRoot(options),
    summary: route.summary,
    source: route.source,
    defaultRoute: {
      request: route.request,
      intent: route.intent.primary,
      selection: route.selection,
      candidates: route.candidates,
    },
    scoring: {
      formula: 'relevance*0.38 + capability*0.22 + health*0.18 + readiness*0.12 - risk*0.07 - cost*0.02 - latency*0.01',
      candidateKinds: ['recipe', 'rumble', 'module', 'action', 'mcp-tool'],
      guardrails: ['no-shell-free-for-all', 'secret-redaction', 'dry-run-before-write', 'module-index-first'],
    },
    mcpContract: {
      statusTool: 'a11_funesterie_mixer_status',
      routeTool: 'a11_funesterie_mixer_route',
      chopperStatusTool: 'a11_chopper_status',
      chopperRecipesTool: 'a11_chopper_recipes',
      workerStatusTool: 'a11_worker_status',
    },
  };
}

function buildMarkdown(routeOrStatus = {}) {
  const isStatus = Boolean(routeOrStatus.defaultRoute);
  const route = isStatus ? routeOrStatus.defaultRoute : routeOrStatus;
  const summary = isStatus ? routeOrStatus.summary : routeOrStatus.summary;
  const selection = route.selection || {};
  const candidates = route.candidates || [];
  const lines = [
    '# Funesterie Mixer',
    '',
    `Generated: ${routeOrStatus.generatedAt || nowIso()}`,
    `Status: ${routeOrStatus.ok ? 'OK' : 'NEEDS_ATTENTION'}`,
    '',
    '## Request',
    '',
    route.request || DEFAULT_REQUEST,
    '',
    '## Intent',
    '',
    `- Primary: ${route.intent?.label || route.intent?.primary?.label || 'Unknown'}`,
    `- Score: ${route.intent?.score ?? route.intent?.primary?.score ?? 'n/a'}`,
    '',
    '## Selection',
    '',
    `- Recipe: ${selection.primaryRecipe ? `${selection.primaryRecipe.name} (${selection.primaryRecipe.score})` : 'none'}`,
    `- Rumble: ${selection.primaryRumble ? `${selection.primaryRumble.name} (${selection.primaryRumble.score})` : 'none'}`,
    `- Dry-run first: ${selection.executionPlan?.dryRunFirst ? 'yes' : 'no'}`,
    '',
    '## Commands',
    '',
  ];

  for (const command of selection.executionPlan?.commands || []) {
    lines.push(`- ${command}`);
  }
  if (!(selection.executionPlan?.commands || []).length) lines.push('- none');

  lines.push('', '## Top Candidates', '');
  for (const candidate of candidates) {
    lines.push(`- ${candidate.kind}:${candidate.id} score=${candidate.score?.final} status=${candidate.status}`);
  }

  lines.push('', '## Guardrails', '');
  for (const guardrail of selection.guardrails || []) {
    lines.push(`- ${guardrail}`);
  }

  lines.push('', '## Summary', '');
  lines.push(`- Candidates: ${summary?.candidates || 0}`);
  lines.push(`- Returned: ${summary?.returned || 0}`);
  lines.push(`- Top score: ${summary?.topScore || 0}`);
  lines.push('', 'No secrets, tokens, passwords or raw environment values belong in this artifact.', '');
  return lines.join('\n');
}

async function writeMixerArtifacts(routeOrStatus, options = {}) {
  const runtimeRoot = chopper.resolveRuntimeRoot(options);
  const jsonPath = mixerJsonPath(runtimeRoot);
  const markdownPath = mixerMarkdownPath(runtimeRoot);
  await fsp.mkdir(path.dirname(jsonPath), { recursive: true });
  await fsp.writeFile(jsonPath, `${JSON.stringify(routeOrStatus, null, 2)}\n`, 'utf8');
  await fsp.writeFile(markdownPath, buildMarkdown(routeOrStatus), 'utf8');
  return {
    jsonPath,
    markdownPath,
  };
}

module.exports = {
  DEFAULT_REQUEST,
  INTENT_RULES,
  buildCandidates,
  buildMarkdown,
  buildMixerRoute,
  buildMixerStatus,
  detectIntent,
  mixerJsonPath,
  mixerMarkdownPath,
  scoreCandidate,
  writeMixerArtifacts,
};
