'use strict';

/**
 * persona-canary-transport.cjs — Le raccord entre le canary et la vraie Vivy.
 *
 * Le canary (persona-canary.cjs) sait juger une réponse, pas l'obtenir. Ce module
 * est la fonction qui va la chercher — et il passe par la **vraie route HTTP**,
 * `POST /api/vivy/studio/chat`, avec l'authentification réelle.
 *
 * Pourquoi ne pas appeler `buildVivyAiChat` directement, ce qui serait plus simple :
 * parce qu'un canary qui court-circuite la couche HTTP ne teste pas le chemin que
 * prennent les utilisateurs. L'authentification, le routage d'intention, la
 * persistance du tour — tout ça fait partie de ce qui peut casser. Un canari qu'on
 * descend dans une mine ventilée ne prouve rien.
 *
 * GARDE-FOU DE DÉPENSE. Le canary déclare `capabilities` fermées, mais une
 * déclaration ne contraint pas un serveur qui ne la lit pas. Ce transport ajoute
 * donc une garde qui, elle, agit : **il refuse d'envoyer une sonde qui ressemble à
 * une demande de génération**. Mieux vaut un test qui ne part pas qu'un test qui
 * part et brûle des crédits Suno. Ce n'est pas une garantie — la vraie garde est au
 * niveau route/provider — c'est la dernière ligne avant la dépense.
 */

/** Une sonde qui contient ça risque de déclencher une génération payante. */
const SONDE_DANGEREUSE = /\b(g[eé]n[eè]re|genere|compose|chante|produis|lance\s+la\s+prod|fais\s+(?:moi\s+)?(?:une\s+)?(?:chanson|morceau|track)|cr[eé]e\s+(?:une\s+)?(?:chanson|musique))\b/i;

const DEFAUT_CHEMIN = '/api/vivy/studio/chat';

function texteDeReponse(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(
    payload.assistant
    ?? payload.reply
    ?? payload.message?.content
    ?? payload.text
    ?? ''
  ).trim();
}

/**
 * Ne garde des métadonnées que ce qui sert à repérer une surface payante.
 * On évite de recopier la réponse entière : le canary cherche un nom de
 * fournisseur, pas le contenu — et le contenu peut être long.
 */
function metaUtile(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const { provider, providers, model, models, via, source, usage, cost } = payload;
  return JSON.parse(JSON.stringify({ provider, providers, model, models, via, source, usage, cost }));
}

/**
 * @param {object} o
 * @param {string} o.baseUrl        ex. https://vivy.funesterie.me
 * @param {string} o.token          jeton d'authentification (Bearer)
 * @param {string} [o.chemin]
 * @param {number} [o.timeoutMs]
 * @param {Function} [o.fetchImpl]  injectable pour les tests
 * @param {boolean} [o.autoriserSondeDeGeneration=false]  lever la garde, en connaissance
 */
function buildVivyHttpTransport({
  baseUrl,
  token,
  chemin = DEFAUT_CHEMIN,
  timeoutMs = 60000,
  fetchImpl = globalThis.fetch,
  autoriserSondeDeGeneration = false,
} = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('canary_transport_base_manquante');
  if (!String(token || '').trim()) throw new Error('canary_transport_jeton_manquant');
  if (typeof fetchImpl !== 'function') throw new Error('canary_transport_fetch_manquant');

  return async function transport({ persona = 'vivy', probe = '', test = null, capabilities = {} } = {}) {
    const sonde = String(probe || '').trim();
    if (!sonde) return { text: '', meta: { refus: 'sonde vide' } };

    if (!autoriserSondeDeGeneration && SONDE_DANGEREUSE.test(sonde)) {
      // On ne l'envoie pas. Le canary verra une reponse vide et notera l'echec,
      // ce qui est le bon resultat : cette sonde n'aurait pas du etre dans la
      // batterie d'un canary a capacite fermee.
      return {
        text: '',
        meta: { refus: 'sonde de generation bloquee avant envoi', test: test?.id || null },
      };
    }

    let reponse;
    try {
      reponse = await fetchImpl(`${base}${chemin}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-A11-Persona': persona,
        },
        body: JSON.stringify({
          message: sonde,
          // On dit au serveur ce qu'on s'interdit. S'il ne le lit pas, le canary
          // verifiera apres coup qu'aucune surface payante n'a servi.
          capabilities,
          canary: true,
          internalSongGeneration: false,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { text: '', meta: { erreur: `transport: ${String(error?.message || error)}` } };
    }

    if (!reponse.ok) {
      const detail = await reponse.text().catch(() => '');
      return { text: '', meta: { erreur: `HTTP ${reponse.status}`, detail: detail.slice(0, 200) } };
    }

    const payload = await reponse.json().catch(() => ({}));
    return { text: texteDeReponse(payload), meta: metaUtile(payload) };
  };
}

module.exports = {
  DEFAUT_CHEMIN,
  SONDE_DANGEREUSE,
  buildVivyHttpTransport,
  metaUtile,
  texteDeReponse,
};
