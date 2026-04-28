/**
 * A11 Prompt Self-Manager
 * 
 * Permet à A11 de gérer automatiquement la section "mindset/états mentaux"
 * de son system_prompt.txt en fonction des références culturelles découvertes.
 */

const fs = require('node:fs');
const path = require('node:path');

const SYSTEM_PROMPT_PATH = path.resolve(__dirname, '../system_prompt.txt');
const MENTAL_STATES_PATH = path.resolve(__dirname, '../A11_MENTAL_STATES.md');
const DISCOVERED_REFS_PATH = path.resolve(__dirname, '../runtime/discovered_references.json');

// Marker pour la section auto-gérée
const MINDSET_START_MARKER = '## États Mentaux — Combinaisons de Nindo et Mindsets';
const MINDSET_END_MARKER = 'Documentation complète : `A11_MENTAL_STATES.md`';

/**
 * Charge les références culturelles découvertes par A11
 */
function loadDiscoveredReferences() {
  try {
    if (fs.existsSync(DISCOVERED_REFS_PATH)) {
      const raw = fs.readFileSync(DISCOVERED_REFS_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (error) {
    console.warn('[PromptSelfManager] Failed to load discovered references:', error.message);
  }
  return {
    anime: [],
    manga: [],
    games: [],
    philosophy: [],
    lastUpdated: null,
  };
}

/**
 * Sauvegarde les références découvertes
 */
function saveDiscoveredReferences(refs) {
  try {
    const dir = path.dirname(DISCOVERED_REFS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      DISCOVERED_REFS_PATH,
      JSON.stringify({ ...refs, lastUpdated: new Date().toISOString() }, null, 2),
      'utf8'
    );
    return true;
  } catch (error) {
    console.error('[PromptSelfManager] Failed to save discovered references:', error.message);
    return false;
  }
}

/**
 * Ajoute une nouvelle référence découverte
 */
function addDiscoveredReference(category, reference) {
  const refs = loadDiscoveredReferences();
  
  if (!refs[category]) {
    refs[category] = [];
  }
  
  // Éviter les doublons
  const exists = refs[category].some(r => 
    r.name === reference.name || r.title === reference.title
  );
  
  if (!exists) {
    refs[category].push({
      ...reference,
      discoveredAt: new Date().toISOString(),
    });
    saveDiscoveredReferences(refs);
    return true;
  }
  
  return false;
}

/**
 * Génère un nouvel état mental basé sur des références
 */
function generateMentalState(name, principles, behavior, usage, capabilities) {
  return {
    name,
    principles,
    behavior,
    usage,
    capabilities,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Extrait la section mindset du system_prompt.txt
 */
function extractMindsetSection() {
  try {
    const content = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
    const startIdx = content.indexOf(MINDSET_START_MARKER);
    const endIdx = content.indexOf(MINDSET_END_MARKER);
    
    if (startIdx === -1 || endIdx === -1) {
      return null;
    }
    
    return content.substring(startIdx, endIdx + MINDSET_END_MARKER.length);
  } catch (error) {
    console.error('[PromptSelfManager] Failed to extract mindset section:', error.message);
    return null;
  }
}

/**
 * Met à jour la section mindset du system_prompt.txt
 */
function updateMindsetSection(newContent) {
  try {
    let content = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
    const startIdx = content.indexOf(MINDSET_START_MARKER);
    const endIdx = content.indexOf(MINDSET_END_MARKER);
    
    if (startIdx === -1 || endIdx === -1) {
      console.error('[PromptSelfManager] Mindset markers not found in system_prompt.txt');
      return false;
    }
    
    // Remplacer la section
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx + MINDSET_END_MARKER.length);
    
    content = before + newContent + after;
    
    // Backup avant modification
    const backupPath = SYSTEM_PROMPT_PATH + '.backup';
    fs.copyFileSync(SYSTEM_PROMPT_PATH, backupPath);
    
    // Écrire le nouveau contenu
    fs.writeFileSync(SYSTEM_PROMPT_PATH, content, 'utf8');
    
    console.log('[PromptSelfManager] Mindset section updated successfully');
    return true;
  } catch (error) {
    console.error('[PromptSelfManager] Failed to update mindset section:', error.message);
    return false;
  }
}

/**
 * Génère le contenu de la section mindset basé sur les références découvertes
 */
function generateMindsetContent(refs) {
  const states = [];
  
  // États de base (toujours présents)
  states.push({
    name: 'SHIKAI',
    emoji: '⚔️',
    principles: 'Naruto + One Piece',
    description: 'Détermination, parallélisation (Kage Bunshin), créativité',
    usage: 'tâches quotidiennes, développement standard',
  });
  
  states.push({
    name: 'BANKAI',
    emoji: '💥',
    principles: 'Bleach + Hunter x Hunter',
    description: 'Concentration maximale, toutes ressources activées, stratégie complexe',
    usage: 'bugs critiques, deadlines serrées, urgences',
    cost: '-1 cœur initial, -0.5 cœur/heure',
  });
  
  states.push({
    name: 'QI VIVE',
    emoji: '👁️',
    principles: 'Bleach + Naruto + Attack on Titan',
    description: 'Surveillance active, détection précoce, anticipation des menaces',
    usage: 'déploiement prod, monitoring, sécurité',
    triggers: 'erreur 503, timeout LLM, database down',
  });
  
  // Ajouter des états dynamiques basés sur les références découvertes
  if (refs.anime.length > 0 || refs.manga.length > 0) {
    // Analyser les nouvelles références et créer des états si pertinent
    // TODO: Implémenter la logique de génération automatique d'états
  }
  
  // Générer le markdown
  let content = MINDSET_START_MARKER + '\n\n';
  content += 'Je peux entrer dans différents **états mentaux** qui combinent plusieurs principes d\'anime/manga pour adapter mon comportement selon le contexte.\n\n';
  content += '### États Disponibles\n\n';
  
  states.forEach((state, idx) => {
    content += `${idx + 1}. **${state.name}** ${state.emoji || ''} — ${state.principles}\n`;
    content += `   - ${state.description}\n`;
    content += `   - Usage : ${state.usage}\n`;
    if (state.cost) content += `   - Coût : ${state.cost}\n`;
    if (state.triggers) content += `   - Triggers : ${state.triggers}\n`;
    content += '\n';
  });
  
  content += '### Activation\n\n';
  content += '- **Automatique** : Je détecte le contexte et active l\'état optimal\n';
  content += '- **Manuelle** : Jeffrey peut demander "A11, passe en mode Bankai"\n';
  content += '- **Fusion** : Je peux combiner plusieurs états (ex: Bankai + Qi Vive)\n\n';
  
  content += '### Effets Sonores\n\n';
  content += 'Chaque état a sa signature sonore TTS :\n';
  content += '- [SFX:shikai] — dégainage léger\n';
  content += '- [SFX:bankai] — explosion de puissance\n';
  content += '- [SFX:alert] — radar actif (Qi Vive)\n';
  content += '- [SFX:gear5] — rire joyeux + tambours\n';
  content += '- [SFX:ui] — silence + aura (Ultra Instinct)\n';
  content += '- [SFX:domain] — barrière qui se déploie\n';
  content += '- [SFX:void] — écho dans le vide\n\n';
  
  content += MINDSET_END_MARKER;
  
  return content;
}

/**
 * Analyse un texte pour détecter des références culturelles
 */
function detectReferences(text) {
  const detected = {
    anime: [],
    manga: [],
    games: [],
    philosophy: [],
  };
  
  const animePatterns = [
    { name: 'Naruto', keywords: ['naruto', 'sharingan', 'rasengan', 'hokage', 'ninja'] },
    { name: 'Bleach', keywords: ['bleach', 'bankai', 'shinigami', 'hollow', 'zanpakuto'] },
    { name: 'One Piece', keywords: ['one piece', 'luffy', 'gear', 'haki', 'pirate'] },
    { name: 'Dragon Ball', keywords: ['dragon ball', 'goku', 'saiyan', 'kamehameha', 'ultra instinct'] },
    { name: 'Attack on Titan', keywords: ['attack on titan', 'titan', 'eren', 'survey corps'] },
    { name: 'Hunter x Hunter', keywords: ['hunter x hunter', 'nen', 'gon', 'killua'] },
    { name: 'Jujutsu Kaisen', keywords: ['jujutsu kaisen', 'domain expansion', 'cursed energy'] },
    { name: 'Mob Psycho 100', keywords: ['mob psycho', 'esper', 'psychic'] },
    { name: 'Steins;Gate', keywords: ['steins gate', 'time travel', 'el psy kongroo'] },
  ];
  
  const gamePatterns = [
    { name: 'Dark Souls', keywords: ['dark souls', 'bonfire', 'hollow', 'estus'] },
    { name: 'Hollow Knight', keywords: ['hollow knight', 'void', 'pale king', 'radiance'] },
    { name: 'Zelda', keywords: ['zelda', 'link', 'triforce', 'master sword', 'heart container'] },
  ];
  
  const lowerText = text.toLowerCase();
  
  animePatterns.forEach(pattern => {
    if (pattern.keywords.some(kw => lowerText.includes(kw))) {
      detected.anime.push({
        name: pattern.name,
        confidence: 0.8,
        keywords: pattern.keywords.filter(kw => lowerText.includes(kw)),
      });
    }
  });
  
  gamePatterns.forEach(pattern => {
    if (pattern.keywords.some(kw => lowerText.includes(kw))) {
      detected.games.push({
        name: pattern.name,
        confidence: 0.8,
        keywords: pattern.keywords.filter(kw => lowerText.includes(kw)),
      });
    }
  });
  
  return detected;
}

/**
 * Propose un nouvel état mental basé sur une référence
 */
function proposeNewState(reference) {
  // TODO: Utiliser un LLM pour générer un état mental cohérent
  // basé sur la référence culturelle découverte
  
  return {
    name: `NEW_STATE_${reference.name.toUpperCase().replace(/\s+/g, '_')}`,
    principles: reference.name,
    description: `État inspiré de ${reference.name}`,
    usage: 'À définir',
    needsValidation: true,
  };
}

module.exports = {
  loadDiscoveredReferences,
  saveDiscoveredReferences,
  addDiscoveredReference,
  generateMentalState,
  extractMindsetSection,
  updateMindsetSection,
  generateMindsetContent,
  detectReferences,
  proposeNewState,
};
