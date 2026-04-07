const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isLlmEnrichmentEnabled,
} = require('../src/mask/resolve-text-to-wazaa.cjs');

test('isLlmEnrichmentEnabled ignores generic OPENAI_API_KEY by default', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  process.env.A11_TRANSLATION_API_KEY = '';
  process.env.A11_OPENAI_API_KEY = '';
  process.env.OPENAI_API_KEY = 'sk-generic';

  try {
    assert.equal(isLlmEnrichmentEnabled(), false);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_TRANSLATION_API_KEY = previous.A11_TRANSLATION_API_KEY;
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
  }
});

test('isLlmEnrichmentEnabled still supports explicit scoped translation keys', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  process.env.A11_TRANSLATION_API_KEY = 'sk-translation';
  process.env.A11_OPENAI_API_KEY = '';

  try {
    assert.equal(isLlmEnrichmentEnabled(), true);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_TRANSLATION_API_KEY = previous.A11_TRANSLATION_API_KEY;
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
  }
});
