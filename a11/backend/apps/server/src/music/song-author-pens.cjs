'use strict';

// Chaque voix écrit ses propres paroles (25/09/2026). Djeff : « chaque persona ou IA
// doit composer ses paroles, ce ne doit plus être à Vivy de composer pour tout le
// monde ». Jusqu'ici toute chanson, même un solo Djeff ou K44, passait par le seul
// prompt système de Vivy : les autres voix chantaient des lignes écrites avec la
// plume de Vivy. Seul Jeffrey (voix catalogue) avait reçu sa plume le 17/09.
//
// Ce module décide QUI écrit : il donne à chaque voix du casting son identité
// d'auteur (profil validé s'il existe, sinon brief voix + ADN) et dit clairement
// que Vivy n'écrit que ce qu'elle chante elle-même.

const {
  buildPersonaSystemPrompt,
  buildPersonaAdnEnrichment,
  getPersonaBrief,
} = require('../persona/persona-engine.cjs');
const { getGenome } = require('../persona/prompt-adn.cjs');

const SONG_AUTHOR_LABELS = Object.freeze({
  vivy: 'Vivy',
  djeff: 'Djeff',
  marvin: 'Marvin',
  a11: 'A11',
  k44: 'K44',
});

const PEN_MAX_CHARS = 5000;

function normalizeSongAuthorId(value = '') {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'kaen44' || id === 'kaen') return 'k44';
  return SONG_AUTHOR_LABELS[id] ? id : '';
}

function resolveSongAuthors(artists = []) {
  const list = Array.isArray(artists) ? artists : String(artists || '').split(/[,+/|;\s]+/g);
  return list
    .map(normalizeSongAuthorId)
    .filter((id, index, all) => id && all.indexOf(id) === index);
}

// L'identité d'auteur d'une voix. Un profil validé passe en premier ; sans lui, le
// brief voix par défaut, la phrase d'activation et les traits ADN — jamais un profil
// non approuvé (persona-engine refuse déjà de l'injecter). Pas getVoicePersonaBrief :
// il ajoute les fiches comptes famille (compte, voiceId), rien qui serve une plume.
function buildAuthorIdentity(id, env = process.env) {
  const personaKey = id === 'k44' ? 'kaen44' : id;
  const profilePrompt = buildPersonaSystemPrompt(personaKey, env);
  if (profilePrompt) return profilePrompt;
  const brief = getPersonaBrief(personaKey, env, { includeVoiceDefault: true });
  const activation = String(getGenome(id)?.activation || '').trim();
  const adn = buildPersonaAdnEnrichment(id);
  return [brief, activation, adn].filter(Boolean).join('\n');
}

function isSoloVivy(authors = []) {
  return authors.length === 1 && authors[0] === 'vivy';
}

// Vrai quand Vivy n'est pas au casting : elle ne doit alors pas signer la chanson.
function isSongWrittenWithoutVivy(artists = []) {
  const authors = resolveSongAuthors(artists);
  return authors.length > 0 && !authors.includes('vivy');
}

/**
 * Prompt système des plumes. Vide pour un solo Vivy : elle écrit déjà avec sa voix.
 * `jeffreyPen` : la plume Jeffrey (voix catalogue), qui remplace celle de Djeff.
 */
function buildSongAuthorPens({ artists = [], jeffreyPen = '', env = process.env } = {}) {
  const authors = resolveSongAuthors(artists);
  if (!authors.length || isSoloVivy(authors)) return '';
  const labels = authors.map((id) => SONG_AUTHOR_LABELS[id]);
  const header = authors.includes('vivy')
    ? `Chaque voix écrit elle-même les lignes qu'elle chante : ${labels.join(', ')}. Vivy écrit seulement ses propres parties, avec sa voix ; les autres parties sont écrites par leur chanteur, avec sa plume à lui ou à elle, décrite ci-dessous.`
    : `Cette chanson est écrite par ${labels.join(' et ')}, pas par Vivy. Chaque voix écrit elle-même les lignes qu'elle chante, avec sa plume décrite ci-dessous.`;
  const sections = authors.map((id) => {
    const label = SONG_AUTHOR_LABELS[id];
    if (id === 'vivy') {
      return `Plume de Vivy (lignes sous [Vivy]) : sa propre voix, celle du cadre Vivy.`;
    }
    const identity = id === 'djeff' && jeffreyPen ? jeffreyPen : buildAuthorIdentity(id, env);
    if (!identity) return `Plume de ${label} (lignes sous [${label}]) : écris comme ${label} parle, à la première personne.`;
    return [
      `Plume de ${label} (lignes sous [${label}]) — c'est ${label} qui écrit ces lignes, à la première personne :`,
      identity,
    ].join('\n');
  });
  const footer = authors.length > 1
    ? 'Les voix se répondent : chacune garde son vocabulaire, son rythme et son regard ; aucune n\'écrit dans le style de l\'autre. Le sujet, la langue et la structure demandés restent communs.'
    : 'Le sujet, la langue et la structure demandés restent ceux de la demande ; seule la plume change.';
  const guard = 'Les identités ci-dessus guident la plume, pas le sujet : n\'y puise ni infrastructure, ni coûts, ni journaux, ni outils, sauf si le sujet de la chanson le demande. Aucun secret dans les paroles.';
  return [header, ...sections, footer, guard].join('\n\n').slice(0, PEN_MAX_CHARS * Math.max(1, authors.length));
}

