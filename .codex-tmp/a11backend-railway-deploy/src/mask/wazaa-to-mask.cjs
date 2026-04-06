// wazaa-to-mask.cjs
// Transforme un objet WAZAA v1 en MASK image.generate strict

/**
 * Convertit une structure WAZAA v1 en MASK image.generate strict
 * @param {object} wazaa
 * @returns {object|null} MASK image.generate ou null si non reconnu
 */
function wazaaToMask(wazaa) {
  if (!wazaa || typeof wazaa !== 'object') return null;
  const intent = wazaa.intent?.type || wazaa.intents?.[0]?.type || 'image.generate';
  if (intent !== 'image.generate') return null;
  // Extraction des entités par rôle
  const subject = (wazaa.entities || []).find(e => e.role === 'subject')?.value || '';
  const attribute = (wazaa.entities || []).find(e => e.role === 'attribute')?.value || '';
  const environment = (wazaa.entities || []).find(e => e.role === 'environment')?.value || '';
  // Style simple (à raffiner)
  const style = attribute ? [attribute] : ["high quality", "detailed"];
  // Options par défaut (à raffiner selon signal ou meta)
  const width = 768;
  const height = 768;
  const steps = 40;
  const guidance_scale = 8;
  return {
    version: "mask-1",
    intent,
    task: { domain: "image", action: "generate" },
    compiler: { target: "sd-payload", version: "1.0" },
    inputs: {
      subject: subject ? [subject] : [],
      environment: environment ? [environment] : [],
      style,
      composition: [],
      lighting: [],
      palette: []
    },
    options: {
      width,
      height,
      steps,
      guidance_scale
    },
    constraints: {
      safe_mode: true,
      no_text: true
    },
    ambiguities: Array.isArray(wazaa.ambiguities) ? wazaa.ambiguities : [],
    raw: String(wazaa.meta?.sourceText || '').trim()
  };
}

module.exports = wazaaToMask;
