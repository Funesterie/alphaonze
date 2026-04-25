// video-spatial-strategy.cjs
// Interprète le visual scan Janus via LLM pour produire une stratégie
// spatiale et sonore pour la génération vidéo frame-by-frame.
//
// Séquence : Janus visual scan (déjà exécuté) → LLM ici → SD frames après.
// Pas de pipeline parallèle, pas de contention VRAM.
//
// Le LLM décide :
// - zones stables (à préserver entre frames)
// - zones de mouvement (à animer)
// - sound cues physiques dérivés des matériaux/surfaces/impacts visibles
// - hints de continuité spatiale pour le frame prompter

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../mask/resolve-text-to-wazaa.cjs');

const VIDEO_SPATIAL_STRATEGY_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: {
    name: 'video_spatial_strategy',
    strict: true,
    schema: {
      type: 'object',
      required: [
        'stable_zones',
        'motion_zones',
        'spatial_continuity_hints',
        'physical_sound_cues',
        'frame_strength_profile',
        'strategy_confidence',
      ],
      properties: {
        stable_zones: {
          type: 'array',
          items: { type: 'string' },
        },
        motion_zones: {
          type: 'array',
          items: { type: 'string' },
        },
        spatial_continuity_hints: {
          type: 'array',
          items: { type: 'string' },
        },
        physical_sound_cues: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label', 'source', 'timing'],
            properties: {
              label: { type: 'string' },
              source: { type: 'string' },
              timing: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        frame_strength_profile: {
          type: 'string',
          enum: ['preserve', 'balanced', 'restyle'],
        },
        strategy_confidence: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
});

const VIDEO_SPATIAL_STRATEGY_SYSTEM_PROMPT = `You are a spatial and sound strategist for a frame-by-frame video renderer using Stable Diffusion 3.5.

You receive:
1. A Janus visual analysis of a reference image (subjects, props, scene, bbox, continuity anchors)
2. The user's video request and motion profile
3. The target frame count

Your job is to decide:
- STABLE ZONES: what must stay visually consistent across all frames (background, costume, identity)
- MOTION ZONES: what changes frame by frame (limbs, weapon trajectory, energy effects)
- SPATIAL CONTINUITY HINTS: short SD3 prompt fragments that help each frame stay coherent
- PHYSICAL SOUND CUES: sounds derived from what Janus actually sees in the scene

Physical sound cue rules:
- Derive sounds from VISIBLE materials and objects only (do not invent)
- If Janus sees a metal sword: "metallic blade scrape", "sword whoosh", "hilt impact"
- If Janus sees stone floor: "footstep on stone", "stone resonance"
- If Janus sees armor: "armor rattle", "plate clank"
- If Janus sees wood: "wood creak", "wooden thud"
- If Janus sees energy/aura: "energy hum", "power surge crackle"
- If Janus sees fabric/cape: "fabric flutter", "cloth swish"
- timing: "start", "mid", "end", "continuous", or a specific beat label
- source: the physical object or material that produces the sound

Frame strength profile:
- preserve (0.22-0.38): subtle motion, mostly stable scene
- balanced (0.48-0.68): clear motion with identity preserved
- restyle (0.60-0.78): strong transformation or action burst

Keep all output in English. Be specific and grounded in what Janus actually detected.
Return strict JSON only.`;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function normalizeStrengthProfile(value = '', fallback = 'balanced') {
  const normalized = String(value || '').trim().toLowerCase();
  return ['preserve', 'balanced', 'restyle'].includes(normalized) ? normalized : fallback;
}

function normalizeSoundCue(entry = null) {
  if (!entry || typeof entry !== 'object') return null;
  const label = normalizeText(entry.label || '');
  const source = normalizeText(entry.source || '');
  const timing = normalizeText(entry.timing || 'continuous');
  if (!label) return null;
  return { label, source: source || label, timing };
}

function buildVisualScanSummaryForStrategy(visualAnalysis = {}) {
  const parts = [];

  const scene = [
    ...(visualAnalysis?.scene?.decor || []),
    ...(visualAnalysis?.scene?.cameraFraming || []),
    ...(visualAnalysis?.scene?.lighting || []),
  ].filter(Boolean);
  if (scene.length) parts.push(`scene: ${scene.join(', ')}`);

  const subjects = (Array.isArray(visualAnalysis?.subjects) ? visualAnalysis.subjects : [])
    .map((s) => {
      const bbox = Array.isArray(s?.bbox) ? `bbox [${s.bbox.join(', ')}]` : '';
      const pose = normalizeText(s?.pose || '');
      const accessories = Array.isArray(s?.accessories) ? s.accessories.slice(0, 3).join(', ') : '';
      const props = Array.isArray(s?.props) ? s.props.slice(0, 3).join(', ') : '';
      return [
        `subject: ${normalizeText(s?.label || 'character')}`,
        bbox,
        pose ? `pose: ${pose}` : '',
        accessories ? `wearing: ${accessories}` : '',
        props ? `holding: ${props}` : '',
      ].filter(Boolean).join(' | ');
    });
  parts.push(...subjects);

  const props = (Array.isArray(visualAnalysis?.props) ? visualAnalysis.props : [])
    .map((p) => {
      const bbox = Array.isArray(p?.bbox) ? `bbox [${p.bbox.join(', ')}]` : '';
      const details = Array.isArray(p?.details) ? p.details.slice(0, 3).join(', ') : '';
      return [
        `prop: ${normalizeText(p?.label || 'object')}`,
        bbox,
        details,
      ].filter(Boolean).join(' | ');
    });
  parts.push(...props);

  if (Array.isArray(visualAnalysis?.continuityAnchors) && visualAnalysis.continuityAnchors.length) {
    parts.push(`continuity anchors: ${visualAnalysis.continuityAnchors.join(', ')}`);
  }
  if (Array.isArray(visualAnalysis?.continuityRisks) && visualAnalysis.continuityRisks.length) {
    parts.push(`continuity risks: ${visualAnalysis.continuityRisks.join(', ')}`);
  }

  return parts.join('\n');
}

function buildStrategyInput({
  visualAnalysis = null,
  prompt = '',
  compiledPrompt = '',
  motionProfile = '',
  frameCount = 1,
} = {}) {
  const scanSummary = visualAnalysis
    ? buildVisualScanSummaryForStrategy(visualAnalysis)
    : 'No Janus visual scan available';

  return JSON.stringify({
    janus_visual_scan: scanSummary,
    user_request: normalizeText(compiledPrompt || prompt),
    motion_profile: normalizeText(motionProfile),
    frame_count: Math.max(1, Number(frameCount) || 1),
    instruction: 'Based on the Janus visual scan, decide the spatial strategy and derive physical sound cues from visible materials and objects only.',
  }, null, 2);
}

function normalizeStrategyResponse(response = null) {
  if (!response || typeof response !== 'object') return null;

  const stableZones = normalizeStringList(response.stable_zones);
  const motionZones = normalizeStringList(response.motion_zones);
  const spatialContinuityHints = normalizeStringList(response.spatial_continuity_hints);
  const physicalSoundCues = (Array.isArray(response.physical_sound_cues) ? response.physical_sound_cues : [])
    .map(normalizeSoundCue)
    .filter(Boolean);
  const frameStrengthProfile = normalizeStrengthProfile(response.frame_strength_profile, 'balanced');
  const strategyConfidence = clamp01(response.strategy_confidence, 0.5);

  if (!stableZones.length && !motionZones.length && !physicalSoundCues.length) return null;

  return {
    stableZones,
    motionZones,
    spatialContinuityHints,
    physicalSoundCues,
    frameStrengthProfile,
    strategyConfidence,
    strategySource: 'janus_llm_video',
  };
}

function buildFallbackVideoStrategy(visualAnalysis = null, motionProfile = '') {
  // Fallback basé sur le motion profile si le LLM échoue
  const isAction = ['action_burst', 'power_up_loop', 'transformation_rise'].includes(motionProfile);
  const isLocomotive = ['walk_cycle', 'run_cycle', 'dance_cycle'].includes(motionProfile);

  const stableZones = ['background scene', 'character identity and costume'];
  const motionZones = isAction
    ? ['full body pose', 'energy effects', 'weapon trajectory']
    : isLocomotive
      ? ['leg and arm movement', 'body weight shift']
      : ['primary subject motion'];

  // Sound cues basiques dérivés du visual scan si disponible
  const physicalSoundCues = [];
  if (visualAnalysis) {
    const props = Array.isArray(visualAnalysis?.props) ? visualAnalysis.props : [];
    const subjects = Array.isArray(visualAnalysis?.subjects) ? visualAnalysis.subjects : [];

    for (const prop of props.slice(0, 4)) {
      const label = normalizeText(prop?.label || '').toLowerCase();
      if (/sword|blade|epee|sabre/.test(label)) {
        physicalSoundCues.push({ label: 'metallic blade whoosh', source: label, timing: 'mid' });
        physicalSoundCues.push({ label: 'sword scrape', source: label, timing: 'start' });
      } else if (/bow|arc/.test(label)) {
        physicalSoundCues.push({ label: 'bowstring release', source: label, timing: 'mid' });
      } else if (/armor|armure|plate/.test(label)) {
        physicalSoundCues.push({ label: 'armor rattle', source: label, timing: 'continuous' });
      } else if (/staff|baton|wand/.test(label)) {
        physicalSoundCues.push({ label: 'staff impact', source: label, timing: 'end' });
      }
    }

    for (const subject of subjects.slice(0, 2)) {
      const accessories = Array.isArray(subject?.accessories) ? subject.accessories : [];
      for (const acc of accessories) {
        const a = normalizeText(acc).toLowerCase();
        if (/cape|cloak|manteau/.test(a)) {
          physicalSoundCues.push({ label: 'fabric flutter', source: a, timing: 'continuous' });
        }
      }
    }

    const decor = Array.isArray(visualAnalysis?.scene?.decor) ? visualAnalysis.scene.decor : [];
    for (const d of decor) {
      const dl = normalizeText(d).toLowerCase();
      if (/stone|pierre|cobble/.test(dl)) {
        physicalSoundCues.push({ label: 'footstep on stone', source: dl, timing: 'mid' });
      } else if (/wood|bois/.test(dl)) {
        physicalSoundCues.push({ label: 'wooden creak', source: dl, timing: 'continuous' });
      } else if (/water|eau/.test(dl)) {
        physicalSoundCues.push({ label: 'water splash', source: dl, timing: 'mid' });
      }
    }
  }

  return {
    stableZones,
    motionZones,
    spatialContinuityHints: [],
    physicalSoundCues: physicalSoundCues.slice(0, 6),
    frameStrengthProfile: isAction ? 'balanced' : 'preserve',
    strategyConfidence: 0.4,
    strategySource: 'motion_profile_fallback',
  };
}

async function interpretVideoVisualScanWithLlm({
  visualAnalysis = null,
  prompt = '',
  compiledPrompt = '',
  motionProfile = '',
  frameCount = 1,
  timeoutMs = 20000,
  callStructuredLlmJson = defaultCallStructuredLlmJson,
} = {}) {
  if (!visualAnalysis) return null;

  if (typeof callStructuredLlmJson !== 'function') {
    console.warn('[A11][video-spatial-strategy] LLM unavailable, using motion profile fallback');
    return buildFallbackVideoStrategy(visualAnalysis, motionProfile);
  }

  const input = buildStrategyInput({
    visualAnalysis,
    prompt,
    compiledPrompt,
    motionProfile,
    frameCount,
  });

  try {
    const response = await callStructuredLlmJson({
      text: input,
      systemPrompt: VIDEO_SPATIAL_STRATEGY_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 700,
      timeoutMs: Math.max(5000, Number(timeoutMs) || 20000),
      responseFormat: VIDEO_SPATIAL_STRATEGY_RESPONSE_FORMAT,
      stage: 'video_spatial_strategy',
    });

    const normalized = normalizeStrategyResponse(response);
    if (!normalized) {
      console.warn('[A11][video-spatial-strategy] LLM returned invalid strategy, using fallback');
      return buildFallbackVideoStrategy(visualAnalysis, motionProfile);
    }

    console.log(
      `[A11][video-spatial-strategy] strategy=${normalized.frameStrengthProfile}`
      + ` stable=${normalized.stableZones.length}`
      + ` motion=${normalized.motionZones.length}`
      + ` sounds=${normalized.physicalSoundCues.length}`
      + ` confidence=${normalized.strategyConfidence.toFixed(2)}`
    );

    return normalized;
  } catch (error) {
    console.warn(`[A11][video-spatial-strategy] LLM error: ${String(error?.message || error)}, using fallback`);
    return buildFallbackVideoStrategy(visualAnalysis, motionProfile);
  }
}

function buildStrategyVisualContext(strategy = null, existingVisualContext = '') {
  if (!strategy) return existingVisualContext;

  const parts = [existingVisualContext].filter(Boolean);

  if (strategy.stableZones.length > 0) {
    parts.push(`stable zones (preserve across frames): ${strategy.stableZones.slice(0, 4).join(', ')}`);
  }
  if (strategy.motionZones.length > 0) {
    parts.push(`motion zones (animate progressively): ${strategy.motionZones.slice(0, 4).join(', ')}`);
  }
  for (const hint of strategy.spatialContinuityHints.slice(0, 3)) {
    parts.push(hint);
  }

  return parts.filter(Boolean).join('. ');
}

function buildStrategySoundCues(strategy = null, existingSoundCues = []) {
  if (!strategy || !strategy.physicalSoundCues.length) return existingSoundCues;

  const physicalLabels = strategy.physicalSoundCues.map((c) => c.label);
  const merged = [...new Set([...existingSoundCues, ...physicalLabels])];
  return merged.slice(0, 8);
}

function isVideoSpatialStrategyEnabled(env = process.env) {
  const explicit = String(env.A11_VIDEO_SPATIAL_STRATEGY || '').trim().toLowerCase();
  if (!explicit) return true; // activé par défaut si Janus est disponible
  return ['1', 'true', 'yes', 'on'].includes(explicit);
}

module.exports = {
  buildFallbackVideoStrategy,
  buildStrategyInput,
  buildStrategySoundCues,
  buildStrategyVisualContext,
  buildVisualScanSummaryForStrategy,
  interpretVideoVisualScanWithLlm,
  isVideoSpatialStrategyEnabled,
  normalizeStrategyResponse,
  VIDEO_SPATIAL_STRATEGY_RESPONSE_FORMAT,
  VIDEO_SPATIAL_STRATEGY_SYSTEM_PROMPT,
};
