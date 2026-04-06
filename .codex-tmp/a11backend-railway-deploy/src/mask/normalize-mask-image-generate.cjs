// normalize-mask-image-generate.cjs
// Remplit les valeurs par défaut et corrige les types pour MASK image.generate

const DEFAULTS = {
  version: 'mask-1',
  intent: 'image.generate',
  task: { domain: 'image', action: 'generate' },
  compiler: { target: 'python', version: '1.0' },
  inputs: {
    subject: [],
    environment: [],
    style: [],
    composition: [],
    lighting: [],
    palette: []
  },
  options: {
    width: 768,
    height: 768,
    steps: 30,
    guidance_scale: 7.5
  },
  constraints: {
    safe_mode: true,
    no_text: true
  },
  ambiguities: [],
  raw: ''
};

function normalizeMaskImageGenerate(mask) {
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  if (!mask || typeof mask !== 'object') return out;
  for (const k of Object.keys(DEFAULTS)) {
    if (mask[k] !== undefined) out[k] = mask[k];
  }
  // Deep merge for nested objects/arrays
  for (const k of ['inputs','options','constraints']) {
    if (mask[k] && typeof mask[k] === 'object') {
      for (const sub of Object.keys(DEFAULTS[k])) {
        if (mask[k][sub] !== undefined) out[k][sub] = mask[k][sub];
      }
    }
  }
  // Force arrays for inputs
  for (const arr of ['subject','environment','style','composition','lighting','palette']) {
    if (!Array.isArray(out.inputs[arr])) out.inputs[arr] = [String(out.inputs[arr]||'')].filter(Boolean);
    out.inputs[arr] = out.inputs[arr].map(x => String(x).trim()).filter(Boolean);
  }
  // Clamp options
  out.options.width = Math.max(64, Math.min(1024, Number(out.options.width)||768));
  out.options.height = Math.max(64, Math.min(1024, Number(out.options.height)||768));
  out.options.steps = Math.max(1, Math.min(100, Number(out.options.steps)||30));
  out.options.guidance_scale = Math.max(1, Math.min(30, Number(out.options.guidance_scale)||7.5));
  return out;
}

module.exports = normalizeMaskImageGenerate;
