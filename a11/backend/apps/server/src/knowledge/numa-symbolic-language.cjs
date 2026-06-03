'use strict';

const numaModule = require('./modules/language.numa.symbolic.module.json');
const { normalizeText } = require('../image/prompt-builder.cjs');

function listNumaValues() {
  return Array.isArray(numaModule.knowledge?.numberValues)
    ? numaModule.knowledge.numberValues.map((entry) => ({ ...entry }))
    : [];
}

function lookupNumaToken(token) {
  const wanted = String(token || '').trim();
  if (!wanted) return null;
  return listNumaValues().find((entry) => String(entry.token) === wanted) || null;
}

function extractNumaTokens(text = '') {
  const normalized = String(text || '');
  const tokens = new Set();
  for (const match of normalized.matchAll(/(?<!\d)\d{1,4}(?!\d)/g)) {
    const value = lookupNumaToken(match[0]);
    if (value) tokens.add(value.token);
  }
  return Array.from(tokens).map(lookupNumaToken).filter(Boolean);
}

function isNumaPrompt(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return [
    'numa',
    'force des nombres',
    'valeur des numeros',
    'valeur des chiffres',
    'langage secret',
    'langage abstrait',
    'code numerique',
    'maison blanche 1600',
    'ghost88',
    'entera',
    'ligne magenta',
  ].some((keyword) => normalized.includes(keyword));
}

function buildNumaContext(text = '') {
  const tokens = extractNumaTokens(text);
  return {
    id: numaModule.id,
    label: numaModule.label,
    isNumaPrompt: isNumaPrompt(text),
    tokens,
    guidance: numaModule.knowledge?.methods || [],
    commonErrors: numaModule.knowledge?.commonErrors || [],
  };
}

module.exports = {
  NUMA_SYMBOLIC_LANGUAGE: numaModule,
  buildNumaContext,
  extractNumaTokens,
  isNumaPrompt,
  listNumaValues,
  lookupNumaToken,
};
