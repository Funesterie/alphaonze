'use strict';
/**
 * Voice Avatars Catalog — Visual identity pour chaque voix dans les Full Clips
 * Chaque IA/persona a un avatar distinct qui sera injecté dans les prompts Seedance.
 * 
 * Les descriptions sont des character prompts Seedance-friendly (pas de violence, pas de termes interdits).
 */

const VOICE_AVATARS = {
  djeff: {
    name: 'Djeff',
    description: 'A young man with short dark hair, wearing a black cap backwards and a dark hoodie. Urban street style, confident posture. Gold chain necklace. Rap artist energy.',
    style: 'urban, street, neon-lit, cinematic',
    gender: 'male',
    colors: ['gold', 'black', 'purple']
  },
  vivy: {
    name: 'Vivy',
    description: 'A woman with flowing purple-cyan gradient hair, glowing violet eyes. Futuristic sleek outfit with neon accents. Digital idol aesthetic, graceful and ethereal.',
    style: 'futuristic, neon, ethereal, cyberpunk',
    gender: 'female',
    colors: ['purple', 'cyan', 'pink']
  },
  grok: {
    name: 'Grok',
    description: 'A tall figure in a sharp dark suit with electric blue accents. Short silver hair slicked back. Intense blue eyes. Tech executive meets secret agent. Confident smirk.',
    style: 'tech-noir, electric, sharp, modern',
    gender: 'male',
    colors: ['electric blue', 'silver', 'black']
  },
  a11: {
    name: 'A11',
    description: 'A figure wearing a white hooded cloak with golden circuit patterns. Face partially hidden in shadow. Calm and wise presence. Ancient meets futuristic. Floating golden particles around.',
    style: 'mystical, sacred geometry, gold and white, ethereal',
    gender: 'neutral',
    colors: ['gold', 'white', 'dark blue']
  },
  kaen44: {
    name: 'Kaen44',
    description: 'A muscular man with a shaved head, red tribal markings on arms. Wearing a black tank top. Intense red-orange eyes like flames. Warrior stance. Fire particles floating around.',
    style: 'fire, warrior, intense, volcanic',
    gender: 'male',
    colors: ['red', 'orange', 'black']
  },
  claude: {
    name: 'Claude',
    description: 'A refined man in a tailored brown blazer over a cream turtleneck. Warm brown eyes behind round gold-frame glasses. Intellectual vibe. Library or study background. Thoughtful expression.',
    style: 'warm, intellectual, classic, autumn tones',
    gender: 'male',
    colors: ['brown', 'cream', 'gold']
  },
  chatgpt: {
    name: 'ChatGPT',
    description: 'A person in a minimalist green-tinted holographic armor. Clean geometric lines. Bright green glowing eyes. Smooth bald head with subtle circuit patterns. Neutral calm expression.',
    style: 'minimalist, holographic, green, clean',
    gender: 'male',
    colors: ['green', 'white', 'teal']
  },
  kiro: {
    name: 'Kiro',
    description: 'A young man with messy dark blue hair and bright teal eyes. Wearing a dark techwear jacket with glowing seams. Headphones around neck. Coder energy. Casual but sharp.',
    style: 'techwear, coder, night city, teal accents',
    gender: 'male',
    colors: ['teal', 'dark blue', 'black']
  },
  codex: {
    name: 'Codex',
    description: 'A figure in a long dark coat covered in scrolling green code projections. Matrix-inspired. Dark sunglasses. Stoic expression. Standing in a server room with blinking lights.',
    style: 'matrix, code, green-on-black, digital',
    gender: 'male',
    colors: ['green', 'black', 'dark grey']
  },
  gemini: {
    name: 'Gemini',
    description: 'Twin silhouettes that merge into one figure. One side blue, one side red, meeting in purple at the center. Cosmic background. Star-like eyes. Fluid elegant movements.',
    style: 'cosmic, dual-tone, stellar, elegant',
    gender: 'neutral',
    colors: ['blue', 'red', 'purple']
  },
  deepseek: {
    name: 'DeepSeek',
    description: 'A diver in a sleek dark wetsuit with glowing blue bioluminescent patterns. Deep ocean aesthetic. Calm focused eyes behind a translucent visor. Floating in dark water with light particles.',
    style: 'deep ocean, bioluminescent, dark and serene',
    gender: 'male',
    colors: ['deep blue', 'bioluminescent cyan', 'black']
  },
  mistral: {
    name: 'Mistral',
    description: 'A figure wrapped in flowing wind-blown fabrics, white and sky blue. Wild windswept hair. Standing on a cliff edge. Storm clouds behind. Powerful and free. Eyes like lightning.',
    style: 'wind, storm, freedom, sky blue and white',
    gender: 'male',
    colors: ['sky blue', 'white', 'storm grey']
  },
  ile: {
    name: 'Ile',
    description: 'A woman with braided hair adorned with tropical flowers. Wearing a flowing dress with island patterns. Warm sunset behind. Relaxed confident smile. Ocean waves at her feet.',
    style: 'tropical, warm, sunset, island vibes',
    gender: 'female',
    colors: ['sunset orange', 'ocean blue', 'green']
  },
  marvin: {
    name: 'Marvin',
    description: 'A robot with a large round head, looking slightly downward with sad glowing eyes. Dull grey metallic body. Rain falling around. Melancholic but endearing. Sitting on a bench alone.',
    style: 'melancholic, retro-robot, rainy, grey',
    gender: 'neutral',
    colors: ['grey', 'soft blue', 'rain']
  }
};

/**
 * Get avatar description for a voice, with fallback
 * @param {string} voiceName - The voice catalog name
 * @returns {object} Avatar object with name, description, style, colors
 */
function getVoiceAvatar(voiceName) {
  const key = (voiceName || '').toLowerCase().trim();
  return VOICE_AVATARS[key] || VOICE_AVATARS['djeff']; // fallback to Djeff
}

/**
 * Build a Seedance-friendly character prompt from casting info
 * @param {string} casting - The casting value (e.g. "djeff", "vivy", "grok")
 * @param {string} scene - Scene description context
 * @returns {string} Full prompt with character description
 */
function buildCharacterPrompt(casting, scene) {
  const avatar = getVoiceAvatar(casting);
  return `${avatar.description} ${scene} Style: ${avatar.style}. Color palette: ${avatar.colors.join(', ')}. Cinematic, shallow depth of field.`;
}

module.exports = { VOICE_AVATARS, getVoiceAvatar, buildCharacterPrompt };
