// janus-spatial-strategy.cjs
// Interprète les manifests Janus via LLM pour produire une stratégie
// de génération spatiale : strength, zones, prompts SD3.
//
// Séquence : Janus (déjà exécuté) → LLM ici → SD après.
// Pas de pipeline parallèle, pas de contention VRAM.

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../mask/resolve-text-to-wazaa.cjs');

const VALID_STRENGTH_PROFILES = Object.freeze([
  'preserve',
  'balanced',
  'restyle',
]);

// json_schema not supported by llama-3.3-70b-versatile on Groq — structure is described in system prompt
const JANUS_STRATEGY_RESPONSE_FORMAT = Object.freeze({ type: 'json_object' });

const JANUS_STRATEGY_SYSTEM_PROMPT = `You are a spatial generation strategist for a Stable Diffusion 3.5 image pipeline.

You receive:
1. A Janus visual analysis of a reference image (characters, objects, anatomy, spatial relations, bounding boxes)
2. The user's canonical English generation request
3. The detected scene type

Your job is to decide HOW to generate the new image:
- What to PRESERVE from the reference (identity, pose, outfit, background, props)
- What to REWRITE (transform, replace, add)
- The global strength profile and per-component profiles
- Spatial prompt hints that will guide SD3 multi-prompt generation

Strength profiles:
- preserve (0.22-0.38): keep most of the reference, only light changes
- balanced (0.48-0.68): significant changes while keeping identity
- restyle (0.60-0.78): strong transformation, only identity anchor kept

Rules:
- If the user wants a transformation (new outfit, new scene, new style), use restyle for those components
- If the user wants to keep the person/character recognizable, use preserve for identity
- preserve_zones: short descriptions of what must stay the same (e.g. "face and hair", "sword in right hand")
- rewrite_zones: short descriptions of what must change (e.g. "full body armor", "background scene", "blue aura around blade")
- spatial_prompt_hints: concrete SD3 prompt fragments that describe the spatial transformation, including exact colors ("deep burgundy badge"), materials ("polished gold metal pin"), sizes relative to frame ("~10% frame width star shape"), and placement ("pinned to upper-left chest"). Examples: "blue energy aura surrounding the blade", "star-shaped polished gold badge ~8% frame width pinned center-left chest", "stone courtyard background replacing previous setting"
- Keep all text in English
- Be decisive: pick clear profiles, do not hedge with all-balanced

Return strict JSON only.`;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStrengthProfile(value = '', fallback = 'balanced') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_STRENGTH_PROFILES.includes(normalized) ? normalized : fallback;
}

