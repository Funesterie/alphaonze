'use strict';

/**
 * La sonnette — savoir qui repond AVANT de s'engager.
 *
 * Djeff, 09/08/2026 : « ca sert a rien d'attendre 25 sec si le model est pas dispo,
 * c'est comme au restaurant, ya plusieurs serveurs [...] la ou on peut etre malin
 * c'est la sonnette ».
 *
 * Le probleme mesure ce jour-la en prod : cinq fournisseurs essayes en serie, chacun
 * coupe apres sa fenetre, cinq echecs et 502 chez Cloudflare. Le budget etait
 * depense a decouvrir des indisponibilites, pas a produire du texte.
 *
 * On appelle donc tous les serveurs d'un coup, une seule fois, avec une question qui
 * ne coute rien : « tu es la ? ». GET /models est gratuit, ne consomme aucun jeton et
 * dit l'essentiel — la clef est-elle acceptee, le service repond-il, le modele
 * demande est-il dans la carte. Deux secondes et demie pour tout le monde, en
 * parallele, au lieu de vingt-deux secondes par refus decouvert un par un.
 *
 * Ce que la sonnette ne fait PAS, et il faut le savoir : elle ne garantit pas que la
 * generation aboutira. Un service peut repondre a /models puis limiter le debit sur
 * /chat/completions. Elle ecarte les morts certains, pas les capricieux. C'est deja
 * la difference entre cinq echecs garantis et deux tentatives credibles.
 */

const CACHE_OK_MS = 60000;      // un service qui repond le restera un moment
const CACHE_KO_MS = 20000;      // un service muet merite une seconde chance plus tot
const SONNERIE_TIMEOUT_MS = 2500;
const MAX_PARALLELE = 8;

// Cle -> { verdict, expireAt }. Borne par MAX_ENTREES pour ne pas fuir en memoire
// sur un catalogue de modeles qui changerait souvent.
const MAX_ENTREES = 200;
const memoire = new Map();

function maintenant() {
  return Date.now();
}

function cleDe(bundle) {
  return `${bundle?.provider || '?'}|${bundle?.baseURL || '?'}|${bundle?.model || '?'}`;
}

function lireMemoire(cle) {
  const entree = memoire.get(cle);
  if (!entree) return null;
  if (entree.expireAt <= maintenant()) {
    memoire.delete(cle);
    return null;
  }
  return entree.verdict;
}

function ecrireMemoire(cle, verdict) {
  if (memoire.size >= MAX_ENTREES) {
    // On jette la plus ancienne entree plutot que de grossir sans fin.
    const premiere = memoire.keys().next();
    if (!premiere.done) memoire.delete(premiere.value);
  }
  memoire.set(cle, {
    verdict,
    expireAt: maintenant() + (verdict.disponible ? CACHE_OK_MS : CACHE_KO_MS),
  });
}

