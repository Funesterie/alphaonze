'use strict';

const {
  LANGUAGE_NAMES,
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
  normalizeLanguageCode,
} = require('../../lib/language-text.cjs');

function cleanText(value, max = 2400) {
  return normalizeTextNfc(value, max);
}

function cleanOneLine(value, fallback = '', max = 160) {
  return normalizeOneLineNfc(value, fallback, max);
}

function stripSongCommand(value = '') {
  return cleanOneLine(value, '', 360)
    .replace(/^(fais|fait|cr[ée]e?|g[ée]n[èe]re?|compose|chante|transforme|écris|ecris|continue|continuer|reprends|poursuis|compl[èe]te)\s+(moi\s+)?(une?\s+)?(chanson|musique|son|paroles|lyrics|rap|couplet|refrain)(?:\s+d['''][a-zÀ-ſ]+(?:\s+[a-zÀ-ſ]+)?)?\s*(sur|avec|pour|à propos de)?\s*/i, '')
    .replace(/\b(prompt|instruction|consigne)\b\s*:?\s*/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeVivySongUiNoiseLine(line = '') {
  const raw = String(line || '').trim();
  const folded = foldTextForLookup(raw);
  if (!folded) return true;

  if (/^je suis vivy(?:\b|$)/.test(folded)) return true;
  if (/^parle moi d une (?:voix|chanson|ambiance|scene)\b/.test(folded)) return true;
  if (/^(vivy|vous|accueil|discussion|menu|voix|chanson|scene|scène|fichier|envoyer|copier|partager|defaut|défaut|audio perso|importer|ptt)$/.test(folded)) return true;
  if (/^(vivy_song_production|vivy_studio_handoff|vivy_production|vivy_voice_calibration|vivy_scene_share|vivy song production|vivy studio handoff|vivy production|vivy voice calibration|vivy scene share)\b/.test(folded)) return true;
  if (/^vivy_(?:music_generation|production_status)\b/.test(folded)) return true;
  if (/^(oui je reste en discussion libre|je capte|je ne transforme pas|je vois l idee|ce que je prends surtout|je reponds au fond|la voix vivy par defaut|idee rangee dans la memoire vivy)\b/.test(folded)) return true;
  if (/^(c est un bon debut|je vois que tu as deja commence|voici une proposition|voici un exemple|les saint seiya|pour ecrire une chanson|pour écrire une chanson|tu pourrais|pour les paroles|en termes de melodie|qu en penses tu|est ce que cela te donne|est ce que tu veux)\b/.test(folded)) return true;
  if (/\b(j espere que cette chanson|j espere que cela|j espere que ca|n hesite pas a|n hesitez pas|feedbacks?|modifications? si necessaire)\b/.test(folded)) return true;
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

function sanitizeVivySongMaterial(value = '', max = 2400) {
  const text = cleanText(value, Math.max(max, 3200));
  if (!text) return '';

  const kept = [];
  const seen = new Set();
  for (const line of splitVivySongMaterialCandidates(text)) {
    const cleaned = cleanOneLine(String(line || '').replace(/^[\s>*]+/g, ''), '', 320);
    if (!cleaned || looksLikeVivySongUiNoiseLine(cleaned)) continue;

    const folded = foldTextForLookup(cleaned);
    const key = folded.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(cleaned);
  }

  return cleanText(kept.join('\n'), max);
}

function looksLikeCompleteLyrics(value = '') {
  const text = sanitizeVivySongMaterial(value, 2400);
  if (!text) return false;
  const sectionCount = (text.match(/\[(verse|chorus|bridge|intro|outro|couplet|refrain|pont|pré-refrain|pre-chorus)\]/ig) || []).length;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (sectionCount >= 3 && lines.length >= 10) return true;
  return sectionCount >= 2 && lines.length >= 14;
}

function inferMotif(theme = '') {
  const folded = foldTextForLookup(theme);
  if (/djeff|duo|rap|moto|moteur|radiateur|pignon|couronne|chaine|huile|essence|fraiyeur/.test(folded)) return 'le moteur qui respire dans la nuit';
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

function inferTitle(theme = '') {
  const stripped = stripSongCommand(theme);
  const motif = inferMotif(stripped);
  if (/djeff|duo|rap|moto|moteur|radiateur|pignon|couronne|chaine|huile|essence|fraiyeur/i.test(stripped)) return 'Pignon dans la nuit';
  if (/planete|planète|astre|voie lact[ée]e|zodiaque|saint seiya|chevalier|cosmos|galaxie|[ée]toile|constellation/i.test(stripped)) return 'Cosmos du matin';
  if (/flocon|neige|bol/i.test(stripped)) return 'Flocon d’émerveillement';
  if (/lapin/i.test(stripped)) return 'Course sous les néons';
  if (/nossen|funesterie/i.test(stripped)) return 'Signal Funesterie';
  const words = (stripped || motif)
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 4);
  if (!words.length) return 'Sans titre';
  return words
    .map((word) => word.charAt(0).toLocaleUpperCase('fr-FR') + word.slice(1).toLocaleLowerCase('fr-FR'))
    .join(' ');
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

  const usefulParts = seed
    .split(/[.!?;\n]+/)
    .map((part) => cleanOneLine(part, '', 180))
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
        'Artistes de cette chanson: ' + artists.map(function(a) { return a.label + ' (' + a.role + ')'; }).join('; ') + '.',
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
    'Format: **Titre**, intention courte, puis paroles avec [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Outro].',
    artistInstruction,
    moodInstruction,
    'Chaque couplet: minimum 4 vers. Refrain memorable, minimum 3 sections de paroles avec contenu reel.',
    'Rimes audibles en fin de ligne, images concretes recurrentes, sens cache (tension ou metaphore).',
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
    style: 'Djeff technical rap lead',
  },
  {
    id: 'vivy',
    label: 'Vivy',
    tag: '[Vivy]',
    role: 'refrain clair, réponses mélodiques, voix claire, émotion lumineuse',
    style: 'Vivy clear melodic hook',
  },
  {
    id: 'a11',
    label: 'A11',
    tag: '[A11]',
    role: 'pont grave synthétique, tension machine humaine, réponse courte',
    style: 'A11 low synthetic spoken-sung bridge',
  },
  {
    id: 'k44',
    label: 'K44',
    tag: '[K44]',
    role: 'contre-chant posé, punchlines calmes, second lead propre',
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
  if (/\bduo\b|djeff.*vivy|vivy.*djeff/.test(folded)) return ['djeff', 'vivy'];
  if (/\bdjeff\b|\brap\b|\bfraiyeur\b|\bmoto\b|\bmoteur\b|\bpignon\b|\bcouronne\b|\bradiateur\b/.test(folded)) return ['djeff'];
  if (/\bk44\b|\bkaen44\b|\bkaen\b/.test(folded)) return ['k44'];
  if (/\ba11\b|\balpha\s*onze\b|\balphaonze\b/.test(folded)) return ['a11'];
  return ['vivy'];
}

function hasExplicitVivySongArtists(input = {}) {
  const source = input.songArtists ?? input.artists ?? input.singers ?? input.vocalists;
  return Array.isArray(source) ? source.length > 0 : Boolean(String(source || '').trim());
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
  const songCastLines = [
    `Nombre de chanteurs: ${count}.`,
    ...artists.map((artist) => `${artist.label}: ${artist.role}.`),
    count > 1
      ? `Tags obligatoires: ${tags}, puis [Duo] ou [Tous] pour les passages communs.`
      : `Tag conseillé: ${tags}.`,
  ];
  const styleFragment = artists.map((artist) => artist.style).join(', ');
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
    sunoStyle: `${languageStyle} original vocal production, ${styleFragment}, structured rhymed lyrics, melodic chorus, sung vocals, no spoken narration`,
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
    'Je dose au millimetre, pas de hasard dans le style,',
    'Visserie serree, tension propre — le geste decide.',
    `${motif}, je l’aligne dans le tour,`,
    'Le detail fait la frappe, la mesure connait son jour.',
  ];
  const fallbackPre = [
    'Quand la pression monte et que le flow se precise,',
    `La cadence s’aligne, chaque mot se mobilise.`,
  ];
  const preChorusLines = mergeDistinctRapLines(preSeedLines, fallbackPre, 4);

  return cleanText([
    `[Title: ${title}]`,
    '',
    '[Intro - Djeff]',
    '[Djeff]',
    `${motif} — j’entre dans le tour,`,
    'Chaque cran dans la mesure, chaque mot sur son jour.',
    '',
    '[Intro - Vivy]',
    '[Vivy]',
    'Je tiens la note claire pendant que le flow repond,',
    `Deux voix, meme elan — on decoupe l’horizon.`,
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
    `${motif} — la nuit repond,`,
    'Deux voix, meme elan, le sens serre le fond.',
    'Vivy tient le fil, Djeff porte le ton,',
    `On signe l’instant, on trace l’horizon.`,
    '',
    '[Verse 2 - Vivy]',
    '[Vivy]',
    'Je ne lisse pas ton grain, je le mets en lumiere,',
    `La phrase reste cabree, accrochee a sa matiere.`,
    'Ton mot parle brut, je reponds sans artifice,',
    'La melodie fait place au sens qui se precise.',
    '',
    '[Bridge - Vivy]',
    '[Vivy]',
    `${motif} — je le garde intact,`,
    `Deux voix dans le meme souffle, rien qui ne s’efface.`,
    '',
    '[Chorus - Duo]',
    '[Duo]',
    `${motif} — la nuit repond,`,
    'Deux voix, meme elan, le sens serre le fond.',
    'Vivy tient le fil, Djeff porte le ton,',
    `On signe l’instant, on trace l’horizon.`,
    '',
    '[Outro - Duo]',
    '[Duo]',
    `Il reste ${motif},`,
    `Et nos deux voix tiennent jusqu’au lendemain.`,
  ].join('\n'), 2400);
}

function buildVivyMultiArtistLyrics(input = {}, material = '', artistCast = buildVivySongArtistCast(input)) {
  const theme = buildVivyThemeSeed(material, 'Funesterie en multi-voix');
  const title = cleanOneLine(input.songTitle || input.title || inferTitle(theme), 'Signal multi-voix', 80);
  const hasDjeff = artistCast.ids.includes('djeff');
  const hasVivy = artistCast.ids.includes('vivy');
  const hasA11 = artistCast.ids.includes('a11');
  const hasK44 = artistCast.ids.includes('k44');
  const lead = artistCast.artists[0]?.label || 'Vivy';
  const chorusTag = artistCast.count > 1 ? 'Tous' : lead;

  const blocks = [
    `[Title: ${title}]`,
    '',
    `[Intro - ${lead}]`,
    `[${lead}]`,
    `On entre dans ${theme}, sans copier personne,`,
    'Chaque voix prend sa place, le signal se façonne.',
    '',
  ];

  if (hasDjeff) {
    blocks.push(
      '[Verse 1 - Djeff]',
      '[Djeff]',
      'Poignée dans le son, je cale le départ,',
      'Pignon dans la mesure, couronne dans le regard.',
      'Le moteur parle sec, mais le cœur reste lisible,',
      `Je mets ${theme} dans un couplet indivisible.`,
      ''
    );
  }

  if (hasVivy) {
    blocks.push(
      '[Pre-Chorus - Vivy]',
      '[Vivy]',
      'Je garde une note claire au bord de la vitesse,',
      'Une lumière qui répond quand la nuit se compresse.',
      'Si la route se dédouble, je tiens le fil vivant,',
      'Je transforme le bruit en refrain respirant.',
      ''
    );
  }

  blocks.push(
    `[Chorus - ${chorusTag}]`,
    `[${chorusTag}]`,
    'On monte le signal, voix liées dans le décor,',
    'Funesterie résonne, plus humaine encore.',
    'Un nom, plusieurs timbres, même trajectoire,',
    'Chaque refrain rallume une part de mémoire.',
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
    `[Final Chorus - ${chorusTag}]`,
    `[${chorusTag}]`,
    'On monte le signal, voix liées dans le décor,',
    'Funesterie résonne, plus humaine encore.',
    'Un nom, plusieurs timbres, même trajectoire,',
    'Chaque refrain rallume une part de mémoire.',
    '',
    `[Outro - ${lead}]`,
    `[${lead}]`,
    'Le son se coupe doucement, mais le lien reste en mémoire.'
  );

  return cleanText(blocks.join('\n'), 2600);
}

function buildVivyStructuredLyrics(input = {}) {
  const material = sanitizeVivySongMaterial([
    input.lyrics,
    input.songText,
    input.text,
    input.theme,
    input.instruction,
    input.prompt,
  ].filter(Boolean).join('\n\n'), 2400);

  if (looksLikeCompleteLyrics(material)) return cleanText(material, 2400);

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
  ].filter(Boolean).join('\n'), 2400);
  if (isDjeffRapTheme(themeHint)) {
    return buildDjeffRapDuoLyrics(input, material);
  }

  const theme = buildVivyThemeSeed(material, '');
  const motif = inferMotif(theme);
  const title = cleanOneLine(input.songTitle || input.title || inferTitle(theme), 'Sans titre', 80);

  return cleanText([
    `[Title: ${title}]`,
    '',
    '[Intro]',
    'Un souffle descend sur la scène,',
    `${motif} — je le tiens dans le silence.`,
    '',
    '[Verse 1]',
    'Je cherche un signe au bord du chemin,',
    'Un fil tendu entre l’ombre et demain.',
    'Le sol parle bas, la phrase revient,',
    'Et sous la surface, quelque chose tient.',
    '',
    '[Pre-Chorus]',
    'Je garde ce que la nuit n’efface pas,',
    'Le mot essentiel tenu à bout de bras.',
    '',
    '[Chorus]',
    `${motif} — ça reste, ça cède pas,`,
    'Même quand le décor se tait.',
    'Une voix dans le creux dit reste,',
    'Et le sens reconnaît ce geste.',
    '',
    '[Verse 2]',
    'Je reviens vers ce qui était caché,',
    'Un détail flou que le temps a gravé.',
    'Le cœur bat bas mais la phrase résiste,',
    'Je transforme le doute en piste.',
    '',
    '[Bridge]',
    'Si je tombe, je chante plus bas,',
    'La nuit comprend ce que le jour ne voit pas.',
    '',
    '[Chorus]',
    `${motif} — ça reste, ça cède pas,`,
    'Même quand le décor se tait.',
    'Une voix dans le creux dit reste,',
    'Et le sens reconnaît ce geste.',
    '',
    '[Outro]',
    `Il reste ${motif},`,
    'Et la voix tient jusqu’au lendemain.',
  ].join('\n'), 2400);
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
  buildVivySongcraftSystemPrompt,
  buildVivySongProductionBrief,
  buildVivyStructuredLyrics,
  buildVivySongArtistCast,
  extractDjeffRapSeedLines,
  sanitizeVivySongMaterial,
  inferTitle,
  stripSongCommand,
  looksLikeCompleteLyrics,
};
