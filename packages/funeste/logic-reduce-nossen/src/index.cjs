'use strict';

const path = require('path');

function loadLogicReduce() {
  try {
    return require('@nossen/logic-reduce');
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return require(path.join(__dirname, '..', '..', '..', 'nossen', 'logic-reduce', 'src', 'index.cjs'));
  }
}

const {
  DEFAULT_GUARD_PATTERNS,
  DEFAULT_NOISE_PATTERNS,
  formatReducedPlan,
  logicReduce
} = loadLogicReduce();

const NOSSEN_GUARD_PATTERNS = [
  ...DEFAULT_GUARD_PATTERNS,
  /\bpreflight\b/i,
  /\bmcp\b/i,
  /\bneo4j\b/i,
  /\baura\b/i,
  /\bgithub\b/i,
  /\bpr\b/i,
  /\bpublish\b/i,
  /\bnpm\b/i,
  /\bregistry\b/i,
  /\bdeploy\b/i,
  /\bprod\b/i,
  /\bpayment\b/i,
  /\bwebhook\b/i
];

const NOSSEN_NOISE_PATTERNS = [
  ...DEFAULT_NOISE_PATTERNS,
  /\bchange org at random\b/i,
  /\bcopy token\b/i,
  /\bpaste secret\b/i,
  /\bskip check\b/i,
  /\bforce publish\b/i,
  /\bmerge blind\b/i
];

const NOSSEN_HARD_DROP_PATTERNS = [
  /\bchange org at random\b/i,
  /\bcopy token\b/i,
  /\bpaste secret\b/i,
  /\bskip check\b/i,
  /\bforce publish\b/i,
  /\bmerge blind\b/i
];

const NOSSEN_REQUIRED_GUARDS = [
  'read NOSSEN preflight before infra/auth/deploy/npm claims',
  'do not display or commit secrets',
  'patch exact source files',
  'run targeted package tests',
  'verify registry or PR checks before saying done'
];

function reduceNossenHandoff(input, options = {}) {
  const base = logicReduce(input, {
    ...options,
    guardPatterns: options.guardPatterns || NOSSEN_GUARD_PATTERNS,
    noisePatterns: options.noisePatterns || NOSSEN_NOISE_PATTERNS
  });

  const hardDropPatterns = options.hardDropPatterns || NOSSEN_HARD_DROP_PATTERNS;
  const hardDropped = base.classified
    .filter((step) => step.action === 'keep' && hardDropPatterns.some((pattern) => pattern.test(step.text)))
    .map((step) => ({
      text: step.text,
      reason: 'private-forbidden-step'
    }));
  const hardDropText = new Set(hardDropped.map((step) => step.text));
  const directPath = base.directPath.filter((step) => !hardDropText.has(step));
  const dropped = [...base.dropped, ...hardDropped];
  const safeguards = base.safeguards.filter((step) => !hardDropText.has(step));

  const result = {
    ...base,
    keptCount: directPath.length,
    droppedCount: dropped.length,
    directPath,
    dropped,
    safeguards,
    summary: `kept ${directPath.length}/${base.inputCount} steps; dropped ${dropped.length} detour(s)`
  };

  const present = new Set(result.directPath.map((step) => step.toLowerCase()));
  const requiredGuards = NOSSEN_REQUIRED_GUARDS.filter((guard) => !present.has(guard.toLowerCase()));

  return {
    ...result,
    lane: 'private-nossen',
    requiredGuards,
    recommendedPath: [
      ...requiredGuards,
      ...result.directPath
    ]
  };
}

function formatNossenHandoff(result) {
  const base = formatReducedPlan(result).trimEnd();
  const lines = [base, 'Required NOSSEN guards:'];
  for (const guard of result.requiredGuards) {
    lines.push(`- ${guard}`);
  }
  lines.push('Recommended path:');
  for (const step of result.recommendedPath) {
    lines.push(`- ${step}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  NOSSEN_GUARD_PATTERNS,
  NOSSEN_HARD_DROP_PATTERNS,
  NOSSEN_NOISE_PATTERNS,
  NOSSEN_REQUIRED_GUARDS,
  formatNossenHandoff,
  reduceNossenHandoff
};