function normalizeStringList(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function clamp01(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function buildManifestSummaryForLlm(manifest = {}) {
  const parts = [];

  const detected = normalizeText(manifest?.detected_content || '');
  if (detected) parts.push(`detected: ${detected}`);

  const role = normalizeText(manifest?.probable_role || '');
  if (role) parts.push(`role: ${role} (confidence ${Number(manifest?.confidence || 0).toFixed(2)})`);

  if (Array.isArray(manifest?.characters) && manifest.characters.length > 0) {
    for (const char of manifest.characters.slice(0, 3)) {
      const label = normalizeText(char?.label || 'character');
      const bbox = Array.isArray(char?.bbox) ? `bbox [${char.bbox.join(', ')}]` : '';
      const pose = normalizeText(char?.pose || '');
      const clothing = Array.isArray(char?.clothing) ? char.clothing.slice(0, 3).join(', ') : '';
      const anatomy = Array.isArray(char?.anatomy)
        ? char.anatomy.slice(0, 4).map((a) => {
          const part = normalizeText(a?.part || '');
          const side = normalizeText(a?.side || '');
          const state = normalizeText(a?.state || '');
          const abbox = Array.isArray(a?.bbox) ? `bbox [${a.bbox.join(', ')}]` : '';
          return [side, part, state ? `(${state})` : '', abbox].filter(Boolean).join(' ');
        }).filter(Boolean).join(', ')
        : '';
      parts.push([
        `character: ${label}`,
        bbox,
        pose ? `pose: ${pose}` : '',
        clothing ? `clothing: ${clothing}` : '',
        anatomy ? `anatomy: ${anatomy}` : '',
      ].filter(Boolean).join(' | '));
    }
  }

  if (Array.isArray(manifest?.objects) && manifest.objects.length > 0) {
    for (const obj of manifest.objects.slice(0, 6)) {
      const label = normalizeText(obj?.label || 'object');
      const bbox = Array.isArray(obj?.bbox) ? `bbox [${obj.bbox.join(', ')}]` : '';
      const attrs = Array.isArray(obj?.attributes) ? obj.attributes.slice(0, 5).join(', ') : '';
      parts.push([`object: ${label}`, bbox, attrs ? `[${attrs}]` : ''].filter(Boolean).join(' | '));
    }
  }

  if (Array.isArray(manifest?.relationships) && manifest.relationships.length > 0) {
    parts.push(`spatial relations: ${manifest.relationships.slice(0, 4).join('; ')}`);
  }

  return parts.join('\n');
}

function buildStrategyInput({
  manifests = [],
  canonicalRequest = '',
  sceneType = '',
  imageReferences = [],
} = {}) {
  const manifestSummaries = manifests
    .map((manifest, index) => {
      const ref = imageReferences[index] || {};
      const imageId = normalizeText(manifest?.image_id || ref?.image_id || `image-${index + 1}`);
      return `=== Reference image: ${imageId} ===\n${buildManifestSummaryForLlm(manifest)}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return JSON.stringify({
    janus_analysis: manifestSummaries || 'No Janus analysis available',
    user_request: normalizeText(canonicalRequest),
    scene_type: normalizeText(sceneType),
    instruction: 'Based on the Janus visual analysis and the user request, decide the generation strategy. Be specific about what to preserve and what to rewrite.',
  }, null, 2);
}

function normalizeStrategyResponse(response = null) {
  if (!response || typeof response !== 'object') return null;

  const globalProfile = normalizeStrengthProfile(response.global_strength_profile, 'balanced');
  const globalReason = normalizeText(response.global_strength_reason || 'llm_spatial_strategy');

  const rawComponents = response.component_profiles && typeof response.component_profiles === 'object'
    ? response.component_profiles
    : {};

  const componentProfiles = {
    identity: normalizeStrengthProfile(rawComponents.identity, globalProfile),
    anatomy: normalizeStrengthProfile(rawComponents.anatomy, globalProfile),
    outfit: normalizeStrengthProfile(rawComponents.outfit, globalProfile),
    background: normalizeStrengthProfile(rawComponents.background, globalProfile),
    effects: normalizeStrengthProfile(rawComponents.effects, 'restyle'),
    props: normalizeStrengthProfile(rawComponents.props, globalProfile),
  };

  return {
    globalStrengthProfile: globalProfile,
    globalStrengthReason: globalReason,
    componentProfiles,
    preserveZones: normalizeStringList(response.preserve_zones),
    rewriteZones: normalizeStringList(response.rewrite_zones),
    spatialPromptHints: normalizeStringList(response.spatial_prompt_hints),
    strategyConfidence: clamp01(response.strategy_confidence, 0.5),
    strategySource: 'janus_llm',
  };
}

function buildFallbackStrategy(manifests = []) {
  // Fallback si le LLM échoue : stratégie conservative basée sur le rôle Janus
  const primaryManifest = manifests[0] || {};
  const role = normalizeText(primaryManifest?.probable_role || '');

  const globalProfile = role === 'identity' ? 'preserve'
    : role === 'pose' ? 'balanced'
      : role === 'background' ? 'restyle'
        : 'balanced';

  return {
    globalStrengthProfile: globalProfile,
    globalStrengthReason: `janus_role_fallback:${role || 'unknown'}`,
    componentProfiles: {
      identity: role === 'identity' ? 'preserve' : 'balanced',
      anatomy: role === 'pose' ? 'preserve' : 'balanced',
      outfit: 'balanced',
      background: role === 'background' ? 'preserve' : 'restyle',
      effects: 'restyle',
      props: 'balanced',
    },
    preserveZones: [],
    rewriteZones: [],
    spatialPromptHints: [],
    strategyConfidence: 0.4,
    strategySource: 'janus_role_fallback',
  };
}

async function interpretJanusManifestWithLlm({
  manifests = [],
  canonicalRequest = '',
  sceneType = '',
  imageReferences = [],
  timeoutMs = 30000,
  callStructuredLlmJson = defaultCallStructuredLlmJson,
} = {}) {
  if (!manifests.length || !canonicalRequest) {
    return null;
  }

  if (typeof callStructuredLlmJson !== 'function') {
    console.warn('[A11][janus-strategy] LLM unavailable, using Janus role fallback');
    return buildFallbackStrategy(manifests);
  }

  const input = buildStrategyInput({
    manifests,
    canonicalRequest,
    sceneType,
    imageReferences,
  });

  try {
    const response = await callStructuredLlmJson({
      text: input,
      systemPrompt: JANUS_STRATEGY_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 800,
      timeoutMs: Math.max(5000, Number(timeoutMs) || 30000),
      responseFormat: JANUS_STRATEGY_RESPONSE_FORMAT,
      stage: 'janus_spatial_strategy',
    });

    const normalized = normalizeStrategyResponse(response);
    if (!normalized) {
      console.warn('[A11][janus-strategy] LLM returned invalid strategy, using fallback');
      return buildFallbackStrategy(manifests);
    }

    console.log(
      `[A11][janus-strategy] strategy=${normalized.globalStrengthProfile}`
      + ` confidence=${normalized.strategyConfidence.toFixed(2)}`
      + ` preserve=${normalized.preserveZones.length}`
      + ` rewrite=${normalized.rewriteZones.length}`
      + ` hints=${normalized.spatialPromptHints.length}`
    );

    return normalized;
  } catch (error) {
    console.warn(`[A11][janus-strategy] LLM error: ${String(error?.message || error)}, using fallback`);
    return buildFallbackStrategy(manifests);
  }
}

function applyJanusStrategyToMask(mask = {}, strategy = null) {
  if (!strategy || typeof strategy !== 'object') return mask;
  if (String(mask?.intent || '').trim() !== 'image.generate') return mask;

  const nextMask = {
    ...mask,
    meta: {
      ...(mask.meta && typeof mask.meta === 'object' ? mask.meta : {}),
      janusStrategy: strategy,
    },
  };

  // Injecter les hints spatiaux dans promptInstructions
  const existingInstructions = Array.isArray(nextMask.meta.promptInstructions)
    ? [...nextMask.meta.promptInstructions]
    : [];

  const strategyInstructions = [];

  if (strategy.preserveZones.length > 0) {
    strategyInstructions.push(
      `preserve from reference: ${strategy.preserveZones.slice(0, 4).join(', ')}`
    );
  }

  if (strategy.rewriteZones.length > 0) {
    strategyInstructions.push(
      `transform in generation: ${strategy.rewriteZones.slice(0, 4).join(', ')}`
    );
  }

  for (const hint of strategy.spatialPromptHints.slice(0, 3)) {
    strategyInstructions.push(hint);
  }

  // Injecter le strength profile dans webImageDraft pour que img2img-source-guard le lise
  const existingDraft = nextMask.meta.webImageDraft && typeof nextMask.meta.webImageDraft === 'object'
    ? nextMask.meta.webImageDraft
    : {};

  nextMask.meta.webImageDraft = {
    ...existingDraft,
    janusStrategyProfile: strategy.globalStrengthProfile,
    janusStrategyReason: strategy.globalStrengthReason,
    janusComponentProfiles: strategy.componentProfiles,
    janusStrategyConfidence: strategy.strategyConfidence,
  };

  nextMask.meta.promptInstructions = [
    ...existingInstructions,
    ...strategyInstructions,
  ].filter(Boolean);

  return nextMask;
}

function isJanusSpatialStrategyEnabled(env = process.env) {
  const explicit = String(env.A11_JANUS_SPATIAL_STRATEGY || '').trim().toLowerCase();
  if (!explicit) return true; // activé par défaut si Janus est disponible
  return ['1', 'true', 'yes', 'on'].includes(explicit);
}

module.exports = {
  applyJanusStrategyToMask,
  buildFallbackStrategy,
  buildManifestSummaryForLlm,
  buildStrategyInput,
  interpretJanusManifestWithLlm,
  isJanusSpatialStrategyEnabled,
  normalizeStrategyResponse,
  JANUS_STRATEGY_SYSTEM_PROMPT,
  JANUS_STRATEGY_RESPONSE_FORMAT,
};
