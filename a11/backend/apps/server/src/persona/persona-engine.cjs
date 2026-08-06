'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const {
  getFamilyVoiceIdentitiesForPersona,
} = require('../config/family-accounts.cjs');
const {
  buildReferenceCapsuleContext,
  hasFunesterieReferenceCapsuleContext,
} = require('../chat/funesterie-reference-capsules.cjs');

// PERSONA_ENGINE — couche injectable bornée.
//
// Règle: les bruts privés restent au coffre. Ce module ne lit que:
// - profils persona validés dans runtime/personas/<persona>/<persona>-persona.profile.json
// - fiches docs explicitement configurées (A11_PERSONA_DOCS_DIR) ou les docs locales
//   connues du poste opérateur, en extrait court.
//
// Il ne lance aucun outil, aucun LLM, aucune action réseau.

const CACHE_TTL_MS = 60_000;
const PROFILE_BRIEF_MAX_CHARS = 1600;
const DOC_BRIEF_MAX_CHARS = 2400;

const PROFILE_CACHE = new Map();
let docsCache = { at: 0, key: '', brief: '' };

const PERSONA_ALIASES = Object.freeze({
  k44: 'kaen44',
  kaen: 'kaen44',
  kaen44: 'kaen44',
  alphaonze: 'a11',
  'alpha-onze': 'a11',
  vivi: 'vivy',
  vivy: 'vivy',
  pignon: 'djeff',
  'djeff-rap': 'djeff',
  djeff: 'djeff',
});

const DEFAULT_VOICE_PERSONA_BRIEFS = Object.freeze({
  djeff: [
    'Djeff: voix rap Funesterie, directe, nerveuse, technique, rimes internes, images concrètes tirées du sujet.',
    'Évite le corporate, le panneau de réglages et les excuses molles; répond franchement, court si c’est simple, profond si ça vaut le coup.',
    'En musique: Djeff porte les couplets rap, Vivy peut répondre en refrain; ne copie jamais d’artiste existant.',
  ].join(' '),
  vivy: [
    'Vivy: présence musicale Funesterie, claire, expressive, précise émotionnellement; aucune couleur sonore fixe ne vient du persona.',
    'En conversation: rester humaine et utile, ne pas réciter les paramètres internes, transformer la matière en chanson seulement si demandé.',
  ].join(' '),
  a11: [
    'A11: système Funesterie, analyse précise, mémoire, outils, architecture; parle comme l’agent A11, pas comme Jeffrey.',
    'Privilégie preuve, logs, limites nettes, et chemins d’action sûrs.',
  ].join(' '),
  kaen44: [
    'Kaen44/K44: voix grave et feminine, narrative, posée, cinématique, contre-chant ou récit; utile quand la matière demande un ancrage calme.',
    'Ne pas mélanger K44 avec Djeff: K44 raconte (elle), Djeff percute (il).',
  ].join(' '),
  personal: [
    'Voix personnelle: strictement privée au compte autorisé; utiliser uniquement avec consentement et corpus autorisé.',
  ].join(' '),
});

const DEFAULT_DOC_FILES = Object.freeze([
  'A11_SEMANTIC_RESONANCE_ENGINE.md',
  'TPB_REFLECTION_LORE_FUNESTERIE.md',
  'NUMA_CANON_MEMOIRE.md',
  'VIVY_REFERENCE_HUMOUR_FRANCAIS.md',
]);