function urlDesModeles(baseURL = '') {
  const base = String(baseURL || '').replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/models`;
}

/**
 * Sonne un seul fournisseur. Ne leve jamais : un echec de sonnette est une
 * information, pas une panne.
 */
async function sonnerUn(bundle, { timeoutMs = SONNERIE_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const url = urlDesModeles(bundle?.baseURL);
  if (!url) return { disponible: false, motif: 'pas_d_url' };

  const controleur = typeof AbortController === 'function' ? new AbortController() : null;
  const minuteur = setTimeout(() => { try { controleur?.abort(); } catch (_) {} }, timeoutMs);
  const debut = maintenant();
  try {
    const entetes = { accept: 'application/json' };
    if (bundle?.apiKey) entetes.authorization = `Bearer ${bundle.apiKey}`;
    const reponse = await fetchImpl(url, {
      method: 'GET',
      headers: entetes,
      ...(controleur ? { signal: controleur.signal } : {}),
    });
    const latenceMs = maintenant() - debut;

    // 401/403 : la clef est refusee. Inutile de lui donner vingt-deux secondes.
    if (reponse.status === 401 || reponse.status === 402 || reponse.status === 403) {
      return { disponible: false, motif: `clef_refusee_${reponse.status}`, latenceMs };
    }
    // 429 : debit limite maintenant. Le fournisseur existe mais ne nous prend pas.
    if (reponse.status === 429) {
      return { disponible: false, motif: 'debit_limite', latenceMs };
    }
    if (!reponse.ok) {
      return { disponible: false, motif: `statut_${reponse.status}`, latenceMs };
    }
    return { disponible: true, motif: 'repond', latenceMs };
  } catch (error) {
    const latenceMs = maintenant() - debut;
    const avorte = error?.name === 'AbortError';
    return {
      disponible: false,
      motif: avorte ? 'silence' : `erreur_${String(error?.code || error?.message || 'inconnue').slice(0, 40)}`,
      latenceMs,
    };
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Sonne tous les fournisseurs en parallele et rend un verdict par bundle.
 *
 * @param {Array} bundles
 * @param {object} o
 * @param {number} [o.timeoutMs]  duree max de la sonnerie, pour TOUT le monde
 * @param {boolean} [o.ignorerCache]
 * @returns {Promise<Map<string, {disponible:boolean, motif:string, latenceMs?:number}>>}
 */
async function sonnerTous(bundles = [], { timeoutMs = SONNERIE_TIMEOUT_MS, ignorerCache = false, fetchImpl = fetch } = {}) {
  const verdicts = new Map();
  const aSonner = [];

  for (const bundle of bundles) {
    const cle = cleDe(bundle);
    if (verdicts.has(cle)) continue;
    const connu = ignorerCache ? null : lireMemoire(cle);
    if (connu) {
      verdicts.set(cle, { ...connu, depuisCache: true });
      continue;
    }
    aSonner.push({ cle, bundle });
  }

  // Le local (ollama sur la machine) n'a pas besoin de sonnette : il est chez nous,
  // et une sonnerie de plus sur un service deja lent ne renseigne pas mieux.
  const distants = aSonner.filter(({ bundle }) => bundle?.provider !== 'ollama');
  for (const { cle } of aSonner) {
    if (!distants.some((d) => d.cle === cle)) {
      verdicts.set(cle, { disponible: true, motif: 'local_non_sonne' });
    }
  }

  for (let i = 0; i < distants.length; i += MAX_PARALLELE) {
    const tranche = distants.slice(i, i + MAX_PARALLELE);
    const resultats = await Promise.all(
      tranche.map(({ bundle }) => sonnerUn(bundle, { timeoutMs, fetchImpl }))
    );
    tranche.forEach(({ cle }, index) => {
      const verdict = resultats[index];
      ecrireMemoire(cle, verdict);
      verdicts.set(cle, verdict);
    });
  }

  return verdicts;
}

/**
 * Reordonne les bundles : ceux qui repondent d'abord, les muets a la fin.
 *
 * On ne SUPPRIME pas les indisponibles. Un service peut refuser /models et accepter
 * une generation (certaines passerelles ne servent pas la carte), et se retrouver
 * sans aucun fournisseur serait pire que d'en essayer un douteux en dernier recours.
 * On change l'ordre, pas la liste.
 */
function ordonnerParDisponibilite(bundles = [], verdicts = new Map()) {
  const note = (bundle) => {
    const v = verdicts.get(cleDe(bundle));
    if (!v) return 1;                 // inconnu : entre les deux
    return v.disponible ? 0 : 2;      // repond : devant ; muet : derriere
  };
  // Tri stable : a note egale, l'ordre de priorite d'origine est conserve.
  return bundles
    .map((bundle, index) => ({ bundle, index, note: note(bundle) }))
    .sort((a, b) => (a.note - b.note) || (a.index - b.index))
    .map((x) => x.bundle);
}

/** Resume court pour les journaux, sans jamais exposer une clef. */
function resumerSonnerie(bundles = [], verdicts = new Map()) {
  return bundles
    .map((bundle) => {
      const v = verdicts.get(cleDe(bundle));
      if (!v) return `${bundle.provider}=?`;
      return `${bundle.provider}=${v.disponible ? 'ok' : v.motif}`;
    })
    .join(' ');
}

module.exports = {
  sonnerUn,
  sonnerTous,
  ordonnerParDisponibilite,
  resumerSonnerie,
  SONNERIE_TIMEOUT_MS,
  CACHE_OK_MS,
  CACHE_KO_MS,
};
