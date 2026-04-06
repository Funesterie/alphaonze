// adapt-mask-to-freeland-value.cjs
// Adaptateur MASK -> FreelandValue canonique

/**
 * Adapte un MASK image.generate et son resultat compile en FreelandValue.
 * Si compiled est deja un FreelandValue, il est re-normalise sans double wrapping.
 * @param {object} mask - L'objet MASK d'origine
 * @param {object} compiled - Le resultat du compilateur (ex: SD payload brut)
 * @returns {object} FreelandValue { kind, state, value, meta }
 */
function isFreelandValue(value) {
  return !!(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.kind === 'string'
    && typeof value.state === 'string'
    && 'value' in value
  );
}

function adaptMaskToFreelandValue(mask, compiled) {
  const existing = isFreelandValue(compiled) ? compiled : null;
  const compiledValue = existing ? existing.value : compiled;
  const existingMeta = existing && existing.meta && typeof existing.meta === 'object'
    ? existing.meta
    : {};

  return {
    kind: String(mask?.intent || existing?.kind || 'image.generate'),
    state: String(existing?.state || 'ready'),
    value: compiledValue && typeof compiledValue === 'object' ? compiledValue : {},
    meta: {
      ...existingMeta,
      maskVersion: mask?.version || existingMeta.maskVersion || null,
      compilerTarget: mask?.compiler?.target || existingMeta.compilerTarget || null,
      compilerVersion: mask?.compiler?.version || existingMeta.compilerVersion || null,
      createdAt: existingMeta.createdAt || new Date().toISOString(),
    }
  };
}

module.exports = adaptMaskToFreelandValue;
