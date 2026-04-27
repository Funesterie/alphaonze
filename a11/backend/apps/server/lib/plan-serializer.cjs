'use strict';

/**
 * plan-serializer.cjs
 * Sérialiseur/désérialiseur de Plans pour A11 Autonomous Action System.
 *
 * Schéma : { steps: Array<{ skill: string, payload: object, id?: string }> }
 *
 * Exigences : 9.1, 9.2, 9.3, 9.4
 */

/** Préfixes de skills autorisés */
const ALLOWED_PREFIXES = [
  'a11d.fs.',
  'a11d.shell.',
  'a11d.git.',
  'a11d.tests.',
  'a11d.vs.',
  'a11d.qf.',
  'a11d.ui.',
  'a11d.web.',
  'a11d.llm.',
];

/**
 * Vérifie qu'un skill commence par l'un des préfixes autorisés.
 * @param {string} skill
 * @returns {boolean}
 */
function isAllowedSkill(skill) {
  if (typeof skill !== 'string' || skill.length === 0) return false;
  return ALLOWED_PREFIXES.some((prefix) => skill.startsWith(prefix));
}

/**
 * Valide un Plan et retourne les erreurs trouvées.
 *
 * @param {unknown} plan - L'objet Plan à valider.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(plan) {
  const errors = [];

  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    errors.push('Le plan doit être un objet non-null.');
    return { valid: false, errors };
  }

  if (!Array.isArray(plan.steps)) {
    errors.push('Le plan doit contenir un tableau "steps".');
    return { valid: false, errors };
  }

  if (plan.steps.length < 1) {
    errors.push('Le plan doit contenir au minimum 1 step.');
  }

  if (plan.steps.length > 50) {
    errors.push(`Le plan contient ${plan.steps.length} steps, le maximum autorisé est 50.`);
  }

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    if (step === null || typeof step !== 'object' || Array.isArray(step)) {
      errors.push(`Step[${i}] : doit être un objet non-null.`);
      continue;
    }

    // Validation du skill
    if (typeof step.skill !== 'string' || step.skill.length === 0) {
      errors.push(`Step[${i}] : "skill" doit être une string non-vide.`);
    } else if (!isAllowedSkill(step.skill)) {
      errors.push(
        `Step[${i}] : skill "${step.skill}" ne commence par aucun préfixe autorisé (${ALLOWED_PREFIXES.join(', ')}).`
      );
    }

    // Validation du payload
    if (
      step.payload === null ||
      typeof step.payload !== 'object' ||
      Array.isArray(step.payload)
    ) {
      errors.push(`Step[${i}] : "payload" doit être un objet non-null et non-tableau.`);
    }

    // Validation de l'id optionnel
    if ('id' in step && step.id !== undefined && typeof step.id !== 'string') {
      errors.push(`Step[${i}] : "id" doit être une string si présent.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Sérialise un Plan en JSON lisible (indentation 2 espaces).
 *
 * @param {{ steps: Array<{ skill: string, payload: object, id?: string }> }} plan
 * @returns {string} JSON sérialisé
 * @throws {Error} Si le plan est invalide
 */
function serialize(plan) {
  const { valid, errors } = validate(plan);
  if (!valid) {
    throw new Error(`Impossible de sérialiser un plan invalide : ${errors.join(' | ')}`);
  }
  return JSON.stringify(plan, null, 2);
}

/**
 * Désérialise un JSON en Plan valide.
 *
 * @param {string} json - La chaîne JSON à parser.
 * @returns {{ steps: Array<{ skill: string, payload: object, id?: string }> }}
 * @throws {Error} Si le JSON est invalide ou si le plan ne respecte pas le schéma
 */
function deserialize(json) {
  let parsed;

  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`JSON invalide : ${err.message}`);
  }

  // Validation structurelle de base
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Le JSON désérialisé doit être un objet non-null.');
  }

  if (!Array.isArray(parsed.steps)) {
    throw new Error('Le plan désérialisé doit contenir un tableau "steps".');
  }

  // Validation de chaque step avec index descriptif
  for (let i = 0; i < parsed.steps.length; i++) {
    const step = parsed.steps[i];

    if (step === null || typeof step !== 'object' || Array.isArray(step)) {
      throw new Error(`Step[${i}] invalide : doit être un objet non-null.`);
    }

    if (typeof step.skill !== 'string' || step.skill.length === 0) {
      throw new Error(
        `Step[${i}] invalide : "skill" doit être une string non-vide (reçu : ${JSON.stringify(step.skill)}).`
      );
    }

    if (
      step.payload === null ||
      typeof step.payload !== 'object' ||
      Array.isArray(step.payload)
    ) {
      throw new Error(
        `Step[${i}] invalide : "payload" doit être un objet non-null et non-tableau (reçu : ${JSON.stringify(step.payload)}).`
      );
    }

    if ('id' in step && step.id !== undefined && typeof step.id !== 'string') {
      throw new Error(
        `Step[${i}] invalide : "id" doit être une string si présent (reçu : ${JSON.stringify(step.id)}).`
      );
    }
  }

  return parsed;
}

module.exports = { serialize, deserialize, validate, ALLOWED_PREFIXES };
