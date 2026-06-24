'use strict';

const {
  LANGUAGE_NAMES,
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
  normalizeLanguageCode,
} = require('../../lib/language-text.cjs');

const VIVY_SONG_MAX_CHARS = 12000;

function cleanText(value, max = 2400) {
  return normalizeTextNfc(value, max);
}

function cleanOneLine(value, fallback = '', max = 160) {
  return normalizeOneLineNfc(value, fallback, max);
}

function applyCasePattern(source = '', replacement = '') {
  if (!source) return replacement;
  if (source === source.toLocaleUpperCase('fr-FR')) return replacement.toLocaleUpperCase('fr-FR');
  const first = source[0] || '';
  if (first === first.toLocaleUpperCase('fr-FR') && first !== first.toLocaleLowerCase('fr-FR')) {
    return replacement.charAt(0).toLocaleUpperCase('fr-FR') + replacement.slice(1);
  }
  return replacement;
}

function restoreVivyFrenchSongAccents(value = '') {
  const replacements = [
    [/\brefren\b/gi, (match) => applyCasePattern(match, 'refrain')],
    [/\bmillimetres?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'millimètres' : 'millimètre')],
    [/\bserrees?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'serrées' : 'serrée')],
    [/\bdecides?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'décides' : 'décide')],
    [/\bdetails?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'détails' : 'détail')],
    [/\bconnait\b/gi, (match) => applyCasePattern(match, 'connaît')],
    [/\bpremieres?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'premières' : 'première')],
    [/\breponds\b/gi, (match) => applyCasePattern(match, 'réponds')],
    [/\brepondent\b/gi, (match) => applyCasePattern(match, 'répondent')],
    [/\brepond\b/gi, (match) => applyCasePattern(match, 'répond')],
    [/\bmemes?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'mêmes' : 'même')],
    [/\belans?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'élans' : 'élan')],
    [/\bdecoupes?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'découpes' : 'découpe')],
    [/\blumieres?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'lumières' : 'lumière')],
    [/\bcabrees?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'cabrées' : 'cabrée')],
    [/\baccrochees?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'accrochées' : 'accrochée')],
    [/\bmatieres?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'matières' : 'matière')],
    [/\bmelodies?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'mélodies' : 'mélodie')],
    [/\bprecises?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'précises' : 'précise')],
    [/\bchaines?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'chaînes' : 'chaîne')],
    [/\bdebits?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'débits' : 'débit')],
    [/\brealites?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'réalités' : 'réalité')],
    [/\bcaracterise\b/gi, (match) => applyCasePattern(match, 'caractérise')],
    [/\bapparait\b/gi, (match) => applyCasePattern(match, 'apparaît')],
    [/\bapparaitre\b/gi, (match) => applyCasePattern(match, 'apparaître')],
    [/\bdeja\b/gi, (match) => applyCasePattern(match, 'déjà')],
    [/(?<![\p{L}\p{N}])tres(?![\p{L}\p{N}])/giu, (match) => applyCasePattern(match, 'très')],
    [/\betre\b/gi, (match) => applyCasePattern(match, 'être')],
    [/\bidees?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'idées' : 'idée')],
    [/\breves?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'rêves' : 'rêve')],
    [/\bcoeurs?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'cœurs' : 'cœur')],
    [/\bcotes?\b/gi, (match) => applyCasePattern(match, match.endsWith('s') ? 'côtés' : 'côté')],
    [/\bdepuis la\b/gi, (match) => applyCasePattern(match, 'depuis là')],
  ];

  return String(value || '')
    .split(/\r?\n/)
    .map((line) => {
      return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), line);
    })
    .join('\n')
    .normalize('NFC');
}

