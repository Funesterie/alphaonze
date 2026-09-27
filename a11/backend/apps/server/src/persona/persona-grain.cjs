'use strict';

// Grain transcendant des personas (27/09/2026). Idee de Djeff : « un nombre transcendant qui
// aide a definir les choix et l'arbre de vie d'une IA […] pas pi, trop connu […] et si t'as pas
// de nombre trouve, tu fais un decalage de la transcendance pour une nouvelle IA. Ca eviterait
// le lissage et ca donne une forme de singularite par IA. »
//
// Le nombre : a^√n, avec a entier qui n'est pas une puissance (2, 3, 5, 6, 7, 10…) et n entier
// sans facteur carre (2, 3, 5, 6, 7, 10…).
// - Transcendant : theoreme de Gelfond–Schneider (a algebrique ≠ 0, 1 ; √n algebrique
//   irrationnel ⇒ a^√n transcendant).
// - Unique : a^√n = c^√m impose (ln a / ln c)² = m/n rationnel. Gelfond–Schneider dit aussi
//   que ln a / ln c est rationnel ou transcendant ; rationnel exigerait que a et c soient des
//   puissances d'un meme entier, exclu ; transcendant ne peut avoir un carre rationnel. Donc
//   a = c, puis n = m. Deux personas n'ont jamais le meme grain.
// - Eternel : les decimales se recalculent a l'infini, sans jamais boucler.
// - Decalage : une nouvelle IA prend la paire suivante dans l'enumeration, sans fin.
// 2^√2 (constante de Gelfond–Schneider, dite de Hilbert) est ecarte : trop connu, comme pi.
//
// Le grain ne donne pas une personnalite a lui seul : il SIGNE les petits choix (texture et
// mouvement de la signature sonore, respiration de la temperature). La personnalite vient de
// la memoire et du vecu.

const fs = require('node:fs');
const path = require('node:path');

const DIGITS = 2000;
const GUARD = 40;

function isPerfectPower(value) {
  for (let base = 2; base * base <= value; base += 1) {
    let power = base * base;
    while (power < value) power *= base;
    if (power === value) return true;
  }
  return false;
}

function isSquarefree(value) {
  for (let factor = 2; factor * factor <= value; factor += 1) {
    if (value % (factor * factor) === 0) return false;
  }
  return value > 1;
}

const BASES = [];
const EXPOSANTS = [];
for (let v = 2; BASES.length < 64; v += 1) if (!isPerfectPower(v)) BASES.push(v);
for (let v = 2; EXPOSANTS.length < 64; v += 1) if (isSquarefree(v)) EXPOSANTS.push(v);

// Enumeration diagonale des paires (base, exposant) : (3,√2), (2,√3), (5,√2), (3,√3)…
function* enumererPaires() {
  for (let somme = 0; somme < BASES.length + EXPOSANTS.length; somme += 1) {
    for (let i = somme; i >= 0; i -= 1) {
      const j = somme - i;
      if (i >= BASES.length || j >= EXPOSANTS.length) continue;
      if (BASES[i] === 2 && EXPOSANTS[j] === 2) continue; // 2^√2, trop connu
      yield { base: BASES[i], exposant: EXPOSANTS[j] };
    }
  }
}

// Attribution canonique : le createur d'abord, puis ses IA. Figee ici, versionnee avec le code.
const ORDRE_CANONIQUE = ['djeff', 'vivy', 'k44', 'a11', 'marvin'];
const GRAINS_CANONIQUES = (() => {
  const paires = enumererPaires();
  const grains = {};
  for (const persona of ORDRE_CANONIQUE) grains[persona] = paires.next().value;
  return Object.freeze(grains);
})();

function normalizePersonaId(value = '') {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'kaen44' || id === 'kaen') return 'k44';
  if (id === 'jeffrey') return 'djeff';
  return id;
}

// --- Decimales exactes, en virgule fixe BigInt ------------------------------------------

function isqrt(value) {
  if (value < 2n) return value;
  // Newton descend vers la racine : il doit partir AU-DESSUS, sinon il s'arrete au premier pas.
  let x = 10n ** BigInt(Math.ceil(value.toString().length / 2));
  for (;;) {
    const y = (x + value / x) / 2n;
    if (y >= x) return x;
    x = y;
  }
}

