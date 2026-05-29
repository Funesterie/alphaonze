'use strict';

// Voice provider manifest — By Djeff / Funesterie
// Defines persona → provider → model/ref routing for A11/K44/Vivy.
// Rule: demo assets (demo-alice.*) are NEVER selected for official personas.

const PROVIDERS = Object.freeze({
  GPT_SOVITS: 'gpt-sovits',
  CHATTERBOX: 'chatterbox',
  XTTS_RVC:   'xtts-rvc',
  PIPER:      'piper',
});

// Provider resolution order for production requests
const PROVIDER_ORDER = [
  PROVIDERS.GPT_SOVITS,
  PROVIDERS.CHATTERBOX,
  PROVIDERS.XTTS_RVC,
  PROVIDERS.PIPER,
];

// Official personas — these may never fall back to a demo model
const OFFICIAL_PERSONAS = new Set(['a11', 'kaen44', 'vivy']);

const VOICE_REFERENCE_POLICY = Object.freeze({
  mode: 'style_reference_only_no_impersonation',
  trainingDataRule: 'Only use owned, licensed, or explicitly consented audio for training/import.',
  publicSampleRule: 'Public soundboards and clips are moodboard references only; do not download or train on them by default.',
  sourceDiscoveryRule: 'Reference filenames may be used as search hints to find the public/YouTube source and analyze scene context, speakers, music, language, compression, and intent.',
});

const VOICE_PERSONA_DIRECTIONS = Object.freeze({
  a11: Object.freeze({
    persona: 'a11',
    label: 'A11 cybernetic guardian',
    referenceMoodboard: [
      'Terminator / T-800 cinematic cyborg archetype',
      '101Soundboards Terminator page: https://www.101soundboards.com/boards/27208-terminator-the-terminator-soundboard',
    ],
    protectedReferences: ['Arnold Schwarzenegger', 'Terminator / T-800'],
    referenceClipNotes: [
      'Primary local ref: a11-terminator.wav. Context ref: a11-terminator-context.wav.',
      'Use the filenames as source-discovery hints when a web-capable agent wants to find the matching public/YouTube reference and analyze it.',
      'Refs are noisy public/cinematic clips; treat them as vocal direction only, not as a clean clone target.',
      'Target original A11: low, metallic, mission-focused French diction with restrained warmth.',
    ],
    prompt:
      'Voix A11 originale: grave, stable, cybernetique et protectrice, avec diction nette, economie de mots, cadence missionnelle et chaleur contenue. Ne clone pas Arnold Schwarzenegger, ne joue pas le T-800 exact, et ne recycle pas de repliques de films.',
  }),
  kaen44: Object.freeze({
    persona: 'kaen44',
    label: 'Kaen44 executive desk operator',
    referenceMoodboard: [
      'Donna Paulsen / Suits executive assistant archetype',
      '101Soundboards Suits page: https://www.101soundboards.com/boards/1386684-suits-2011',
      'Voicy Donna Paulsen board: https://www.voicy.network/official-soundboards/series/donna-paulsen',
    ],
    protectedReferences: ['Sarah Rafferty', 'Donna Paulsen'],
    referenceClipNotes: [
      'Primary local ref: kaen44-donna.wav. Context refs: kaen44-donna-extra.wav and kaen44-donna-context.wav.',
      'Use the filenames as source-discovery hints when a web-capable agent wants to find the matching public/YouTube reference and analyze it.',
      'Refs may include music, Harvey/other voices, and short-form compression; ignore background and other speakers.',
      'Target original Kaen44: sharp executive-assistant timing, redhead Suits energy, confident warmth, fast wit.',
    ],
    prompt:
      'Voix Kaen44 originale: assistante de direction vive, elegante et sure d elle, precise sans etre froide, esprit rapide, tact humain, sens du dossier et repliques courtes. Ne clone pas Sarah Rafferty, ne joue pas Donna Paulsen exacte, et garde une identite Funesterie propre.',
  }),
  vivy: Object.freeze({
    persona: 'vivy',
    label: 'Vivy original musical AI',
    referenceMoodboard: [
      'Japanese anime AI songstress energy from Vivy -Fluorite Eye\'s Song-',
      'Official Vivy USA staff/cast: https://vivy-anime.com/staffcast/',
      'Official Vivy USA music page: https://vivy-anime.com/music/',
    ],
    protectedReferences: ['Kairi Yagi', 'Atsumi Tanezaki', 'anime Vivy / Diva'],
    referenceClipNotes: [
      'Primary local ref: vivy.wav. Context refs: vivy-song-context.wav and vivy-pv-context.wav.',
      'Use the filenames as source-discovery hints when a web-capable agent wants to find the matching public/YouTube reference and analyze it.',
      'Refs may include music beds, trailer narration, and other characters; use only musical phrasing and clarity cues.',
      'Target original Vivy: luminous Japanese-anime AI singer mood, precise emotion, clean vowels, gentle musical lift.',
    ],
    prompt:
      'Voix Vivy originale: claire, musicale, lumineuse, precise emotionnellement, avec phrasing de chanteuse IA et douceur japonaise inspiree anime. Ne clone pas Kairi Yagi, Atsumi Tanezaki, ni la Vivy/Diva de l anime; garde une presence Funesterie originale.',
  }),
});

