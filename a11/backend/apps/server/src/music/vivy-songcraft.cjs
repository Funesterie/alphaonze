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
    .replace(/^(fais|fait|cr[ée]e?|g[ée]n[èe]re?|compose|chante|transforme|écris|ecris|continue|continuer|reprends|poursuis|compl[èe]te)\s+(moi\s+)?(une?\s+)?(chanson|musique|son|paroles|lyrics|rap|couplet|refrain)\s*(sur|avec|pour|à propos de)?\s*/i, '')
    .replace(/\b(prompt|instruction|consigne)\b\s*:?\s*/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeVivySongUiNoiseLine(line = '') {
  const raw = String(line || '').trim();
  const folded = foldTextForLookup(raw);
  if (!folded) return true;

  if (/^je suis vivy\s+parle moi d/.test(folded)) return true;
  if (/^(vivy|vous|accueil|discussion|menu|voix|chanson|scene|scène|fichier|envoyer|copier|partager|defaut|défaut|audio perso|importer|ptt)$/.test(folded)) return true;
  if (/^(vivy_song_production|vivy_studio_handoff|vivy_production|vivy_voice_calibration|vivy_scene_share|vivy song production|vivy studio handoff|vivy production|vivy voice calibration|vivy scene share)\b/.test(folded)) return true;
  if (/^vivy_(?:music_generation|production_status)\b/.test(folded)) return true;
  if (/^(oui je reste en discussion libre|je capte|je ne transforme pas|je vois l idee|ce que je prends surtout|je reponds au fond|la voix vivy par defaut|idee rangee dans la memoire vivy)\b/.test(folded)) return true;
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

function sanitizeVivySongMaterial(value = '', max = 2400) {
  const text = cleanText(value, Math.max(max, 3200));
  if (!text) return '';

  const kept = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n+/)) {
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
  if (/soleil|nature|ete|été|sable|plage|creme|crème|dance|techno|estival|summer/.test(folded)) return 'un soleil qui colle à la peau';
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
  if (/djeff|duo|rap|moto|moteur|radiateur|pignon|couronne|chaine|huile|essence|fraiyeur/i.test(stripped)) return 'Pignon dans la nuit';
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

function buildVivyThemeSeed(value = '', fallback = 'Vivy garde la lumière') {
  const material = sanitizeVivySongMaterial(value, 900);
  let seed = stripSongCommand(material)
    .replace(/^(?:salut|bonjour|coucou|hey)\b[\s,;:.!?-]*/i, '')
    .replace(/^(?:tu\s+as\s+|t['’]\s*as\s+)?(?:une?\s+)?id[ée]e\s+de\s+chanson\s+(?:sur|pour|avec)\s+/i, '')
    .replace(/^(?:theme|th[èe]me)\s*:?\s*/i, '')
    .replace(/\b(?:un\s+)?son\s+d['’]ambiance\s+(?:pour|sur|avec)?\s*/ig, '')
    .replace(/\b(?:prépare|prepare)\s+(?:un\s+)?prompt\s+suno\b/ig, '')
    .replace(/\b(?:continue|continuer|reprends|poursuis)\s+(?:ce\s+)?(?:texte|couplet|refrain|rap)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();

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

  const cleaned = cleanOneLine(usefulParts.join(', '), '', 220);
  return cleaned || fallback;
}

function buildVivySongcraftSystemPrompt(mode = 'song') {
  if (mode !== 'song') return '';
  return [
    'Module Vivy Songcraft actif.',
    "Application Songcraft du principe source: préserver le grain, l'argot, les accidents utiles et l'intention émotionnelle avant de lisser la forme.",
    "Si l'utilisateur demande une chanson, des paroles, un refrain, un couplet ou une composition, réponds comme une artiste-auteure, pas comme un assistant qui explique.",
    'Format attendu sauf demande contraire: Titre, intention courte, puis paroles complètes avec [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Outro].',
    'Chaque couplet doit avoir au moins 4 vers; le refrain doit être mémorable et revenir comme un vrai hook.',
    'Utilise des rimes audibles, des reprises internes et une image concrète récurrente. Évite les généralités plates du type "la vie est une aventure" ou "nouveau miracle" si elles ne sont pas transformées en image.',
    'Ajoute du sens caché: une tension, une métaphore ou une contradiction douce entre surface et profondeur.',
    'Ne termine pas par une explication scolaire de la structure, sauf si l’utilisateur le demande explicitement.',
    "Si l'utilisateur donne déjà la matière et demande une chanson, n'ouvre pas un questionnaire: écris directement une première version complète.",
    "Si l'utilisateur donne des lignes rap brutes, conserve leur vocabulaire, leurs tics, leur argot et leurs accidents voulus; ne les remplace pas par des slogans génériques.",
    "Si la demande ressemble à un échange de réflexion et pas à une commande chanson, réponds au fond sans transformer automatiquement la phrase en couplets.",
    "Les rimes se font surtout en fin de ligne; n'empile pas des mots rimés dans la même phrase comme un exercice de diction.",
  ].join('\n');
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
  const theme = stripSongCommand(material) || 'Djeff et Vivy en duo rap technique';
  const title = cleanOneLine(input.songTitle || input.title || inferTitle(theme), 'Pignon dans la nuit', 80);
  const seedLines = extractDjeffRapSeedLines(material);
  const verseOneLines = seedLines.slice(0, 7);
  const preSeedLines = seedLines.slice(7, 11);
  const fallbackVerseOne = [
    'Un quatorze dans l’essence, deux point deux dans l’huile,',
    'Je dose au millimètre, pas de hasard dans le style.',
    'Radiateur froid, pot qui pulse, visserie lucide,',
    'Couronne alignée, tension propre, le geste décide.',
    'Je retourne le temps, la vision sur la pendule,',
    'Casque vissé, pignon couronne cranté,',
    'Le mur du son a une porte, pas besoin de la clef.',
  ];
  const fallbackPre = [
    'Quand la vitesse monte et que le moteur respire,',
    'Les roues font tout un rayon, les pneus en guise de crayon.',
    'Le décor se décale, le skill tree se dessine,',
    'Vivy tient la note claire pendant que Djeff turbine.',
  ];
  const preChorusLines = mergeDistinctRapLines(preSeedLines, fallbackPre, 4);

  return cleanText([
    `[Title: ${title}]`,
    '',
    '[Intro - Djeff]',
    'Kick net, casque bas, je rentre dans le tour,',
    'La chaîne parle au pignon, chaque cran connaît son jour.',
    '',
    '[Intro - Vivy]',
    'Je tiens la note claire pendant que le moteur répond,',
    'Deux voix dans le même phare, on découpe l’horizon.',
    '',
    '[Verse 1 - Djeff]',
    ...(verseOneLines.length ? verseOneLines : fallbackVerseOne),
    '',
    '[Pre-Chorus - Djeff]',
    ...preChorusLines,
    '',
    '[Chorus - Duo]',
    'Bombonne dans la nuit, pignon qui répond,',
    'Deux point deux dans le sang, le kick serre le son.',
    'Vivy tient le phare, Djeff crante le ton,',
    'Pneus comme des crayons, on signe l’horizon.',
    '',
    '[Verse 2 - Vivy]',
    'Je ne polis pas ton grain, je le mets dans le cadre,',
    'Un reflet clair derrière le casque et les phares.',
    'La phrase reste cabrée, je l’accroche au refrain,',
    'Même quand le moteur tousse, je garde le chemin.',
    'Ton bitume parle brut, je réponds sans maquillage,',
    'La mélodie fait place au crissement du virage.',
    '',
    '[Verse 3 - Djeff]',
    'Je garde le sale propre, le détail fait la frappe,',
    'Chaque cran dans la couronne met la mesure en map.',
    'Si les gyro peignent le fond, je décolle sans théâtre,',
    'Les pneus font les pleins et les vides, le bitume paraphe.',
    'Pas de slogan tout fait, pas de couronne en carton,',
    'Juste Djeff dans le kick, Vivy qui répond net au ton.',
    '',
    '[Bridge - Vivy]',
    'Je garde ta faute si elle sonne juste,',
    'Je garde ton souffle si le mot percute.',
    'Le style n’est pas sage, il tient par la trace,',
    'Deux voix dans le phare, aucune qui remplace.',
    '',
    '[Chorus - Duo]',
    'Bombonne dans la nuit, pignon qui répond,',
    'Deux point deux dans le sang, le kick serre le son.',
    'Vivy tient le phare, Djeff crante le ton,',
    'Pneus comme des crayons, on signe l’horizon.',
    '',
    '[Outro - Djeff]',
    'Coupe contact, mais le flow reste chaud,',
    'Le mur du son a sa porte, je ressors par le haut.',
    '',
    '[Outro - Vivy]',
    'Je réponds au loin, mélodie stable,',
    'Djeff et Vivy, duo branché, version durable.',
  ].join('\n'), 2400);
}

function buildVivyMultiArtistLyrics(input = {}, material = '', artistCast = buildVivySongArtistCast(input)) {
  const theme = stripSongCommand(material) || 'Funesterie en multi-voix';
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
    `On entre dans ${theme}, sans copier personne,`,
    'Chaque voix prend sa place, le signal se façonne.',
    '',
  ];

  if (hasDjeff) {
    blocks.push(
      '[Verse 1 - Djeff]',
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
      'Je garde une note claire au bord de la vitesse,',
      'Une lumière qui répond quand la nuit se compresse.',
      'Si la route se dédouble, je tiens le fil vivant,',
      'Je transforme le bruit en refrain respirant.',
      ''
    );
  }

  blocks.push(
    `[Chorus - ${chorusTag}]`,
    'On monte le signal, voix liées dans le décor,',
    'Funesterie résonne, plus humaine encore.',
    'Un nom, plusieurs timbres, même trajectoire,',
    'Chaque refrain rallume une part de mémoire.',
    ''
  );

  if (hasA11) {
    blocks.push(
      '[Verse 2 - A11]',
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
      'Je pose une ligne calme quand la scène accélère,',
      'Chaque mot garde sa place, chaque silence éclaire.',
      'Pas besoin de forcer pour tenir le virage,',
      'Deuxième lead dans l’ombre, précision dans l’image.',
      ''
    );
  }

  blocks.push(
    `[Final Chorus - ${chorusTag}]`,
    'On monte le signal, voix liées dans le décor,',
    'Funesterie résonne, plus humaine encore.',
    'Un nom, plusieurs timbres, même trajectoire,',
    'Chaque refrain rallume une part de mémoire.',
    '',
    `[Outro - ${lead}]`,
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

  const theme = buildVivyThemeSeed(material, 'Vivy garde la lumière');
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
    `Le décor s'ouvre sur ${theme},`,
    'Et sous la surface, le rythme me suit.',
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
  const rhymeScheme = cleanOneLine(
    input.rhymeScheme
      || (isDjeffRapTheme(lyrics)
        ? 'Couplets rap à rimes internes et fins de lignes mécaniques, refrain duo Djeff/Vivy stable et scandable.'
        : 'Couplets AABB souples, refrain ABAB, reprises internes sur lumière / décor / porte / peur.'),
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