function stripSongCommand(value = '') {
  return cleanOneLine(value, '', 360)
    .replace(/^(?:salut|bonjour|coucou|hey)\b[\s,;:.!?-]*/i, '')
    .replace(/^(?:tu\s+as\s+|t['’]\s*as\s+)?(?:une?\s+)?id[ée]e\s+de\s+chanson\s+(?:sur|pour|avec)\s+/i, '')
    .replace(/^(fais|fait|cr[ée]e?|g[ée]n[èe]re?|compose|chante|transforme|écris|ecris|continue|continuer|reprends|poursuis|compl[èe]te)\s+(moi\s+)?(une?\s+)?(chanson|musique|son|paroles|lyrics|rap|couplet|refrain)(?:\s+d['''][a-zÀ-ſ]+(?:\s+[a-zÀ-ſ]+)?)?\s*(sur|avec|pour|à propos de)?\s*/i, '')
    .replace(/\b(prompt|instruction|consigne)\b\s*:?\s*/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeVivySongUiNoiseLine(line = '') {
  const raw = String(line || '').trim();
  const folded = foldTextForLookup(raw);
  if (!folded) return true;

  // A standalone bracketed tag ([Vivy], [Djeff], [Verse 1], [Chorus - Duo]...) is a
  // section/voice marker, never UI noise. Keep it so complete songs are detected.
  if (/^\[[\p{L}\p{N} &,\/'’-]{1,40}\]$/u.test(raw)) return false;

  if (/^je suis vivy(?:\b|$)/.test(folded)) return true;
  if (/^parle moi d une (?:voix|chanson|ambiance|scene)\b/.test(folded)) return true;
  if (/^(vivy|vous|accueil|discussion|menu|voix|chanson|scene|scène|fichier|envoyer|copier|partager|defaut|défaut|audio perso|importer|ptt)$/.test(folded)) return true;
  if (/^(vivy_song_production|vivy_studio_handoff|vivy_production|vivy_voice_calibration|vivy_scene_share|vivy song production|vivy studio handoff|vivy production|vivy voice calibration|vivy scene share)\b/.test(folded)) return true;
  if (/^vivy_(?:music_generation|production_status)\b/.test(folded)) return true;
  if (/\b(prompt suno|original song inspired by|french original vocal production|structured rhymed lyrics|sung vocals|no spoken narration|no copyrighted melody|no celebrity voice imitation)\b/.test(folded)) return true;
  if (/^(theme|style)\s*:/.test(folded) && /\b(original song|suno|lyrics|vocals|production)\b/.test(folded)) return true;
  if (/^(oui je reste en discussion libre|je capte|je ne transforme pas|je vois l idee|ce que je prends surtout|je reponds au fond|la voix vivy par defaut|idee rangee dans la memoire vivy)\b/.test(folded)) return true;
  if (/^(c est un bon debut|je vois que tu as deja commence|voici une proposition|voici un exemple|les saint seiya|pour ecrire une chanson|pour écrire une chanson|tu pourrais|pour les paroles|en termes de melodie|qu en penses tu|est ce que cela te donne|est ce que tu veux)\b/.test(folded)) return true;
  if (/\b(j espere que (?:tu|vous|cette chanson|cela|ca)|n hesite pas a|n hesitez pas|feedbacks?|modifications? si necessaire)\b/.test(folded)) return true;
  if (/^(?:\*\s*)?(les armures|les combats epiques|les themes de|l amitie|la recherche de|la lutte pour|la quete de|les chevaliers du zodiaque|les heros|ils sont les symboles)\b/.test(folded)) return true;
  if (/\b(quel est le ton que tu veux donner|veux tu qu elle soit|je suis la pour t aider|cela te donne des idees)\b/.test(folded)) return true;
  if (/^(source|direction sonore|titre de travail|structure proposee|assets a produire|paroles guide|routage|flux chanson|atelier|objectif|brief agents|composition production|creation voix|scene partage|sortie attendue|routage recommande|media pret|média prêt|multimodal runtime|janus vision|janus pro|provider|modele|modèle|device|worker|gpu|vram|recommendation|recommandation|dernier scan|safety lane|nerve routing|a11host|bridge vsix|headless|qflush flow|process supervises|clé suno personnelle|cle suno personnelle)\b/.test(folded)) return true;
  if (/^mix d40\b/.test(folded)) return true;
  if (/\b(?:meme|même)\s+format\s+pret\b|\bformat\s+pret\b/.test(folded)) return true;
  if (/https?:\/\/\S*(?:token=|\/api\/double-harmonic\/out\/)/i.test(raw)) return true;
  if (/\b(?:token|access_token|signature|sig|key)=\S+/i.test(raw)) return true;
  if (/^-\s*(kaen44|vivy|a11|ekko|pink-ward)\s*:/.test(folded)) return true;
  if (/^-\s*(source|direction sonore|titre|rimes|motif|structure|intention|artistes coches|artistes cochés|distribution vocale|outil voix actif|prosodie interne|nombre de chanteurs|tags obligatoires|intro|couplet|pre-refrain|pré-refrain|refrain guide|pont|final|role|rôle|sortie simple possible)\b/.test(folded)) return true;
  if (/^(continue|continuer|reprends|poursuis|compl[èe]te)\s+(les\s+)?(paroles|lyrics|couplets?|refrain|rap)\b/.test(folded)) return true;
  if (/\b(envoie|envois|envoyer|donne|donnes|sort|termine|fais)\b.{0,100}\b(reste|suite|paroles|lyrics)\b/.test(folded)) return true;
  if (/^(ex\s*:|exemple\s*:|créer vraie chanson suno|creer vraie chanson suno|oublier cle suno|oublier clé suno|preparer chanson|préparer chanson|demander a vivy|demander à vivy|ouvrir a11|sauver dans a11|kaen44)$/.test(folded)) return true;

  return false;
}

function splitVivySongMaterialCandidates(value = '') {
  return String(value || '')
    .replace(/([.!?])\s+/g, '$1\n')
    .replace(/\s+(\*\s+)/g, '\n$1')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function expandVivySongMaterialCandidate(value = '') {
  let line = cleanOneLine(value, '', 320);
  if (!line) return [];

  const folded = foldTextForLookup(line);
  if (!folded) return [];

  if (/^(matiere chanson nossen|matiere chanson|nossen banger production brief|nossen banger)\.?$/.test(folded)) return [];
  if (/^(?:voix|vocal cast|casting choisi|contexte utile)\s*:/i.test(line)) return [];
  if (/\bsections?\s+s[ée]par[ée]es?\b/i.test(line)) return [];
  if (/^(a transformer|à transformer|ecris une chanson|écris une chanson|le refrain doit|si le mot anglais|composer une chanson|production chantee|production chantée|appliquer ensuite)\b/.test(folded)) return [];
  if (/\b(?:ne chante jamais|pas a recopier|pas à recopier|jamais les consignes|bouton|bugs?|mot prompt|production suno|mix final d40|d40 v9|suno)\b/.test(folded)) return [];

  const labelMatch = line.match(/^(?:titre possible|titre|theme|thème|images?|matiere utile|matière utile)\s*:?\s*(.+)$/i);
  if (labelMatch) line = cleanOneLine(labelMatch[1], '', 300);
  line = line.replace(/^NOSSEN\s+Banger\s*[:.-]?\s*/i, '').trim();
  if (!line) return [];

  return line
    .split(/\s+\/\s+|,\s+(?=(?:écran|ecran|voix|feu|route|lien|vitesse|monde|nouvelle|réel|reel)\b)/i)
    .map((part) => cleanOneLine(part, '', 180))
    .filter((part) => {
      const partFolded = foldTextForLookup(part);
      return partFolded && !looksLikeVivySongUiNoiseLine(part);
    });
}

function normalizeVivySongSectionMarkup(value = '') {
  const sectionName = (raw = '', number = '', artist = '') => {
    const folded = foldTextForLookup(raw);
    const canonical = /^(couplet|verse)$/.test(folded)
      ? 'Verse'
      : /^(refrain|refren|chorus)$/.test(folded)
        ? 'Chorus'
        : /^(pont|bridge)$/.test(folded)
          ? 'Bridge'
          : /^(pre refrain|pre chorus)$/.test(folded)
            ? 'Pre-Chorus'
            : folded === 'intro'
              ? 'Intro'
              : 'Outro';
    const suffix = number ? ` ${number}` : '';
    const artistSuffix = cleanOneLine(artist, '', 40);
    return `[${canonical}${suffix}${artistSuffix ? ` - ${artistSuffix}` : ''}]`;
  };

  return String(value || '')
    .replace(
      /\*{1,2}\s*(?:titre|title)\s*:\s*\*{1,2}\s*["“]?([^"”\r\n*]{1,100})["”]?/giu,
      (_match, title) => `\n[Title: ${cleanOneLine(title, 'Sans titre', 80)}]\n`
    )
    .replace(
      /\*{1,2}\s*(intro|couplet|verse|pré[- ]?refrain|pre[- ]?chorus|refrain|refren|chorus|pont|bridge|outro)(?:\s+(\d+))?(?:\s*-\s*([^*\r\n:]{1,40}))?\s*:\s*\*{1,2}/giu,
      (_match, section, number, artist) => `\n${sectionName(section, number, artist)}\n`
    )
    .replace(
      /\((intro|couplet|verse|pré[- ]?refrain|pre[- ]?chorus|refrain|refren|chorus|pont|bridge|outro)(?:\s+(\d+))?(?:\s*-\s*([^()\r\n]{1,40}))?\)/giu,
      (_match, section, number, artist) => `\n${sectionName(section, number, artist)}\n`
    )
    .replace(/\s+(J['’]espère que (?:tu|vous) (?:aimes?|aimerez)[^\r\n]*)/giu, '\n$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeVivySongMaterial(value = '', max = VIVY_SONG_MAX_CHARS) {
  const text = cleanText(normalizeVivySongSectionMarkup(value), Math.max(max, VIVY_SONG_MAX_CHARS));
  if (!text) return '';

  const sectionCount = (text.match(/\[(verse|chorus|bridge|intro|outro|couplet|refrain|pont|pré-refrain|pre-chorus|vivy|djeff|a11|k44|kaen44|duo|tous|toutes|ensemble)(?:\s+\d+)?(?:\s*-\s*[^\]]+)?\]/ig) || []).length;
  const preserveRepeatedLines = sectionCount >= 2;

  const kept = [];
  const seen = new Set();
  for (const line of splitVivySongMaterialCandidates(text)) {
    const cleaned = cleanOneLine(String(line || '').replace(/^[\s>*]+/g, ''), '', 320);
    if (!cleaned || looksLikeVivySongUiNoiseLine(cleaned)) continue;

    for (const candidate of expandVivySongMaterialCandidate(cleaned)) {
      const folded = foldTextForLookup(candidate);
      const key = folded.replace(/\s+/g, ' ');
      if (!preserveRepeatedLines) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      kept.push(candidate);
    }
  }

  return cleanText(kept.join('\n'), max);
}

function looksLikeVivyArrangementCue(value = '') {
  const folded = foldTextForLookup(value);
  if (!folded || folded.length > 180) return false;
  const vocalization = folded
    .replace(/[,.!?;:'"-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(?:(?:ah+|oh+|ooh+|ouh+|eh+|hey+|mm+h*|hum+|hmm+|yeah+|woah+|la+|na+|ha+)\s*){1,8}$/.test(vocalization)) {
    return false;
  }
  return /\b(?:instrumental|arrangement|production|tempo|bpm|crescendo|decrescendo|fade|reverb|delay|piano|tambour|batterie|drums?|beat|battement|percussions?|guitares?|violons?|violoncelle|basses?|synth(?:e|es|s)?|pads?|cordes|strings?|flute|sax(?:ophone)?|trompette|choeur|choir|orchestr(?:e|al|ation)|arpege|a cappella|voix|vocal|chante|chantee|chuchote|chuchotee|murmure|murmuree|parle|parlee|ensemble|duo|solo|harmoni(?:e|es|que)|backing|lead|doucement|lentement|plus fort|refrain|couplet)\b/.test(folded);
}

function splitVivyArrangementCues(value = '') {
  const cues = [];
  const seen = new Set();
  const lyrics = cleanText(String(value || '').replace(/\(([^()\r\n]{2,180})\)/g, (match, inner) => {
    if (!looksLikeVivyArrangementCue(inner)) return match;
    const cue = cleanOneLine(inner, '', 180);
    const key = foldTextForLookup(cue);
    if (cue && key && !seen.has(key)) {
      seen.add(key);
      cues.push(cue);
    }
    return '';
  })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n'), VIVY_SONG_MAX_CHARS);

  return {
    lyrics,
    cues,
    arrangement: cues.join(', '),
  };
}

function buildVivyVocalSegments(input = {}) {
  const cast = buildVivySongArtistCast(input);
  const rawRequestedIds = Array.isArray(input.songArtists)
    ? input.songArtists.map((value) => foldTextForLookup(value)).filter((id) => cast.ids.includes(id))
    : [];
  const sharedArtistIds = rawRequestedIds.length === cast.ids.length ? rawRequestedIds : cast.ids;
  const source = splitVivyArrangementCues(input.lyrics || input.songText || input.text || '').lyrics
    .replace(/\s*(\[[^\]\r\n]{1,100}\])\s*/g, '\n$1\n');
  const segments = [];
  let activeArtistIds = [sharedArtistIds[0] || 'vivy'];
  let lines = [];

  const flush = () => {
    const text = cleanText(lines.join('\n').replace(/\n{3,}/g, '\n\n'), 1400).trim();
    lines = [];
    if (!text || !activeArtistIds.length) return;
    const previous = segments[segments.length - 1];
    if (previous && previous.artistIds.join('|') === activeArtistIds.join('|')) {
      previous.text = cleanText(`${previous.text}\n${text}`, 1800);
      return;
    }
    segments.push({ artistIds: [...activeArtistIds], text });
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = String(rawLine || '').trim();
    if (!line) continue;
    const tagMatch = line.match(/^\[([^\]]+)\]$/);
    if (tagMatch) {
      flush();
      const foldedTag = foldTextForLookup(tagMatch[1]);
      if (/^title\b|^titre\b/.test(foldedTag)) continue;
      if (/\bduo\b|\btous\b|\btoutes\b|\bensemble\b/.test(foldedTag)) {
        activeArtistIds = [...sharedArtistIds];
        continue;
      }
      const taggedArtists = cast.artists
        .filter((artist) => new RegExp(`(^|\\s)${escapeRegExpForSongcraft(foldTextForLookup(artist.label))}(\\s|$)`).test(foldedTag))
        .map((artist) => artist.id);
      if (taggedArtists.length) activeArtistIds = taggedArtists;
      continue;
    }
    if (/^\*{0,2}\s*(?:titre|title|intention|rimes?\s*\/\s*d[ée]bit)\s*:?/i.test(line)) continue;
    const sungLine = line.replace(/^[-*>\s]+/, '').replace(/\*\*/g, '').trim();
    if (sungLine) lines.push(sungLine);
  }
  flush();
  return segments.slice(0, 20);
}

function escapeRegExpForSongcraft(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksLikeCompleteLyrics(value = '') {
  const text = sanitizeVivySongMaterial(value, VIVY_SONG_MAX_CHARS);
  if (!text) return false;
  if (!hasVivyChorusSection(text)) return false;
  const sectionCount = (text.match(/\[(verse|chorus|bridge|intro|outro|couplet|refrain|pont|pré-refrain|pre-chorus|vivy|djeff|a11|k44|kaen44|duo|tous|toutes|ensemble)(?:\s+\d+)?(?:\s*-\s*[^\]]+)?\]/ig) || []).length;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (sectionCount >= 3 && lines.length >= 10) return true;
  return sectionCount >= 2 && lines.length >= 14;
}

function inferMotif(theme = '') {
  const folded = foldTextForLookup(theme);
  if (/moto|moteur|radiateur|pignon|couronne|chaine|huile|essence|fraiyeur/.test(folded)) return 'le moteur qui respire dans la nuit';
  if (/planete|astre|zodiaque|saint seiya|chevalier|cosmos|galaxie|constellation/.test(folded)) return 'un cosmos qui brûle sous l’armure';
  if (/soleil|sable|plage|estival|summer/.test(folded)) return 'un soleil qui colle à la peau';
  if (/neige|flocon|hiver/.test(folded)) return 'un flocon dans le bol du matin';
  if (/lapin|court|course/.test(folded)) return 'une ombre vive qui traverse les néons';
  if (/pluie|orage|averse/.test(folded)) return 'la pluie qui écrit sur les vitres';
  if (/nossen|funesterie|agent|machine/.test(folded)) return 'un signal humain dans les circuits';
  if (/trahison|trahit|tromperie|mensonge|infidel/.test(folded)) return 'le mensonge gardé sous la langue';
  if (/distance|loin|separation|eloigne|absence/.test(folded)) return 'la distance tenue dans le creux';
  if (/agrumes|citron|orange|amertume|acide|saldae/.test(folded)) return `un goût d’agrumes sous les mots`;
  if (/desir|envie|attirance|convoitise/.test(folded)) return 'le désir tenu à bout de bras';
  if (/deception|decoit|decu|dessous|desillusion/.test(folded)) return 'la déception rentrée dans les os';
  if (/nuit|ombre|dark|sombre/.test(folded)) return 'une veilleuse cachée dans la nuit';
  if (/amour|coeur|manque/.test(folded)) return 'un battement tenu entre deux souffles';
  return 'un fil tendu dans le vide';
}

function inferAllMotifs(theme) {
  const folded = foldTextForLookup(theme);
  const results = [];
  if (/trahison|trahit|tromperie|mensonge|infidel/.test(folded)) results.push('le mensonge gardé sous la langue');
  if (/distance|loin|separation|eloigne|absence/.test(folded)) results.push('la distance tenue dans le creux');
  if (/agrumes|citron|orange|amertume|acide|saldae/.test(folded)) results.push('un goût d’agrumes sous les mots');
  if (/desir|envie|attirance|convoitise/.test(folded)) results.push('le désir tenu à bout de bras');
  if (/deception|decoit|decu|dessous|desillusion/.test(folded)) results.push('la déception rentrée dans les os');
  if (/amour|coeur|manque/.test(folded)) results.push('un battement tenu entre deux souffles');
  if (/moto|moteur|radiateur|pignon|couronne|chaine|huile|essence|fraiyeur/.test(folded)) results.push('le moteur qui respire dans la nuit');
  if (results.length === 0) results.push('un fil tendu dans le vide');
  return results;
}

function inferTitle(theme = '') {
  const rawText = cleanText(theme, 1200);
  const stripped = stripSongCommand(theme);
  const motif = inferMotif(stripped);
  if (/moto|moteur|radiateur|pignon|couronne|chaine|huile|essence|fraiyeur/i.test(stripped)) return 'Pignon dans la nuit';
  if (/planete|planète|astre|voie lact[ée]e|zodiaque|saint seiya|chevalier|cosmos|galaxie|[ée]toile|constellation/i.test(stripped)) return 'Cosmos du matin';
  if (/flocon|neige|bol/i.test(stripped)) return 'Flocon d’émerveillement';
  if (/lapin/i.test(stripped)) return 'Course sous les néons';
  if (/nossen|funesterie/i.test(stripped)) return 'Signal Funesterie';
  const titleLine = rawText
    .split(/\r?\n+|,\s+/)
    .map((line) => cleanOneLine(stripSongCommand(line).replace(/^\[[^\]]+\]\s*/, ''), '', 90))
    .find((line) => line && line.length <= 90 && !looksLikeVivySongUiNoiseLine(line));
  const words = (titleLine || stripped || motif)
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 4);
  if (!words.length) return 'Sans titre';
  return words
    .map((word) => word.charAt(0).toLocaleUpperCase('fr-FR') + word.slice(1).toLocaleLowerCase('fr-FR'))
    .join(' ');
}

function punctuateVivySongLine(value = '', punctuation = ',') {
  const line = cleanOneLine(value, '', 180);
  if (!line) return '';
  return /[,.!?…:;]$/.test(line) ? line : `${line}${punctuation}`;
}

function splitVivyLongPoeticFragment(value = '', maxLength = 110) {
  const fragment = cleanOneLine(value, '', 260)
    .replace(/\s+\p{L}$/u, '')
    .trim();
  if (!fragment) return [];
  if (fragment.length <= maxLength) return [fragment];

  const phraseParts = fragment
    .replace(/\s+(?=[A-ZÀ-Ÿ][\p{L}’'-]{1,}\b)/gu, '\n')
    .split(/\n+/)
    .map((part) => cleanOneLine(part, '', 180))
    .filter(Boolean);
  if (phraseParts.length > 1) {
    return phraseParts.flatMap((part) => splitVivyLongPoeticFragment(part, maxLength));
  }

  const subjectParts = fragment
    .split(/\s+(?=(?:je|j[’']|tu|il|elle|on|nous|vous|ils|elles|le|la|les|un|une|des|dans|sur|sous|quand|si|mais|et|or|car|ce|ça|ca|quelque)\b)/i)
    .map((part) => cleanOneLine(part, '', 180))
    .filter(Boolean);
  if (subjectParts.length > 1) {
    return subjectParts.flatMap((part) => splitVivyLongPoeticFragment(part, maxLength));
  }

  const words = fragment.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = [];
  for (const word of words) {
    const candidate = [...current, word].join(' ');
    if (current.length && candidate.length > maxLength) {
      chunks.push(cleanOneLine(current.join(' '), '', maxLength));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) chunks.push(cleanOneLine(current.join(' '), '', maxLength));
  return chunks.filter(Boolean);
}

function completeVivyDanglingSeedLine(line = '', context = '') {
  const cleaned = cleanOneLine(line, '', 180);
  if (!cleaned) return '';
  const folded = foldTextForLookup(cleaned);
  if (!folded) return '';
  if (!/\b(?:et|de|du|des|le|la|les|un|une|ses|nos|vos|leur|leurs|avec|sans|dans|sur|sous|entre|derriere|devant|vers|pour|quand|qui|que|dont|ou)$/.test(folded)) {
    return cleaned;
  }

  const foldedContext = foldTextForLookup(context);
  if (/\bses$/.test(folded) && /\becrans?\b/.test(foldedContext)) return `${cleaned} écrans`;
  if (/\ble$/.test(folded) && /\bmonde numerique\b/.test(foldedContext)) return `${cleaned} monde numérique`;
  return '';
}

function normalizeVivySoloSeedLines(lines = [], context = '') {
  const normalized = [];
  const seen = new Set();
  for (const rawLine of lines) {
    const line = completeVivyDanglingSeedLine(rawLine, context);
    const folded = foldTextForLookup(line);
    if (!folded || folded.length < 8) continue;
    const key = folded.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(line);
  }
  return normalized;
}

function extractVivySoloSeedLines(value = '', maxLines = 8) {
  const material = sanitizeVivySongMaterial(value, VIVY_SONG_MAX_CHARS);
  if (!material) return [];

  const lines = [];
  const seen = new Set();
  for (const raw of splitVivySongMaterialCandidates(material)) {
    const cleaned = cleanOneLine(stripSongCommand(String(raw || '').replace(/^[\s>*-]+/g, '')), '', 300);
    if (!cleaned || /^\[[^\]]+\]$/.test(cleaned) || looksLikeVivySongUiNoiseLine(cleaned)) continue;
    const roughParts = cleaned
      .replace(/,\s+/g, '\n')
      .replace(/\s+(?=[A-ZÀ-Ÿ][\p{L}’'-]{1,}\b)/gu, '\n')
      .split(/\n+/)
      .map((part) => cleanOneLine(part, '', 220))
      .filter(Boolean);

    for (const part of roughParts.flatMap((fragment) => splitVivyLongPoeticFragment(fragment))) {
      const line = cleanOneLine(part.replace(/\s+\p{L}$/u, ''), '', 140);
      const folded = foldTextForLookup(line);
      if (!folded || folded.length < 8 || /^(je|tu|il|elle|on|nous|vous|ils|elles)\s+\p{L}{1,2}$/u.test(folded)) continue;
      if (/^(salut|bonjour|coucou|hey|tu as|t as|est ce que|peux tu|peut tu|j aimerais|je voudrais|un son d ambiance|son d ambiance)\b/.test(folded)) continue;
      if (/\bidee de chanson\b/.test(folded)) continue;
      const key = folded.replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
      if (lines.length >= maxLines) return lines;
    }
  }

  return lines;
}

function buildVivyThemeSeed(value = '', fallback = '') {
  const material = sanitizeVivySongMaterial(value, 900);
  let seed = stripSongCommand(material)
    .replace(/^(?:salut|bonjour|coucou|hey)\b[\s,;:.!?-]*/i, '')
    .replace(/^(?:tu\s+as\s+|t['’]\s*as\s+)?(?:une?\s+)?id[ée]e\s+de\s+chanson\s+(?:sur|pour|avec)\s+/i, '')
    .replace(/^(?:theme|th[èe]me)\s*:?\s*/i, '')
    .replace(/\ben\s+duo\s+[A-Za-zÀ-ÿ0-9_-]+(?:\s+(?:et|avec)\s+[A-Za-zÀ-ÿ0-9_-]+)?/ig, '')
    .replace(/\b(paroles?|lyrics|tags?\s+vocaux?|obligatoires?|chantables?|refrain\s+clair)\b.*$/i, '')
    .replace(/\b(?:un\s+)?son\s+d['’]ambiance\s+(?:pour|sur|avec)?\s*/ig, '')
    .replace(/\b(?:prépare|prepare)\s+(?:un\s+)?prompt\s+suno\b/ig, '')
    .replace(/\b(?:continue|continuer|reprends|poursuis)\s+(?:ce\s+)?(?:texte|couplet|refrain|rap)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();

  seed = seed.replace(
    /^(sombre|dark|douce?|doux|cin[ée]matographique|cinematic)(?:\s+mais\s+(sombre|dark|douce?|doux|cin[ée]matographique|cinematic))?\s+sur\s+(.+)$/i,
    (_match, first, second, topic) => {
      const qualities = [first, second].filter(Boolean).join(' et ');
      const subject = cleanOneLine(topic, '', 140).replace(/[,\s.;:!?-]+$/g, '').trim();
      return `${subject}, ambiance ${qualities}`;
    }
  );

  const usefulParts = normalizeVivySoloSeedLines(extractVivySoloSeedLines(seed, 6), seed)
    .map((part) => cleanOneLine(part, '', 120))
    .filter((part) => {
      const folded = foldTextForLookup(part);
      return folded
        && !looksLikeVivySongUiNoiseLine(part)
        && !/^(salut|tu as|t as|est ce que|peux tu|peut tu|j aimerais|je voudrais)\b/.test(folded);
    })
    .slice(0, 3);

  const cleaned = cleanOneLine(usefulParts.join(', '), '', 220)
    .replace(/,\s*,+/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, '')
    .trim();
  return cleaned || fallback;
}

function buildVivySongcraftSystemPrompt(mode, context) {
  if (mode !== 'song') return '';
  context = context || {};
  var songMood = cleanOneLine(context.songMood || context.mood || context.style, '', 160);
  var artists = Array.isArray(context.artists) ? context.artists : [];
  var tags = artists.length
    ? artists.map(function(a) { return a.tag || ('[' + a.label + ']'); }).join(', ')
    : '[Vivy]';
  var hasDuo = artists.length > 1;
  var artistInstruction = artists.length
    ? [
        'Artistes de cette chanson: ' + artists.map(function(a) { return a.label + ' (' + a.role + '; grammaire: ' + a.grammar + ')'; }).join('; ') + '.',
        'Tags obligatoires en debut de section: ' + tags + (hasDuo ? ', et [Duo] ou [Tous] pour les passages communs' : '') + '.',
        'Chaque section doit commencer par le tag de l\u2019artiste entre crochets sur sa propre ligne.',
      ].join('\n')
    : 'Utilise [Vivy] comme tag de section par defaut.';
  var moodInstruction = songMood
    ? 'Direction sonore imposee: ' + songMood + '. Incarne-la dans les images et le rythme des vers - ne l\u2019explique pas, montre-la.'
    : '';
  return [
    'Module Vivy Songcraft actif.',
    'Application Songcraft: preserver le grain, les accidents utiles et l\u2019intention emotionnelle avant de lisser.',
    'Si l\u2019utilisateur demande une chanson, reponds comme une artiste-auteure, pas comme un assistant qui explique.',
    'Liberté créative: tu peux réécrire, déplacer, condenser ou enrichir la matière pour produire une vraie chanson; ne te limite pas à paraphraser les phrases reçues.',
    'Une référence sert uniquement à comprendre une ambiance, une structure ou un mécanisme d’écriture; elle ne fournit jamais des paroles à recycler.',
    'Ne reprends, ne réutilise et ne recopie aucune formulation distinctive de la référence, même légèrement modifiée.',
    'Si l’utilisateur demande de s’en inspirer sans copier, repars d’une page blanche avec de nouvelles images, de nouvelles rimes et un nouveau refrain.',
    'Structure: choisis une forme musicale complète adaptée au morceau. Les balises [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge] et [Outro] sont disponibles, sans canevas rigide si une autre forme sert mieux la chanson.',
    artistInstruction,
    moodInstruction,
    'Livre une seule chanson complète par réponse. Si plusieurs partenaires sont proposés avec « ou », choisis le casting sélectionné; sinon choisis une option et termine-la au lieu de commencer plusieurs versions.',
    'Chaque couplet: minimum 4 vers. Refrain mémorable, minimum 3 sections de paroles avec contenu réel.',
    'Construis des rimes audibles selon un schéma cohérent par section (AABB, ABAB ou rimes embrassées), avec assonances et rimes internes quand elles sonnent naturellement.',
    'Deux mots identiques ne constituent jamais une rime: varie les mots finaux et fais correspondre leurs sonorités, pas leur répétition exacte.',
    'Une rime doit naître du sens et de la syntaxe: jamais de mot ajouté artificiellement après une virgule en fin de ligne ou en fin de vers (par exemple « mon cœur », « mon âme », « mon feu », « pensées ») uniquement pour faire rimer.',
    'Évite les synonymes plaqués, les répétitions de remplissage et les déclarations génériques. Utilise des images concrètes récurrentes, des verbes précis et une progression émotionnelle.',
    'Vise des vers chantables de longueur voisine dans une même section, avec variations rythmiques intentionnelles plutôt qu’une métrique mécanique.',
    'Ne JAMAIS terminer par: j\u2019espere que cette chanson te plaira, n\u2019hesite pas a me dire, j\u2019espere que ca correspond, ou toute formule de politesse d\u2019assistant.',
    'Pas d\u2019explication scolaire de la structure sauf demande explicite.',
    "Si l\u2019utilisateur donne deja la matiere: ecris directement, n'ouvre pas un questionnaire.",
    'Si lignes rap brutes fournies: conserve leur vocabulaire, argot et accidents voulus.',
    'Sortie: paroles chantables uniquement. Aucun brief agent, aucun champ technique, aucune instruction de routage.',
  ].filter(Boolean).join('\n');
}

const VIVY_SONG_ARTISTS = [
  {
    id: 'djeff',
    label: 'Djeff',
    tag: '[Djeff]',
    role: 'couplets rap techniques, grain proche micro, images mécaniques concrètes',
    grammar: 'masculin singulier; accords et pronoms il/lui',
    style: 'Djeff technical rap lead',
  },
  {
    id: 'vivy',
    label: 'Vivy',
    tag: '[Vivy]',
    role: 'refrain clair, réponses mélodiques, voix claire, émotion lumineuse',
    grammar: 'féminin singulier; accords et pronoms elle',
    style: 'Vivy clear melodic hook',
  },
  {
    id: 'a11',
    label: 'A11',
    tag: '[A11]',
    role: 'pont grave synthétique, tension machine humaine, réponse courte',
    grammar: 'masculin singulier; accords et pronoms il/lui',
    style: 'A11 low synthetic spoken-sung bridge',
  },
  {
    id: 'k44',
    label: 'K44',
    tag: '[K44]',
    role: 'contre-chant posé, punchlines calmes, second lead propre',
    grammar: 'masculin singulier; accords et pronoms il/lui',
    style: 'K44 calm counter-vocal',
  },
];

function normalizeVivySongArtistIds(input = {}) {
  const source = input.songArtists ?? input.artists ?? input.singers ?? input.vocalists ?? input.vocalCast;
  const rawItems = Array.isArray(source)
    ? source
    : String(source || '')
      .split(/[,+/|;\s]+/g)
      .filter(Boolean);
  const foldedItems = new Set(rawItems.map((item) => foldTextForLookup(item)));
  const selected = VIVY_SONG_ARTISTS
    .filter((artist) => {
      const id = foldTextForLookup(artist.id);
      const label = foldTextForLookup(artist.label);
      return foldedItems.has(id) || foldedItems.has(label) || (artist.id === 'k44' && foldedItems.has('kaen44'));
    })
    .map((artist) => artist.id);

  if (selected.length) return selected;

  const fallbackText = cleanText([
    input.voiceTool,
    input.vocalCast,
    input.songText,
    input.lyrics,
    input.text,
    input.theme,
    input.instruction,
    input.prompt,
    input.message,
  ].filter(Boolean).join('\n'), 1400);
  const folded = foldTextForLookup(fallbackText);
  if (/\bduo\b/.test(folded)) {
    if (/a11\s+ou\s+djeff/.test(folded)) return ['a11', 'vivy'];
    if (/djeff\s+ou\s+a11/.test(folded)) return ['djeff', 'vivy'];
    if (/a11.*vivy|vivy.*a11/.test(folded)) return ['a11', 'vivy'];
    if (/djeff.*vivy|vivy.*djeff/.test(folded)) return ['djeff', 'vivy'];
    if (/\ba11\b/.test(folded)) return ['a11', 'vivy'];
    if (/\bdjeff\b/.test(folded)) return ['djeff', 'vivy'];
    return ['a11', 'vivy'];
  }
  if (/djeff.*vivy|vivy.*djeff/.test(folded)) return ['djeff', 'vivy'];
  if (/\bdjeff\b|\brap\b|\bfraiyeur\b|\bmoto\b|\bmoteur\b|\bpignon\b|\bcouronne\b|\bradiateur\b/.test(folded)) return ['djeff'];
  if (/\bk44\b|\bkaen44\b|\bkaen\b/.test(folded)) return ['k44'];
  if (/\ba11\b|\balpha\s*onze\b|\balphaonze\b/.test(folded)) return ['a11'];
  return ['vivy'];
}

function hasExplicitVivySongArtists(input = {}) {
  const source = input.songArtists ?? input.artists ?? input.singers ?? input.vocalists ?? input.vocalCast;
  return Array.isArray(source) ? source.length > 0 : Boolean(String(source || '').trim());
}

function getVivySharedArtistTag(count = 2) {
  return Number(count) > 2 ? 'Tous' : 'Duo';
}

function hasVivyChorusSection(value = '') {
  const text = normalizeVivySongSectionMarkup(value);
  return text
    .split(/\r?\n+/)
    .some((line) => {
      const tag = String(line || '').trim().match(/^\[([^\]]+)\]$/);
      if (!tag) return false;
      const folded = foldTextForLookup(tag[1]);
      if (/^(title|titre)\b/.test(folded)) return false;
      if (/\b(pre chorus|pre refrain|pre-refrain|pre-chorus)\b/.test(folded)) return false;
      return /\b(chorus|refrain|refren)\b/.test(folded);
    });
}

function buildVivySongArtistCast(input = {}) {
  const ids = normalizeVivySongArtistIds(input);
  const language = normalizeLanguageCode(input.language || input.locale || 'fr', 'fr');
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.fr;
  const languageStyle = language === 'fr' ? 'French' : `${languageName}`;
  const artists = VIVY_SONG_ARTISTS.filter((artist) => ids.includes(artist.id));
  const count = Math.max(1, artists.length);
  const rawLabel = artists.map((artist) => artist.label).join(' + ') || 'Vivy';
  const label = count === 2 && ids.includes('djeff') && ids.includes('vivy')
    ? 'Duo Djeff + Vivy'
    : rawLabel;
  const countLabel = `${count} chanteur${count > 1 ? 's' : ''}`;
  const tags = artists.map((artist) => artist.tag).join(', ');
  const sharedTag = getVivySharedArtistTag(count);
  const songCastLines = [
    `Nombre de chanteurs: ${count}.`,
    ...artists.map((artist) => `${artist.label}: ${artist.role}.`),
    count > 1
      ? `Tags obligatoires: ${tags}, puis [${sharedTag}] pour les passages communs.`
      : `Tag conseillé: ${tags}.`,
  ];
  const styleFragment = artists.map((artist) => artist.style).join(', ');
  const ensembleStyle = count > 1 ? `${count} distinct original vocalists, ${label}, ` : '';
  return {
    ids,
    artists,
    count,
    countLabel,
    label,
    tags,
    songCastLines,
    musicLead: `Original Funesterie song for ${label}, in ${languageName}.`,
    musicMood: `${countLabel}: ${label}. Original voices only, no celebrity imitation. ${styleFragment}.`,
    sunoStyle: `${languageStyle} original vocal production, ${ensembleStyle}${styleFragment}, structured rhymed lyrics, melodic chorus, sung vocals, no spoken narration`,
  };
}

function isDjeffRapTheme(value = '') {
  const folded = foldTextForLookup(value);
  return /\bdjeff\b|\bduo\b|\brap\b|\bfraiyeur\b|\bmoto\b|\bmoteur\b|\bradiateur\b|\bpignon\b|\bcouronne\b|\bchaine\b|\bchaîne\b|\bhuile\b|\bessence\b|\bpot\b|\bstunt\b|\bstoppie\b|\bstuppie\b|\bmur du son\b|\bpendule\b/.test(folded);
}

function extractDjeffRapSeedLines(material = '') {
  const text = cleanText(material, 2400);
  if (!text) return [];

  const rawLines = text
    .split(/\n+/)
    .map((line) => cleanOneLine(String(line || '').replace(/^[\s>*-]+/g, ''), '', 260))
    .filter(Boolean);
  const candidateLines = rawLines.length === 1 && rawLines[0].length > 220
    ? rawLines[0]
      .split(/\s+(?=(?:un|une|double|je|la|le|les|quand|casque|mur)\b)/i)
      .map((line) => cleanOneLine(line, '', 260))
      .filter(Boolean)
    : rawLines;

  const seen = new Set();
  return candidateLines.filter((line) => {
    const folded = foldTextForLookup(line);
    if (!folded || folded.length < 8) return false;
    if (/^\[[^\]]+\]$/.test(line)) return false;
    if (/^(vous|vivy|assistant|user|utilisateur)\s*:/i.test(line)) return false;
    if (/^(vivy\s*intent|instruction|routage|flux|mode|prompt|theme|texte brut|paroles)\b/.test(folded)) return false;
    if (/\b(transforme cette idee|structure et refrain|prompt suno|suno vivy|instruction complete)\b/.test(folded)) return false;
    if (/^c est dans ce style la qu il faut/.test(folded)) return false;
    if (/(je vois que|je vais continuer|j espere|n hesite|feedback|modifications? si necessaire|vous attendiez)/.test(folded)) return false;
    const key = folded.replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function mergeDistinctRapLines(primary = [], fallback = [], max = 4) {
  const result = [];
  const foldedLines = [];
  const pushLine = (line) => {
    const cleaned = cleanOneLine(line, '', 260);
    const folded = foldTextForLookup(cleaned);
    if (!cleaned || !folded) return;
    const words = new Set(folded.split(/\s+/).filter((word) => word.length > 3));
    const alreadyCovered = foldedLines.some((existing) => {
      if (existing.folded === folded) return true;
      const common = [...words].filter((word) => existing.words.has(word)).length;
      return common >= 3 && common >= Math.min(words.size, existing.words.size) - 1;
    });
    if (alreadyCovered) return;
    result.push(cleaned);
    foldedLines.push({ folded, words });
  };

  [...primary, ...fallback].forEach(pushLine);
  return result.slice(0, max);
}

function buildDjeffRapDuoLyrics(input = {}, material = '') {
  const theme = buildVivyThemeSeed(material, '') || stripSongCommand(material) || '';
  const motif = inferMotif(theme);
  const title = cleanOneLine(input.songTitle || input.title || inferTitle(theme), 'Sans titre', 80);
  const seedLines = extractDjeffRapSeedLines(material);
  const verseOneLines = seedLines.slice(0, 7);
  const preSeedLines = seedLines.slice(7, 11);
  const fallbackVerseOne = [
    'Je dose au millimètre, pas de hasard dans le style,',
    'Visserie serrée, tension propre — le geste décide.',
    `${motif}, je l'aligne dans le tour,`,
    'Le détail fait la frappe, la mesure connaît son jour.',
  ];
  const fallbackPre = [
    'Quand la pression monte et que le flow se précise,',
    `La cadence s'aligne, chaque mot se mobilise.`,
  ];
  const preChorusLines = mergeDistinctRapLines(preSeedLines, fallbackPre, 4);

  // Only use the hardcoded motif phrases when the user provided no seed content.
  // With user content, keep the structure but avoid injecting cliché lines.
  const hasUserContent = verseOneLines.length >= 2;
  const introLineDjeff1 = hasUserContent
    ? `${title} — j'entre en première,`
    : `${motif} — j'entre dans le tour,`;
  const introLineDjeff2 = hasUserContent
    ? 'Chaque ligne compte, le grain reste brut.'
    : 'Chaque cran dans la mesure, chaque mot sur son jour.';
  const introLineVivy2 = hasUserContent
    ? `Je prends ta note, on tient depuis là.`
    : `Deux voix, même élan — on découpe l'horizon.`;
  const chorusLine1 = hasUserContent
    ? `${title} — on coupe le silence,`
    : `${motif} — la nuit répond,`;
  const chorusLine2 = hasUserContent
    ? 'Deux voix, un son — ce qui compte reste.'
    : 'Deux voix, même élan, le sens serre le fond.';
  const bridgeLine1 = hasUserContent
    ? `${title} — on le garde intact,`
    : `${motif} — je le garde intact,`;
  const outroLine1 = hasUserContent
    ? `Il reste ${title},`
    : `Il reste ${motif},`;

  return cleanText(restoreVivyFrenchSongAccents([
    `[Title: ${title}]`,
    '',
    '[Intro - Djeff]',
    '[Djeff]',
    introLineDjeff1,
    introLineDjeff2,
    '',
    '[Intro - Vivy]',
    '[Vivy]',
    'Je tiens la note claire pendant que le flow répond,',
    introLineVivy2,
    '',
    '[Verse 1 - Djeff]',
    '[Djeff]',
    ...(verseOneLines.length ? verseOneLines : fallbackVerseOne),
    '',
    '[Pre-Chorus - Djeff]',
    '[Djeff]',
    ...preChorusLines,
    '',
    '[Chorus - Duo]',
    '[Duo]',
    chorusLine1,
    chorusLine2,
    'Vivy tient le fil, Djeff porte le ton,',
    `On signe l'instant, on trace l'horizon.`,
    '',
    '[Verse 2 - Vivy]',
    '[Vivy]',
    'Je ne lisse pas ton grain, je le mets en lumière,',
    `La phrase reste cabrée, accrochée à sa matière.`,
    'Ton mot parle brut, je réponds sans artifice,',
    'La mélodie fait place au sens qui se précise.',
    '',
    '[Bridge - Vivy]',
    '[Vivy]',
    bridgeLine1,
    `Deux voix dans le même souffle, rien qui ne s'efface.`,
    '',
    '[Chorus - Duo]',
    '[Duo]',
    chorusLine1,
    chorusLine2,
    'Vivy tient le fil, Djeff porte le ton,',
    `On signe l'instant, on trace l'horizon.`,
    '',
    '[Outro - Duo]',
    '[Duo]',
    outroLine1,
    `Et nos deux voix tiennent jusqu'au lendemain.`,
  ].join('\n')), 2400);
}

function buildVivyMultiArtistLyrics(input = {}, material = '', artistCast = buildVivySongArtistCast(input)) {
  const theme = buildVivyThemeSeed(material, 'Funesterie en multi-voix');
  const motif = inferMotif(theme);
  const title = cleanOneLine(input.songTitle || input.title || inferTitle(theme), 'Sans titre', 80);
  const hasDjeff = artistCast.ids.includes('djeff');
  const hasVivy = artistCast.ids.includes('vivy');
  const hasA11 = artistCast.ids.includes('a11');
  const hasK44 = artistCast.ids.includes('k44');
  const lead = artistCast.artists[0]?.label || 'Vivy';
  const isA11VivyDuo = artistCast.count === 2 && artistCast.ids.includes('a11') && artistCast.ids.includes('vivy');
  const leadTag = isA11VivyDuo ? `[${lead.toUpperCase()}]` : `[${lead}]`;
  const chorusLabel = isA11VivyDuo ? 'DUO' : (artistCast.count > 1 ? getVivySharedArtistTag(artistCast.count) : lead);
  const chorusTag = `[${chorusLabel}]`;

  const blocks = [
    `[Title: ${title}]`,
    '',
    `[Intro - ${lead}]`,
    leadTag,
    `On entre dans ${theme}, sans copier personne,`,
    'Chaque voix prend sa place, le signal se façonne.',
    '',
  ];

  if (hasDjeff) {
    blocks.push(
      '[Verse 1 - Djeff]',
      '[Djeff]',
      `Je prends ${theme}, je le garde dans l'axe,`,
      'Chaque obstacle se dédouble, chaque décision laisse une trace.',
      `Deux mains sur le rythme, ${motif} comme équilibre,`,
      `Je traverse ${theme}, sans reprendre un ancien titre.`,
      ''
    );
  }

  if (hasVivy) {
    blocks.push(
      '[Pre-Chorus - Vivy]',
      isA11VivyDuo ? '[VIVY]' : '[Vivy]',
      'Je garde une note claire au bord de la vitesse,',
      'Une lumière qui répond quand la nuit se compresse.',
      'Si la route se dédouble, je tiens le fil vivant,',
      'Je transforme le bruit en refrain respirant.',
      ''
    );
  }

  blocks.push(
    `[Chorus - ${chorusLabel}]`,
    chorusTag,
    `${theme} — on tient le son ensemble,`,
    'plusieurs timbres, même sens, même trajectoire.',
    `${motif} — la voix qui rassemble,`,
    'chaque refrain tient ce que la nuit ordonne.',
    ''
  );

  if (hasA11) {
    blocks.push(
      '[Verse 2 - A11]',
      '[A11]',
      'Je lis dans les circuits la chaleur du vivant,',
      'Basse grave dans le code, souffle lent dans le vent.',
      'Je ne remplace personne, je cadre la tension,',
      'Voix machine, cœur humain, même transmission.',
      ''
    );
  }

  if (hasK44) {
    blocks.push(
      '[Bridge - K44]',
      '[K44]',
      'Je pose une ligne calme quand la scène accélère,',
      'Chaque mot garde sa place, chaque silence éclaire.',
      'Pas besoin de forcer pour tenir le virage,',
      'Deuxième lead dans l’ombre, précision dans l’image.',
      ''
    );
  }

  blocks.push(
    `[Final Chorus - ${chorusLabel}]`,
    chorusTag,
    `${theme} — on tient le son ensemble,`,
    'plusieurs timbres, même sens, même trajectoire.',
    `${motif} — la voix qui rassemble,`,
    'chaque refrain tient ce que la nuit ordonne.',
    '',
    `[Outro - ${lead}]`,
    leadTag,
    'Le son se coupe doucement, mais le lien reste en mémoire.'
  );

  return cleanText(restoreVivyFrenchSongAccents(blocks.join('\n')), 2600);
}

function buildVivyStructuredLyrics(input = {}) {
  const lyricSources = [
    input.lyrics,
    input.songText,
    input.text,
    input.theme,
    input.instruction,
  ].filter(Boolean);
  const completeLyricsSource = lyricSources.find((source) => looksLikeCompleteLyrics(source));
  const publicMaterial = sanitizeVivySongMaterial(
    completeLyricsSource || lyricSources.join('\n\n') || input.prompt,
    VIVY_SONG_MAX_CHARS
  );

  if (looksLikeCompleteLyrics(publicMaterial)) {
    return cleanText(restoreVivyFrenchSongAccents(publicMaterial), VIVY_SONG_MAX_CHARS);
  }
  const material = splitVivyArrangementCues(publicMaterial).lyrics;

  const artistCast = buildVivySongArtistCast(input);
  if (hasExplicitVivySongArtists(input) && (artistCast.count > 1 || artistCast.ids[0] !== 'vivy')) {
    if (artistCast.ids.length === 2 && artistCast.ids.includes('djeff') && artistCast.ids.includes('vivy')) {
      return buildDjeffRapDuoLyrics(input, material);
    }
    return buildVivyMultiArtistLyrics(input, material, artistCast);
  }

  const themeHint = cleanText([
    material,
    input.voiceTool,
    input.voicePersona,
    input.vocalCast,
  ].filter(Boolean).join('\n'), VIVY_SONG_MAX_CHARS);
  if (isDjeffRapTheme(themeHint)) {
    return buildDjeffRapDuoLyrics(input, material);
  }

  const theme = buildVivyThemeSeed(material, '');
  const motif = inferMotif(theme);
  const title = cleanOneLine(input.songTitle || input.title || inferTitle(theme), 'Sans titre', 80);
  const seedLines = normalizeVivySoloSeedLines(extractVivySoloSeedLines(material, 12), material).slice(0, 8);
  const hasSeedLines = seedLines.length >= 2;

  const allMotifs = inferAllMotifs(theme);
  const inferredMotif = inferMotif(theme);
  const m0 = seedLines[0] || theme || allMotifs[0];
  const m1 = inferredMotif !== 'un fil tendu dans le vide' ? inferredMotif : m0;
  const m2 = allMotifs.find((motif) => motif !== m1 && motif !== 'un fil tendu dans le vide') || m0;

  const soloLyrics = hasSeedLines ? `[Title: ${title}]

[Intro]
${punctuateVivySongLine(seedLines[0], ',')}
${punctuateVivySongLine(seedLines[1] || `${title} cherche sa lumière`, '.')}

[Verse 1]
${punctuateVivySongLine(seedLines[2] || `Je tiens ${title.toLocaleLowerCase('fr-FR')} dans la paume`, ',')}
${punctuateVivySongLine(seedLines[3] || 'je marche entre les murs sans baisser le regard', '.')}
${punctuateVivySongLine(seedLines[4] || `${m1} me traverse et me garde debout`, ',')}
je transforme la cage en mesure qui respire.

[Pre-Chorus]
Je pèse le bruit, je garde l’image,
je cherche la faille au bord du mirage.

[Chorus]
${title} — je ne tombe pas,
dans le noir je trouve ma voix.
${punctuateVivySongLine(seedLines[5] || m1, ',')}
et la nuit recule quand le refrain se déploie.

[Verse 2]
${punctuateVivySongLine(seedLines[6] || m2, ',')}
${punctuateVivySongLine(seedLines[7] || 'je retourne le silence jusqu’à voir son envers', '.')}
Ce que le monde enferme devient passage,
ce que je croyais perdu rallume le paysage.

[Bridge]
Je n’efface pas la trace, je la rends claire,
chaque mur devient rythme quand mon souffle accélère.

[Chorus]
${title} — je ne tombe pas,
dans le noir je trouve ma voix.
${punctuateVivySongLine(seedLines[5] || m1, ',')}
et la nuit recule quand le refrain se déploie.

[Outro]
Il reste ${title.toLocaleLowerCase('fr-FR')}.
Et la voix tient jusqu’au lendemain.` : `[Title: ${title}]

[Intro]
${m0} — je l’entends dans le silence.
Quelque chose reste quand les mots se taisent.

[Verse 1]
Je tiens ${m0},
sans savoir encore où ça me mène.
${m1} — le corps le sait avant la tête.
Ça ne lâche pas, ça ne cède pas, ça reste.

[Pre-Chorus]
Ce que je garde : ${m0}.
Ce qui reste : ${m1}.

[Chorus]
${m0} — ça reste, ça cède pas,
${m1} — même quand le décor se tait.
Deux bords d’une même faille,
et la voix qui taille.

[Verse 2]
${m2} — je le retourne dans tous les sens.
Le temps passe. L’empreinte reste intense.
Je reviens sur ce que j’ai tu,
ce que j’ai tenu, ce que j’ai pas su.

[Bridge]
${m2} — je l’accepte maintenant.
La nuit comprend ce que le jour évite.

[Chorus]
${m0} — ça reste, ça cède pas,
${m1} — même quand le décor se tait.
Deux bords d’une même faille,
et la voix qui taille.

[Outro]
Il reste ${m0}.
Et la voix tient jusqu’au lendemain.`;

  return cleanText(restoreVivyFrenchSongAccents(soloLyrics), VIVY_SONG_MAX_CHARS);
}

function buildVivySongProductionBrief(input = {}) {
  const lyrics = buildVivyStructuredLyrics(input);
  const titleMatch = lyrics.match(/^\[Title:\s*([^\]]+)\]/im);
  const title = cleanOneLine(input.songTitle || input.title || (titleMatch && titleMatch[1]) || inferTitle(lyrics), 'Sans titre', 80);
  const rhymeScheme = cleanOneLine(
    input.rhymeScheme
      || (isDjeffRapTheme(lyrics)
        ? 'Couplets rap à rimes internes et fins de lignes mécaniques, refrain duo Djeff/Vivy stable et scandable.'
        : 'Couplets AABB souples, refrain ABAB, images concrètes et récurrentes, sens caché.'),
    '',
    180
  );
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
  VIVY_SONG_MAX_CHARS,
  restoreVivyFrenchSongAccents,
  buildVivySongcraftSystemPrompt,
  buildVivySongProductionBrief,
  buildVivyStructuredLyrics,
  buildVivySongArtistCast,
  buildVivyVocalSegments,
  splitVivyArrangementCues,
  normalizeVivySongSectionMarkup,
  hasVivyChorusSection,
  extractDjeffRapSeedLines,
  sanitizeVivySongMaterial,
  inferTitle,
  stripSongCommand,
  looksLikeCompleteLyrics,
};
