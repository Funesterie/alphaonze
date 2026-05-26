'use strict';

const DEFAULT_NOISE_PATTERNS = [
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\bcrash(?:ed|es|ing)?\b/i,
  /\bfail(?:ed|s|ing)?\b/i,
  /\bfailure\b/i,
  /\berror loop\b/i,
  /\bhang(?:s|ing)?\b/i,
  /\bblocked\b/i,
  /\bstale\b/i,
  /\bdead end\b/i,
  /\bdetour\b/i,
  /\bduplicate\b/i,
  /\bretry\b/i,
  /\brebuild everything\b/i,
  /\brewrite all\b/i
];

const DEFAULT_GUARD_PATTERNS = [
  /\bpreflight\b/i,
  /\bverify\b/i,
  /\bcheck\b/i,
  /\btest\b/i,
  /\baudit\b/i,
  /\breview\b/i,
  /\bauth\b/i,
  /\bsecret\b/i,
  /\bcredential\b/i,
  /\btoken\b/i,
  /\bbackup\b/i,
  /\brollback\b/i,
  /\bconsent\b/i,
  /\bapproval\b/i
];

function normalizeStepText(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSteps(input) {
  if (Array.isArray(input)) {
    return input
      .map((item, index) => {
        const text = typeof item === 'object' && item !== null
          ? normalizeStepText(item.text || item.step || item.label || item.name)
          : normalizeStepText(item);
        return text ? { index, text } : null;
      })
      .filter(Boolean);
  }

  return String(input || '')
    .split(/\r?\n|(?:\s*(?:->|=>|\+|;)\s*)/g)
    .map((item, index) => {
      const text = normalizeStepText(item);
      return text ? { index, text } : null;
    })
    .filter(Boolean);
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) {
      return pattern.test(text);
    }
    return text.toLowerCase().includes(String(pattern).toLowerCase());
  });
}

function classifyStep(step, options = {}) {
  const noisePatterns = options.noisePatterns || DEFAULT_NOISE_PATTERNS;
  const guardPatterns = options.guardPatterns || DEFAULT_GUARD_PATTERNS;
  const isGuard = matchesAny(step.text, guardPatterns);
  const isNoise = matchesAny(step.text, noisePatterns);

  if (isGuard) {
    return {
      ...step,
      action: 'keep',
      reason: isNoise ? 'safety-guard-overrides-noise' : 'safety-guard'
    };
  }

  if (isNoise) {
    return {
      ...step,
      action: 'drop',
      reason: 'known-detour'
    };
  }

  return {
    ...step,
    action: 'keep',
    reason: 'direct-step'
  };
}

function logicReduce(input, options = {}) {
  const steps = parseSteps(input);
  const classified = steps.map((step) => classifyStep(step, options));
  const kept = classified.filter((step) => step.action === 'keep');
  const dropped = classified.filter((step) => step.action === 'drop');
  const safeguards = kept.filter((step) => step.reason.includes('safety'));

  return {
    objective: normalizeStepText(options.objective || ''),
    inputCount: steps.length,
    keptCount: kept.length,
    droppedCount: dropped.length,
    directPath: kept.map((step) => step.text),
    dropped: dropped.map((step) => ({
      text: step.text,
      reason: step.reason
    })),
    safeguards: safeguards.map((step) => step.text),
    classified,
    summary: `kept ${kept.length}/${steps.length} steps; dropped ${dropped.length} detour(s)`
  };
}

function formatReducedPlan(result) {
  const lines = [];
  if (result.objective) {
    lines.push(`Objective: ${result.objective}`);
  }
  lines.push(`Summary: ${result.summary}`);
  lines.push('Direct path:');
  for (const step of result.directPath) {
    lines.push(`- ${step}`);
  }
  if (result.dropped.length) {
    lines.push('Dropped:');
    for (const item of result.dropped) {
      lines.push(`- ${item.text} (${item.reason})`);
    }
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  DEFAULT_GUARD_PATTERNS,
  DEFAULT_NOISE_PATTERNS,
  classifyStep,
  formatReducedPlan,
  logicReduce,
  parseSteps
};
