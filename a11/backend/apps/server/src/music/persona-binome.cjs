'use strict';

/**
 * persona-binome.cjs — Chaque voix en surveille une autre.
 *
 * LA REGLE, DE DJEFF : « si l'un dead l'autre le rez ».
 *
 * CE QUE LE BINOME NE FAIT SURTOUT PAS
 *
 * Il ne prete PAS sa voix. C'est le contresens qu'il faut tuer d'entree, parce
 * que c'est deja arrive : quand la persona de Djeff est morte le 30/07, aucune
 * persona n'etait envoyee a Suno, qui improvisait alors une voix feminine. Djeff
 * chantait avec la voix de Vivy sans que personne l'ait demande.
 *
 * L'ADN reste TOUJOURS celui du mort. Le binome apporte l'initiative, jamais le
 * timbre. `verifierAdn()` existe pour rendre cette confusion impossible en code.
 *
 * CE QUE LE BINOME APPORTE VRAIMENT
 *
 * La reanimation elle-meme n'a besoin de personne : c'est du code serveur, il
 * pourrait tourner tout seul. Le binome apporte deux choses qu'une reprise
 * automatique anonyme n'a pas :
 *
 *   1. UN RESPONSABLE. Une voix morte a quelqu'un dont c'est le travail de le
 *      remarquer. Sans nom en face, personne ne regarde -- la persona de Djeff
 *      est restee morte quatre jours en distribuant un identifiant vide.
 *
 *   2. UNE BORNE. Seul le binome declenche. Sans cette regle, douze personas qui
 *      se reanimeraient mutuellement au premier incident feraient douze
 *      generations Suno en cascade, chacune facturee.
 *
 * L'APPARIEMENT
 *
 * Fixe, symetrique, ecrit en clair. Un appariement dynamique choisirait un
 * binome different a chaque incident : impossible a relire six mois plus tard
 * quand il faut comprendre qui a relance quoi.
 *
 * Symetrique, donc A veille sur B ET B veille sur A. Une chaine (A->B->C->A)
 * aurait le meme nombre de liens, mais si deux voisins meurent ensemble le
 * maillon casse; avec des paires, une paire morte n'entraine que sa propre paire.
 */

const SCHEMA = 'funesterie.persona-binome.v1';

/**
 * Les paires. Djeff et Vivy d'abord, c'est la demande d'origine : les deux voix
 * chantees du projet, les deux qui comptent vraiment si elles tombent.
 *
 * Les autres sont appariees par contraste de timbre, pour une raison pratique :
 * si un jour on doit ecouter les deux echantillons cote a cote pour verifier
 * qu'une reanimation n'a pas rendu la mauvaise voix, deux timbres opposes se
 * distinguent a l'oreille en une seconde. Deux voix proches, non.
 */
const PAIRES = Object.freeze([
  ['djeff', 'vivy'],
  ['a11', 'kaen44'],
  ['grok', 'codex'],
  ['chatgpt', 'claude'],
  ['kiro', 'gemini'],
  ['ile', 'marvin'],
]);

const BINOMES = Object.freeze(PAIRES.reduce((acc, [a, b]) => {
  acc[a] = b;
  acc[b] = a;
  return acc;
}, {}));

function binomeDe(persona = '') {
  return BINOMES[String(persona || '').trim().toLowerCase()] || '';
}

/**
 * Garde-fou : l'ADN doit appartenir au mort.
 *
 * Appele avant toute reanimation. Rendre false doit ARRETER la reanimation, pas
 * la corriger en silence -- une reanimation qui se corrige toute seule masque
 * l'erreur de cablage qui l'a provoquee.
 */
function verifierAdn({ personaMorte, sourceAdn } = {}) {
  const morte = String(personaMorte || '').trim().toLowerCase();
  const source = String(sourceAdn || '').trim().toLowerCase();
  if (!morte || !source) return { ok: false, raison: 'persona_ou_source_absente' };
  if (source !== morte) {
    return {
      ok: false,
      raison: 'adn_etranger',
      detail: `reanimer ${morte} avec l echantillon de ${source} lui donnerait la voix de ${source}`,
    };
  }
  return { ok: true, raison: '' };
}

