'use strict';

const fs = require('node:fs');

// Voice provider manifest — By Djeff / Funesterie
// Defines persona → provider → model/ref routing for A11/K44/Vivy.
// Rule: demo assets (demo-alice.*) are NEVER selected for official personas.

const {
  FAMILY_VOICE_IDENTITIES,
  PERSONAL_VOICE_POLICY,
} = require('../config/family-accounts.cjs');

const PROVIDERS = Object.freeze({
  CARTESIA:   'cartesia',
  ELEVENLABS: 'elevenlabs',
  AZURE:      'azure',
  OPENAI:     'openai',
  GPT_SOVITS: 'gpt-sovits',
  CHATTERBOX: 'chatterbox',
  XTTS_RVC:   'xtts-rvc',
  PIPER:      'piper',
});

// Provider resolution order for production requests
const PROVIDER_ORDER = [
  PROVIDERS.ELEVENLABS,
  PROVIDERS.XTTS_RVC,
  PROVIDERS.AZURE,
  PROVIDERS.OPENAI,
  PROVIDERS.PIPER,
];

const LOCAL_PROVIDER_ORDER = [
  PROVIDERS.XTTS_RVC,
  PROVIDERS.PIPER,
];

const LEGACY_EXPERIMENTAL_PROVIDERS = [
  PROVIDERS.GPT_SOVITS,
  PROVIDERS.CHATTERBOX,
  PROVIDERS.XTTS_RVC,
];

const LEGACY_CLOUD_TTS_PROVIDERS = new Set([
  PROVIDERS.CARTESIA,
  PROVIDERS.ELEVENLABS,
]);

const CLOUD_DEFAULT_PERSONAS = new Set(['a11', 'kaen44', 'vivy']);
const LOCAL_OFFICIAL_PRIORITY_PERSONAS = new Set(['a11', 'kaen44', 'k44', 'kaen', 'vivy', 'djeff', 'djeff-rap']);
const DEFAULT_ELEVENLABS_FAMILY_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

// Official personas — these may never fall back to a demo model
const OFFICIAL_PERSONAS = new Set(['a11', 'kaen44', 'vivy']);

const VOICE_REFERENCE_POLICY = Object.freeze({
  mode: 'style_reference_only_no_impersonation',
  trainingDataRule: 'Only use owned, licensed, or explicitly consented audio for training/import.',
  publicSampleRule: 'Public soundboards and clips are moodboard references only; do not download or train on them by default.',
  sourceDiscoveryRule: 'Reference filenames may be used as search hints to find the public/YouTube source and analyze scene context, speakers, music, language, compression, and intent.',
  accountVoiceRule: 'Family official voices are mapped to explicit owner accounts; personal voices require a connected premium/founder/admin account and opt-in consent.',
});

