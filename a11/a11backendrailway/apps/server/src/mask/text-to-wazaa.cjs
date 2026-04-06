// text-to-wazaa.cjs
// SCREAM -> WAZAA via semantic hierarchy V1 + LLM enrichment fallback
//
// Default export is async: heuristic first, then LLM enrichment if needed.
// Use textToWazaa.sync(text, opts) for synchronous-only callers (no LLM).

const semanticToWazaa = require('./semantic/semantic-to-wazaa.cjs');
const { resolveTextToWazaa } = require('./resolve-text-to-wazaa.cjs');

function textToWazaaSync(text, opts = {}) {
  return semanticToWazaa(text, opts);
}

async function textToWazaa(text, opts = {}) {
  const heuristic = semanticToWazaa(text, opts);
  return resolveTextToWazaa(text, heuristic);
}

textToWazaa.sync = textToWazaaSync;

module.exports = textToWazaa;