function getVoicePersonaDirection(persona = 'a11') {
  const normalized = String(persona || '').trim().toLowerCase();
  if (normalized === 'k44' || normalized === 'kaen') return VOICE_PERSONA_DIRECTIONS.kaen44;
  if (normalized === 'vivy' || normalized === 'vivi') return VOICE_PERSONA_DIRECTIONS.vivy;
  return VOICE_PERSONA_DIRECTIONS[normalized] || VOICE_PERSONA_DIRECTIONS.a11;
}

function buildVoicePersonaInstruction(persona = 'a11') {
  const direction = getVoicePersonaDirection(persona);
  const referenceNotes = Array.isArray(direction.referenceClipNotes)
    ? direction.referenceClipNotes.join(' ')
    : '';
  return [
    direction.prompt,
    referenceNotes,
    `Politique voix: ${VOICE_REFERENCE_POLICY.mode}; ${VOICE_REFERENCE_POLICY.trainingDataRule} ${VOICE_REFERENCE_POLICY.sourceDiscoveryRule}`,
  ].filter(Boolean).join(' ');
}

// Manifest: persona → provider config
// model: null = not yet trained; approved ref clips are stored in voice-reference-store
const MANIFEST = Object.freeze({
  a11: {
    persona: 'a11',
    official: true,
    direction: VOICE_PERSONA_DIRECTIONS.a11,
    providers: {
      [PROVIDERS.GPT_SOVITS]: { configured: false, modelPath: null, note: 'Pending trained original A11 cybernetic voice. Licensed/consented data only; no T-800/actor clone.' },
      [PROVIDERS.CHATTERBOX]: { configured: false, refClipId: null, note: 'Pending approved ref clip for original A11 direction; public film clips are moodboard only.' },
      [PROVIDERS.XTTS_RVC]:   { configured: true, modelPath: null, note: 'Official bridge voice: XTTS reference first; RVC .pth optional.' },
      [PROVIDERS.PIPER]:      { configured: true,  note: 'Manual neutral fallback only.' },
    },
  },
  kaen44: {
    persona: 'kaen44',
    official: true,
    direction: VOICE_PERSONA_DIRECTIONS.kaen44,
    providers: {
      [PROVIDERS.GPT_SOVITS]: { configured: false, modelPath: null, note: 'Pending trained original Kaen44 executive voice. Licensed/consented data only; no Donna/Sarah Rafferty clone.' },
      [PROVIDERS.CHATTERBOX]: { configured: false, refClipId: null, note: 'Pending approved ref clip for original Kaen44 direction; public TV clips are moodboard only.' },
      [PROVIDERS.XTTS_RVC]:   { configured: true, modelPath: null, note: 'Official bridge voice: XTTS reference first; RVC .pth optional.' },
      [PROVIDERS.PIPER]:      { configured: true,  note: 'Manual neutral fallback only.' },
    },
  },
  vivy: {
    persona: 'vivy',
    official: true,
    direction: VOICE_PERSONA_DIRECTIONS.vivy,
    providers: {
      [PROVIDERS.GPT_SOVITS]: { configured: false, modelPath: null, note: 'Pending trained original Vivy musical voice. Licensed/consented data only; no anime singer/voice actor clone.' },
      [PROVIDERS.CHATTERBOX]: { configured: false, refClipId: null, note: 'Pending approved ref clip for original Vivy direction; public anime songs are moodboard only.' },
      [PROVIDERS.XTTS_RVC]:   { configured: true, modelPath: null, note: 'Official bridge voice: XTTS reference first; RVC .pth optional.' },
      [PROVIDERS.PIPER]:      { configured: true,  note: 'Manual neutral fallback only.' },
    },
  },
  'demo-alice': {
    persona: 'demo-alice',
    official: false,
    demo: true,
    providers: {
      [PROVIDERS.XTTS_RVC]: { configured: true, modelPath: null, note: 'Demo asset — must never be auto-selected for official personas.' },
      [PROVIDERS.PIPER]:    { configured: true, note: 'Demo fallback only.' },
    },
  },
});