const VOICE_PERSONA_DIRECTIONS = Object.freeze({
  a11: Object.freeze({
    persona: 'a11',
    label: 'A11 official stern French guardian',
    referenceMoodboard: [
      'Stern French operator voice, gravelly and assertive, based on the owned Djeff WAV reference when available.',
      'Optional a11-voix-de-lait style: calm French teaching cadence, soft authority, interior clarity, and benevolent restraint from an approved local reference clip.',
      'Optional djeff-rap style: owned Pignon rap reference, tighter flow, concrete motorcycle vocabulary and natural Djeff cadence.',
    ],
    protectedReferences: [],
    referenceClipNotes: [
      'Official path: owned Djeff WAV reference through the Funesterie XTTS/RVC bridge when available.',
      'Optional path: a11-voix-de-lait local reference is a persona/mood style for measured interior and symbolic clarity; it must not override the official A11 voice unless explicitly selected.',
      'Optional path: djeff-rap local reference is a consented Djeff rap style for Vivy Studio and duet drafting; it must not override A11 unless explicitly selected.',
      'ElevenLabs and Cartesia are privileged explicit choices only; the owned local reference remains the official route.',
      'Target original A11: low, mission-focused French diction with restrained warmth.',
    ],
    prompt:
      'Voix A11 originale: grave, stable, protectrice, avec diction nette, economie de mots, cadence missionnelle et chaleur contenue. Le style optionnel a11-voix-de-lait ajoute une parole plus lente, pedagogique, humble et lumineuse quand il est explicitement demande. Le style optionnel djeff-rap utilise la reference Pignon consentie pour une cadence rap Djeff distincte. Utilise les references WAV possedees ou approuvees par Funesterie via XTTS/RVC quand elles sont disponibles; ne clone aucune personne ni personnage.',
  }),
  kaen44: Object.freeze({
    persona: 'kaen44',
    label: 'Kaen44 official French desk operator',
    referenceMoodboard: [
      'Elegant French desk-operator voice, based on the owned family WAV reference when available.',
      'If ElevenLabs is configured, use a crisp French operator voice: feminine, quick, elegant, confident, never cartoonish.',
    ],
    protectedReferences: [],
    referenceClipNotes: [
      'Official path: owned family WAV reference through the Funesterie XTTS/RVC bridge when available.',
      'ElevenLabs is the preferred ready-made cloud route when configured; otherwise use the owned family reference first.',
      'Target original Kaen44: sharp desk-operator timing, confident warmth, fast wit.',
    ],
    prompt:
      'Voix Kaen44 originale: operatrice vive, elegante et sure d elle, precise sans etre froide, esprit rapide, tact humain, sens du dossier et repliques courtes. Utilise la reference WAV familiale consentie par Funesterie via XTTS/RVC quand elle est disponible; ne clone aucune personne ni personnage sans consentement explicite.',
  }),
  vivy: Object.freeze({
    persona: 'vivy',
    label: 'Vivy official French creative voice',
    referenceMoodboard: [
      'Clear conversational French female voice, creative and luminous, routed through Funesterie-owned or explicitly approved references when available.',
    ],
    protectedReferences: [],
    referenceClipNotes: [
      'Official path: Funesterie-owned or explicitly approved voice references. ElevenLabs and Cartesia are privileged explicit choices only.',
      'Target original Vivy: luminous AI-singer mood, precise emotion, clean vowels, gentle musical lift.',
    ],
    prompt:
      'Voix Vivy originale: claire, musicale, lumineuse, precise emotionnellement, avec phrasing creatif et douceur de scene. Utilise les references possedees ou explicitement approuvees par Funesterie quand elles sont disponibles; ne clone aucune chanteuse, comedienne ou personnage.',
  }),
});

