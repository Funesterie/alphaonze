'use strict';

/**
 * partenaires.cjs — Les renvois vers les outils qu'on utilise vraiment.
 *
 * L'IDEE : la pipeline reste a nous. Ce qu'on refere, c'est l'outil.
 *
 * Un utilisateur en libre-service genere sur SES credits: il lui faut un compte
 * chez le fournisseur. S'il l'ouvre par notre lien, la commission finance le
 * palier qui, lui, sert a produire les clips qu'on vend. La boucle se referme
 * sans toucher a la chaine de livraison ni au filigrane.
 *
 * TROIS REGLES, ET AUCUNE N'EST NEGOCIABLE
 *
 * 1. On ne refere que ce qu'on utilise. Un partenaire ajoute ici doit etre dans
 *    la pile, sinon c'est de la publicite deguisee en recommandation.
 * 2. On le DIT. Un lien remunere presente comme un conseil neutre est
 *    exactement ce que la charte Mille Fleurs appelle de la fumee -- et en
 *    France comme dans l'UE, la remuneration doit etre divulguee. Chaque entree
 *    porte donc `remunere`, et l'interface doit afficher la mention.
 * 3. Aucune URL n'est codee en dur. Les liens de suivi sont personnels et se
 *    revoquent: ils vivent dans l'environnement. Sans variable renseignee, le
 *    partenaire est simplement absent de la liste -- pas de lien mort, pas de
 *    lien nu qui rapporterait a personne.
 */

const MENTION_LEGALE = 'Lien partenaire rémunéré. Nous ne référons que des outils que nous utilisons nous-mêmes.';

/**
 * Le catalogue. `env` porte la variable qui contient le lien de suivi.
 *
 * `commission` est documentaire: elle sert a expliquer la boucle a qui lit le
 * code dans six mois, pas a calculer quoi que ce soit. Les conditions reelles
 * sont celles du contrat d'affiliation, pas celles de ce commentaire.
 */
const CATALOGUE = Object.freeze([
  Object.freeze({
    id: 'comfy-cloud',
    label: 'Comfy Cloud',
    usage: "C'est le GPU qui fabrique nos clips.",
    pourquoi: 'Pour générer tes propres vidéos sur tes crédits, sans file d\'attente derrière les nôtres.',
    env: 'A11_PARTNER_COMFY_URL',
    commission: '30 % pendant 3 mois sur les abonnements Comfy Cloud (hors achats de crédits à l\'unité et usage API seul).',
    remunere: true,
  }),
  Object.freeze({
    id: 'suno',
    label: 'Suno',
    usage: "C'est ce qui chante sur nos morceaux.",
    pourquoi: 'Pour composer tes propres titres et garder tes voix.',
    env: 'A11_PARTNER_SUNO_URL',
    commission: '',
    remunere: true,
  }),
]);

function lienConfigure(entree, env = process.env) {
  return String(env[entree.env] || '').trim();
}

/**
 * Un lien de suivi doit etre une URL https absolue.
 *
 * Une valeur vide desactive le partenaire, c'est le cas normal. Une valeur
 * malformee, elle, est une erreur de saisie qu'il vaut mieux voir tot: un lien
 * casse dans une page publique ne rapporte rien et fait mauvais effet.
 */
function lienValide(url) {
  const brut = String(url || '').trim();
  if (!brut) return false;
  try {
    return new URL(brut).protocol === 'https:';
  } catch {
    return false;
  }
}

function listerPartenaires(env = process.env) {
  return CATALOGUE
    .map((entree) => ({ entree, url: lienConfigure(entree, env) }))
    .filter(({ url }) => lienValide(url))
    .map(({ entree, url }) => ({
      id: entree.id,
      label: entree.label,
      usage: entree.usage,
      pourquoi: entree.pourquoi,
      url,
      remunere: entree.remunere === true,
      mention: entree.remunere === true ? MENTION_LEGALE : '',
    }));
}

/** Les entrees mal renseignees, pour le diagnostic. Jamais servies au public. */
function partenairesInvalides(env = process.env) {
  return CATALOGUE
    .filter((entree) => {
      const url = lienConfigure(entree, env);
      return url !== '' && !lienValide(url);
    })
    .map((entree) => ({ id: entree.id, env: entree.env }));
}

module.exports = {
  MENTION_LEGALE,
  CATALOGUE,
  lienValide,
  listerPartenaires,
  partenairesInvalides,
};
