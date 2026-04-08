function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function localizeList(values = []) {
  return normalizeList(Array.isArray(values) ? values : [values]);
}

function normalizeList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function joinPromptSections(values = []) {
  return (Array.isArray(values) ? values : [values])
    .map((entry) => normalizeText(String(entry || '').replace(/[.。\s]+$/g, '')))
    .filter(Boolean)
    .join('. ');
}

function joinSection(label, values = []) {
  const entries = normalizeList(values);
  if (!entries.length) return '';
  return `${label} : ${entries.join(', ')}`;
}

function buildLiteralInstructions(mask = {}) {
  const instructions = [
    'Créer une image fidèle à la demande.',
    'Mettre le sujet principal en avant avec une scène claire et naturelle.',
  ];

  if (Array.isArray(mask?.inputs?.palette) && mask.inputs.palette.length > 0) {
    instructions.push("Utiliser les couleurs demandées sur le sujet principal.");
  }

  if (mask?.constraints?.no_text === true) {
    instructions.push("Garder l'image visuelle, sans texte lisible.");
  }

  return instructions.join(' ');
}

function compileMaskToImagePrompt(mask = {}) {
  const rawPrompt = normalizeText(mask?.raw || '');
  const subject = localizeList(mask?.inputs?.subject || []);
  const environment = localizeList(mask?.inputs?.environment || []);
  const style = localizeList(mask?.inputs?.style || []);
  const composition = localizeList(mask?.inputs?.composition || []);
  const lighting = localizeList(mask?.inputs?.lighting || []);
  const palette = localizeList(mask?.inputs?.palette || []);

  const promptSections = [
    rawPrompt ? `Demande : ${rawPrompt}` : '',
    joinSection('Sujet principal', subject),
    joinSection('Environnement', environment),
    joinSection('Style', style),
    joinSection('Couleurs', palette),
    buildLiteralInstructions(mask),
  ].filter(Boolean);

  return {
    prompt: joinPromptSections(promptSections),
    prompt_language: 'fr',
    prompt_prebuilt: true,
    width: Number(mask?.options?.width || 768),
    height: Number(mask?.options?.height || 768),
    num_inference_steps: Number(mask?.options?.steps || 40),
    guidance_scale: Number(mask?.options?.guidance_scale || 8),
    ...(mask?.options?.seed !== undefined ? { seed: Number(mask.options.seed) } : {}),
  };
}

module.exports = compileMaskToImagePrompt;