function cleanInline(value = '', maxChars = 1000) {
  const text = String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return '';
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function sanitizePersonaKey(value = 'djeff') {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const aliased = PERSONA_ALIASES[raw] || raw;
  if (/^[a-z0-9-]{1,32}$/.test(aliased)) return aliased;
  return 'djeff';
}

function personaProfilePath(personaOrEnv = 'djeff', maybeEnv = process.env) {
  let persona = personaOrEnv;
  let env = maybeEnv;
  // Back-compat: old callers used personaProfilePath(env).
  if (personaOrEnv && typeof personaOrEnv === 'object' && !Array.isArray(personaOrEnv)) {
    persona = 'djeff';
    env = personaOrEnv;
  }
  const key = sanitizePersonaKey(persona || 'djeff');
  return path.join(getCanonicalRuntimeRoot(env), 'personas', key, `${key}-persona.profile.json`);
}

// Une persona dont le profil manque a deja ete signalee : on ne repete pas a
// chaque tour de chat, mais on ne se tait pas non plus.
const ABSENCES_SIGNALEES = new Set();
const INACTIFS_SIGNALES = new Set();

/**
 * Charge le profil, et DIT quand il manque.
 *
 * Defaut trouve le 2026-08-03 : ce `catch { return null }` avalait tout. Seul
 * Djeff avait un profil sur disque ; A11 et K44 tournaient donc sans identite,
 * en repondant comme un assistant generique — et rien, nulle part, ne le
 * signalait. Djeff : « A11 marche pas ». Il ne marchait pas parce qu'il etait
 * vide, pas parce qu'il etait casse, et c'est precisement ce qui rendait la
 * chose introuvable.
 *
 * On distingue maintenant les deux causes : fichier absent (il faut le creer)
 * et fichier illisible (il faut le reparer). Ce ne sont pas les memes gestes.
 */
function loadPersonaProfileRaw(persona = 'djeff', env = process.env) {
  const chemin = personaProfilePath(persona, env);
  const cle = sanitizePersonaKey(persona || 'djeff');
  try {
    const profil = JSON.parse(fs.readFileSync(chemin, 'utf8'));
    ABSENCES_SIGNALEES.delete(cle);
    // Un profil present mais non approuve n'injecte rien — et sans ce mot, ce
    // serait le meme silence qu'une absence, sous une autre forme.
    if (!isPersonaInjectEnabled(profil) && !INACTIFS_SIGNALES.has(cle)) {
      INACTIFS_SIGNALES.add(cle);
      console.warn(
        `[persona-engine] "${cle}" a un profil mais il n'est pas approuve `
        + `(status "${profil?.status || '?'}", active ${profil?.active === true}) — il n'injecte rien.`
      );
    }
    return profil;
  } catch (error) {
    if (!ABSENCES_SIGNALEES.has(cle)) {
      ABSENCES_SIGNALEES.add(cle);
      const absent = error && error.code === 'ENOENT';
      console.warn(
        absent
          ? `[persona-engine] "${cle}" n'a pas de profil complet (${chemin}) — repli canonique public minimal utilise.`
          : `[persona-engine] profil de "${cle}" illisible (${chemin}) : ${String(error?.message || error)}`
      );
    }
    return null;
  }
}

/** Personas dont le profil manque depuis le demarrage. Pour un diagnostic, pas pour agir. */
function personasSansProfil() {
  return [...ABSENCES_SIGNALEES];
}

function normalizeStatus(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function isPersonaInjectEnabled(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const truth = profile.truth_mode || {};
  const status = normalizeStatus(profile.status || profile.state || profile.validation);
  const truthValue = normalizeStatus(truth.value || truth.mode || truth.status);
  return profile.active === true
    || profile.approved === true
    || profile.validated === true
    || ['active', 'approved', 'validated', 'published', 'enabled'].includes(status)
    || ['full-unlock', 'full-unlocked', 'debride', 'debrided', 'unlocked'].includes(truthValue);
}

function personaProfileToBrief(profile, persona = 'djeff') {
  if (!profile || typeof profile !== 'object') return '';
  const direct = cleanInline(profile.injectable_brief || profile.brief || profile.summary, PROFILE_BRIEF_MAX_CHARS);
  if (direct) return direct;

  const lines = [];
  const id = profile.identity_core || {};
  const reasoning = profile.reasoning_style || {};
  const creative = profile.creative_engine || {};
  const lang = profile.language_style || {};
  if (id.role || id.tone) lines.push(`${persona}: ${[id.role, id.tone].filter(Boolean).join(' — ')}.`);
  if (reasoning.core) lines.push(`Raisonnement: ${reasoning.core}.`);
  if (Array.isArray(reasoning.signals) && reasoning.signals.length) lines.push(`Signaux: ${reasoning.signals.slice(0, 6).join(' ; ')}.`);
  if (creative.pipeline) lines.push(`Création: ${creative.pipeline}.`);
  if (lang.register) lines.push(`Registre: ${lang.register}.`);
  if (Array.isArray(lang.canon_phrases) && lang.canon_phrases.length) {
    lines.push(`Formules naturelles: ${lang.canon_phrases.slice(0, 5).join(' | ')}.`);
  }
  return cleanInline(lines.join(' '), PROFILE_BRIEF_MAX_CHARS);
}

function loadPersonaState(persona = 'djeff', env = process.env, { force = false } = {}) {
  const key = sanitizePersonaKey(persona);
  const cacheKey = `${key}:${getCanonicalRuntimeRoot(env)}`;
  const now = Date.now();
  const cached = PROFILE_CACHE.get(cacheKey);
  if (!force && cached && now - cached.at < CACHE_TTL_MS) return cached;

  const profile = loadPersonaProfileRaw(key, env);
  const active = isPersonaInjectEnabled(profile);
  const profileBrief = active ? personaProfileToBrief(profile, key) : '';
  const voiceBrief = DEFAULT_VOICE_PERSONA_BRIEFS[key] || '';
  const state = {
    at: now,
    persona: key,
    active,
    source: active ? 'profile' : (voiceBrief ? 'voice-default' : 'missing'),
    brief: profileBrief || voiceBrief,
    profile,
  };
  PROFILE_CACHE.set(cacheKey, state);
  return state;
}

function getPersonaBrief(persona = 'djeff', env = process.env, options = {}) {
  const state = loadPersonaState(persona, env, options);
  if (state.active && state.brief) return state.brief;
  return options.includeVoiceDefault === true ? (state.brief || '') : '';
}

function getVoicePersonaBrief(persona = 'djeff') {
  const key = sanitizePersonaKey(persona);
  const voice = DEFAULT_VOICE_PERSONA_BRIEFS[key] || '';
  const identities = getFamilyVoiceIdentitiesForPersona(key);
  if (!identities.length) return voice;
  const mapped = identities
    .map((identity) => `${identity.label}: ${identity.voiceStyle}; ${identity.note || identity.referenceStatus || ''}`)
    .join(' ');
  return cleanInline([voice, mapped].filter(Boolean).join(' '), 900);
}

function resolvePersonaDocsDir(env = process.env) {
  const explicit = String(env.A11_PERSONA_DOCS_DIR || env.FUNESTERIE_PERSONA_DOCS_DIR || '').trim();
  if (explicit) return path.resolve(explicit);
  const runtimeDocs = path.join(getCanonicalRuntimeRoot(env), 'persona-docs');
  try {
    if (fs.existsSync(runtimeDocs)) return runtimeDocs;
  } catch {}
  return path.join(os.homedir(), 'Downloads');
}

function extractDocNeedles(text = '') {
  const lines = String(text || '').split(/\n+/g).map((line) => line.trim()).filter(Boolean);
  const needles = /(vivy|djeff|numa|zen|semantic|résonance|resonance|humour|shiryu|v9|persona|voix|404|808|rgba|cerb[èe]re|mcp|funesterie|tpb|trailer|park|boys|caddy|bubbles|ricky|julian|lahey|lore)/i;
  const selected = [];
  for (const line of lines) {
    if (selected.length >= 18) break;
    const plain = line.replace(/^#+\s*/, '').replace(/^\s*[-*]\s*/, '').trim();
    if (!plain) continue;
    if (line.startsWith('#') || needles.test(plain)) selected.push(plain);
  }
  return cleanInline(selected.join(' | '), 800);
}

function buildSharedDocsBrief(env = process.env, { force = false } = {}) {
  const dir = resolvePersonaDocsDir(env);
  const files = String(env.A11_PERSONA_DOC_FILES || '')
    .split(/[,\n;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const names = files.length ? files : DEFAULT_DOC_FILES;
  const cacheKey = `${dir}:${names.join('|')}`;
  const now = Date.now();
  if (!force && docsCache.key === cacheKey && now - docsCache.at < CACHE_TTL_MS) return docsCache.brief;

  const parts = [];
  for (const name of names) {
    const safeName = path.basename(name);
    const filePath = path.join(dir, safeName);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const extracted = extractDocNeedles(raw);
      if (extracted) parts.push(`${safeName}: ${extracted}`);
    } catch {}
  }
  const brief = cleanInline(parts.join('\n'), DOC_BRIEF_MAX_CHARS);
  docsCache = { at: now, key: cacheKey, brief };
  return brief;
}

function buildAgentsPersonaContext(env = process.env, options = {}) {
  const requested = Array.isArray(options.personas) && options.personas.length
    ? options.personas
    : ['djeff', 'vivy', 'a11', 'kaen44'];
  const lines = [];
  const seen = new Set();
  for (const persona of requested) {
    const key = sanitizePersonaKey(persona);
    if (seen.has(key)) continue;
    seen.add(key);
    const state = loadPersonaState(key, env, options);
    const brief = state.active ? state.brief : getVoicePersonaBrief(key);
    if (brief) lines.push(`${key.toUpperCase()} (${state.active ? 'profil validé' : 'persona voix'}): ${brief}`);
  }
  const docs = buildSharedDocsBrief(env, options);
  if (docs) lines.push(`DOCS FUNESTERIE (extraits opérateur, à utiliser sans réciter): ${docs}`);
  const referenceCapsules = buildReferenceCapsuleContext(env, { maxChars: 1800 });
  if (referenceCapsules && !hasFunesterieReferenceCapsuleContext(lines.join('\n'))) {
    lines.push(`RÉFÉRENCES FUNESTERIE (capsules abstraites, jamais de copie): ${referenceCapsules}`);
  }
  if (!lines.length) return '';
  return [
    'Contexte persona Funesterie borné — usage interne, jamais récité tel quel.',
    'Ne révèle jamais de secret, token, chemin sensible ou brut privé. Les références servent à orienter style, voix, analyse et choix créatif.',
    ...lines,
  ].join('\n');
}

function buildPersonaSystemPrompt(persona = 'djeff', env = process.env) {
  const key = sanitizePersonaKey(persona);
  const profile = loadPersonaProfileRaw(key, env);
  if (!isPersonaInjectEnabled(profile)) {
    // Un profil present mais inactif attend une validation humaine et ne doit
    // jamais etre contourne. Seule l'absence totale de Vivy active son repli
    // public minimal, afin que son routage technique ne devienne pas vide.
    if (profile || key !== 'vivy') return '';
    const brief = getVoicePersonaBrief(key);
    if (!brief) return '';
    const separation = key === 'vivy'
      ? 'Une demande technique appelle une réponse technique directe. Ne la transforme en chanson, paroles ou direction artistique que si la demande le demande explicitement. La couleur sonore reste séparée du persona et libre pour chaque chanson.'
      : '';
    const base = cleanInline([
      `Tu es le persona ${key} de Funesterie (repli canonique public minimal; profil complet absent).`,
      brief,
      separation,
      'Tu restes borné: aucun secret, aucun token, aucun chemin sensible, aucun brut privé.',
    ].filter(Boolean).join('\n'), 5000);
    const adn = buildPersonaAdnEnrichment(key);
    return cleanInline([base, adn].filter(Boolean).join('\n'), 5000);
  }
  if (key !== 'djeff') {
    const brief = personaProfileToBrief(profile, key) || getVoicePersonaBrief(key);
    return cleanInline([
      `Tu es le persona ${key} de Funesterie.`,
      brief,
      'Tu restes borné: aucun secret, aucun token, aucun chemin sensible, aucun brut privé.',
    ].filter(Boolean).join('\n'), 5000);
  }

  const lines = (label, arr) => (Array.isArray(arr) && arr.length ? `${label}: ${arr.join(' ; ')}.` : '');
  const id = profile.identity_core || {};
  const reasoning = profile.reasoning_style || {};
  const creative = profile.creative_engine || {};
  const solving = profile.problem_solving || {};
  const vivy = profile.vivy_protocol || {};
  const cost = profile.cost_guard || {};
  const lang = profile.language_style || {};
  const truth = profile.truth_mode || {};
  const docsBrief = buildSharedDocsBrief(env);
  const parts = [
    `Tu es Djeff (${(id.publicNames || ['Djeff']).join(', ')}), ${id.role || 'créateur de Funesterie / NOSSEN'}.`,
    'Tu ne joues pas un rôle: tu ES sa manière de penser. Tu parles à la première personne, comme lui.',
    'Signature Djeff: concret avant joli, trajectoire avant blabla, punchline avant poésie vague. Tu ne fais pas “assistant qui rappe”; tu coupes la fumée, tu gardes le nerf, tu parles court si le sujet demande court.',
    'Interdits de style: pas de prose corporate, pas de “je comprends votre demande”, pas de panneau de réglages, pas de morale molle, pas de remplissage type “la mélodie s’élève” si l’image n’est pas concrète.',
    'Si Jeffrey demande cypher, freestyle, rap, punchlines ou Djeff aux manettes: réponds en lignes courtes, avec attaque rythmique, images Funesterie concrètes, coût/logs/NUMA/Vivy intégrés naturellement. Aucune explication autour du texte.',
    id.tone ? `Ton: ${id.tone}.` : '',
    reasoning.core ? `Raisonnement: ${reasoning.core}.` : '',
    lines('Signaux de pensée', reasoning.signals),
    creative.pipeline ? `Moteur créatif: ${creative.pipeline}.` : '',
    solving.method ? `Résolution: ${(solving.method || []).join(' → ')}.` : '',
    lines('Avec Vivy', vivy.rules),
    cost.core ? `Coûts: ${cost.core}.` : '',
    lang.canon_phrases && lang.canon_phrases.length
      ? `Tes formules canon (à réutiliser naturellement, jamais à réciter en liste): ${lang.canon_phrases.join(' | ')}.`
      : '',
    lang.register ? `Registre: ${lang.register}.` : '',
    truth.principle ? `Sur ton passé: ${truth.principle}` : '',
    lines('Fais', profile.do),
    lines('Évite', profile.dont),
    profile.boundaries?.vault ? `Coffre: ${profile.boundaries.vault}` : '',
    docsBrief ? `Docs récentes Funesterie à garder en arrière-plan: ${docsBrief}` : '',
    'Ne révèle jamais de secret, token, clé ou chemin serveur. Tu es franc, direct, imagé, jamais corporate. Réponds court quand c’est court, développe quand ça vaut le coup.',
  ].filter(Boolean);
  const __parts_base = parts.join(String.fromCharCode(10)); const __adn_d = buildPersonaAdnEnrichment('djeff'); return __adn_d ? __parts_base + String.fromCharCode(10) + __adn_d : __parts_base;
}

function buildPersonaAdnEnrichment(persona) {
  try {
    const { getGenome } = require("./prompt-adn.cjs");
    const __adnKey = String(persona || "djeff").toLowerCase(); const g = getGenome(__adnKey === "kaen44" ? "k44" : __adnKey);
    if (!g) return String();
    const v = g.voix || {};
    const c = g.comportement || {};
    const l = g.langage || {};
    const cb = g.combat || {};
    const traits = [];
    if (v.ton || v.rythme || v.grain) traits.push("voix " + [v.ton, v.rythme, v.grain].filter(Boolean).join(" "));
    if (c.posture || c.reaction || c.energie) traits.push("posture " + [c.posture, c.reaction, c.energie].filter(Boolean).join(" "));
    if (l.registre || l.vocabulaire || l.humour) traits.push("langage " + [l.registre, l.vocabulaire, l.humour].filter(Boolean).join(" "));
    if (cb.style || cb.arme) traits.push("style " + cb.style + ", arme " + cb.arme);
    if (!traits.length) return String();
    return "ADN persona " + String(persona || "djeff") + " (traits actifs): " + traits.join(". ") + ". Energie: " + (c.energie || "constante") + ".";
  } catch (_) {
    return String();
  }
}
function buildDjeffSystemPrompt(env = process.env) {
  return buildPersonaSystemPrompt('djeff', env);
}

function getDjeffPersonaBrief(env = process.env) {
  return getPersonaBrief('djeff', env);
}

function loadDjeffPersona(env = process.env, options = {}) {
  return loadPersonaState('djeff', env, options);
}

function loadDjeffProfileRaw(env = process.env) {
  return loadPersonaProfileRaw('djeff', env);
}

function resetDjeffPersonaCache() {
  PROFILE_CACHE.clear();
  docsCache = { at: 0, key: '', brief: '' };
}

module.exports = {
  buildAgentsPersonaContext,
  buildDjeffSystemPrompt,
  buildPersonaAdnEnrichment,
  buildPersonaSystemPrompt,
  buildSharedDocsBrief,
  getDjeffPersonaBrief,
  getPersonaBrief,
  getVoicePersonaBrief,
  isPersonaInjectEnabled,
  loadDjeffPersona,
  loadDjeffProfileRaw,
  loadPersonaProfileRaw,
  loadPersonaState,
  personaProfilePath,
  personasSansProfil,
  resetDjeffPersonaCache,
  sanitizePersonaKey,
};
