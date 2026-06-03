'use strict';

const zenModule = require('./modules/format.zen.container.module.json');
const { normalizeText } = require('../image/prompt-builder.cjs');

function listZenLayers() {
  return Array.isArray(zenModule.knowledge?.layers)
    ? zenModule.knowledge.layers.map((entry) => ({ ...entry }))
    : [];
}

function listZenPipeline() {
  return Array.isArray(zenModule.knowledge?.pipeline)
    ? zenModule.knowledge.pipeline.map((entry) => ({ ...entry }))
    : [];
}

function isZenPrompt(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return [
    'zen',
    '.zen',
    'nez inverse',
    'zero-exposed nez',
    'zip inverse',
    'archive chiffree',
    'conteneur opaque',
    'conteneur chiffre',
    'dump nez',
    'cube rgba',
    'cubes couleur',
    'multi-load',
  ].some((keyword) => normalized.includes(keyword));
}

function buildZenContext(text = '') {
  return {
    id: zenModule.id,
    label: zenModule.label,
    isZenPrompt: isZenPrompt(text),
    canonicalDefinition: zenModule.knowledge?.canonicalDefinition || '',
    shortDefinition: zenModule.knowledge?.shortDefinition || '',
    publicHeader: zenModule.knowledge?.publicHeader || {},
    layers: listZenLayers(),
    pipeline: listZenPipeline(),
    guidance: zenModule.knowledge?.methods || [],
    commonErrors: zenModule.knowledge?.commonErrors || [],
  };
}

module.exports = {
  ZEN_CONTAINER_FORMAT: zenModule,
  buildZenContext,
  isZenPrompt,
  listZenLayers,
  listZenPipeline,
};
