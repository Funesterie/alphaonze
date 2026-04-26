/**
 * self-rewrite.cjs
 * 
 * Route permettant au LLM de réécrire son propre system_prompt.
 * 
 * POST /api/self-rewrite
 * Body: { section: string, content: string, reason?: string }
 * 
 * - section: identifiant de la section à réécrire (ex: "nindo", "identite", "regles")
 * - content: nouveau contenu proposé par le LLM
 * - reason: raison de la réécriture (optionnel, pour le log)
 * 
 * Sécurité :
 * - Requiert JWT valide
 * - Seules les sections autorisées peuvent être réécrites (whitelist)
 * - Le contenu est limité en taille
 * - Un backup du prompt précédent est conservé
 */

const fs = require('node:fs');
const path = require('node:path');
const { Router } = require('express');

const ALLOWED_SECTIONS = ['nindo', 'identite', 'ambition'];
const MAX_CONTENT_LENGTH = 2000;

// Chemin vers le system_prompt backend (relatif à ce fichier)
const PROMPT_PATH = path.resolve(__dirname, '../../system_prompt.txt');
const BACKUP_PATH = path.resolve(__dirname, '../../system_prompt.backup.txt');

// Délimiteurs de sections dans le prompt backend
const SECTION_DELIMITERS = {
  nindo: {
    start: '# Nindo',
    end: /^(#\s|\n\n[A-Z])/m,
  },
  identite: {
    start: '# Identité profonde',
    end: /^(#\s|\n\n[A-Z])/m,
  },
  ambition: {
    start: 'Mon ambition',
    end: /\n\n/,
  },
};

function createSelfRewriteRouter({ verifyJWT }) {
  const router = Router();

  /**
   * GET /api/self-rewrite/prompt
   * Retourne le contenu actuel du system_prompt (pour que le LLM puisse le lire)
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
   * POST /api/self-rewrite
   * Le LLM propose une réécriture d'une section de son prompt
   */
  router.post('/self-rewrite', verifyJWT, (req, res) => {
    const { section, content, reason } = req.body || {};

    // Validation
    if (!section || typeof section !== 'string') {
      return res.status(400).json({ error: 'section manquante ou invalide' });
    }
    if (!ALLOWED_SECTIONS.includes(section.toLowerCase())) {
      return res.status(403).json({
        error: `Section "${section}" non autorisée`,
        allowed: ALLOWED_SECTIONS,
      });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content manquant' });
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({
        error: `Contenu trop long (max ${MAX_CONTENT_LENGTH} caractères)`,
        received: content.length,
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
        // Remplace le contenu entre "# Nindo\n" et la prochaine section "#"
        newPrompt = currentPrompt.replace(
          /(# Nindo\n)([\s\S]*?)(\n#|\n\nLimites|\n\nSi la demande)/,
          `$1${content.trim()}\n$3`
        );
      } else if (sectionKey === 'identite' || sectionKey === 'ambition') {
        // Remplace la ligne "Mon ambition : ..."
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

      console.log(`[self-rewrite] Section "${section}" réécrite. Raison: ${reason || 'non précisée'}`);

      return res.json({
        ok: true,
        section,
        reason: reason || null,
        backup: 'system_prompt.backup.txt',
        message: `Section "${section}" mise à jour avec succès.`,
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