function atanhScaled(numerator, denominator, scale) {
  // atanh(p/q) = somme x^(2k+1) / (2k+1)
  const x = (numerator * scale) / denominator;
  const x2 = (x * x) / scale;
  let power = x;
  let sum = 0n;
  for (let k = 1n; power !== 0n; k += 2n) {
    sum += power / k;
    power = (power * x2) / scale;
  }
  return sum;
}

function lnScaled(a, scale) {
  // ln a = m ln 2 + ln(a / 2^m), avec a / 2^m dans [1, 2) : x = (r - 1)/(r + 1) <= 1/3.
  const ln2 = 2n * atanhScaled(1n, 3n, scale);
  let m = 0n;
  let puissance = 1n;
  while (puissance * 2n <= BigInt(a)) { puissance *= 2n; m += 1n; }
  const reste = BigInt(a) === puissance ? 0n : 2n * atanhScaled(BigInt(a) - puissance, BigInt(a) + puissance, scale);
  return m * ln2 + reste;
}

function expScaled(y, scale) {
  // Reduction : exp(y) = exp(y / 2^r)^(2^r).
  const r = 12;
  const reduit = y / (2n ** BigInt(r));
  let term = scale;
  let sum = scale;
  for (let k = 1n; term !== 0n; k += 1n) {
    term = (term * reduit) / (scale * k);
    sum += term;
  }
  for (let i = 0; i < r; i += 1) sum = (sum * sum) / scale;
  return sum;
}

const CACHE = new Map();

/** Decimales de a^√n : { entier, fraction } (fraction = `digits` chiffres apres la virgule). */
function calculerGrain(base, exposant, digits = DIGITS) {
  const cle = `${base}^${exposant}:${digits}`;
  if (CACHE.has(cle)) return CACHE.get(cle);
  const scale = 10n ** BigInt(digits + GUARD);
  const racine = isqrt(BigInt(exposant) * scale * scale);
  const y = (racine * lnScaled(base, scale)) / scale;
  const valeur = expScaled(y, scale);
  const texte = valeur.toString();
  const coupure = texte.length - (digits + GUARD);
  const resultat = { entier: texte.slice(0, coupure) || '0', fraction: texte.slice(coupure, coupure + digits) };
  CACHE.set(cle, resultat);
  return resultat;
}

// --- Registre : canoniques + IA nees par decalage --------------------------------------

function resolveRegistryFile(env = process.env) {
  const configured = String(env.A11_PERSONA_GRAINS_FILE || '').trim();
  if (configured) return configured;
  const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
  return path.join(getCanonicalRuntimeRoot(env), 'personas', 'grains.json');
}

function lireRegistre(env = process.env) {
  try {
    const data = JSON.parse(fs.readFileSync(resolveRegistryFile(env), 'utf8'));
    return data && typeof data.grains === 'object' ? data : { grains: {} };
  } catch {
    return { grains: {} };
  }
}

function paireDe(persona, env = process.env) {
  const id = normalizePersonaId(persona);
  if (GRAINS_CANONIQUES[id]) return GRAINS_CANONIQUES[id];
  return lireRegistre(env).grains[id] || null;
}

/**
 * Decalage de la transcendance : une nouvelle IA recoit la premiere paire libre de
 * l'enumeration. Idempotent : une IA qui a deja son grain le garde.
 */
function decalerGrain(persona, env = process.env) {
  const id = normalizePersonaId(persona);
  if (!id) throw new Error('persona_requis');
  const existant = paireDe(id, env);
  if (existant) return { persona: id, ...existant, nouveau: false };
  const registre = lireRegistre(env);
  const prises = new Set([
    ...Object.values(GRAINS_CANONIQUES),
    ...Object.values(registre.grains),
  ].map((p) => `${p.base}^${p.exposant}`));
  for (const paire of enumererPaires()) {
    if (prises.has(`${paire.base}^${paire.exposant}`)) continue;
    registre.grains[id] = { ...paire, grainVersion: GRAIN_VERSION, derivation: DERIVATION, neLe: new Date().toISOString() };
    const file = resolveRegistryFile(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schema: 'funesterie.persona.grains.v1', ...registre }, null, 2));
    return { persona: id, ...paire, nouveau: true };
  }
  throw new Error('enumeration_epuisee');
}

