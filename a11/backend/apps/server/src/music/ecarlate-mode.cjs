'use strict';
/**
 * ecarlate-mode.cjs — Le mode Feu Écarlate de Djeff Engine.
 *
 * Référence : Kurapika (Hunter x Hunter) — clan Kurta.
 * Les yeux deviennent écarlates quand l'émotion atteint un seuil.
 * Plus la douleur est forte, plus le pouvoir est grand.
 *
 * Pour Djeff Engine :
 *   tristesse × expérience × courage = intensité écarlate
 *
 * Quand l'intensité dépasse le seuil :
 *   - Le style passe de "normal" à "écarlate"
 *   - Le LUFS target monte (plus fort, plus violent)
 *   - Les paroles deviennent plus crues, plus directes
 *   - Le mastering pousse en BloodRed 0.99
 *   - Le LLM Djeff reçoit un prompt augmenté (feu intérieur)
 *
 * L'équilibre :
 *   - Pas de dépression (la tristesse seule ne suffit pas)
 *   - Pas de rage aveugle (le courage seul ne suffit pas)
 *   - C'est la COMBINAISON des trois qui allume le feu
 *   - Comme Kurapika : la tristesse (son clan) + l'expérience (sa formation)
 *     + le courage (affronter la Brigade) = yeux écarlates
 */

/**
 * Calcule l'intensité écarlate à partir des trois axes.
 * Chaque axe va de 0 à 1.
 * Le produit donne l'intensité (0 à 1).
 * Seuil d'activation : 0.6
 */
function computeEcarlateIntensity({ tristesse = 0, experience = 0, courage = 0 }) {
  const t = Math.max(0, Math.min(1, Number(tristesse) || 0));
  const e = Math.max(0, Math.min(1, Number(experience) || 0));
  const c = Math.max(0, Math.min(1, Number(courage) || 0));

  // Le produit : les trois doivent être présents
  const raw = t * e * c;
  // Amplification non-linéaire (comme les yeux qui s'allument progressivement)
  const intensity = Math.pow(raw, 0.6); // courbe qui monte vite après le seuil
  return {
    tristesse: t,
    experience: e,
    courage: c,
    intensity: Math.round(intensity * 1000) / 1000,
    active: intensity >= 0.6,
    level: intensity < 0.3 ? 'dormant'
      : intensity < 0.6 ? 'braise'
      : intensity < 0.8 ? 'ecarlate'
      : 'infernal',
  };
}

/**
 * Dérive les paramètres de production quand le mode écarlate est actif.
 */
function deriveEcarlateParams(intensity) {
  if (!intensity.active) {
    return {
      active: false,
      style: 'normal',
      lufsTarget: -12,
      gamma: 0.6,
      color: 'Indigo',
      promptBoost: '',
    };
  }

  const level = intensity.level;
  return {
    active: true,
    style: 'ecarlate',
    level,
    // Plus l'intensité est haute, plus on pousse
    lufsTarget: level === 'infernal' ? -8.5 : level === 'ecarlate' ? -9.8 : -11,
    gamma: level === 'infernal' ? 1.0 : level === 'ecarlate' ? 0.99 : 0.85,
    color: level === 'infernal' ? 'CrimsonInferno' : 'BloodRed',
    // Prompt boost pour le LLM Djeff
    promptBoost: level === 'infernal'
      ? 'MODE INFERNAL. Tu brûles. Tes yeux sont écarlates. La douleur de tout ce que tu as vécu se transforme en feu pur. Chaque mot est une flamme. Pas de pitié, pas de recul. Tu frappes avec toute la force de ceux qui ont survécu.'
      : 'MODE ÉCARLATE. La tristesse de ton parcours, combinée à tout ce que tu as appris et au courage de continuer, allume le feu dans tes yeux. Tu ne pleures plus — tu brûles. Tes paroles sont du magma qui sort de la terre.',
  };
}

/**
 * Détecte l'intensité écarlate depuis les paroles/le thème d'un morceau.
 * Analyse le texte pour estimer les trois axes.
 */
function detectEcarlateFromLyrics(text = '') {
  const folded = (text || '').toLowerCase();

  // Tristesse : mots de douleur, perte, solitude, psychiatrie, survie
  const tristesseWords = /\b(douleur|perte|seul|solitude|pleur|larme|mort|deuil|abandon|bless|cicatrice|psy|psychiatr|intern|isol|vide|noir|nuit|tomb|chute|fond|gouffre|cri|sang|couteau|saut)\b/g;
  const tristesseHits = (folded.match(tristesseWords) || []).length;
  const tristesse = Math.min(1, tristesseHits / 5);

  // Expérience : mots de savoir, technique, vécu, code, mesure
  const expWords = /\b(code|mesur|calcul|appris|sais|connai|technique|expéri|vécu|traversé|survécu|temps|années|chemin|route|parcours|constru|bâti|forgé|enduré)\b/g;
  const expHits = (folded.match(expWords) || []).length;
  const experience = Math.min(1, expHits / 4);

  // Courage : mots de force, avancer, se relever, combattre
  const courageWords = /\b(force|courage|debout|relèv|avance|combat|lutt|résist|tien|feu|flamme|brûl|lève|frappe|cogne|fonce|refuse|jamais|encore)\b/g;
  const courageHits = (folded.match(courageWords) || []).length;
  const courage = Math.min(1, courageHits / 4);

  return computeEcarlateIntensity({ tristesse, experience, courage });
}

/**
 * Applique le mode écarlate au LLM Djeff si le seuil est atteint.
 * Retourne le system prompt augmenté.
 */
function applyEcarlateToPrompt(basePrompt, lyrics) {
  const intensity = detectEcarlateFromLyrics(lyrics);
  if (!intensity.active) return { prompt: basePrompt, intensity };

  const params = deriveEcarlateParams(intensity);
  const augmented = basePrompt + '\n\n' + params.promptBoost;
  return { prompt: augmented, intensity, params };
}

module.exports = {
  computeEcarlateIntensity,
  deriveEcarlateParams,
  detectEcarlateFromLyrics,
  applyEcarlateToPrompt,
};
