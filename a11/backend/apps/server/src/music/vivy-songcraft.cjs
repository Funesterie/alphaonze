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
    .replace(/^(?:djeff|vivy|a11|k44|kaen44)\s+(?:sur|avec|pour|à propos de)\s+/i, '')
    .replace(/^(?:on\s+va|je\s+veux|j['’]\s*aimerais|j['’]\s+voudrais)\s+(?:faire|cr[ée]er|[ée]crire|composer)\s+(?:une?\s+)?(?:chanson|musique|son|g[ée]n[ée]rique|paroles|lyrics)\s*(?:sur|avec|pour|à propos de)?\s*/i, '')
    .replace(/\b(prompt|instruction|consigne)\b\s*:?\s*/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeVivySongTechnicalMediaNoiseLine(line = '') {
  const raw = String(line || '').trim();
  const folded = foldTextForLookup(raw);
  if (!folded) return false;
  if (/\.(?:jpe?g|png|webp|gif|bmp|svg|heic|avif)\b/i.test(raw)) return true;
  if (/https?:\/\/\S+/i.test(raw) || /\b(?:downloadurl|storagekey|contenttype|textpreview|visualdescription|analysissummary)\b/i.test(raw)) return true;
  if (/\b(?:ocr|analyse\s+a11|jpg|jpeg|png|webp|gif|maxresdefault|wallpaper|preview|filename|nom\s+de\s+fichier|fichier\s+image|metadata|metadonnees|métadonnées|lecture\s+locale|vision\s+avancee|vision\s+avancée|format\s+jpeg|format\s+png|image\s+recue|image\s+reçue|px|ko)\b/.test(folded)) return true;
  if (/\b[a-f0-9]{14,}\b/i.test(raw) || /\b\d{8,}\b/.test(raw)) return true;
  return false;
}

function looksLikeVivySongStyleOrStructureLine(line = '') {
  const raw = String(line || '').trim();
  const folded = foldTextForLookup(raw);
  if (!folded) return false;
  if (/^(?:style\s+sonore|direction\s+sonore|couleur\s+sonore|ambiance\s+sonore|mood|genre|style|instruction|consigne|structure|format\s+attendu|ecrire|écrire|ecris|écris)\b/.test(folded)) return true;
  if (/\b(?:vraie\s+chanson\s+complete|vraie\s+chanson\s+complète|ecrire.{0,50}chanson\s+complete|écrire.{0,50}chanson\s+complète|ecris.{0,50}chanson\s+complete|écris.{0,50}chanson\s+complète|intro.*couplet.*refrain|couplet.*refrain.*pont|ne\s+pas\s+recopier|ne\s+chante\s+pas|paroles\s+chantables)\b/.test(folded)) return true;
  const styleMatches = folded.match(/\b(?:epic|cinematic|cinematique|cinématique|dark|pop|rock|metal|electro|rap|anthem|motorbike|racing|powerful|female|male|vocal|voice|guitars?|guitares?|drums?|batterie|synths?|orchestr(?:e|al|ation)?|strings?|bpm|stadium|crowd|choir|reverb|bass|basse)\b/g) || [];
  return styleMatches.length >= 3 && (raw.includes(',') || /\b(?:vocal|bpm|drums?|guitars?|synths?|orchestr|anthem)\b/.test(folded));
}

function looksLikeVivySongUiNoiseLine(line = '') {
  const raw = String(line || '').trim();
  const folded = foldTextForLookup(raw);
  if (!folded) return true;

  // A standalone bracketed tag ([Vivy], [Djeff], [Verse 1], [Chorus - Duo]...) is a
  // section/voice marker, never UI noise. Keep it so complete songs are detected.
  if (/^\[[\p{L}\p{N} &,\/'’-]{1,40}\]$/u.test(raw)) return false;

  if (looksLikeVivySongTechnicalMediaNoiseLine(raw)) return true;
  if (looksLikeVivySongStyleOrStructureLine(raw)) return true;
  if (/^je suis vivy(?:\b|$)/.test(folded)) return true;
  if (/^parle moi d une (?:voix|chanson|ambiance|scene)\b/.test(folded)) return true;
  if (/^(vivy|vous|accueil|discussion|menu|voix|chanson|scene|scène|fichier|envoyer|copier|partager|defaut|défaut|audio perso|importer|ptt)$/.test(folded)) return true;
  if (/^(conversation vivy|conversation|historique vivy|recherche web|web search|web research|que dirais tu|que dirais tu d en faire un son|je mets quoi en couleur sonore|couleur sonore|paroles?)\b/.test(folded)) return true;
  if (/^(vous|copier|you might also like|testo di|ritornello|strofa)\b/.test(folded)) return true;
  if (/\b(je te donne un ex(?:e|a)?mple|quelqu un qui a fais une chanson|tu as juste traduis|c est pas ca que je voulais|il faut un theme principal|sous theme|en manque de flow|tu comprends|musique c est de l art|pas de des calculs)\b/.test(folded)) return true;
  if (/\b(io guido|io scopo|io mangio|io cago|figa|fighe|sborro|tette|cuscino|non pulisco|maschi bianchi|ammazzarmi|torna nel tuo paese)\b/.test(folded)) return true;
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
  if (/\b(vivy|nossen|bouton|codex|llm|suno|d40|prompt|compil|compile|compiler|compilateur|generation musique)\b/.test(folded)
    && /\b(bug|bugs|repete|repetes|perroquet|singeur|generique|marche pas|passent pas|passe pas|corrige|fix|logs|credit|credits|cle|cles|key|quota|sortie compilateur|user)\b/.test(folded)) return true;
  if (/\b(affichage telephone|telephone.*impossible|mobile.*impossible|dezoom|clavier|viewport|scroll|ca bouge|ecrire ca bouge|impossible d ecrire)\b/.test(folded)) return true;
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

function isVivyLyricSectionTagLine(value = '') {
  return /^\[(verse|chorus|bridge|intro|outro|couplet|refrain|pont|pré-refrain|pre-chorus|vivy|djeff|a11|k44|kaen44|duo|tous|toutes|ensemble)(?:\s+\d+)?(?:\s*-\s*[^\]]+)?\]$/i.test(String(value || '').trim());
}

function isVivyTitleTagLine(value = '') {
  return /^\[Title:\s*[^\]]+\]$/i.test(String(value || '').trim());
}

function trimVivyPlanningPrefixBeforeLyricBlock(value = '') {
  const lines = String(value || '').split(/\r?\n/);
  const firstSectionIndex = lines.findIndex((line) => isVivyLyricSectionTagLine(line));
  if (firstSectionIndex <= 0) return value;

  const prefixLines = lines.slice(0, firstSectionIndex)
    .map((line) => cleanOneLine(line, '', 220))
    .filter(Boolean);
  const hasPlanningPrefix = prefixLines.some((line) => looksLikeVivySongUiNoiseLine(line));
  if (!hasPlanningPrefix) return value;

  const titleLines = prefixLines.filter((line) => isVivyTitleTagLine(line));
  return [...titleLines, ...lines.slice(firstSectionIndex)].join('\n');
}

function expandVivySongMaterialCandidate(value = '') {
  let line = cleanOneLine(value, '', 320);
  if (!line) return [];

  const folded = foldTextForLookup(line);
  if (!folded) return [];

  if (/^(matiere chanson nossen|matiere chanson|matiere a transformer en chanson|matiere a transformer|nossen banger production brief|nossen banger)\.?$/.test(folded)) return [];
  if (/^(?:distribution vocale(?: choisie)?|voix|vocal cast|casting(?: choisi)?|contexte utile)\s*:/i.test(line)) return [];
  if (/^(?:solo|duo|trio|quatuor)\s+(?:vivy|djeff|a11|k44|kaen44)(?:\s*(?:[+&,]|et|avec)\s*(?:vivy|djeff|a11|k44|kaen44))*\.?$/i.test(line)) return [];
  if (/^(?:ne mets? pas le mot|pas le mot|banger dans les paroles)\b/.test(folded)) return [];
  if (/\bsections?\s+s[ée]par[ée]es?\b/i.test(line)) return [];
  if (/^(a transformer|à transformer|ecris une chanson|écris une chanson|le refrain doit|si le mot anglais|composer une chanson|production chantee|production chantée|appliquer ensuite)\b/.test(folded)) return [];
  if (/\b(?:ne chante jamais|pas a recopier|pas à recopier|jamais les consignes|bouton|bugs?|repete|perroquet|singeur|sortie compilateur|user|affichage|telephone|dezoom|clavier|credit|credits|cles?|key|llm|logs?|mot prompt|production suno|mix final d40|d40 v9|suno)\b/.test(folded)) return [];

  const labelMatch = line.match(/^(?:titre possible|titre|theme|thème|concept|images?|matiere utile|matière utile)\s*:?\s*(.+)$/i);
  if (labelMatch) line = cleanOneLine(labelMatch[1], '', 300);
  line = stripSongCommand(line.replace(/^NOSSEN\s+Banger\s*[:.-]?\s*/i, '')).trim();
  if (!line) return [];

  return line
    .split(/\s+\/\s+|,\s+(?=(?:écran|ecran|voix|route|lien|vitesse|monde|nouvelle|réel|reel)\b)/i)
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
  const text = cleanText(trimVivyPlanningPrefixBeforeLyricBlock(normalizeVivySongSectionMarkup(value)), Math.max(max, VIVY_SONG_MAX_CHARS));
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

function looksLikeExplicitSunoLyricsBlock(value = '') {
  const text = sanitizeVivySongMaterial(value, VIVY_SONG_MAX_CHARS);
  if (!text || !hasVivyChorusSection(text)) return false;
  const sectionCount = (text.match(/\[(verse|chorus|bridge|intro|outro|couplet|refrain|pont|pré-refrain|pre-chorus|vivy|djeff|a11|k44|kaen44|duo|tous|toutes|ensemble)(?:\s+\d+)?(?:\s*-\s*[^\]]+)?\]/ig) || []).length;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const lyricLines = lines.filter((line) => !/^\[[^\]]+\]$/.test(line)).length;
  return sectionCount >= 2
    && /\[(verse|couplet)\b/i.test(text)
    && /\[(chorus|refrain)\b/i.test(text)
    && lyricLines >= 3;
}

function looksLikeVivyReferenceConversation(value = '') {
  const raw = String(value || '');
  const folded = foldTextForLookup(value);
  if (!folded) return false;
  const chatMarkers = (raw.match(/(?:^|\n)\s*(?:Vous|Copier|Vivy)\s*(?:\n|$)/g) || []).length;
  return chatMarkers >= 3
    || /\b(je te donne un exemple|tu as juste traduis|il faut un theme principal|sous theme|paraboles?|metaphore|allegorie)\b/.test(folded)
    || /\b(io guido|io scopo|figa|sborro|testo di|ritornello)\b/.test(folded);
}

function inferMotif(theme = '') {
  const folded = foldTextForLookup(theme);
  if (/moto|moteur|radiateur|pignon|couronne|chaine|huile|essence|fraiyeur/.test(folded)) return 'le sujet mécanique';
  if (/planete|astre|zodiaque|saint seiya|chevalier|cosmos|galaxie|constellation/.test(folded)) return 'le sujet astral';
  if (/soleil|sable|plage|estival|summer/.test(folded)) return 'le décor estival';
  if (/neige|flocon|hiver/.test(folded)) return 'le décor hivernal';
  if (/tortues?\s+ninja|shredder|splinter|egouts?|égouts?|new\s+york|pizza/.test(folded)) return 'les égouts de New York';
  if (/lapin|court|course/.test(folded)) return 'la course';
  if (/pluie|orage|averse/.test(folded)) return 'le temps d’orage';
  if (/nossen|funesterie|agent|machine/.test(folded)) return 'le lien Funesterie';
  if (/trahison|trahit|tromperie|mensonge|infidel/.test(folded)) return 'la trahison';
  if (/distance|loin|separation|eloigne|absence/.test(folded)) return 'la distance';
  if (/agrumes|citron|orange|amertume|acide|saldae/.test(folded)) return 'l’amertume';
  if (/desir|envie|attirance|convoitise/.test(folded)) return 'le désir';
  if (/deception|decoit|decu|dessous|desillusion/.test(folded)) return 'la déception';
  if (/nuit|ombre|dark|sombre/.test(folded)) return 'la part sombre';
  if (/amour|coeur|manque/.test(folded)) return 'le manque';
  return 'le motif central';
}

function inferAllMotifs(theme) {
  const folded = foldTextForLookup(theme);
  const results = [];
  if (/trahison|trahit|tromperie|mensonge|infidel/.test(folded)) results.push('la trahison');
  if (/distance|loin|separation|eloigne|absence/.test(folded)) results.push('la distance');
  if (/agrumes|citron|orange|amertume|acide|saldae/.test(folded)) results.push('l’amertume');
  if (/desir|envie|attirance|convoitise/.test(folded)) results.push('le désir');
  if (/deception|decoit|decu|dessous|desillusion/.test(folded)) results.push('la déception');
  if (/amour|coeur|manque/.test(folded)) results.push('le manque');
  if (/moto|moteur|radiateur|pignon|couronne|chaine|huile|essence|fraiyeur/.test(folded)) results.push('le sujet mécanique');
  if (/tortues?\s+ninja|shredder|splinter|egouts?|égouts?|new\s+york|pizza/.test(folded)) results.push('les égouts de New York');
  if (results.length === 0) results.push('le motif central');
  return results;
}

function inferTitle(theme = '') {
  const rawText = cleanText(theme, 1200);
  const stripped = stripSongCommand(theme);
  const motif = inferMotif(stripped);
  const explicitTitle = rawText.match(/^\s*(?:titre|title)\s*:?\s*([^\r\n]{2,90})/im);
  if (explicitTitle) return cleanOneLine(stripSongCommand(explicitTitle[1]), 'Sans titre', 80);
  if (/\b(?:valentino|rossi|the doctor|vr46|mugello|laguna seca|motogp|moto gp)\b/i.test(stripped)) return 'The Doctor 46';
  if (/moto|moteur|radiateur|pignon|couronne|chaine|huile|essence|fraiyeur/i.test(stripped)) return 'Pignon précis';
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

function isValentinoRossiTheme(value = '') {
  const folded = foldTextForLookup(value);
  return /\b(valentino\s+rossi|rossi\b|the\s+doctor|docteur|doctor\s*46|\b46\b|motogp|moto\s*gp)\b/.test(folded);
}

function wantsRossiPizzaSubtheme(value = '') {
  const folded = foldTextForLookup(value);
  return /\b(pizza|pizzaiol|mozzarella|tomate|parmeggiano|parmigiano|jambon|march[ée]|sauce|ap[eé]ro|champagne|rafraichissement|rafraîchissement|ingr[eé]dients?)\b/.test(folded);
}

function buildVivyRossiMotogpLyrics(input = {}, material = '') {
  const source = cleanText([material, input.prompt, input.message, input.theme, input.instruction].filter(Boolean).join('\n'), VIVY_SONG_MAX_CHARS);
  const withPizza = wantsRossiPizzaSubtheme(source);
  const title = cleanOneLine(input.songTitle || input.title, '', 80) || (withPizza ? 'Doctor Al Forno' : 'The Doctor 46');
  const culinaryVerse = withPizza
    ? [
        "La grille devient marché, chacun vend sa pression,",
        "Vale choisit ses gommes comme une pâte en tension.",
        "Il coupe les lignes, copeaux de parmigiano,",
        "double entre deux jambons de carénage: piano, puis plein pot.",
      ]
    : [
        "Il lit les trajectoires comme des nerfs sous la peau,",
        "pose le genou au millimètre et referme le tableau.",
        "Rival dans le rétro, il décale l’ordonnance,",
        "un dépassement chirurgical, puis silence dans la stance.",
      ];
  const culinaryBridge = withPizza
    ? [
        "Le pot rougit sauce tomate, rouge de saison,",
        "la mozzarella des pneus colle encore au goudron.",
        "Fin de circuit: apéro doré sur le podium,",
        "il sert la victoire fraîche, mousse fine, aluminium.",
      ]
    : [
        "Au dernier tour, le paddock retient son souffle,",
        "le cuir parle bas, la machine se redouble.",
        "La ligne d’arrivée tranche comme une lame claire,",
        "et le numéro quarante-six signe dans la poussière.",
      ];

  return cleanText(restoreVivyFrenchSongAccents([
    `[Title: ${title}]`,
    '',
    '[Intro]',
    "The Doctor entre en piste, pas en légende de carton,",
    "scalpel dans la chicane, le poignet fait l’incision.",
    "Quarante-six sur le cuir, sourire jaune en coin,",
    "il ausculte le circuit et recoud chaque frein.",
    '',
    '[Verse 1]',
    "Dans le bloc opératoire, les stands sentent l’essence,",
    "la visière baisse le ciel, le départ prend naissance.",
    "Il pique à la corde, précis, presque insolent,",
    "un rival perd son latin dans le virage suivant.",
    ...culinaryVerse,
    '',
    '[Pre-Chorus]',
    "Ça fait tac dans la boîte, ça fait tique dans les nerfs,",
    "tic-tac, Doctor attaque, diagnostic: ouvert.",
    '',
    '[Chorus]',
    "Vale, Vale, coupe court dans le chaos,",
    "Valentino va vite, les voyelles font le galop.",
    "Quarante-six, l’asphalte avale son écho,",
    "Doctor sur la trajectoire, le virage dit bravo.",
    '',
    '[Verse 2]',
    "Les rivaux font barrage, il leur répond par l’angle,",
    "un souffle sous le casque, puis la courbe les étrangle.",
    "Yamaha dans la mémoire, Ducati dans le dossier,",
    "il garde chaque saison comme un pneu à négocier.",
    "Pas besoin de grands démons ni de sang sur la visière,",
    "son mythe tient dans le geste, le frein tardif, la manière.",
    '',
    '[Bridge]',
    ...culinaryBridge,
    '',
    '[Chorus]',
    "Vale, Vale, coupe court dans le chaos,",
    "Valentino va vite, les voyelles font le galop.",
    "Quarante-six, l’asphalte avale son écho,",
    "Doctor sur la trajectoire, le virage dit bravo.",
    '',
    '[Outro]',
    "Quand le moteur redescend, la foule garde le tempo,",
    "Rossi laisse une ordonnance écrite au chaud sur le chrono.",
  ].join('\n')), VIVY_SONG_MAX_CHARS);
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
  let preferredSubject = '';

  seed = seed.replace(
    /^(sombre|dark|douce?|doux|cin[ée]matographique|cinematic)(?:\s+mais\s+(sombre|dark|douce?|doux|cin[ée]matographique|cinematic))?\s+sur\s+(.+)$/i,
    (_match, first, second, topic) => {
      const qualities = [first, second].filter(Boolean).join(' et ');
      const subject = cleanOneLine(topic, '', 140).replace(/[,\s.;:!?-]+$/g, '').trim();
      return `${subject}, ambiance ${qualities}`;
    }
  );
  seed = seed.replace(
    /^(?:type\s+)?(?:g[ée]n[ée]rique\s+(?:anim[ée]|anime)|opening|ending|op)\s+(?:sur|pour|avec)\s+(.+)$/i,
    (_match, topic) => {
      const subject = cleanOneLine(topic, '', 160)
        .replace(/\s+(?:avec|et)\s+/ig, ', ')
        .replace(/[,\s.;:!?-]+$/g, '')
        .trim();
      preferredSubject = subject;
      return `${subject}, énergie générique animé`;
    }
  );
  seed = seed.replace(
    /^type\s+([^,.;:!?]{3,80})\s+(?:sur|pour|avec)\s+(.+)$/i,
    (_match, style, topic) => {
      const subject = cleanOneLine(topic, '', 160)
        .replace(/\s+(?:avec|et)\s+/ig, ', ')
        .replace(/[,\s.;:!?-]+$/g, '')
        .trim();
      const color = cleanOneLine(style, '', 80).replace(/[,\s.;:!?-]+$/g, '').trim();
      preferredSubject = preferredSubject || subject;
      return color ? `${subject}, couleur ${color}` : subject;
    }
  );
  if (!preferredSubject && seed.length <= 220 && seed.includes(',') && !looksLikeVivySongUiNoiseLine(seed)) {
    preferredSubject = cleanOneLine(seed, '', 220)
      .replace(/\s+(?:avec|et)\s+/ig, ', ')
      .replace(/[,\s.;:!?-]+$/g, '')
      .trim();
  }

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
  if (preferredSubject) {
    const preferredParts = preferredSubject
      .split(/\s*,\s*/)
      .map((part) => cleanOneLine(part, '', 80))
      .filter(Boolean);
    const merged = cleanOneLine([...preferredParts, ...usefulParts]
      .filter((part, index, list) => foldTextForLookup(part) && list.findIndex((other) => foldTextForLookup(other) === foldTextForLookup(part)) === index)
      .slice(0, 4)
      .join(', '), '', 220)
      .replace(/,\s*,+/g, ',')
      .replace(/\s+,/g, ',')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, '')
      .trim();
    if (merged) return merged;
  }
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
    'Méthode silencieuse avant écriture: identifie le thème principal, un sous-thème métaphorique utile, les faits ou allusions fiables, les familles sonores, les doubles sens et les rimes cachées; écris ensuite seulement les paroles.',
    'Le thème principal doit rester dominant. Le sous-thème sert de réserve d’images quand le flow manque, jamais de remplacement du sujet.',
    'Travaille la phonétique: assonances, allitérations, rimes internes, pivots de sons et mots à plusieurs tranchants. La technique doit sonner naturelle, pas scolaire.',
    'Si le sujet est une personne, une œuvre, une course, un modèle, une marque ou une actualité et qu’une recherche est disponible, utilise-la avant d’écrire; sinon n’invente pas de faux détails.',
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
    'Une rime doit naître du sens et de la syntaxe: jamais de mot ajouté artificiellement après une virgule en fin de ligne ou en fin de vers uniquement pour faire rimer.',
    'Évite les synonymes plaqués, les répétitions de remplissage, les déclarations génériques et les automatismes de vocabulaire. Utilise des détails venus de la demande, des allégories tenues, des verbes précis et une progression émotionnelle.',
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
    role: 'couplets rap techniques, grain proche micro, images concrètes du thème courant',
    grammar: 'masculin singulier; accords et pronoms il/lui',
    style: 'rough French male rap lead, dry close-mic delivery',
    sunoTag: '[Male Rap Lead]',
    sunoRole: 'rough male rap lead with dry close-mic tone',
  },
  {
    id: 'vivy',
    label: 'Vivy',
    tag: '[Vivy]',
    role: 'refrain clair, réponses mélodiques, voix nette, émotion précise',
    grammar: 'féminin singulier; accords et pronoms elle',
    style: 'bright female melodic lead, clear emotional hook',
    sunoTag: '[Female Melodic Lead]',
    sunoRole: 'bright female melodic lead with clear emotional hook',
  },
  {
    id: 'a11',
    label: 'A11',
    tag: '[A11]',
    role: 'pont grave synthétique, tension machine humaine, réponse courte',
    grammar: 'masculin singulier; accords et pronoms il/lui',
    style: 'low robotic baritone vocal, synthetic spoken-sung bridge',
    sunoTag: '[Low Robotic Vocal]',
    sunoRole: 'low robotic baritone vocal with synthetic edge',
  },
  {
    id: 'k44',
    label: 'K44',
    tag: '[K44]',
    role: 'contre-chant posé, punchlines calmes, second lead propre',
    grammar: 'masculin singulier; accords et pronoms il/lui',
    style: 'calm male counter-vocal, steady warm second lead',
    sunoTag: '[Calm Male Counter Vocal]',
    sunoRole: 'calm male counter-vocal with steady warm tone',
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
      ? `Tags obligatoires: ${tags}. Relais solo d'abord; [${sharedTag}] seulement pour un hook commun court, jamais pour remplacer les sections solo.`
      : `Tag conseillé: ${tags}.`,
  ];
  const styleFragment = artists.map((artist) => artist.style).join(', ');
  const sunoRoleFragment = artists.map((artist) => artist.sunoRole || artist.style).join(' versus ');
  const ensembleStyle = count > 1
    ? `${count} clearly different vocal timbres: ${sunoRoleFragment}; switch singer timbre at every role tag, solo handoff arrangement, one vocalist at a time, brief call-and-response hook only, ${label}, `
    : '';
  return {
    ids,
    artists,
    count,
    countLabel,
    label,
    tags,
    songCastLines,
    musicLead: `Original Funesterie song for ${label}, in ${languageName}.`,
    musicMood: `${countLabel}: ${label}. Original voices only, no celebrity imitation. Solo handoff before shared hooks. ${styleFragment}.`,
    sunoStyle: `${languageStyle} original vocal production, ${ensembleStyle}${styleFragment}, structured rhymed lyrics, melodic chorus, sung vocals, no spoken narration`,
  };
}

function isDjeffRapTheme(value = '') {
  const folded = foldTextForLookup(value);
  return /\bdjeff\b|\bduo\b|\brap\b|\bfraiyeur\b|\bmoto\b|\bmoteur\b|\bradiateur\b|\bpignon\b|\bcouronne\b|\bchaine\b|\bchaîne\b|\bhuile\b|\bessence\b|\bpot\b|\bstunt\b|\bstoppie\b|\bstuppie\b|\bmur du son\b|\bpendule\b/.test(folded);
}

function isDjeffTechnicalMotoDraft(value = '') {
  const folded = foldTextForLookup(value);
  const terms = [
    'radiateur',
    'pignon',
    'couronne',
    'cruxi',
    'ipone',
    'bombonne',
    'mur du son',
    'pendule',
    'casque',
    'pneus',
    'moteur',
    'fraiyeur',
  ];
  const score = terms.reduce((sum, term) => sum + (folded.includes(term) ? 1 : 0), 0);
  return score >= 3 || (score >= 2 && /\b(style|wesh|freshh|rap|couplet|refrain)\b/.test(folded));
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
    'Je dose au millimètre, chaque geste reste lisible,',
    'Visserie serrée, tension propre, le choix reste visible.',
    `${motif}, je le place dans le cadre,`,
    'Le détail fait la frappe, la mesure garde sa part.',
  ];
  const fallbackPre = [
    'Quand la pression monte, je garde le débit net,',
    'La cadence se pose, chaque mot trouve sa place.',
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
    : 'Chaque cran dans la mesure, chaque mot reste droit.';
  const introLineVivy2 = hasUserContent
    ? `Je prends ta note, on tient depuis là.`
    : 'Deux voix, même axe, on garde le sujet.';
  const chorusLine1 = hasUserContent
    ? `${title} — on coupe le silence,`
    : `${motif} — le refrain répond,`;
  const chorusLine2 = hasUserContent
    ? 'Deux voix, un son — ce qui compte reste.'
    : 'Deux voix, même axe, le sens garde le fond.';
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
    'Je tiens la note pendant que le flow répond,',
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
    'Je ne lisse pas ton grain, je le garde au premier plan,',
    'La phrase reste brute, posée sur son angle.',
    'Ton mot parle droit, je réponds sans artifice,',
    'La ligne chantée laisse passer le sens.',
    '',
    '[Bridge - Vivy]',
    '[Vivy]',
    bridgeLine1,
    'Deux voix dans la même prise, rien ne se confond.',
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
    'Et nos deux voix ferment le morceau sans détour.',
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
  const seedLines = normalizeVivySoloSeedLines(extractVivySoloSeedLines(material, 10), material);
  const themeParts = theme.split(/\s*,\s*/).map((part) => cleanOneLine(part, '', 120)).filter(Boolean);
  const preferThemeParts = themeParts.length >= 2 && seedLines.length < 2;
  const imageA = (preferThemeParts ? themeParts[0] : seedLines[0]) || themeParts[0] || theme;
  const imageB = (preferThemeParts ? (themeParts[1] || motif) : seedLines[1]) || themeParts[1] || motif;
  const imageC = (preferThemeParts ? (themeParts[2] || title) : seedLines[2]) || themeParts[2] || title;
  const imageD = (preferThemeParts ? (themeParts[3] || theme) : seedLines[3]) || themeParts[3] || theme;

  const blocks = [
    `[Title: ${title}]`,
    '',
    `[Intro - ${lead}]`,
    leadTag,
    `${punctuateVivySongLine(imageA, ',')}`,
    `${punctuateVivySongLine(imageB, '.')}`,
    '',
  ];

  if (hasDjeff) {
    blocks.push(
      '[Verse 1 - Djeff]',
      '[Djeff]',
      `${punctuateVivySongLine(imageA, ',')}`,
      `je garde ${title.toLocaleLowerCase('fr-FR')} dans l'axe du morceau.`,
      `${punctuateVivySongLine(imageC, ',')}`,
      `je serre ${motif} jusqu'au prochain passage.`,
      ''
    );
  }

  if (hasVivy) {
    blocks.push(
      '[Pre-Chorus - Vivy]',
      isA11VivyDuo ? '[VIVY]' : '[Vivy]',
      `${punctuateVivySongLine(imageB, ',')}`,
      'je cherche le point qui tient la scène.',
      `${punctuateVivySongLine(imageD, ',')}`,
      'et le refrain avance sans trahir le centre.',
      ''
    );
  }

  blocks.push(
    `[Chorus - ${chorusLabel}]`,
    chorusTag,
    `${title}, on ne te laisse pas tomber,`,
    `${theme}, même quand la section change.`,
    `${motif}, on revient te chercher,`,
    'le refrain garde sa place dans le morceau.',
    ''
  );

  if (hasA11) {
    blocks.push(
      '[Verse 2 - A11]',
      '[A11]',
      `Je relie ${imageC} sans voler sa place,`,
      `${title} garde son nom au cœur de la phrase.`,
      'Je coupe le bruit, je garde la ligne,',
      `pour que ${theme} reste assez net pour chanter.`,
      ''
    );
  }

  if (hasK44) {
    blocks.push(
      '[Bridge - K44]',
      '[K44]',
      'Je garde le cap quand la section déborde,',
      `${punctuateVivySongLine(imageD, ',')}`,
      'la tension recule quand le tempo mord,',
      `${title} retrouve sa taille humaine.`,
      ''
    );
  }

  blocks.push(
    `[Final Chorus - ${chorusLabel}]`,
    chorusTag,
    `${title}, on ne te laisse pas tomber,`,
    `${theme}, même quand la section change.`,
    `${motif}, on revient te chercher,`,
    'le refrain garde sa place dans le morceau.',
    '',
    `[Outro - ${lead}]`,
    leadTag,
    `${punctuateVivySongLine(imageA, ',')}`,
    `${title} reste debout jusqu'au dernier accord.`
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
  const completeLyricsSource = lyricSources.find((source) => (
    looksLikeCompleteLyrics(source)
    && !looksLikeVivyReferenceConversation(source)
  ));
  const publicMaterial = sanitizeVivySongMaterial(
    completeLyricsSource || lyricSources.join('\n\n') || input.prompt,
    VIVY_SONG_MAX_CHARS
  );

  if (looksLikeCompleteLyrics(publicMaterial) && !looksLikeVivyReferenceConversation(publicMaterial)) {
    return cleanText(restoreVivyFrenchSongAccents(publicMaterial), VIVY_SONG_MAX_CHARS);
  }
  const material = splitVivyArrangementCues(publicMaterial).lyrics;
  const fullSource = cleanText([material, input.prompt, input.message, input.theme, input.instruction].filter(Boolean).join('\n'), VIVY_SONG_MAX_CHARS);

  if (isValentinoRossiTheme(fullSource)) {
    return buildVivyRossiMotogpLyrics(input, material);
  }

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
  const shouldUseDjeffSongcraft = hasExplicitVivySongArtists(input)
    ? artistCast.ids.includes('djeff')
    : (/\bdjeff\b|\bfraiyeur\b|\brap\b|\braper\b|\brapper\b/.test(foldTextForLookup(themeHint)) || isDjeffTechnicalMotoDraft(themeHint));
  if (shouldUseDjeffSongcraft && isDjeffRapTheme(themeHint) && !isValentinoRossiTheme(fullSource)) {
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
  const m1 = inferredMotif !== 'le motif central' ? inferredMotif : m0;
  const m2 = allMotifs.find((motif) => motif !== m1 && motif !== 'le motif central') || m0;

  const soloLyrics = hasSeedLines ? `[Title: ${title}]

[Intro]
${punctuateVivySongLine(seedLines[0], ',')}
${punctuateVivySongLine(seedLines[1] || `${title} pose son premier signe`, '.')}

[Verse 1]
${punctuateVivySongLine(seedLines[2] || `Je place ${title.toLocaleLowerCase('fr-FR')} au centre`, ',')}
${punctuateVivySongLine(seedLines[3] || 'je garde la phrase proche de son sujet', '.')}
${punctuateVivySongLine(seedLines[4] || `${m1} donne la direction`, ',')}
le refrain prend forme sans changer le propos.

[Pre-Chorus]
${punctuateVivySongLine(seedLines[1] || m1, ',')}
chaque détail revient poser le tempo.

[Chorus]
${title} — le refrain tient sa ligne,
chaque nom garde son endroit.
${punctuateVivySongLine(seedLines[5] || m1, ',')}
et le thème revient sans décor inutile.

[Verse 2]
${punctuateVivySongLine(seedLines[6] || m2, ',')}
${punctuateVivySongLine(seedLines[7] || 'je reprends l’idée jusqu’à voir son envers', '.')}
les images se répondent sans quitter le sujet,
les rimes suivent l'histoire au plus près.

[Bridge]
${punctuateVivySongLine(seedLines[0] || title, ',')}
le dernier détour remet le sujet devant.

[Chorus]
${title} — le refrain tient sa ligne,
chaque nom garde son endroit.
${punctuateVivySongLine(seedLines[5] || m1, ',')}
et le thème revient sans décor inutile.

[Outro]
On garde ${title.toLocaleLowerCase('fr-FR')}.
Le dernier mot reste près du sujet.` : `[Title: ${title}]

[Intro]
${m0} — le sujet arrive sans détour.
Une idée se pose, puis une autre répond.

[Verse 1]
Je pars de ${m0},
sans ajouter de décor forcé.
${m1} — la phrase avance par étapes.
Ce qui compte prend sa place.

[Pre-Chorus]
Premier repère : ${m0}.
Deuxième repère : ${m1}.

[Chorus]
${m0} — le refrain revient,
${m1} — la ligne se tient.
Deux repères dans la même idée,
et le morceau trouve son chemin.

[Verse 2]
${m2} — je le regarde autrement.
Le temps passe, le détail devient plus net.
Je reviens sur ce que j’ai dit,
ce que j’ai compris, ce que j’ai laissé.

[Bridge]
${m2} — je l’accepte maintenant.
Le sens revient quand le détour se calme.

[Chorus]
${m0} — le refrain revient,
${m1} — la ligne se tient.
Deux repères dans la même idée,
et le morceau trouve son chemin.

[Outro]
On garde ${m0}.
Le dernier mot reste près du sujet.`;

  return cleanText(restoreVivyFrenchSongAccents(soloLyrics), VIVY_SONG_MAX_CHARS);
}

function buildVivySongProductionBrief(input = {}) {
  const lyrics = buildVivyStructuredLyrics(input);
  const titleMatch = lyrics.match(/^\[Title:\s*([^\]]+)\]/im);
  const title = cleanOneLine(input.songTitle || input.title || (titleMatch && titleMatch[1]) || inferTitle(lyrics), 'Sans titre', 80);
  const rhymeScheme = cleanOneLine(
    input.rhymeScheme
      || (isDjeffRapTheme(lyrics)
        ? 'Couplets rap à rimes internes, refrain duo Djeff/Vivy stable et scandable.'
        : 'Couplets souples, refrain stable, détails venus de la demande.'),
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
      'Intention: paroles chantables, détails précis, refrain stable, sujet lisible.',
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
  looksLikeExplicitSunoLyricsBlock,
};