/**
 * Que faire pour cette persona, maintenant.
 *
 * `entree` est une entree de voice-catalog (vue publique acceptee : on ne lit que
 * des drapeaux, jamais le voiceId).
 */
function planDeVeille(entree = {}, { maintenant = Date.now() } = {}) {
  const nom = String(entree?.name || '').trim().toLowerCase();
  if (!nom) return { schema: SCHEMA, action: 'rien', raison: 'sans_nom' };

  const binome = binomeDe(nom);
  const morte = Boolean(entree.personaExpired || entree.personaExpiredAt);

  if (!morte) return { schema: SCHEMA, persona: nom, binome, action: 'rien', raison: 'vivante' };

  if (!entree.hasSample && !entree.sampleFile) {
    // Sans ADN, la reanimation est impossible et le restera : il faut un nouvel
    // enregistrement humain. Le dire tot evite de bruler des tentatives.
    return {
      schema: SCHEMA, persona: nom, binome,
      action: 'alerter',
      raison: 'adn_absent',
      detail: `${nom} est morte sans echantillon : seule une nouvelle prise peut la recreer`,
    };
  }

  if (!binome) {
    return {
      schema: SCHEMA, persona: nom, binome: '',
      action: 'alerter',
      raison: 'sans_binome',
      detail: `${nom} n a pas de binome : personne n a la charge de la relever`,
    };
  }

  const adn = verifierAdn({ personaMorte: nom, sourceAdn: nom });
  if (!adn.ok) return { schema: SCHEMA, persona: nom, binome, action: 'refuser', raison: adn.raison, detail: adn.detail };

  return {
    schema: SCHEMA,
    persona: nom,
    binome,
    action: 'reanimer',
    raison: 'morte_avec_adn',
    // Explicite, et redondant avec `persona` : cette redondance est le garde-fou.
    // Le jour ou quelqu'un cablera `sourceAdn: binome` par reflexe, verifierAdn
    // le refusera au lieu de laisser Vivy chanter a la place de Djeff.
    sourceAdn: nom,
    declencheur: binome,
    detail: `${binome} relance ${nom} depuis l echantillon de ${nom}`,
    a: new Date(maintenant).toISOString(),
  };
}

/**
 * Passe en revue tout le catalogue.
 *
 * `limiteReanimations` borne le nombre de relances par passage. Une reanimation
 * coute une generation Suno : si le catalogue entier expirait d'un coup -- ce qui
 * arrive quand un compte est suspendu, pas seulement quand une voix meurt --
 * relancer douze generations ne reparerait rien et coûterait douze fois.
 */
function veillerSurCatalogue(voix = [], { limiteReanimations = 2, maintenant = Date.now() } = {}) {
  const plans = (Array.isArray(voix) ? voix : []).map((v) => planDeVeille(v, { maintenant }));
  const aReanimer = plans.filter((p) => p.action === 'reanimer');
  const retenues = aReanimer.slice(0, Math.max(0, limiteReanimations));
  const reportees = aReanimer.slice(retenues.length);

  return {
    schema: SCHEMA,
    total: plans.length,
    mortes: plans.filter((p) => p.action !== 'rien').length,
    reanimations: retenues,
    // Jamais silencieux : une relance repoussee doit se voir, sinon une voix
    // reste morte en donnant l'impression que la veille s'en est occupee.
    reportees: reportees.map((p) => ({ persona: p.persona, binome: p.binome })),
    alertes: plans.filter((p) => p.action === 'alerter'),
    refus: plans.filter((p) => p.action === 'refuser'),
  };
}

module.exports = {
  SCHEMA,
  PAIRES,
  BINOMES,
  binomeDe,
  verifierAdn,
  planDeVeille,
  veillerSurCatalogue,
};