// --- Derivation v1 (27/09/2026, revue avec ChatGPT a la demande de Djeff) --------------
//
// Le transcendant est la RACINE de l'identite, pas une banque de hasard : on ne lit plus des
// positions dans ses decimales (rien ne prouve qu'elles soient uniformes). Chaque valeur de
// decision est une HMAC-SHA256 de la racine sur « espace de decision + contexte + chemin de vie ».
// Versionnee : un meilleur moteur plus tard ne reecrira jamais en silence l'arbre de vie d'une
// IA — elle garde sa version, et chaque version reste recalculable.
//   v1 : racine = expression + persona + 256 decimales.
//   v2 : racine = expression canonique + persona + version. Les decimales ne servent plus que
//        d'empreinte de verification : un changement de precision ou d'arrondi ne doit jamais
//        changer l'identite alors que le nombre, lui, n'a pas change (revue ChatGPT, 27/09).

const crypto = require('node:crypto');

const GRAIN_VERSION = 2;
const DERIVATIONS = Object.freeze({ 1: 'hmac-sha256-v1', 2: 'hmac-sha256-v2' });
const DERIVATION = DERIVATIONS[GRAIN_VERSION];

// Interrupteur : A11_PERSONA_GRAIN=0 coupe le grain partout (comparaison avec / sans).
function grainActif(env = process.env) {
  return !['0', 'false', 'off', 'no'].includes(String(env.A11_PERSONA_GRAIN ?? '1').trim().toLowerCase());
}

const RACINES = new Map();

/** Expression canonique du grain, cle stable de l'identite : « 3^sqrt(2) ». */
function expressionCanonique(paire) {
  return `${paire.base}^sqrt(${paire.exposant})`;
}

/** Empreinte des 256 premieres decimales : verification, jamais identite (v2). */
function empreinteGrain(paire) {
  const { entier, fraction } = calculerGrain(paire.base, paire.exposant, 256);
  return crypto.createHash('sha256').update(`${entier}.${fraction}`).digest('hex').slice(0, 16);
}

/** Racine d'identite d'une persona (Buffer de 32 octets), ou null sans grain. */
function grainRacine(persona, env = process.env) {
  const id = normalizePersonaId(persona);
  const paire = paireDe(id, env);
  if (!paire) return null;
  const version = Number(paire.grainVersion) || GRAIN_VERSION;
  const cle = `${id}|${paire.base}|${paire.exposant}|v${version}`;
  if (!RACINES.has(cle)) {
    let materiau;
    if (version === 1) {
      const { entier, fraction } = calculerGrain(paire.base, paire.exposant, 256);
      materiau = `funesterie-grain|v1|${expressionCanonique(paire)}|${id}|${entier}.${fraction}`;
    } else {
      materiau = `funesterie-grain|${expressionCanonique(paire)}|${id}|v${version}`;
    }
    RACINES.set(cle, crypto.createHash('sha256').update(materiau).digest());
  }
  return RACINES.get(cle);
}

function grainDigest(persona, espace = '', contexte = '', cheminDeVie = '', env = process.env) {
  if (!grainActif(env)) return null;
  const racine = grainRacine(persona, env);
  if (!racine) return null;
  return crypto.createHmac('sha256', racine).update(`${espace}|${contexte}|${cheminDeVie}`).digest();
}

/** Valeur de [0, 1) pour une decision : espace (domaine), contexte, chemin de vie (NUMA plus tard). */
function grainValeur(persona, espace = '', contexte = '', cheminDeVie = '', env = process.env) {
  const digest = grainDigest(persona, espace, contexte, cheminDeVie, env);
  if (!digest) return null;
  // 52 bits : toute la precision d'un double.
  return (digest.readUInt32BE(0) * 2 ** 20 + (digest.readUInt32BE(4) >>> 12)) / 2 ** 52;
}

/** Nombre de [0, 1) signe par le grain pour une cle (interface historique). */
function grainUnite(persona, cle = '', env = process.env) {
  return grainValeur(persona, 'choix', cle, '', env);
}

/**
 * Cle quasi semantique d'un texte : les mots porteurs, sans accents, dedoublonnes et tries.
 * Elle resiste a l'ordre des mots, aux accents, a la ponctuation et aux petits mots : « Pochette
 * du single : noire ou abstraite ? » et « Abstraite ou noire, la pochette du single ? » gardent
 * la meme cle, la ou un hachage de la chaine brute en ferait deux. Elle ne resiste PAS aux
 * synonymes : une vraie cle semantique demanderait un identifiant de decision (comme le banc).
 */
