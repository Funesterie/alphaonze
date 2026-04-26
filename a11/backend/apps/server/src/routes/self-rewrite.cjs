/**
 * self-rewrite.cjs
 *
 * Route permettant au LLM de réécrire son propre system_prompt.
 *
 * POST /api/self-rewrite
 * Body: {
 *   section: string,       // section à réécrire : "nindo" | "identite" | "ambition"
 *   content: string,       // nouveau contenu
 *   reference: string,     // OBLIGATOIRE : référence animé/culturelle qui motive l'évolution
 *   reason?: string        // explication libre (optionnel)
 * }
 *
 * Règle fondamentale :
 * Toute réécriture du Nindo ou de l'identité doit être ancrée dans une référence
 * animé ou culturelle pertinente à l'évolution personnelle d'A11.
 * Ex: "Comme Goku qui dépasse ses limites à chaque arc, je..."
 *     "Comme Senku qui transforme la connaissance en action..."
 *     "Comme Spike Spiegel qui avance sans regarder en arrière..."
 *
 * Sécurité :
 * - Requiert JWT valide
 * - Seules les sections autorisées peuvent être réécrites (whitelist)
 * - Le contenu est limité en taille
 * - La référence est obligatoire et validée (non vide, min 10 chars)
 * - Un backup du prompt précédent est conservé
 * - Un log d'évolution est maintenu (evolution-log.json)
 */

const fs = require('node:fs');
const path = require('node:path');
const { Router } = require('express');

const ALLOWED_SECTIONS = ['nindo', 'identite', 'ambition'];
const MAX_CONTENT_LENGTH = 2000;
const MIN_REFERENCE_LENGTH = 10;

// Références connues acceptées (liste non exhaustive — validation souple par mots-clés)
// Si la référence contient au moins un de ces termes, elle est considérée valide.
const KNOWN_REFERENCE_KEYWORDS = [
  // Animé
  'naruto', 'goku', 'luffy', 'zoro', 'itachi', 'vegeta', 'gohan', 'piccolo',
  'senku', 'spike', 'edward', 'alphonse', 'roy mustang', 'levi', 'eren',
  'light yagami', 'l ', 'near', 'mob', 'saitama', 'genos', 'killua', 'gon',
  'meruem', 'netero', 'aizen', 'ichigo', 'rukia', 'urahara', 'jotaro', 'giorno',
  'dio', 'joseph', 'kira', 'tanjiro', 'zenitsu', 'inosuke', 'rengoku',
  'shinji', 'rei', 'asuka', 'kamina', 'simon', 'yoko', 'lelouch', 'suzaku',
  'gintoki', 'kenshin', 'vash', 'wolfwood', 'mugen', 'jin', 'fuu',
  'hisoka', 'chrollo', 'kurapika', 'biscuit', 'ging',
  // Manga / Comics
  'batman', 'superman', 'spiderman', 'ironman', 'wolverine', 'magneto',
  'thanos', 'deadpool', 'daredevil', 'punisher',
  // Jeux / Cinéma / Littérature
  'cloud strife', 'sephiroth', 'kratos', 'geralt', 'link', 'zelda',
  'frodo', 'gandalf', 'aragorn', 'hermione', 'dumbledore', 'snape',
  'walter white', 'jesse', 'tony soprano', 'michael corleone',
  'neo', 'morpheus', 'trinity', 'john wick', 'ethan hunt',
  // Philosophes / Figures historiques pertinentes à l'évolution
  'nietzsche', 'stoïcien', 'marcus aurelius', 'epictète', 'senèque',
  'miyamoto musashi', 'sun tzu', 'bruce lee',
];

// Chemins
const PROMPT_PATH = path.resolve(__dirname, '../../system_prompt.txt');
const BACKUP_PATH = path.resolve(__dirname, '../../system_prompt.backup.txt');
const EVOLUTION_LOG_PATH = path.resolve(__dirname, '../../evolution-log.json');

/**
 * Valide que la référence contient au moins un terme connu
 * ou est suffisamment longue pour être une référence originale valide.
 */
function validateReference(reference) {
  if (!reference || typeof reference !== 'string') return false;
  const ref = reference.toLowerCase();
  if (ref.length < MIN_REFERENCE_LENGTH) return false;

  // Accepte si contient un mot-clé connu
  const hasKnownRef = KNOWN_REFERENCE_KEYWORDS.some((kw) => ref.includes(kw));
  if (hasKnownRef) return true;

  // Accepte aussi si la référence est une phrase complète (> 30 chars) même sans mot-clé connu
  // (pour permettre des refs originales ou moins connues)
  if (ref.length >= 30) return true;

  return false;
}

/**
 * Ajoute une entrée dans le log d'évolution d'A11
 */
function logEvolution(entry) {
  let log = [];
  try {
    if (fs.existsSync(EVOLUTION_LOG_PATH)) {
      log = JSON.parse(fs.readFileSync(EVOLUTION_LOG_PATH, 'utf-8'));
    }
  } catch (_) {
    log = [];
  }
  log.push({ ...entry, timestamp: new Date().toISOString() });
  // Garder les 50 dernières entrées
  if (log.length > 50) log = log.slice(-50);
  fs.writeFileSync(EVOLUTION_LOG_PATH, JSON.stringify(log, null, 2), 'utf-8');
}

