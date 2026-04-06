import fs from "fs";
import * as path from 'path';

export type SecretMatch = {
  file: string;
  pattern: string;
  match: string;
  index: number;
  line: number;
  snippet: string;
};

const SECRET_PATTERNS: RegExp[] = [
  /ghp_[0-9A-Za-z]{30,}/g,                // GitHub token (legacy / variants)
  /gho_[0-9A-Za-z]{30,}/g,                // GitHub OAuth variants
  /AIza[0-9A-Za-z\-_]{35}/g,              // Google API key style
  /sk-[0-9a-zA-Z]{32,}/g,                 // OpenAI / Stripe style
  /AKIA[0-9A-Z]{16}/g,                    // AWS access key
  /ya29\.[0-9A-Za-z\-_\.]+/g,             // Google OAuth token-ish
  /xox[baprs]-[0-9A-Za-z-]+/g,            // Slack tokens
  /-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA )?PRIVATE KEY-----/g,
  new RegExp('password\\s*[:=]\\s*["\\\']?.{4,}', 'gi') // password = ...
];

/** Retourne le numéro de ligne (1-based) pour un index dans la string */
function lineNumberFor(text: string, index: number): number {
  if (index <= 0) return 1;
  return text.slice(0, index).split(/\r\n|\r|\n/).length;
}

/** Récupère extrait centré sur l'index (safe) */
function snippetAt(text: string, index: number, radius = 40): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\r?\n/g, ' ');
}

/**
 * Scanne un fichier pour les secrets et retourne les correspondances.
 * - filePath: chemin absolu ou relatif vers le fichier texte à scanner.
 */
export function scanFileForSecrets(filePath: string): SecretMatch[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`fichier introuvable: ${abs}`);
  }

  const text = fs.readFileSync(abs, 'utf8');
  const results: SecretMatch[] = [];

  for (const regexOrig of SECRET_PATTERNS) {
    // clone regex pour éviter l'état lastIndex partagé
    const flags = regexOrig.flags.includes('g') ? regexOrig.flags : regexOrig.flags + 'g';
    const regex = new RegExp(regexOrig.source, flags);

    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const idx = m.index;
      results.push({
        file: abs,
        pattern: regexOrig.toString(),
        match: m[0],
        index: idx,
        line: lineNumberFor(text, idx),
        snippet: snippetAt(text, idx, 60)
      });
      // sécurité anti-boucle si regex vide
      if (m.index === regex.lastIndex) { regex.lastIndex++; }
    }
  }

  return results;
}