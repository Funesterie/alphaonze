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
    registre.grains[id] = { ...paire, neLe: new Date().toISOString() };
    const file = resolveRegistryFile(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schema: 'funesterie.persona.grains.v1', ...registre }, null, 2));
    return { persona: id, ...paire, nouveau: true };
  }
  throw new Error('enumeration_epuisee');
}

// --- Choix signes par le grain ----------------------------------------------------------

function fnv1a(texte = '') {
  let hash = 0x811c9dc5;
  for (const char of String(texte)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Interrupteur : A11_PERSONA_GRAIN=0 coupe le grain partout (comparaison avec / sans).
function grainActif(env = process.env) {
  return !['0', 'false', 'off', 'no'].includes(String(env.A11_PERSONA_GRAIN ?? '1').trim().toLowerCase());
}

/** Nombre de [0, 1) lu dans les decimales du grain, a une position fixee par la cle. */
function grainUnite(persona, cle = '', env = process.env) {
  if (!grainActif(env)) return null;
  const paire = paireDe(persona, env);
  if (!paire) return null;
  const { fraction } = calculerGrain(paire.base, paire.exposant);
  const position = fnv1a(`${normalizePersonaId(persona)}|${cle}`) % (fraction.length - 12);
  return Number(`0.${fraction.slice(position, position + 12)}`);
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
  };
}

module.exports = {
  GRAINS_CANONIQUES,
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