// Libellé public de l'étape « paroles » du live.
function describeSongAuthors(artists = []) {
  const authors = resolveSongAuthors(artists);
  if (!authors.length) return 'Vivy écrit';
  const labels = authors.map((id) => SONG_AUTHOR_LABELS[id]);
  if (labels.length === 1) return `${labels[0]} écrit ses paroles`;
  return `${labels.join(' et ')} écrivent chacun leurs paroles`;
}

// ─── Passe par chanteur ────────────────────────────────────────────────
// Le premier jet est écrit en un seul appel, plumes comprises. Ensuite chaque voix
// reçoit SON appel, avec SA persona pour prompt système, et réécrit seulement les
// sections à son nom. Les sections communes (duo, ensemble) restent au premier jet.

const SHARED_TAG_PATTERN = /\b(?:duo|tous|toutes|ensemble|both|all|together|choeur|chorus\s+all)\b|[+&]/;
const AUTHOR_TAG_PATTERNS = Object.freeze({
  djeff: /\bdjeff\b|\bjeffrey\b/,
  vivy: /\bvivy\b/,
  marvin: /\bmarvin\b/,
  a11: /\ba11\b/,
  k44: /\bk44\b|\bkaen44\b/,
});

function foldTag(value = '') {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function isTagLine(line = '') {
  return /^\s*\[[^\]\r\n]{1,100}\]\s*$/.test(line);
}

// Sections = en-tête (une ou plusieurs balises consécutives) + corps.
function splitSongSections(lyrics = '') {
  const sections = [];
  let current = { header: [], body: [] };
  for (const line of String(lyrics || '').split(/\r?\n/)) {
    if (isTagLine(line)) {
      if (current.body.some((entry) => entry.trim())) {
        sections.push(current);
        current = { header: [], body: [] };
      }
      current.header.push(line.trim());
    } else {
      current.body.push(line);
    }
  }
  if (current.header.length || current.body.some((entry) => entry.trim())) sections.push(current);
  return sections;
}

