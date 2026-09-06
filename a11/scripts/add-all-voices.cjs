'use strict';
/**
 * add-all-voices.cjs — Script pour ajouter toutes les voix au catalogue NOSSEN.
 *
 * USAGE :
 *   1. Sur le serveur EX44 : docker exec a11-backend-green node /app/scripts/add-all-voices.cjs
 *   2. Localement (dev) : node add-all-voices.cjs
 *
 * COMMENT OBTENIR UN voiceId SUNO :
 *   - Va sur suno.ai/create, section "Personas"
 *   - Upload un échantillon vocal (10-30s, propre, voix seule)
 *   - Copie l'ID de la persona créée (32 hex dans l'URL)
 *   - Colle-le ci-dessous dans VOICES_TO_ADD
 *
 * Le script refuse d'écraser une voix existante active — il ne fait qu'ajouter.
 * Pour remplacer une voix expirée, utilise persona-recovery.cjs.
 */

const path = require('path');

// Charger le catalogue
let catalog;
try {
  catalog = require(path.resolve(__dirname, '../backend/apps/server/src/music/voice-catalog.cjs'));
} catch (_) {
  try {
    catalog = require('/app/src/music/voice-catalog.cjs');
  } catch (_2) {
    console.error('Impossible de charger voice-catalog.cjs');
    process.exit(1);
  }
}

/**
 * LISTE DES VOIX A AJOUTER
 *
 * Pour chaque voix, remplis le voiceId avec l'identifiant Suno 32 hex.
 * Laisse "" pour les voix pas encore créées — elles seront ignorées.
 *
 * consentBy = qui a donné le consentement (obligatoire)
 * gender = 'male' | 'female' | 'neutral' (aide l'auto-DJ)
 * style = description libre du timbre pour le profilage
 */
const VOICES_TO_ADD = [
  {
    name: 'vivy',
    label: 'Vivy',
    voiceId: '', // TODO: créer persona Suno avec un échantillon de Vivy
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'female',
    style: 'Voix féminine claire, pop/électro, aiguë et lumineuse',
    aliases: ['viviane', 'vivy-nossen'],
  },
  {
    name: 'a11',
    label: 'A11',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'male',
    style: 'Voix masculine robotique/androïde, grave, métallique',
    aliases: ['alpha-onze', 'alphaonze'],
  },
  {
    name: 'kaen44',
    label: 'Kaen44',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'female',
    style: 'Voix féminine douce, méditative, soignante',
    aliases: ['kaen', 'k44'],
  },
  {
    name: 'rei33',
    label: 'Rei33',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'male',
    style: 'Voix masculine électrique, intense, précise',
    aliases: ['rei'],
  },
  {
    name: 'chopper',
    label: 'Chopper',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'male',
    style: 'Voix masculine brute, mécanique, rugueuse',
    aliases: ['chop', 'westside-chopper'],
  },
  {
    name: 'rome',
    label: 'Rome',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'male',
    style: 'Voix masculine posée, narrative, théâtrale',
    aliases: ['rome-runner'],
  },
  {
    name: 'qflush',
    label: 'Qflush',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'neutral',
    style: 'Voix neutre, flux rapide, glitchée, digitale',
    aliases: ['flush', 'q-flush'],
  },
  {
    name: 'jean',
    label: 'Jean',
    voiceId: '', // TODO: créer persona Suno avec voix de Jean
    owner: 'Jean',
    consentBy: 'jean',
    gender: 'male',
    style: 'Voix masculine grave, posée, paternelle',
    aliases: ['jean-funesterie'],
  },
  {
    name: 'maman',
    label: 'Maman',
    voiceId: '', // TODO: créer persona Suno avec voix de Maman
    owner: 'Maman',
    consentBy: 'maman',
    gender: 'female',
    style: 'Voix féminine chaleureuse, maternelle, mélodieuse',
    aliases: ['mama'],
  },
  {
    name: 'henry',
    label: 'Henry',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'male',
    style: 'Voix masculine classe, sophistiquée, élégante',
    aliases: ['henri'],
  },
  {
    name: 'bloop',
    label: 'Bloop',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'neutral',
    style: 'Voix enfantine, curieuse, légère, bulle',
    aliases: [],
  },
  {
    name: 'piccolo',
    label: 'Piccolo',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'male',
    style: 'Voix masculine sage, ancienne, bienveillante',
    aliases: [],
  },
  {
    name: 'cortex',
    label: 'Cortex',
    voiceId: '', // TODO: créer persona Suno
    owner: 'Funesterie',
    consentBy: 'djeff',
    gender: 'neutral',
    style: 'Voix neutre analytique, rapide, froide, précise',
    aliases: [],
  },
];

// ─── EXECUTION ───────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

let added = 0;
let skipped = 0;
let missing = 0;

for (const voice of VOICES_TO_ADD) {
  if (!voice.voiceId || voice.voiceId.length !== 32) {
    console.log(`  SKIP ${voice.name}: pas de voiceId (TODO: créer sur Suno)`);
    missing++;
    continue;
  }

  // Vérifier si déjà dans le catalogue
  const existing = catalog.findVoiceInCatalog
    ? catalog.findVoiceInCatalog(voice.name)
    : null;

  if (existing && existing.active && !FORCE) {
    console.log(`  SKIP ${voice.name}: déjà actif (${existing.voiceId.slice(0, 8)}...)`);
    skipped++;
    continue;
  }

  const entry = {
    name: voice.name,
    label: voice.label,
    voiceId: voice.voiceId,
    owner: voice.owner,
    consentBy: voice.consentBy,
    gender: voice.gender || 'neutral',
    style: voice.style || '',
    aliases: voice.aliases || [],
    addedBy: 'add-all-voices-script',
    addedAt: new Date().toISOString(),
  };

  if (DRY_RUN) {
    console.log(`  DRY ${voice.name}: serait ajouté (${voice.voiceId.slice(0, 8)}...)`);
    added++;
    continue;
  }

  try {
    catalog.upsertVoiceInCatalog(entry);
    console.log(`  OK  ${voice.name}: ajouté (${voice.voiceId.slice(0, 8)}...)`);
    added++;
  } catch (err) {
    console.error(`  ERR ${voice.name}: ${err.message}`);
  }
}

console.log(`\n─── Résultat ───`);
console.log(`  Ajoutés  : ${added}`);
console.log(`  Ignorés  : ${skipped} (déjà actifs)`);
console.log(`  Manquants: ${missing} (pas de voiceId Suno)`);
console.log(`  Total    : ${VOICES_TO_ADD.length}`);

if (missing > 0) {
  console.log(`\n─── VOIX A CREER SUR SUNO ───`);
  for (const voice of VOICES_TO_ADD) {
    if (!voice.voiceId || voice.voiceId.length !== 32) {
      console.log(`  ${voice.name} (${voice.style})`);
      console.log(`    → Upload un échantillon de ${voice.label} sur suno.ai/create → Personas`);
      console.log(`    → Copie l'ID hex 32 chars dans le script, champ voiceId`);
    }
  }
}

if (DRY_RUN) console.log('\n(dry-run, rien écrit)');
