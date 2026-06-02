'use strict';

const {
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
} = require('../../lib/language-text.cjs');

function cleanText(value, max = 2400) {
  return normalizeTextNfc(value, max);
}

function cleanOneLine(value, fallback = '', max = 160) {
  return normalizeOneLineNfc(value, fallback, max);
}

function stripSongCommand(value = '') {
  return cleanOneLine(value, '', 360)
    .replace(/^(fais|fait|cr[ée]e?|g[ée]n[èe]re?|compose|chante|transforme|écris|ecris)\s+(moi\s+)?(une?\s+)?(chanson|musique|son|paroles|lyrics)\s*(sur|avec|pour|à propos de)?\s*/i, '')
    .replace(/\b(prompt|instruction|consigne)\b\s*:?\s*/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeCompleteLyrics(value = '') {
  const text = cleanText(value, 2400);
  if (!text) return false;
  const sectionCount = (text.match(/\[(verse|chorus|bridge|intro|outro|couplet|refrain|pont|pré-refrain|pre-chorus)\]/ig) || []).length;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (sectionCount >= 3 && lines.length >= 10) return true;
  return sectionCount >= 2 && lines.length >= 14;
}

function inferMotif(theme = '') {
  const folded = foldTextForLookup(theme);
  if (/neige|flocon|hiver|bol/.test(folded)) return 'un flocon dans le bol du matin';
  if (/lapin|court|course/.test(folded)) return 'une ombre vive qui traverse les néons';
  if (/pluie|orage|averse/.test(folded)) return 'la pluie qui écrit sur les vitres';
  if (/nossen|funesterie|agent|machine/.test(folded)) return 'un signal humain dans les circuits';
  if (/nuit|ombre|dark|sombre/.test(folded)) return 'une veilleuse cachée dans la nuit';
  if (/amour|coeur|cœur|manque/.test(folded)) return 'un battement gardé sous la peau';
  return 'une petite lumière qui refuse de s’éteindre';
}

function inferTitle(theme = '') {
  const stripped = stripSongCommand(theme);
  const motif = inferMotif(stripped);
  if (/flocon|neige|bol/i.test(stripped)) return 'Flocon d’émerveillement';
  if (/lapin/i.test(stripped)) return 'Course sous les néons';
  if (/nossen|funesterie/i.test(stripped)) return 'Signal Funesterie';
  const words = (stripped || motif)
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 4);
  if (!words.length) return 'Je garde la lumière';
  return words
    .map((word) => word.charAt(0).toLocaleUpperCase('fr-FR') + word.slice(1).toLocaleLowerCase('fr-FR'))
    .join(' ');
}

function buildVivySongcraftSystemPrompt(mode = 'song') {
  if (mode !== 'song') return '';
  return [
    'Module Vivy Songcraft actif.',
    "Si l'utilisateur demande une chanson, des paroles, un refrain, un couplet ou une composition, réponds comme une artiste-auteure, pas comme un assistant qui explique.",
    'Format attendu sauf demande contraire: Titre, intention courte, puis paroles complètes avec [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Outro].',
    'Chaque couplet doit avoir au moins 4 vers; le refrain doit être mémorable et revenir comme un vrai hook.',
    'Utilise des rimes audibles, des reprises internes et une image concrète récurrente. Évite les généralités plates du type "la vie est une aventure" ou "nouveau miracle" si elles ne sont pas transformées en image.',
    'Ajoute du sens caché: une tension, une métaphore ou une contradiction douce entre surface et profondeur.',
    'Ne termine pas par une explication scolaire de la structure, sauf si l’utilisateur le demande explicitement.',
  ].join('\n');
}

function buildVivyStructuredLyrics(input = {}) {
  const material = cleanText([
    input.lyrics,
    input.songText,
    input.text,
    input.theme,
    input.instruction,
    input.prompt,
  ].filter(Boolean).join('\n\n'), 2400);

  if (looksLikeCompleteLyrics(material)) return cleanText(material, 2400);

  const theme = stripSongCommand(material) || 'Vivy garde la lumière';
  const motif = inferMotif(theme);
  const title = cleanOneLine(input.songTitle || input.title || inferTitle(theme), 'Je garde la lumière', 80);

  return cleanText([
    `[Title: ${title}]`,
    '',
    '[Intro]',
    'Un souffle clair descend sur la scène,',
    `Je tiens ${motif} dans la main.`,
    '',
    '[Verse 1]',
    'Je cherche un signe au bord de la nuit,',
    'Un fil de néon tremble dans le bruit.',
    `Tout semble petit: ${theme},`,
    'Mais sous la surface, un monde me suit.',
    '',
    '[Pre-Chorus]',
    'Je cache un soleil sous ma voix légère,',
    'Pour qu’il traverse les murs de matière.',
    '',
    '[Chorus]',
    'Garde la lumière, garde-la encore,',
    'Même si le monde efface le décor.',
    'Je fais d’un silence une porte ouverte,',
    'Et ton idée respire quand la peur déserte.',
    '',
    '[Verse 2]',
    `Je reviens vers ${motif},`,
    'Comme un secret qu’on apprend sans le dire.',
    'Le cœur bat bas, mais la scène répond,',
    'Je transforme la faille en horizon.',
    '',
    '[Bridge]',
    'Si je tombe, je chante plus bas,',
    'La nuit comprend ce que le jour ne voit pas.',
    '',
    '[Chorus]',
    'Garde la lumière, garde-la encore,',
    'Même si le monde efface le décor.',
    'Je fais d’un silence une porte ouverte,',
    'Et ton idée respire quand la peur déserte.',
    '',
    '[Outro]',
    `Il reste ${motif},`,
    'Et ma voix le ramène demain.',
  ].join('\n'), 2400);
}

function buildVivySongProductionBrief(input = {}) {
  const lyrics = buildVivyStructuredLyrics(input);
  const titleMatch = lyrics.match(/^\[Title:\s*([^\]]+)\]/im);
  const title = cleanOneLine(input.songTitle || input.title || (titleMatch && titleMatch[1]) || inferTitle(lyrics), 'Je garde la lumière', 80);
  const rhymeScheme = cleanOneLine(input.rhymeScheme || 'Couplets AABB souples, refrain ABAB, reprises internes sur lumière / décor / porte / peur.', '', 180);
  return {
    title,
    lyrics,
    rhymeScheme,
    craftLines: [
      `Titre: ${title}`,
      `Rimes: ${rhymeScheme}`,
      `Motif: ${inferMotif(lyrics)}`,
      'Structure: intro, couplet 1, pré-refrain, refrain, couplet 2, pont, refrain, outro.',
      'Intention: paroles chantables, images concrètes, refrain stable, sens caché lisible.',
    ],
  };
}

module.exports = {
  buildVivySongcraftSystemPrompt,
  buildVivySongProductionBrief,
  buildVivyStructuredLyrics,
  inferTitle,
  stripSongCommand,
  looksLikeCompleteLyrics,
};