/**
 * Resolves which provider to use for a persona.
 * Never returns a demo model for an official persona.
 * Falls back to piper if nothing is configured.
 *
 * @param {string} persona
 * @param {{ explicitProvider?: string, allowRvc?: boolean }} options
 * @returns {{ provider: string, configured: boolean, note: string, diagnostic?: string }}
 */
function resolveVoiceProvider(persona, options = {}) {
  const normalizedPersona = String(persona || '').trim().toLowerCase();
  const entry = MANIFEST[normalizedPersona];

  if (!entry) {
    return {
      provider: PROVIDERS.PIPER,
      configured: true,
      note: `Unknown persona "${normalizedPersona}" — neutral voice.`,
      diagnostic: 'persona_unknown',
    };
  }

  // Demo assets must never be served to official personas automatically
  if (entry.demo && OFFICIAL_PERSONAS.has(normalizedPersona)) {
    return {
      provider: PROVIDERS.PIPER,
      configured: true,
      note: 'Demo asset blocked for official persona — neutral voice.',
      diagnostic: 'demo_blocked',
    };
  }

  const explicitProvider = options.explicitProvider
    ? String(options.explicitProvider).trim().toLowerCase()
    : null;

  // Explicit provider requested — honour it only if allowed
  if (explicitProvider) {
    if (explicitProvider === PROVIDERS.XTTS_RVC && !options.allowRvc) {
      return {
        provider: PROVIDERS.PIPER,
        configured: true,
        note: 'XTTS/RVC is explicit-only. Set allowRvc=true or provide an approved .pth model.',
        diagnostic: 'rvc_not_allowed',
      };
    }
    const providerConfig = entry.providers[explicitProvider];
    if (providerConfig) {
      return {
        provider: explicitProvider,
        configured: providerConfig.configured,
        note: providerConfig.note || '',
        diagnostic: providerConfig.configured ? null : 'provider_not_configured',
      };
    }
  }

  // Auto-select: walk provider order, pick first configured one.
  // Official personas prefer identity/reference providers; Piper remains manual or last-resort.
  for (const provider of PROVIDER_ORDER) {
    const providerConfig = entry.providers[provider];
    if (providerConfig && providerConfig.configured) {
      return { provider, configured: true, note: providerConfig.note || '' };
    }
  }

  // Ultimate fallback — piper neutral with diagnostic
  return {
    provider: PROVIDERS.PIPER,
    configured: true,
    note: `No configured voice for "${normalizedPersona}" — neutral voice used.`,
    diagnostic: 'identity_voice_unavailable',
  };
}

/**
 * Returns true if the model name looks like a demo asset.
 * Prevents demo-alice.* from sneaking in via model name.
 */
function isDemoModel(modelName = '') {
  return /\bdemo[_-]/i.test(String(modelName).trim());
}

/**
 * Guards against demo models being used for official personas.
 * Returns the model name if safe, null if blocked.
 */
function guardDemoModel(persona, modelName) {
  if (!isDemoModel(modelName)) return modelName;
  if (OFFICIAL_PERSONAS.has(String(persona || '').trim().toLowerCase())) {
    return null;
  }
  return modelName;
}

module.exports = {
  PROVIDERS,
  PROVIDER_ORDER,
  OFFICIAL_PERSONAS,
  VOICE_REFERENCE_POLICY,
  VOICE_PERSONA_DIRECTIONS,
  MANIFEST,
  getVoicePersonaDirection,
  buildVoicePersonaInstruction,
  resolveVoiceProvider,
  isDemoModel,
  guardDemoModel,
};