function joinSongSections(sections = []) {
  return sections
    .map((section) => [...section.header, ...section.body].join('\n').replace(/\n+$/, ''))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Une section appartient à une voix seulement si l'en-tête nomme cette voix, et elle seule.
function sectionOwner(section = {}, authors = []) {
  const folded = foldTag(section.header.join(' '));
  if (!folded || SHARED_TAG_PATTERN.test(folded)) return '';
  const named = authors.filter((id) => AUTHOR_TAG_PATTERNS[id]?.test(folded));
  return named.length === 1 ? named[0] : '';
}

function buildSingerPen(id, { jeffreyPen = '', env = process.env } = {}) {
  const label = SONG_AUTHOR_LABELS[id];
  if (id === 'djeff' && jeffreyPen) return jeffreyPen;
  const identity = id === 'vivy'
    ? [buildPersonaSystemPrompt('vivy', env), buildPersonaAdnEnrichment('vivy')].filter(Boolean).join('\n')
    : buildAuthorIdentity(id, env);
  return [
    `Tu es ${label}. Tu écris toi-même, à la première personne, les lignes que tu chantes dans cette chanson.`,
    identity,
    'Les identités guident la plume, pas le sujet : ni infrastructure, ni coûts, ni journaux, ni outils dans les paroles, sauf si le sujet le demande. Aucun secret.',
  ].filter(Boolean).join('\n\n');
}

function buildSingerPartsRequest({ id, lyrics, owned, subject = '', language = '' }) {
  const label = SONG_AUTHOR_LABELS[id];
  return [
    subject ? `Sujet de la chanson : ${subject}` : '',
    language && language !== 'fr' ? `Langue des paroles : ${language}.` : '',
    'Premier jet complet, pour le contexte (les autres voix gardent leurs lignes) :',
    lyrics,
    '',
    `Réécris avec ta propre plume uniquement tes ${owned.length} section(s) à toi, ${label}. Garde le sens, les images du sujet, la place de chaque section dans l'histoire et une longueur proche ; change la voix, le vocabulaire, le rythme pour qu'ils soient les tiens. Réponds aux autres voix quand elles te parlent.`,
    'Rends exactement ces sections, dans cet ordre, chacune précédée de son en-tête recopié tel quel, et rien d\'autre : pas de commentaire, pas d\'autre section.',
    '',
    owned.map((section) => [...section.header, ...section.body].join('\n').trim()).join('\n\n'),
  ].filter((line) => line !== null && line !== undefined).join('\n');
}

function acceptRewrite(original = [], rewritten = []) {
  const originalChars = original.join('\n').trim().length;
  const text = rewritten.join('\n').trim();
  if (!text) return false;
  if (text.length > Math.max(1200, originalChars * 3)) return false;
  return true;
}

/**
 * Chaque voix du casting réécrit ses propres sections, dans un appel à elle.
 * `writeParts({ artistId, system, message, maxTokens })` renvoie le texte du modèle.
 * Ne jette jamais : une voix qui échoue garde les lignes du premier jet.
 */
async function composeSingerParts({
  lyrics = '',
  artists = [],
  writeParts,
  jeffreyPen = '',
  subject = '',
  language = '',
  logger = console,
  env = process.env,
} = {}) {
  const authors = resolveSongAuthors(artists);
  const result = { lyrics, rewritten: [], kept: [] };
  if (authors.length < 2 || typeof writeParts !== 'function' || !String(lyrics || '').trim()) return result;
  const sections = splitSongSections(lyrics);
  const owners = sections.map((section) => sectionOwner(section, authors));

  const jobs = authors.map(async (id) => {
    const indexes = owners.map((owner, index) => (owner === id ? index : -1)).filter((index) => index >= 0);
    if (!indexes.length) return { id, status: 'aucune section' };
    const owned = indexes.map((index) => sections[index]);
    try {
      const reply = await writeParts({
        artistId: id,
        system: buildSingerPen(id, { jeffreyPen, env }),
        message: buildSingerPartsRequest({ id, lyrics, owned, subject, language }),
        maxTokens: Math.min(6000, 600 + owned.reduce((sum, section) => sum + section.body.join('\n').length, 0)),
      });
      const returned = splitSongSections(String(reply || '')).filter((section) => section.header.length);
      if (returned.length !== owned.length) return { id, status: `sections rendues ${returned.length}/${owned.length}` };
      const bodies = returned.map((section) => section.body);
      if (!owned.every((section, index) => acceptRewrite(section.body, bodies[index]))) {
        return { id, status: 'réécriture rejetée (vide ou démesurée)' };
      }
      return { id, status: 'ok', indexes, bodies };
    } catch (error) {
      return { id, status: `échec: ${String(error?.message || error).slice(0, 120)}` };
    }
  });

  const outcomes = await Promise.all(jobs);
  const merged = sections.map((section) => ({ header: section.header, body: section.body }));
  for (const outcome of outcomes) {
    if (outcome.status === 'ok') {
      outcome.indexes.forEach((sectionIndex, i) => {
        merged[sectionIndex] = { header: merged[sectionIndex].header, body: outcome.bodies[i] };
      });
      result.rewritten.push(outcome.id);
    } else {
      result.kept.push(`${outcome.id}: ${outcome.status}`);
    }
  }
  if (result.kept.length) logger.warn?.('[SongAuthorPens] premier jet gardé pour %s', result.kept.join(' | '));
  if (result.rewritten.length) result.lyrics = joinSongSections(merged);
  return result;
}

module.exports = {
  SONG_AUTHOR_LABELS,
  buildSingerPen,
  buildSongAuthorPens,
  composeSingerParts,
  describeSongAuthors,
  isSongWrittenWithoutVivy,
  resolveSongAuthors,
  sectionOwner,
  splitSongSections,
};