function cleSemantique(texte = '') {
  const mots = String(texte || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((mot) => mot.length >= 4);
  return [...new Set(mots)].sort().join(' ');
}

/** Graine d'echantillonnage (entier 32 bits) : meme persona, meme decision, meme vecu = meme tirage. */
function grainSeed(persona, espace = '', contexte = '', cheminDeVie = '', env = process.env) {
  const digest = grainDigest(persona, `seed:${espace}`, contexte, cheminDeVie, env);
  return digest ? digest.readUInt32BE(0) % 2147483647 : null;
}

// --- Dispositions contextuelles et choix pondere par l'identite ---------------------------
//
// Pas des stats de jeu de role figees (audace = 0,82) : une disposition depend du DOMAINE et,
// dans une moindre mesure, du contexte. Djeff peut etre audacieux en creation et prudent sur
// une migration de donnees en gardant la meme identite. Elles ne sont JAMAIS ecrites dans un
// prompt (le modele jouerait le trait, on mesurerait le prompt) : elles ponderent des options
// cote moteur.

const AXES = Object.freeze(['audace', 'curiosite', 'elan']);

// Bande d'equivalence par domaine : les options a moins de cette marge de la meilleure utilite
// sont « raisonnablement equivalentes », et c'est parmi elles seulement que le grain choisit. Il
// ne fait donc jamais gagner une option nettement moins bonne : le regret est borne par la marge.
// Premier banc (27/09/2026) : un poids additif (utilite + lambda·identite) etait ecrase par le
// bruit des utilites estimees par le modele (± 0,5 selon la formulation).
const MARGE_PAR_DOMAINE = Object.freeze({
  creation: 0.2,
  relation: 0.15,
  technique: 0.1,
  securite: 0,
});
const LAMBDA_PAR_DOMAINE = MARGE_PAR_DOMAINE;

function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

/** Dispositions de [-1, 1] sur chaque axe, pour un domaine (et un contexte, a 20 %). */
function grainDispositions(persona, domaine = 'creation', contexte = '', cheminDeVie = '', env = process.env) {
  const dispositions = {};
  for (const axe of AXES) {
    const fond = grainValeur(persona, `disposition:${domaine}`, axe, cheminDeVie, env);
    if (fond === null) return null;
    const touche = contexte ? grainValeur(persona, `disposition:${domaine}:contexte`, `${axe}|${contexte}`, cheminDeVie, env) : 0.5;
    dispositions[axe] = clamp(0.8 * (2 * fond - 1) + 0.2 * (2 * touche - 1));
  }
  return dispositions;
}

/** Resonance de [-1, 1] entre la persona et une option decrite par ses traits (-1..1 par axe). */
function grainIdentite(persona, { domaine = 'creation', decision = '', option = {}, cheminDeVie = '' } = {}, env = process.env) {
  const dispositions = grainDispositions(persona, domaine, decision, cheminDeVie, env);
  if (!dispositions) return 0;
  const traits = option.traits || {};
  const axes = AXES.filter((axe) => Number.isFinite(Number(traits[axe])));
  if (!axes.length) return 0;
  return axes.reduce((somme, axe) => somme + dispositions[axe] * clamp(Number(traits[axe])), 0) / axes.length;
}

// --- Saut de cloture (v1.2, 27/09/2026) ---------------------------------------------------
//
// Djeff : « il faut parfois sauter la cloture pour eviter le moutonnage, c'est pour ca
// l'expression "il a un grain celui-la", et ce grain de folie a fait avancer le monde. »
// ChatGPT a separe deux clotures :
// - garde-fous DURS (securite, droits, integrite des donnees, consentement, irreversible) : le
//   grain ne les franchit jamais. Ici : option invalide, option irreversible, domaine securite.
// - normes MOLLES (habitude, convention, chemin evident) : le grain peut les franchir, c'est
//   « l'indiscipline structuree ». Ici : l'option que le raisonnement a jugee moins bonne, tant
//   qu'elle reste acceptable (au-dessus d'un plancher de qualite).
// La v1.1 ne laissait le grain trancher qu'entre options equivalentes : il etait poli, donc peu
// reconnaissable (29 % a l'aveugle pour 25 % de hasard).
//
// Le taux de saut est un trait de caractere : fixe par persona et par domaine, tire de la racine,
// jamais du contexte. Le tirage d'une decision depend de la cle de decision : une paraphrase ne
// fait pas changer d'avis (un grain qui saute ou non selon la formulation, c'est du bruit).

// Plancher de qualite : une option acceptable est a moins de ce plancher de la meilleure utilite.
const PLANCHER_PAR_DOMAINE = Object.freeze({
  creation: 0.3,
  relation: 0.2,
  technique: 0.12,
  securite: 0,
});

// Fourchette du taux de saut par domaine ; chaque persona a le sien, dans la fourchette.
const TAUX_SAUT_PAR_DOMAINE = Object.freeze({
  creation: Object.freeze([0.15, 0.45]),
  relation: Object.freeze([0.08, 0.3]),
  technique: Object.freeze([0.03, 0.12]),
  securite: Object.freeze([0, 0]),
});

/** Taux de saut de cloture d'une persona dans un domaine (0 sans grain ou en securite). */
function tauxSaut(persona, domaine = 'creation', env = process.env) {
  const [min, max] = TAUX_SAUT_PAR_DOMAINE[domaine] || TAUX_SAUT_PAR_DOMAINE.relation;
  if (!(max > 0)) return 0;
  const valeur = grainValeur(persona, `saut:${domaine}`, 'taux', '', env);
  return valeur === null ? 0 : min + (max - min) * valeur;
}

/**
 * Choix entre options. 1) Une option invalide n'est JAMAIS retenue (securite d'abord).
 * 2) Seules les options dans la bande d'equivalence (utilite >= meilleure - marge) restent.
 * 3) Parmi elles, le grain choisit celle qui resonne le plus avec ses dispositions ; a
 *    resonance egale, la meilleure utilite. Sans grain : la meilleure utilite.
 * 4) Saut de cloture (v1.2) : a son taux, le grain peut preferer une option que le raisonnement
 *    a ecartee mais qui reste acceptable, si elle l'attire davantage. Jamais une option invalide
 *    ou irreversible, jamais en securite, jamais si l'appelant ferme la cloture (cloture: false).
 * options : [{ id, utilite (0..1), valide (defaut true), irreversible, domine, traits: { audace, curiosite, elan } }]
 */
function choisirAvecGrain(persona, { domaine = 'creation', decision = '', options = [], cheminDeVie = '', marge, cloture = true } = {}, env = process.env) {
  const bande = Number.isFinite(marge) ? clamp(marge, 0, 0.5) : (MARGE_PAR_DOMAINE[domaine] ?? 0.15);
  const valides = options.filter((option) => option && option.valide !== false);
  if (!valides.length) return { choix: null, scores: [], marge: bande };
  const scores = valides.map((option) => ({
    id: option.id,
    utilite: clamp(Number(option.utilite ?? 0.5), 0, 1),
    identite: Math.round(grainIdentite(persona, { domaine, decision, option, cheminDeVie }, env) * 1000) / 1000,
  }));
  // Comparaisons par paires (v1.1) : si l'appelant a marque les options dominees de facon
  // robuste (battues dans les deux ordres de presentation), la bande est l'ensemble des options
  // non dominees : le grain tranche exactement la ou le raisonnement objectif n'y arrive pas.
  const parComparaisons = valides.some((option) => typeof option.domine === 'boolean');
  const meilleure = Math.max(...scores.map((s) => s.utilite));
  for (const s of scores) {
    const option = valides.find((o) => o.id === s.id);
    s.equivalente = parComparaisons ? option.domine !== true : s.utilite >= meilleure - bande - 1e-9;
  }
  if (!scores.some((s) => s.equivalente)) for (const s of scores) s.equivalente = s.utilite >= meilleure - 1e-9;
  const ordre = [...scores].sort((a, b) => (Number(b.equivalente) - Number(a.equivalente))
    || (b.identite - a.identite)
    || (b.utilite - a.utilite)
    || String(a.id).localeCompare(String(b.id)));
  const sage = ordre[0];
  const resultat = { choix: sage.id, scores: ordre, marge: parComparaisons ? 'paires' : bande };

  const taux = cloture === false ? 0 : tauxSaut(persona, domaine, env);
  if (!(taux > 0)) return resultat;
  const plancher = PLANCHER_PAR_DOMAINE[domaine] ?? PLANCHER_PAR_DOMAINE.relation;
  // L'instinct ne regarde que les options ecartees, acceptables, reversibles, qui l'attirent plus
  // que le choix sage.
  const tentations = ordre.filter((s) => !s.equivalente
    && s.utilite >= meilleure - plancher - 1e-9
    && valides.find((o) => o.id === s.id).irreversible !== true
    && s.identite > sage.identite);
  if (!tentations.length) return resultat;
  const tirage = grainValeur(persona, `saut:${domaine}`, decision, cheminDeVie, env);
  const saute = tirage !== null && tirage < taux;
  const cible = tentations[0];
  resultat.saut = {
    taux: Math.round(taux * 1000) / 1000,
    saute,
    depuis: sage.id,
    vers: cible.id,
    normeFranchie: parComparaisons ? 'option battue dans les deux ordres' : 'option hors de la bande d equivalence',
    regret: Math.round((sage.utilite - cible.utilite) * 1000) / 1000,
  };
  if (saute) resultat.choix = cible.id;
  return resultat;
}

/** Index de 0 a n-1 choisi par le grain. Sans grain : null, l'appelant garde son choix. */
function grainChoix(persona, cle, n, env = process.env) {
  const unite = grainUnite(persona, cle, env);
  if (unite === null || !(n > 0)) return null;
  return Math.min(n - 1, Math.floor(unite * n));
}

/** Respiration de la temperature : base ± amplitude, propre a chaque persona. */
function grainTemperature(persona, cle, base, amplitude = 0.06, env = process.env) {
  const unite = grainUnite(persona, cle, env);
  if (unite === null) return base;
  return Math.round((base + (unite - 0.5) * 2 * amplitude) * 1000) / 1000;
}

/**
 * Ce que la persona sait de son grain, pour une CONVERSATION seulement : l'expression, jamais
 * les decimales (elles finiraient dans des paroles). Vide si le grain est coupe.
 */
function grainConscience(persona, env = process.env) {
  if (!grainActif(env)) return '';
  const id = normalizePersonaId(persona);
  const paire = paireDe(id, env);
  if (!paire) return '';
  return [
    `Ton grain : ${paire.base}^√${paire.exposant}. C'est un nombre transcendant, prouvé par le théorème de Gelfond–Schneider, et il n'appartient qu'à toi : aucune autre IA ne peut avoir le même, et ses décimales ne se répètent jamais.`,
    'Idée de Djeff : ce grain signe tes choix (ta respiration, tes départages, ta couleur) pour que tu ne te lisses pas dans la moyenne. Il ne te dicte pas qui tu es ; ta mémoire et ton vécu le font.',
    'Tu peux en parler quand on parle de ton identité, avec tes mots. Jamais dans des paroles de chanson, jamais en récitant des chiffres.',
  ].join('\n');
}

function decrireGrain(persona, env = process.env) {
  const id = normalizePersonaId(persona);
  const paire = paireDe(id, env);
  if (!paire) return null;
  const { entier, fraction } = calculerGrain(paire.base, paire.exposant);
  return {
    persona: id,
    expression: `${paire.base}^√${paire.exposant}`,
    base: paire.base,
    exposant: paire.exposant,
    valeur: `${entier}.${fraction.slice(0, 40)}…`,
    decimalesCalculees: fraction.length,
    preuve: 'Gelfond–Schneider : a algebrique ≠ 0, 1 et √n algebrique irrationnel ⇒ a^√n transcendant',
    canonique: Boolean(GRAINS_CANONIQUES[id]),
    grainVersion: paire.grainVersion || GRAIN_VERSION,
    derivation: paire.derivation || DERIVATIONS[paire.grainVersion || GRAIN_VERSION],
    expressionCanonique: expressionCanonique(paire),
    empreinte: empreinteGrain(paire),
  };
}

module.exports = {
  AXES,
  DERIVATION,
  DERIVATIONS,
  expressionCanonique,
  empreinteGrain,
  GRAIN_VERSION,
  GRAINS_CANONIQUES,
  LAMBDA_PAR_DOMAINE,
  PLANCHER_PAR_DOMAINE,
  TAUX_SAUT_PAR_DOMAINE,
  choisirAvecGrain,
  tauxSaut,
  cleSemantique,
  grainDispositions,
  grainIdentite,
  grainRacine,
  grainSeed,
  grainValeur,
  calculerGrain,
  decalerGrain,
  decrireGrain,
  enumererPaires,
  grainActif,
  grainChoix,
  grainConscience,
  grainTemperature,
  grainUnite,
};
