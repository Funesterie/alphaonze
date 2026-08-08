'use strict';

/**
 * Reanimation automatique des personas Suno mortes du catalogue.
 *
 * Ce que ce runner peut, et ce qu'il ne peut pas. Une persona ne meurt pas en nous
 * prevenant: le drapeau `personaExpiredAt` n'est pose qu'au moment ou une generation
 * echoue chez Suno (553, « voice persona generation failed »). Aucun balayage ne peut
 * donc anticiper un deces -- le premier morceau touche est perdu quoi qu'il arrive.
 * Ce que le balayage evite, c'est le SECOND: une voix declaree morte est refabriquee
 * entre deux chansons au lieu d'attendre que quelqu'un la redemande et se retrouve
 * devant un refus.
 *
 * Ile, 08/08/2026: persona morte a 18h29, personne ne l'a su, et les morceaux
 * suivants sont sortis chantes par une autre voix. Voir vivy-studio.cjs, le refus
 * `suno_catalog_voice_expired`.
 *
 * Memes garde-fous que le runner d'echantillons, pour la meme raison -- une voix qui
 * echoue en boucle brulerait des credits sans fin:
 *
 *   1. Verrou de concurrence: une seule campagne a la fois.
 *   2. Plafond d'essais par voix, porte par canAttemptRecovery.
 *   3. Delai entre deux tentatives sur la meme voix, idem.
 *   4. Budget par campagne: une seule voix par defaut, chaque reanimation coutant
 *      une generation Suno (12 credits mesures sur Ile).
 */

const { readVoiceCatalog } = require('./voice-catalog.cjs');
const { canAttemptRecovery, recoverPersonaFromSample } = require('./persona-recovery.cjs');

// Une seule voix par campagne: la reanimation coute des credits reels, et rien
// n'exige de toutes les traiter d'un coup. La campagne suivante prendra la suivante.
const MAX_PER_RUN = 1;

let campagneEnCours = false;

function intConfig(env, key, fallback) {
  const raw = Number(env?.[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Une voix morte merite-t-elle une reanimation maintenant ? */
function needsRevival(entry, env = process.env) {
  // canAttemptRecovery couvre deja le drapeau de deces, la presence de l'echantillon,
  // le plafond d'essais et le delai. Il ignore en revanche `active`: une voix retiree
  // du catalogue ne doit pas consommer de credits.
  if (!entry?.active) return false;
  return canAttemptRecovery(entry, env);
}

/** Les voix mortes reanimables, sans rien tenter. Sert aussi au diagnostic. */
function listRevivableVoices(env = process.env) {
  const catalogue = readVoiceCatalog(env);
  return (catalogue.voices || []).filter((entry) => needsRevival(entry, env));
}

/**
 * Reanime les personas mortes, dans la limite du budget de campagne.
 *
 * @param {object}   o
 * @param {string}   o.apiKey
 * @param {string}   o.baseUrl
 * @param {Function} o.buildSampleUrl  (nom) => URL signee et publiquement joignable
 * @param {string}   o.callBackUrl
 */
async function runExpiredPersonaRevival({
  apiKey,
  baseUrl,
  buildSampleUrl,
  callBackUrl,
  env = process.env,
} = {}) {
  if (campagneEnCours) return { skipped: 'campagne_en_cours', treated: 0, résultats: [] };
  if (!apiKey) return { skipped: 'cle_suno_absente', treated: 0, résultats: [] };
  if (typeof buildSampleUrl !== 'function') {
    return { skipped: 'constructeur_url_absent', treated: 0, résultats: [] };
  }

  campagneEnCours = true;
  try {
    const budget = intConfig(env, 'A11_PERSONA_REVIVAL_MAX_PER_RUN', MAX_PER_RUN);
    const candidates = listRevivableVoices(env).slice(0, budget);
    const résultats = [];

    for (const entry of candidates) {
      // Sans echantillon joignable, Suno recoit un 404 et la tentative est perdue.
      // On le verifie avant d'appeler, pas apres avoir paye.
      const sampleUrl = buildSampleUrl(entry.name);
      if (!sampleUrl) {
        résultats.push({ name: entry.name, ok: false, error: 'sample_share_not_configured' });
        console.warn('[PersonaRevival] %s: echantillon non partageable, campagne sautee', entry.name);
        continue;
      }

      try {
        const out = await recoverPersonaFromSample(
          entry.name,
          { apiKey, baseUrl, sampleUrl, callBackUrl },
          env
        );
        résultats.push({ name: entry.name, ...out });
        if (out?.ok) console.info('[PersonaRevival] %s: voix reanimee (%s)', entry.name, out.idMask || '');
        else console.warn('[PersonaRevival] %s: reanimation refusee (%s)', entry.name, out?.error || 'motif inconnu');
      } catch (error) {
        // recoverPersonaFromSample tient deja le compteur d'essais du catalogue:
        // on journalise sans le decrementer ni le doubler ici.
        const message = String(error.message || error).slice(0, 200);
        résultats.push({ name: entry.name, ok: false, error: message });
        console.warn('[PersonaRevival] %s: echec (%s)', entry.name, message);
      }
    }

    return { treated: résultats.length, résultats };
  } finally {
    campagneEnCours = false;
  }
}

module.exports = {
  runExpiredPersonaRevival,
  listRevivableVoices,
  needsRevival,
  MAX_PER_RUN,
};