const OFFICIAL_READY_VOICE_PROFILES = Object.freeze({
  a11: Object.freeze({
    styleId: 'a11-official-stern-french',
    displayName: 'A11 - Djeff WAV XTTS/RVC',
    providerLabels: Object.freeze({
      [PROVIDERS.ELEVENLABS]: 'ElevenLabs A11 family default',
      [PROVIDERS.AZURE]: 'fr-FR-Remy:DragonHDLatestNeural',
      [PROVIDERS.OPENAI]: 'onyx',
      [PROVIDERS.XTTS_RVC]: 'Djeff WAV - A11 official reference',
      [PROVIDERS.PIPER]: 'fr_FR-tom-medium',
    }),
    elevenLabsVoiceId: DEFAULT_ELEVENLABS_FAMILY_VOICE_ID,
    cartesiaVoiceId: '7345dfa5-ee04-44d2-abf4-29262b880ab4',
    azureVoice: 'fr-FR-Remy:DragonHDLatestNeural',
    openAiVoice: 'onyx',
    piperVoice: 'fr_FR-tom-medium',
  }),
  kaen44: Object.freeze({
    styleId: 'kaen44-official-french-narrator',
    displayName: 'Kaen44 - French Narrator Lady',
    providerLabels: Object.freeze({
      [PROVIDERS.ELEVENLABS]: 'ElevenLabs Kaen44 family default',
      [PROVIDERS.AZURE]: 'fr-FR-Vivienne:DragonHDLatestNeural',
      [PROVIDERS.OPENAI]: 'sage',
      [PROVIDERS.XTTS_RVC]: 'Family WAV - Kaen44 official reference',
      [PROVIDERS.PIPER]: 'fr_FR-siwis-medium',
    }),
    elevenLabsVoiceId: DEFAULT_ELEVENLABS_FAMILY_VOICE_ID,
    cartesiaVoiceId: '8832a0b5-47b2-4751-bb22-6a8e2149303d',
    azureVoice: 'fr-FR-Vivienne:DragonHDLatestNeural',
    openAiVoice: 'sage',
    piperVoice: 'fr_FR-siwis-medium',
  }),
  vivy: Object.freeze({
    styleId: 'vivy-official-french-conversational',
    displayName: 'Vivy - Funesterie reference',
    providerLabels: Object.freeze({
      [PROVIDERS.ELEVENLABS]: 'ElevenLabs Vivy temporary default',
      [PROVIDERS.AZURE]: 'fr-FR-Vivienne:DragonHDLatestNeural',
      [PROVIDERS.OPENAI]: 'coral',
      [PROVIDERS.XTTS_RVC]: 'Vivy Funesterie approved reference',
      [PROVIDERS.PIPER]: 'fr_FR-siwis-medium',
    }),
    elevenLabsVoiceId: DEFAULT_ELEVENLABS_FAMILY_VOICE_ID,
    cartesiaVoiceId: '2f8e82c4-cb94-4e6d-8b6a-29bf58ceb60a',
    azureVoice: 'fr-FR-Vivienne:DragonHDLatestNeural',
    openAiVoice: 'coral',
    piperVoice: 'fr_FR-siwis-medium',
  }),
});

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function hasEnvValue(...names) {
  return names.some((name) => String(process.env[name] || '').trim());
}

function hasExistingEnvFileValue(...names) {
  return names.some((name) => {
    const filePath = String(process.env[name] || '').trim();
    if (!filePath) return false;
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  });
}

function envExplicitlyDisabled(...names) {
  return names.some((name) => {
    const raw = String(process.env[name] || '').trim().toLowerCase();
    return raw === '0' || raw === 'false' || raw === 'no' || raw === 'off' || raw === 'disabled';
  });
}

function isLegacyCloudTtsProvider(provider = '') {
  return LEGACY_CLOUD_TTS_PROVIDERS.has(String(provider || '').trim().toLowerCase());
}

function isLegacyCloudTtsProviderEnabled(provider = '') {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === PROVIDERS.CARTESIA) {
    if (envFlag('A11_CARTESIA_TTS_DISABLED') || envFlag('CARTESIA_TTS_DISABLED')) return false;
    return !envExplicitlyDisabled('A11_CARTESIA_TTS_ENABLED', 'CARTESIA_TTS_ENABLED');
  }
  if (normalized === PROVIDERS.ELEVENLABS) {
    if (envFlag('A11_ELEVENLABS_TTS_DISABLED') || envFlag('ELEVENLABS_TTS_DISABLED')) return false;
    return !envExplicitlyDisabled('A11_ELEVENLABS_TTS_ENABLED', 'ELEVENLABS_TTS_ENABLED');
  }
  return true;
}

function getDefaultVoiceProviderForPersona(persona = 'a11') {
  const normalized = normalizePersonaKey(persona);
  const preferred = String(
    process.env.A11_TTS_DEFAULT_PROVIDER
    || process.env.A11_VOICE_DEFAULT_PROVIDER
    || process.env.TTS_DEFAULT_PROVIDER
    || (CLOUD_DEFAULT_PERSONAS.has(normalized) ? PROVIDERS.ELEVENLABS : '')
  ).trim().toLowerCase();
  if (preferred === PROVIDERS.ELEVENLABS && isProviderRuntimeConfigured(PROVIDERS.ELEVENLABS)) return PROVIDERS.ELEVENLABS;
  if (preferred === PROVIDERS.CARTESIA && isProviderRuntimeConfigured(PROVIDERS.CARTESIA)) return PROVIDERS.CARTESIA;
  if (preferred === PROVIDERS.AZURE && isProviderRuntimeConfigured(PROVIDERS.AZURE)) return PROVIDERS.AZURE;
  if (preferred === PROVIDERS.OPENAI && isProviderRuntimeConfigured(PROVIDERS.OPENAI)) return PROVIDERS.OPENAI;
  if (LOCAL_OFFICIAL_PRIORITY_PERSONAS.has(normalized)) return PROVIDERS.XTTS_RVC;
  return PROVIDERS.XTTS_RVC;
}

