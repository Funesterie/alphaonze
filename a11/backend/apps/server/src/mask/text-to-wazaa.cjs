// text-to-wazaa.cjs
// SCREAM -> WAZAA via semantic hierarchy V1 + LLM enrichment fallback
//
// Default export is async: heuristic first, then LLM enrichment if needed.
// Use textToWazaa.sync(text, opts) for synchronous-only callers (no LLM).

const semanticToWazaa = require('./semantic/semantic-to-wazaa.cjs');
const { resolveTextToWazaa } = require('./resolve-text-to-wazaa.cjs');
const {
  attachRequestTextSmootherMeta,
  smoothRequestText,
  smoothRequestTextSync,
} = require('../knowledge/request-text-smoother.cjs');

function textToWazaaSync(text, opts = {}) {
  const requestTextSmootherResult = opts.requestTextSmootherResult || smoothRequestTextSync(text, {
    source: opts.source || 'text-to-wazaa',
    enableLlm: false,
  });
  const heuristic = semanticToWazaa(requestTextSmootherResult.text, opts);
  return attachRequestTextSmootherMeta(heuristic, requestTextSmootherResult);
}

async function textToWazaa(text, opts = {}) {
  const requestTextSmootherResult = opts.requestTextSmootherResult || await smoothRequestText(text, {
    source: opts.source || 'text-to-wazaa',
  });
  const heuristic = semanticToWazaa(requestTextSmootherResult.text, opts);
  const enriched = await resolveTextToWazaa(requestTextSmootherResult.text, heuristic);
  return attachRequestTextSmootherMeta(enriched, requestTextSmootherResult);
}

textToWazaa.sync = textToWazaaSync;

module.exports = textToWazaa;