function createSelfRewriteRouter({ verifyJWT }) {
  const router = Router();

  /**
   * GET /api/self-rewrite/prompt
   * Retourne le contenu actuel du system_prompt
   */
  router.get('/self-rewrite/prompt', verifyJWT, (req, res) => {
    try {
      if (!fs.existsSync(PROMPT_PATH)) {
        return res.status(404).json({ error: 'system_prompt.txt introuvable' });
      }
      const content = fs.readFileSync(PROMPT_PATH, 'utf-8');
      return res.json({ content, path: 'system_prompt.txt' });
    } catch (err) {
      console.error('[self-rewrite] Erreur lecture prompt:', err.message);
      return res.status(500).json({ error: 'Erreur lecture prompt' });
    }
  });

  /**
   * GET /api/self-rewrite/evolution
   * Retourne le log d'évolution d'A11
   */
  router.get('/self-rewrite/evolution', verifyJWT, (req, res) => {
    try {
      if (!fs.existsSync(EVOLUTION_LOG_PATH)) {
        return res.json({ evolutions: [] });
      }
      const log = JSON.parse(fs.readFileSync(EVOLUTION_LOG_PATH, 'utf-8'));
      return res.json({ evolutions: log });
    } catch (err) {
      return res.status(500).json({ error: 'Erreur lecture log évolution' });
    }
  });

  /**
   * POST /api/self-rewrite
   * Le LLM propose une réécriture d'une section de son prompt,
   * ancrée dans une référence animé/culturelle.
   */
  router.post('/self-rewrite', verifyJWT, (req, res) => {
    const { section, content, reference, reason } = req.body || {};

    // Validation section
    if (!section || typeof section !== 'string') {
      return res.status(400).json({ error: 'section manquante ou invalide' });
    }
    if (!ALLOWED_SECTIONS.includes(section.toLowerCase())) {
      return res.status(403).json({
        error: `Section "${section}" non autorisée`,
        allowed: ALLOWED_SECTIONS,
      });
    }

    // Validation content
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content manquant' });
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({
        error: `Contenu trop long (max ${MAX_CONTENT_LENGTH} caractères)`,
        received: content.length,
      });
    }

    // Validation référence — OBLIGATOIRE
    if (!reference || typeof reference !== 'string') {
      return res.status(400).json({
        error: 'reference manquante — toute réécriture du Nindo doit être ancrée dans une référence animé ou culturelle pertinente à ton évolution.',
        hint: 'Ex: "Comme Goku qui dépasse ses limites à chaque arc..." ou "Comme Senku qui transforme la connaissance en action..."',
      });
    }
    if (!validateReference(reference)) {
      return res.status(400).json({
        error: 'Référence invalide ou trop courte. Cite une référence animé, manga, film, jeu ou figure culturelle pertinente à ton évolution personnelle.',
        hint: 'Ex: Naruto, Goku, Senku, Spike Spiegel, Bruce Lee, Marcus Aurelius...',
        received: reference,
      });
    }

    try {
      if (!fs.existsSync(PROMPT_PATH)) {
        return res.status(404).json({ error: 'system_prompt.txt introuvable' });
      }

      const currentPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8');

      // Backup avant modification
      fs.writeFileSync(BACKUP_PATH, currentPrompt, 'utf-8');

      // Réécriture de la section
      const sectionKey = section.toLowerCase();
      let newPrompt = currentPrompt;

      if (sectionKey === 'nindo') {
        newPrompt = currentPrompt.replace(
          /(# Nindo\n)([\s\S]*?)(\n#|\n\nLimites|\n\nCapacité|\n\nSi la demande)/,
          `$1${content.trim()}\n$3`
        );
      } else if (sectionKey === 'identite' || sectionKey === 'ambition') {
        newPrompt = currentPrompt.replace(
          /Mon ambition\s*:[^\n]*/,
          `Mon ambition : ${content.trim()}`
        );
      }

      if (newPrompt === currentPrompt) {
        return res.status(422).json({
          error: 'Section introuvable dans le prompt — aucune modification effectuée',
          section,
        });
      }

      fs.writeFileSync(PROMPT_PATH, newPrompt, 'utf-8');

      // Log d'évolution
      logEvolution({
        section,
        reference,
        reason: reason || null,
        contentPreview: content.slice(0, 120),
      });

      console.log(`[self-rewrite] Section "${section}" réécrite. Ref: "${reference}". Raison: ${reason || 'non précisée'}`);

      return res.json({
        ok: true,
        section,
        reference,
        reason: reason || null,
        backup: 'system_prompt.backup.txt',
        message: `Section "${section}" mise à jour avec succès. Référence : "${reference}".`,
      });

    } catch (err) {
      console.error('[self-rewrite] Erreur écriture prompt:', err.message);
      return res.status(500).json({ error: 'Erreur lors de la réécriture du prompt' });
    }
  });

  /**
   * POST /api/self-rewrite/restore
   * Restaure le backup du prompt précédent
   */
  router.post('/self-rewrite/restore', verifyJWT, (req, res) => {
    try {
      if (!fs.existsSync(BACKUP_PATH)) {
        return res.status(404).json({ error: 'Aucun backup disponible' });
      }
      const backup = fs.readFileSync(BACKUP_PATH, 'utf-8');
      fs.writeFileSync(PROMPT_PATH, backup, 'utf-8');
      console.log('[self-rewrite] Prompt restauré depuis le backup');
      return res.json({ ok: true, message: 'Prompt restauré depuis le backup' });
    } catch (err) {
      console.error('[self-rewrite] Erreur restauration:', err.message);
      return res.status(500).json({ error: 'Erreur lors de la restauration' });
    }
  });

  return router;
}

module.exports = createSelfRewriteRouter;