function getReadyVoiceProfile(persona = 'a11', provider = '') {
  const normalizedPersona = normalizePersonaKey(persona);
  const profile = OFFICIAL_READY_VOICE_PROFILES[normalizedPersona] || OFFICIAL_READY_VOICE_PROFILES.a11;
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (!normalizedProvider) return profile;
  return {
    ...profile,
    provider,
    label: profile.providerLabels?.[normalizedProvider] || profile.displayName,
  };
}

function normalizePersonaKey(persona = '') {
  const normalized = String(persona || '').trim().toLowerCase();
  if (normalized === 'k44' || normalized === 'kaen') return 'kaen44';
  if (normalized === 'vivy' || normalized === 'vivi') return 'vivy';
  if (normalized === 'kaen44') return 'kaen44';
  return normalized || 'a11';
}

function isProviderRuntimeConfigured(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === PROVIDERS.CARTESIA) {
    if (!isLegacyCloudTtsProviderEnabled(normalized)) return false;
    return hasEnvValue('A11_CARTESIA_API_KEY', 'CARTESIA_API_KEY', 'CARTESIA_TOKEN')
      || hasExistingEnvFileValue('A11_CARTESIA_API_KEY_FILE', 'CARTESIA_API_KEY_FILE');
  }
  if (normalized === PROVIDERS.ELEVENLABS) {
    if (!isLegacyCloudTtsProviderEnabled(normalized)) return false;
    return hasEnvValue('A11_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY', 'XI_API_KEY')
      || hasExistingEnvFileValue('A11_ELEVENLABS_API_KEY_FILE', 'ELEVENLABS_API_KEY_FILE');
  }
  if (normalized === PROVIDERS.AZURE) {
    if (envFlag('A11_AZURE_TTS_DISABLED') || envFlag('AZURE_TTS_DISABLED')) return false;
    return hasEnvValue('A11_AZURE_SPEECH_KEY', 'AZURE_SPEECH_KEY', 'SPEECH_KEY')
      && (
        hasEnvValue('A11_AZURE_SPEECH_ENDPOINT', 'AZURE_SPEECH_ENDPOINT', 'SPEECH_ENDPOINT')
        || hasEnvValue('A11_AZURE_SPEECH_REGION', 'AZURE_SPEECH_REGION', 'SPEECH_REGION')
      );
  }
  if (normalized === PROVIDERS.OPENAI) {
    if (envFlag('A11_OPENAI_TTS_DISABLED') || envFlag('OPENAI_TTS_DISABLED')) return false;
    return hasEnvValue('OPENAI_TTS_API_KEY', 'A11_OPENAI_TTS_API_KEY', 'OPENAI_API_KEY', 'A11_OPENAI_API_KEY')
      || hasExistingEnvFileValue('OPENAI_TTS_API_KEY_FILE', 'A11_OPENAI_TTS_API_KEY_FILE');
  }
  if (normalized === PROVIDERS.XTTS_RVC) {
    return envFlag('A11_TTS_ALLOW_XTTS_RVC_AUTO', false)
      && hasEnvValue('A11_VOICE_XTTS_RVC_URL', 'A11_XTTS_RVC_URL', 'A11_VOICE_CONVERSION_URL');
  }
  if (normalized === PROVIDERS.PIPER) return true;
  return false;
}

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
      [PROVIDERS.ELEVENLABS]: { configured: 'runtime', voiceId: OFFICIAL_READY_VOICE_PROFILES.a11.elevenLabsVoiceId, note: 'Privileged explicit ready-made voice choice.' },
      [PROVIDERS.CARTESIA]:   { configured: 'runtime', voiceId: OFFICIAL_READY_VOICE_PROFILES.a11.cartesiaVoiceId, note: 'Privileged explicit ready-made voice choice.' },
      [PROVIDERS.AZURE]:      { configured: 'runtime', voice: OFFICIAL_READY_VOICE_PROFILES.a11.azureVoice, note: 'Fallback/explicit override HD ready-made voice.' },
      [PROVIDERS.OPENAI]:     { configured: 'runtime', voice: OFFICIAL_READY_VOICE_PROFILES.a11.openAiVoice, note: 'Fallback/explicit override high-quality ready-made voice.' },
      [PROVIDERS.XTTS_RVC]:   { configured: 'runtime', modelPath: 'voice-library/a11-official-stern-french.wav', optionalStylePath: 'voice-library/a11-voix-de-lait.wav', optionalRapStylePath: 'voice-library/djeff-rap.wav', note: 'Official A11 bridge using the owned Djeff WAV reference when available; optional a11-voix-de-lait and djeff-rap styles are explicit opt-in only.' },
      [PROVIDERS.PIPER]:      { configured: true,  note: 'Neutral fallback when cloud voices are not configured.' },
    },
  },
  kaen44: {
    persona: 'kaen44',
    official: true,
    direction: VOICE_PERSONA_DIRECTIONS.kaen44,
    providers: {
      [PROVIDERS.GPT_SOVITS]: { configured: false, modelPath: null, note: 'Pending trained original Kaen44 executive voice. Licensed/consented data only; no real-person or character clone.' },
      [PROVIDERS.CHATTERBOX]: { configured: false, refClipId: null, note: 'Pending approved ref clip for original Kaen44 direction; public TV/audio clips are moodboard only.' },
      [PROVIDERS.ELEVENLABS]: { configured: 'runtime', voiceId: OFFICIAL_READY_VOICE_PROFILES.kaen44.elevenLabsVoiceId, note: 'Preferred ready-made ElevenLabs voice when configured; local K44 official reference remains fallback.' },
      [PROVIDERS.CARTESIA]:   { configured: 'runtime', voiceId: OFFICIAL_READY_VOICE_PROFILES.kaen44.cartesiaVoiceId, note: 'Privileged explicit ready-made voice choice; local K44 official reference stays first.' },
      [PROVIDERS.AZURE]:      { configured: 'runtime', voice: OFFICIAL_READY_VOICE_PROFILES.kaen44.azureVoice, note: 'Fallback/explicit override HD ready-made voice.' },
      [PROVIDERS.OPENAI]:     { configured: 'runtime', voice: OFFICIAL_READY_VOICE_PROFILES.kaen44.openAiVoice, note: 'Fallback/explicit override high-quality ready-made voice.' },
      [PROVIDERS.XTTS_RVC]:   { configured: 'runtime', modelPath: 'voice-library/kaen44-official-french-narrator.wav', note: 'Official Kaen44 bridge using the owned family WAV reference when available.' },
      [PROVIDERS.PIPER]:      { configured: true,  note: 'Neutral fallback when cloud voices are not configured.' },
    },
  },
  vivy: {
    persona: 'vivy',
    official: true,
    direction: VOICE_PERSONA_DIRECTIONS.vivy,
    providers: {
      [PROVIDERS.GPT_SOVITS]: { configured: false, modelPath: null, note: 'Pending trained original Vivy musical voice. Licensed/consented data only; no anime singer/voice actor clone.' },
      [PROVIDERS.CHATTERBOX]: { configured: false, refClipId: null, note: 'Pending approved ref clip for original Vivy direction; public anime songs are moodboard only.' },
      [PROVIDERS.ELEVENLABS]: { configured: 'runtime', voiceId: OFFICIAL_READY_VOICE_PROFILES.vivy.elevenLabsVoiceId, note: 'Privileged explicit ready-made voice choice.' },
      [PROVIDERS.CARTESIA]:   { configured: 'runtime', voiceId: OFFICIAL_READY_VOICE_PROFILES.vivy.cartesiaVoiceId, note: 'Privileged explicit ready-made voice choice.' },
      [PROVIDERS.AZURE]:      { configured: 'runtime', voice: OFFICIAL_READY_VOICE_PROFILES.vivy.azureVoice, note: 'Secondary HD ready-made voice.' },
      [PROVIDERS.OPENAI]:     { configured: 'runtime', voice: OFFICIAL_READY_VOICE_PROFILES.vivy.openAiVoice, note: 'Tertiary high-quality ready-made voice.' },
      [PROVIDERS.XTTS_RVC]:   { configured: 'runtime', modelPath: 'voice-library/vivy.wav', note: 'Official Vivy bridge using the Funesterie-approved local reference when available.' },
      [PROVIDERS.PIPER]:      { configured: true,  note: 'Neutral fallback when cloud voices are not configured.' },
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
 * @param {{ explicitProvider?: string, allowRvc?: boolean, allowCloud?: boolean }} options
 * @returns {{ provider: string, configured: boolean, note: string, diagnostic?: string }}
 */
function resolveVoiceProvider(persona, options = {}) {
  const normalizedPersona = normalizePersonaKey(persona);
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
    if (isLegacyCloudTtsProvider(explicitProvider) && !isLegacyCloudTtsProviderEnabled(explicitProvider)) {
      return {
        provider: PROVIDERS.PIPER,
        configured: true,
        note: `${explicitProvider} is a disabled legacy cloud voice provider; using the local neutral fallback.`,
        diagnostic: 'legacy_cloud_tts_disabled',
      };
    }
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
      const configured = providerConfig.configured === 'runtime'
        ? isProviderRuntimeConfigured(explicitProvider)
        : Boolean(providerConfig.configured);
      return {
        provider: explicitProvider,
        configured,
        note: providerConfig.note || '',
        diagnostic: configured ? null : 'provider_not_configured',
      };
    }
  }

  // Auto-select: official family personas use the configured cloud default first,
  // then fall back to owned local references and finally neutral Piper.
  const prefersLocalOfficial = LOCAL_OFFICIAL_PRIORITY_PERSONAS.has(normalizedPersona);
  const defaultProvider = getDefaultVoiceProviderForPersona(normalizedPersona);
  const providerOrder = options.allowCloud === false
    ? LOCAL_PROVIDER_ORDER
    : Array.from(new Set([
      defaultProvider,
      ...(prefersLocalOfficial ? LOCAL_PROVIDER_ORDER : []),
      ...PROVIDER_ORDER,
    ].filter(Boolean)));
  for (const provider of providerOrder) {
    const providerConfig = entry.providers[provider];
    const configured = providerConfig?.configured === 'runtime'
      ? isProviderRuntimeConfigured(provider)
      : Boolean(providerConfig?.configured);
    if (providerConfig && configured) {
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
  LOCAL_PROVIDER_ORDER,
  LEGACY_EXPERIMENTAL_PROVIDERS,
  LEGACY_CLOUD_TTS_PROVIDERS,
  CLOUD_DEFAULT_PERSONAS,
  LOCAL_OFFICIAL_PRIORITY_PERSONAS,
  OFFICIAL_PERSONAS,
  VOICE_REFERENCE_POLICY,
  FAMILY_VOICE_IDENTITIES,
  PERSONAL_VOICE_POLICY,
  VOICE_PERSONA_DIRECTIONS,
  OFFICIAL_READY_VOICE_PROFILES,
  MANIFEST,
  getVoicePersonaDirection,
  getDefaultVoiceProviderForPersona,
  getReadyVoiceProfile,
  buildVoicePersonaInstruction,
  resolveVoiceProvider,
  isProviderRuntimeConfigured,
  isLegacyCloudTtsProvider,
  isLegacyCloudTtsProviderEnabled,
  isDemoModel,
  guardDemoModel,
};
