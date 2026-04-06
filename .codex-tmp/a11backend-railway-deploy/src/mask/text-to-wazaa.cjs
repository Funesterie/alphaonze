// text-to-wazaa.cjs
// SCREAM -> WAZAA via semantic hierarchy V1

const semanticToWazaa = require('./semantic/semantic-to-wazaa.cjs');

function textToWazaa(text, opts = {}) {
  return semanticToWazaa(text, opts);
}

module.exports = textToWazaa;
