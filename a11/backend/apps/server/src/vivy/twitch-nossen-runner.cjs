const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const {
  buildRealMusicForProduction,
  buildVivyAiChat,
  buildVivyNossenIntentPlan,
  buildVivyNossenRoutingPlan,
  getVivyMusicJob,
  requestSunoMusicExtension,
  masterVivyMusicFile,
} = require('../routes/vivy-studio.cjs');
const {
  finalizeTwitchFullSongClip,
  isTwitchFullClipEnabled,
  prepareTwitchFullSongClip,
} = require('./twitch-clip-director.cjs');
const {
  appendVivyVisualIdentityBrief,
  buildVivyVisualIdentityPack,
  buildVivyVisualNegativeIdentityPrompt,
  resolveVivyVisualFocus,
} = require('./visual-identities.cjs');
const { isCoverTextStampEnabled, stampCoverText } = require('./cover-text-stamp.cjs');
const { uploadBufferToR2 } = require('../../lib/file-storage.cjs');
const { pickVivyOutfitBrief } = require('./wardrobe.cjs');

const execFileAsync = promisify(execFile);
const DEFAULT_TARGET_DURATION_SECONDS = 210;
const DEFAULT_MIN_ACCEPTABLE_SECONDS = 150;
const DEFAULT_SHORT_MIX_ACCEPT_SECONDS = 120;
const DEFAULT_HARD_MIN_ACCEPTABLE_SECONDS = 60;
const DEFAULT_DYNAMIC_MIN_TARGET_SECONDS = 150;
const DEFAULT_DYNAMIC_MAX_TARGET_SECONDS = 360;
const DEFAULT_LONG_TARGET_SECONDS = 300;
const DEFAULT_NO_LIMIT_TARGET_SECONDS = 330;
const DEFAULT_MAX_EXTENSIONS = 3;
const DEFAULT_POLL_ATTEMPTS = 60;
const DEFAULT_POLL_INTERVAL_MS = 10000;
const DEFAULT_FULL_CLIP_READY_WAIT_MS = 90_000;

function cleanText(value = '', fallbackOrMax = 6000, maybeMax = 6000) {
  const fallback = typeof fallbackOrMax === 'string' ? fallbackOrMax : '';
  const max = typeof fallbackOrMax === 'number' ? fallbackOrMax : maybeMax;
  const cleaned = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return cleaned || fallback;
}

function foldForVisualLookup(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function cleanLyrics(value = '', max = 12000) {
  return String(value || '')
    .normalize('NFC')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

function countMeaningfulTwitchWords(value = '') {
  return cleanText(value, '', 800)
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}'’-]+/gu, '').trim())
    .filter((word) => word.length >= 2).length;
}

function resolveFullClipReadyWaitMs(env = process.env) {
  const raw = Number(env.VIVY_STREAM_FULL_CLIP_READY_WAIT_MS || env.VIVY_STREAM_FULL_CLIP_WAIT_TIMEOUT_MS || 0);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(5_000, Math.min(15 * 60 * 1000, Math.round(raw)));
  }
  return DEFAULT_FULL_CLIP_READY_WAIT_MS;
}

function resolveTwitchFullClipSourceImageUrl(env = process.env) {
  const raw = cleanText(
    env.VIVY_STREAM_FULL_CLIP_SOURCE_IMAGE_URL
    || env.VIVY_STREAM_DREAMCLIP_SOURCE_IMAGE_URL
    || '',
    '',
    1200
  );
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw;
}

function extractCleanTwitchLyricsBlock(value = '', max = 12000) {
  const text = cleanLyrics(value, max);
  if (!text) return '';

  const tagged = text.match(/<\s*(?:clean_lyrics|paroles_propres|paroles)\s*>\s*([\s\S]*?)\s*<\s*\/\s*(?:clean_lyrics|paroles_propres|paroles)\s*>/i);
  if (tagged?.[1]) return cleanLyrics(tagged[1], max);

  const labeled = text.match(
    /(?:^|\n)\s*(?:CLEAN[_\s-]?LYRICS|PAROLES[_\s-]?PROPRES|PAROLES\s+FINALES|LYRICS)\s*:?\s*\n([\s\S]*?)(?=\n\s*(?:SUNO[_\s-]?STYLE[_\s-]?BRIEF|STYLE[_\s-]?BRIEF|BRIEF[_\s-]?SUNO|MUSIC[_\s-]?STYLE|PROMPT[_\s-]?SUNO|NEGATIVE[_\s-]?PROMPT)\s*:|$)/i
  );
  if (labeled?.[1]) {
    return cleanLyrics(labeled[1]
      .replace(/^\s*```(?:text|lyrics|paroles)?\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, ''), max);
  }

  const fencedBlocks = Array.from(text.matchAll(/```(?:text|lyrics|paroles)?\s*\n([\s\S]*?)```/gi));
  for (const block of fencedBlocks) {
    if (/\[(?:intro|verse|couplet|pre[-\s]?chorus|pr[ée][- ]?refrain|chorus|refrain|bridge|pont|outro|final)/i.test(block[1] || '')) {
      return cleanLyrics(block[1], max);
    }
  }

  return text
    .replace(/^\s*```(?:text|lyrics|paroles)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '');
}

async function withTimeout(factory, timeoutMs = 120000, label = 'operation') {
  let timeout = null;
  try {
    return await Promise.race([
      Promise.resolve().then(factory),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function jaccardSimilarity(a = '', b = '') {
  const toWords = (value) => new Set(foldTwitchLyricText(value)
    .split(/\s+/)
    .filter((word) => word.length >= 3));
  const left = toWords(a);
  const right = toWords(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const word of left) {
    if (right.has(word)) intersection += 1;
  }
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function resolveTwitchCreativePlaceholders(value = '') {
  const source = cleanText(value, '', 6000);
  if (!/\[(?:titre|id[ée]e|sujet|qui|o[uù]|probl[èe]me|style|morale|th[èe]me)\]/i.test(source)) return source;
  return cleanText([
    source
      .replace(/\[titre\]/gi, 'Carte blanche: Vivy invente un titre concret et original')
      .replace(/\[id[ée]e\]/gi, 'une morale cachée adulte et originale choisie par Vivy')
      .replace(/\[sujet\]|\[th[èe]me\]/gi, 'un sujet concret et inédit choisi par Vivy')
      .replace(/\[qui\]/gi, 'un personnage précis inventé par Vivy')
      .replace(/\[o[uù]\]/gi, 'un lieu concret inventé par Vivy')
      .replace(/\[probl[èe]me\]/gi, 'un conflit comique précis inventé par Vivy')
      .replace(/\[style\]/gi, 'un style musical cohérent choisi par Vivy')
      .replace(/\[morale\]/gi, 'une morale cachée choisie par Vivy'),
    'Les crochets étaient des champs de modèle, pas des mots à chanter. Carte blanche: invente maintenant une prémisse précise, un décor, des personnages, un tabou central et une chute finale. N’utilise aucun ancien thème par défaut.',
  ].join('. '), '', 6000);
}

function extractTwitchMusicProviderDirective(value = '') {
  const source = cleanText(value, '', 6000);
  const match = source.match(/^\s*(?:\[\s*)?(suno|mureka|elevenlabs)\s*\]\s*/i);
  if (!match) return { provider: '', text: source };
  return {
    provider: match[1].toLowerCase(),
    text: cleanText(source.slice(match[0].length), '', 6000),
  };
}

function extractTitleFromLyrics(lyrics = '') {
  const text = cleanLyrics(lyrics, 1600);
  const titleMatch = text.match(/^\s*\[\s*(?:title|titre)\s*:\s*([^\]\n]+)\s*\]/im);
  if (titleMatch?.[1]) return cleanText(titleMatch[1], '', 90);
  const firstHeader = text.match(/^\s*(?:#{1,3}\s*)?["“]?([^\n\[\]]{4,90})["”]?\s*$/m);
  if (firstHeader?.[1] && !/\b(?:intro|verse|couplet|refrain|chorus|pont|bridge|outro)\b/i.test(firstHeader[1])) {
    return cleanText(firstHeader[1], '', 90);
  }
  return '';
}

function buildTwitchPublicTrackTitle(winnerOrText = '', lyrics = '') {
  const source = cleanText(
    typeof winnerOrText === 'object' ? winnerOrText.text : winnerOrText,
    '',
    6000
  );
  const lyricTitle = extractTitleFromLyrics(lyrics);
  const placeholderLike = /^\s*\[[^\]]+\]/.test(source)
    || /\b(?:carte\s+blanche|Vivy\s+invente\s+un\s+titre|champs?\s+de\s+mod[eè]le)\b/i.test(source);
  if (placeholderLike && lyricTitle) return cleanText(lyricTitle, 'Nouvelle composition Vivy', 90);

  const cleanSource = source
    .replace(/^\s*["“”']+|["“”']+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const firstSplit = cleanSource.match(/^(.{4,90}?)([,.;:–—])\s+(.+)$/);
  if (firstSplit) {
    const head = cleanText(firstSplit[1], '', 90);
    const tail = cleanText(firstSplit[3], '', 600);
    const descriptorTail = /\b(?:chanson|banger|style|ambiance|version|g[ée]n[ée]rique|opening|duo|solo|voix|paroles|couplet|refrain|pont|morale|surface|sous[-\s]?texte|double\s+sens|m[ée]taphore|all[ée]gorie|funk|rock|pop|rap|trap|cabaret|paillard|[ée]lectro|electro|synth|drums?|guitare|basse|choeurs?|chœurs?|prompt)\b/i.test(tail);
    if (descriptorTail && head.length >= 4) return head;
  }
  if (lyricTitle && cleanSource.length > 120) return cleanText(lyricTitle, 'Nouvelle composition Vivy', 90);
  return cleanText(cleanSource, 'Nouvelle composition Vivy', 90);
}

function buildTwitchEmergencyLyrics({
  winner = {},
  routing = {},
  seed = {},
  intentPlan = {},
  lyricScope = {},
  artists = [],
} = {}) {
  const subject = cleanText(typeof winner === 'object' ? winner.text : winner, 'Nouvelle chanson Vivy', 1800);
  const title = buildTwitchPublicTrackTitle(subject);
  const context = cleanText([
    subject,
    routing?.songMood,
    seed?.canvas,
    seed?.notes,
    intentPlan?.generationBrief,
    Array.isArray(artists) && artists.length ? `Voix: ${artists.join(' + ')}` : '',
  ].filter(Boolean).join('\n'), '', 2400);
  const folded = foldTwitchLyricText(context);
  const max = Math.max(1800, Math.min(12000, Number(lyricScope?.maxChars || 5200) || 5200));

  if (/\b(?:carmelo|boxster)\b/.test(folded)) {
    return cleanLyrics(`
[Intro]
Gyros bleus dans le rétro, Porsche grise sous les néons
Djeff tient la trajectoire, Jean sourit dans la pression

[Verse 1]
Les poulets veulent le cuire, le passer dans leur bouillon
Il veille au grain, garde la sauce et refuse la cuisson
Je calcule l’angle au virage, tangente sur le bitume
Parabole au-dessus du pont, le moteur fend la brume

[Pre-Chorus]
Sirènes à pleine gorge, elles promettent des frissons
Jean pêche la faille au filet, Djeff garde la direction

[Chorus]
Y'a Carmelo
Y'a Carmelo
Y'a Carmelo
La Boxster mord la nuit, personne ne tient le tempo

[Verse 2]
Ils veulent faire un pot-au-feu d’un roi du volant
Mais la route prend du plaisir quand il dompte le tournant
Les courbes parlent en silence, les phares tracent l’équation
Une dérivée de folie, puis la fuite en solution

[Pre-Chorus]
Les sirènes font les belles, les poulets montent le son
On garde la pêche au ventre et la ligne à l’horizon

[Chorus]
Y'a Carmelo
Y'a Carmelo
Y'a Carmelo
La Boxster mord la nuit, personne ne tient le tempo

[Bridge]
Le pont se lève devant nous comme un défi de cinéma
Jean rit côté passager, Djeff ne ralentit pas
La ville retient son souffle, les gyrophares décrochent
On saute la dernière casserole, la liberté dans les poches

[Final Chorus]
Y'a Carmelo
Y'a Carmelo
Y'a Carmelo
Au-dessus du pont, la lune applaudit le héros

[Outro]
Quand le moteur redescend, il reste un goût de fête
Jean rentre avec la pêche et le ciel sur la veste
`, max);
  }

  const scene = cleanText(title || subject, 'La scène recommence', 110);
  const firstImage = cleanText(subject.split(/[.!?\n]/)[0] || scene, scene, 150);
  return cleanLyrics(`
[Intro]
${scene}, la lumière revient dans le décor
Une idée prend la route et refuse de dormir encore

[Verse 1]
${firstImage}
Le premier pas tremble un peu mais garde sa couleur
Les doutes font du bruit, les murs changent de visage
On serre le fil vivant qui traverse l’orage

[Pre-Chorus]
Tout pourrait s’éteindre, tout pourrait tomber
Mais quelque chose répond quand la voix se remet

[Chorus]
On avance encore, on rallume le signal
Ce qui pesait hier devient rythme vital
On avance encore, debout dans l’étincelle
Même les erreurs finissent par ouvrir le ciel

[Verse 2]
La scène se précise, chaque détail choisit sa place
Le cœur prend le tempo, la peur perd sa menace
Un geste devient promesse, un silence devient feu
On transforme le détour en chemin lumineux

[Bridge]
Au moment de céder, la chanson change de main
Elle garde la blessure mais refuse le destin

[Final Chorus]
On avance encore, on rallume le signal
Ce qui pesait hier devient rythme vital
On avance encore, plus fort dans l’étincelle
La dernière image monte et traverse le ciel

[Outro]
La voix reste debout quand le noir se retire
`, max);
}

function normalizeLyricLineForRepeat(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reduceMechanicalLyricRepeats(lyrics = '') {
  const lines = cleanLyrics(lyrics).split('\n');
  const seen = new Map();
  const kept = [];
  let currentSection = '';
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      currentSection = line;
      kept.push(line.trim());
      continue;
    }
    if (!line.trim()) {
      if (kept.at(-1) !== '') kept.push('');
      continue;
    }
    const key = normalizeLyricLineForRepeat(line);
    if (key.length < 18) {
      kept.push(line);
      continue;
    }
    const isChorus = /\[(?:chorus|refrain|final\s+chorus|refrain\s+final)[^\]]*\]/i.test(currentSection);
    const allowedRepeats = isChorus ? 3 : 1;
    const count = seen.get(key) || 0;
    if (count >= allowedRepeats) continue;
    seen.set(key, count + 1);
    kept.push(line);
  }
  return cleanLyrics(kept.join('\n'));
}

function extractLyricEndWord(line = '') {
  const match = String(line || '').trim().match(/[\p{L}\p{N}'’.-]+$/u);
  return match ? match[0] : '';
}

function normalizeFrenchRhymeKey(word = '') {
  let value = String(word || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!value) return '';

  value = value
    .replace(/(eaux|eau|aux|au)$/i, 'o')
    .replace(/(ait|ais|aient|er|ez|ee|ees|es|e)$/i, 'e')
    .replace(/(ain|ein|aim|in|im)$/i, 'in')
    .replace(/(ant|ent|an|en)$/i, 'an')
    .replace(/(on|om)$/i, 'on');

  if (value.length > 4) value = value.replace(/(?:s|x)$/i, '');
  const lastVowel = Math.max(
    value.lastIndexOf('a'),
    value.lastIndexOf('e'),
    value.lastIndexOf('i'),
    value.lastIndexOf('o'),
    value.lastIndexOf('u'),
    value.lastIndexOf('y')
  );
  const tail = lastVowel >= 0 ? value.slice(lastVowel) : value.slice(-3);
  return tail.length >= 2 ? tail.slice(-5) : value.slice(-3);
}

function rhymeKeysMatch(a = '', b = '') {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.endsWith(b) || b.endsWith(a))) return true;
  return a.length >= 3 && b.length >= 3 && a.slice(-3) === b.slice(-3);
}

function assessTwitchRhymeSignals(lyrics = '') {
  const sections = parseLyricSections(lyrics);
  let opportunities = 0;
  let matches = 0;

  for (const section of sections) {
    const header = section.header || '';
    if (/\[(?:intro|outro)[^\]]*\]/i.test(header)) continue;
    const lines = section.text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^\[[^\]]+\]$/.test(line));
    if (lines.length < 4) continue;

    for (let index = 0; index + 3 < lines.length; index += 4) {
      const keys = lines.slice(index, index + 4)
        .map((line) => normalizeFrenchRhymeKey(extractLyricEndWord(line)));
      if (keys.some((key) => key.length < 2)) continue;
      opportunities += 2;
      const aabb = (rhymeKeysMatch(keys[0], keys[1]) ? 1 : 0)
        + (rhymeKeysMatch(keys[2], keys[3]) ? 1 : 0);
      const abab = (rhymeKeysMatch(keys[0], keys[2]) ? 1 : 0)
        + (rhymeKeysMatch(keys[1], keys[3]) ? 1 : 0);
      matches += Math.max(aabb, abab);
    }
  }

  const needed = opportunities >= 4 ? Math.max(2, Math.ceil(opportunities * 0.28)) : 0;
  return {
    valid: opportunities < 4 || matches >= needed,
    matches,
    opportunities,
    needed,
    ratio: opportunities ? Number((matches / opportunities).toFixed(2)) : 1,
  };
}

function parseLyricSections(lyrics = '') {
  const sections = [];
  let header = '';
  let lines = [];
  const flush = () => {
    const text = [header, ...lines].filter(Boolean).join('\n').trim();
    const body = lines.join('\n').replace(/\s+/g, ' ').trim();
    if (text && body) sections.push({ header, text, body });
    header = '';
    lines = [];
  };
  for (const rawLine of cleanLyrics(lyrics).split('\n')) {
    const line = rawLine.trimEnd();
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      flush();
      header = line.trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function buildVocalExtensionPrompt(lyrics = '', options = {}) {
  const cleaned = cleanLyrics(lyrics);
  const targetDurationSeconds = Number(options.targetDurationSeconds || 0);
  const durationSeconds = Number(options.durationSeconds || 0);
  const extensionIndex = Math.max(1, Number(options.extensionIndex || 1) || 1);
  const maxExtensions = Math.max(extensionIndex, Number(options.maxExtensions || extensionIndex) || extensionIndex);
  const maxChars = Math.max(600, Math.min(2600, Number(options.maxChars || 1800) || 1800));
  if (!cleaned) return '';

  const ratio = targetDurationSeconds > 0 && Number.isFinite(durationSeconds)
    ? Math.max(0, Math.min(0.92, durationSeconds / targetDurationSeconds))
    : Math.min(0.75, extensionIndex / (maxExtensions + 1));
  const sections = parseLyricSections(cleaned);
  if (sections.length < 3) {
    const lines = cleaned.split('\n').filter((line) => line.trim());
    const start = Math.max(0, Math.floor(ratio * lines.length) - 3);
    return cleanLyrics(reduceMechanicalLyricRepeats(lines.slice(start).join('\n')), maxChars);
  }

  let startIndex = Math.max(0, Math.floor(ratio * sections.length) - 1);
  if (extensionIndex > 1) startIndex = Math.max(startIndex, Math.floor(sections.length * 0.45));
  if (extensionIndex >= maxExtensions) startIndex = Math.max(startIndex, Math.floor(sections.length * 0.62));
  if (durationSeconds >= 210) startIndex = Math.max(startIndex, Math.floor(sections.length * 0.58));
  if (durationSeconds >= 260) startIndex = Math.max(startIndex, Math.floor(sections.length * 0.72));
  startIndex = Math.min(startIndex, sections.length - 1);

  const selected = [];
  const selectedBodies = new Set();
  let totalChars = 0;
  for (let index = startIndex; index < sections.length; index += 1) {
    const section = sections[index];
    const bodyKey = normalizeLyricLineForRepeat(section.body || section.text);
    if (bodyKey.length >= 18 && selectedBodies.has(bodyKey)) continue;
    const nextChars = section.text.length + 2;
    if (selected.length >= 2 && totalChars + nextChars > maxChars) break;
    selected.push(section.text);
    if (bodyKey.length >= 18) selectedBodies.add(bodyKey);
    totalChars += nextChars;
  }

  const finalIndex = sections.findIndex((section, index) => (
    index >= startIndex
    && /\[(?:final|dernier|outro|bridge|pont|mont[eé]e|final build|final chorus|refrain final)[^\]]*\]/i.test(section.header)
  ));
  if (finalIndex >= 0 && !selected.includes(sections[finalIndex].text)) {
    const bodyKey = normalizeLyricLineForRepeat(sections[finalIndex].body || sections[finalIndex].text);
    if (bodyKey.length < 18 || !selectedBodies.has(bodyKey)) selected.push(sections[finalIndex].text);
  }

  return cleanLyrics(selected.join('\n\n'), maxChars);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTrustedTwitchRequest() {
  return {
    protocol: 'https',
    headers: { host: 'vivy.funesterie.me' },
    user: {
      id: 'vivy-twitch-live',
      username: 'vivy-twitch-live',
      role: 'founder',
      tier: 'founder',
      isAdmin: true,
    },
    get(name = '') {
      const key = String(name || '').toLowerCase();
      if (key === 'host' || key === 'x-forwarded-host') return 'vivy.funesterie.me';
      if (key === 'x-forwarded-proto') return 'https';
      return '';
    },
  };
}

function getMusicTaskId(value = {}) {
  return cleanText(
    value?.taskId
    || value?.jobId
    || value?.mediaStatus?.taskId
    || value?.musicJob?.taskId
    || value?.media?.taskId,
    160
  );
}

function getSunoAudioId(value = {}) {
  return cleanText(
    value?.audioId
    || value?.audio_id
    || value?.id
    || value?.media?.audioId
    || value?.media?.audio_id
    || value?.media?.id
    || value?.musicJob?.audioId
    || value?.musicJob?.audio_id
    || value?.musicJob?.media?.audioId
    || value?.musicJob?.media?.audio_id
    || value?.musicJob?.media?.id,
    180
  );
}

function getSunoModel(value = {}, fallback = '') {
  return cleanText(
    value?.model
    || value?.media?.model
    || value?.musicJob?.model
    || value?.musicJob?.media?.model
    || fallback,
    80
  );
}

function getReadyMedia(value = {}) {
  const media = value?.media?.url || value?.media?.audioUrl || value?.media?.audio_url
    ? value.media
    : value?.url || value?.audioUrl || value?.audio_url
      ? value
      : null;
  if (!media) return null;
  const url = cleanText(media.audioUrl || media.audio_url || media.downloadUrl || media.url, 1200);
  if (!url) return null;
  return {
    ...media,
    url,
    durationSeconds: Number(
      media.durationSeconds
      || media.duration
      || value?.durationSeconds
      || value?.duration
      || 0
    ) || 0,
  };
}

function isExternalMediaUrl(url = '') {
  return /^https?:\/\//i.test(cleanText(url, '', 1200));
}

function isLocalVivyMediaUrl(url = '') {
  const value = cleanText(url, '', 1200);
  return /^\/api\/vivy\/studio\/assets\//i.test(value)
    || /^\/api\/double-harmonic\/out\//i.test(value)
    || /^https?:\/\/vivy\.funesterie\.me\/api\/vivy\/studio\/assets\//i.test(value)
    || /^https?:\/\/vivy\.funesterie\.me\/api\/double-harmonic\/out\//i.test(value);
}

function resolvePublicMediaUrl(url = '', req = null) {
  const value = cleanText(url, '', 1200);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith('/')) return '';
  const host = cleanText(
    req?.get?.('x-forwarded-host') || req?.get?.('host') || req?.headers?.host || 'vivy.funesterie.me',
    'vivy.funesterie.me',
    180
  ).split(',')[0];
  const proto = cleanText(
    req?.get?.('x-forwarded-proto') || req?.protocol || 'https',
    'https',
    24
  ).split(',')[0];
  try {
    return new URL(value, `${proto}://${host}/`).toString();
  } catch {
    return '';
  }
}

function isTwitchCoverEnabled() {
  return String(process.env.VIVY_STREAM_COVER_ENABLED ?? '1').trim() === '1';
}

function isTwitchClipEnabled() {
  return String(process.env.VIVY_STREAM_CLIP_ENABLED ?? '1').trim() === '1';
}

function stripCoverTitleFromVisualIdea(title = '', idea = '') {
  const cleanedIdea = cleanText(idea, '', 900);
  const cleanedTitle = cleanText(title, '', 180);
  if (!cleanedIdea || !cleanedTitle) return cleanedIdea;
  const escapedTitle = cleanedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let stripped = cleanedIdea
    .replace(new RegExp(`(^|[\\s,;:.-])${escapedTitle}([\\s,;:.-]|$)`, 'gi'), ' ')
    .replace(/\b(?:titre|title)\s*[:=-]\s*["“”'`]*[^,;.\n]+[,;.\n]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length >= 24) return stripped;
  return [
    'scène symbolique issue du thème, sans aucune inscription visible',
    stripped,
  ].filter(Boolean).join(': ');
}

function sanitizeCoverVisualIdea(title = '', idea = '') {
  let result = stripCoverTitleFromVisualIdea(title, idea)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/«[^»]*»/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/\b(?:refrain|hook|paroles?|lyrics?|couplet|verse|pont|bridge|intro|outro)\b[^:.;!?]{0,60}[:=-]\s*[^.;!?]*/gi, ' ')
    .replace(/:\s*/g, '. ')
    .replace(/\s*\.\s*\.+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
  const folded = foldForVisualLookup(result);
  if (!/\b(enfant|petite fille|fillette|adolescente|ado|jeune fille mineure)\b/.test(folded)) {
    result = result.replace(/\bune fille\b/gi, 'une jeune femme adulte');
  }
  return cleanText(result.replace(/^(?:et|puis|qui|mais)\s+/i, ''), '', 700);
}

function buildTwitchCoverPrompt(input = {}) {
  const title = cleanText(input.publicTitle || input.title, 'Nouvelle composition Vivy', 140);
  const idea = cleanText(input.winner?.text || input.idea, '', 900)
    .replace(/^\s*!(?:vivy|nossen|chanson|song|th[eè]me|idee|idée)\b[\s:,-]*/i, '');
  const mood = cleanText(input.routing?.songMood || input.styleBrief || '', '', 700);
  const intent = cleanText(input.intentPlan?.generationBrief || input.intentPlan?.reason || '', '', 500);
  const subjectGuidance = cleanText(input.subjectFrame?.guidance, '', 700);
  const visualFocus = resolveVivyVisualFocus(input);
  const visualLookup = foldForVisualLookup(`${title} ${idea} ${mood} ${intent}`);
  const winkRequested = /\bclin\s*d\s*['’]?\s*oeil\b|\bwink\b/.test(visualLookup);
  const wantsSpaceCorsair = /\b(pirate|corsaire|drapeau noir|voiles?)\b/.test(visualLookup)
    && /\b(espace|interstellaire|planete|planetes|etoile|etoiles|cosmique|galaxie|galactique)\b/.test(visualLookup);
  const visualIdea = wantsSpaceCorsair
    ? 'Corsaire spatial original qui défie un empire galactique pour rendre liberté et ressources vitales aux colonies oubliées; justice lumineuse, drapeau noir symbolique, équipage rebelle, silhouette héroïque, vaisseau stellaire à ailes solaires noires.'
    : sanitizeCoverVisualIdea(title, idea);
  const promptParts = [
    'Image cinéma 16:9 pour une chanson originale diffusée dans une émission musicale Funesterie, pensée comme un plan de clip et pas comme une affiche.',
    'Le titre reste strictement privé et sera ajouté séparément par l’overlay Twitch: ne produire aucun mot, même déformé, stylisé, gravé, peint, flou ou suggéré par des lettres.',
    visualIdea ? `Idée à représenter uniquement par action, décor, lumière, objet et personnage, sans aucun mot écrit: ${visualIdea}.` : '',
    subjectGuidance ? `Lecture sémantique obligatoire: ${subjectGuidance}` : '',
    mood ? `Ambiance musicale: ${mood}.` : '',
    intent ? `Intention visuelle: ${intent}.` : '',
    winkRequested
      ? 'Expression du personnage: clin d’œil complice — un seul œil fermé, l’autre grand ouvert et expressif, sourire malicieux; visage net et naturel, aucune déformation, aucun strabisme.'
      : '',
    visualFocus.prompt,
  ].filter(Boolean);
  appendVivyVisualIdentityBrief(promptParts, input);
  promptParts.push(...[
    visualFocus.nonHumanFocus
      ? 'Motifs visuels à privilégier: le sujet non humain du titre, son décor, le conflit symbolique, des accessoires lisibles et une chute comique visuelle; éviter les corps humains et les scènes charnelles.'
      : 'Motifs visuels à privilégier: gestes lisibles, objets symboliques, décor émotionnel, lumière narrative, silhouettes et mouvement; ne jamais transformer les paroles en affiche, sous-titre ou calligraphie.',
    wantsSpaceCorsair
      ? 'Direction visuelle spéciale: space opera rétro adulte, corsaire spatial original non reconnaissable, capitaine sombre à la proue d’un vaisseau spatial cuirassé avec ailes ou panneaux solaires noirs, nébuleuse profonde, colonies stellaires lointaines, drapeau noir symbolique, lumière dramatique, gravité héroïque, affiche d’album électro-rock interstellaire. Interdits visuels: aucun océan, aucune mer, aucun voilier terrestre, aucune vague, aucune scène nautique, aucun décor fantasy enfantin.'
      : '',
    'Créer une scène forte et lisible, cinématique, expressive, avec un sujet principal clair et une couleur émotionnelle nette; aucune zone ne doit ressembler à un cartouche de titre, une affiche, une bannière ou une interface.',
    'Budget de complexité visuelle strict: un seul sujet détaillé au premier plan, trois personnages détaillés maximum. Toute foule ou armée reste à distance sous forme de silhouettes simples et cohérentes.',
    'Anatomie et accessoires obligatoirement complets: tête, torse, bras et jambes reliés naturellement; aucune main, jambe, tête ou silhouette détachée. Si un instrument est visible, il appartient physiquement à un musicien complet qui le tient de façon crédible; aucun instrument flottant, fusionné au corps ou masquant un torse absent.',
    'Si un microphone est visible, choisir une interaction anatomique sans ambiguïté: soit il repose seul sur un pied stable et les deux mains restent entièrement visibles ailleurs, soit une main complète à cinq doigts entoure clairement son manche avec paume, poignet et avant-bras continus. Le microphone ne doit jamais remplacer, cacher, couper ou fusionner avec la main.',
    'Les coupes de cadrage ne sont autorisées qu’aux bords de l’image. Aucun corps central ne doit être coupé, amputé, caché par un objet incohérent ou réduit à des membres isolés.',
    'Style key visual de clip musical premium, cinématique adulte, composition propre, profondeur, lumière travaillée, détails riches, contraste maîtrisé, pas une affiche typographique et pas une illustration générique.',
    'Éviter absolument: dessin enfantin, cartoon mignon, livre scolaire, jouet, mascotte, rendu plastique, image plate, coloriage, personnage naïf.',
    'Aucun texte dans l’image: pas de titre, pas de paroles, pas de faux titre, pas de paragraphes, pas de liste, pas de typographie décorative, pas de pseudo-écriture, pas de glyphes illisibles, pas de panneau, pas d’écran lisible, pas de panneau UI; le titre et les infos seront ajoutés par l’overlay Twitch.',
    'Aucun logo, aucune marque, aucun personnage sous copyright reconnaissable, pas de célébrité, pas de copie de style ou personnage existant.',
  ].filter(Boolean));
  return cleanText(promptParts.join(' '), '', 4200);
}

function buildTwitchCoverNegativePrompt(input = {}, prompt = '') {
  const lookup = foldForVisualLookup(`${prompt} ${input.publicTitle || input.title || ''} ${input.winner?.text || input.idea || ''}`);
  const visualFocus = resolveVivyVisualFocus(input);
  const base = [
    'text',
    'logo',
    'watermark',
    'subtitles',
    'UI',
    'messy typography',
    'fake text',
    'gibberish text',
    'pseudo-writing',
    'unreadable letters',
    'lorem ipsum',
    'fake UI labels',
    'tiny text blocks',
    'poster text',
    'album cover text',
    'large centered title',
    'title card',
    'billboard',
    'street sign',
    'signage',
    'readable sign',
    'caption',
    'label',
    'letters',
    'word art',
    'decorative typography',
    'copyrighted character',
    'celebrity face',
    'childish drawing',
    'toy-like render',
    'flat generic cartoon',
    'missing torso',
    'missing head',
    'missing limbs',
    'amputated body',
    'disembodied hand',
    'disembodied legs',
    'floating guitar',
    'floating instrument',
    'instrument fused with body',
    'body hidden behind instrument',
    'missing hand on microphone',
    'hand hidden behind microphone',
    'microphone replacing hand',
    'microphone fused with hand',
    'wrist fused with microphone',
    'microphone emerging from wrist',
    'fingerless microphone grip',
    'floating microphone',
    'central cropped body',
    'broken anatomy',
    'extra limbs',
    'fused hands',
    'overlapping bodies',
  ];
  if (/\b(corsaire spatial|space opera retro adulte|vaisseau spatial|ailes solaires|panneaux solaires)\b/.test(lookup)) {
    base.push(
      'ocean',
      'sea',
      'water',
      'waves',
      'sailing ship',
      'wooden boat',
      'nautical scene',
      'fantasy ocean',
      'pirate ship on water'
    );
  }
  const identityNegative = buildVivyVisualNegativeIdentityPrompt(input);
  if (identityNegative) {
    base.push(...identityNegative.split(/\s*,\s*/).filter(Boolean));
  }
  if (visualFocus.negativePrompt) {
    base.push(...visualFocus.negativePrompt.split(/\s*,\s*/).filter(Boolean));
  }
  return cleanText(base.join(', '), '', 1400);
}

function extractGeneratedImageUrl(payload = {}, req = null) {
  const candidates = [
    payload.imagePath,
    payload.image_url,
    payload.imageUrl,
    payload.url,
    payload.output_url,
    payload.outputUrl,
    payload.result?.imagePath,
    payload.result?.image_url,
    payload.result?.imageUrl,
    payload.result?.url,
    payload.a11Agent?.imagePath,
  ];
  for (const candidate of candidates) {
    const url = resolvePublicMediaUrl(candidate, req);
    if (url) return url;
  }
  return '';
}

function extractTwitchCoverAsyncJob(payload = {}) {
  const asyncJob = payload?.asyncJob && typeof payload.asyncJob === 'object'
    ? payload.asyncJob
    : (payload?.a11Agent?.asyncJob && typeof payload.a11Agent.asyncJob === 'object' ? payload.a11Agent.asyncJob : null);
  const status = cleanText(asyncJob?.status || payload?.status, '', 40).toLowerCase();
  const jobId = cleanText(asyncJob?.jobId || asyncJob?.id || payload?.jobId, '', 140);
  if (!jobId || !/^(pending|running|queued)$/i.test(status)) return null;
  return {
    jobId,
    status,
    pollUrl: cleanText(asyncJob?.pollUrl || asyncJob?.poll_url || payload?.pollUrl || payload?.poll_url, '', 600),
    pollIntervalMs: Math.max(100, Math.min(30_000, Number(asyncJob?.pollIntervalMs || payload?.pollIntervalMs || 5000) || 5000)),
    maxWaitMs: Math.max(1000, Math.min(10 * 60 * 1000, Number(asyncJob?.maxWaitMs || payload?.maxWaitMs || 0) || 0)),
  };
}

function resolveTwitchCoverPollUrl(job = {}, endpoint = '') {
  const raw = cleanText(job.pollUrl, '', 600) || `/api/llm/jobs/image/${encodeURIComponent(cleanText(job.jobId, '', 140))}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return new URL(raw, endpoint).toString();
  } catch {
    return raw;
  }
}

async function pollTwitchCoverAsyncJob(job = {}, options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const endpoint = cleanText(options.endpoint, '', 600);
  const req = options.req || null;
  const deadlineAt = Number(options.deadlineAt || 0) || Date.now() + Math.max(1000, Number(options.timeoutMs || job.maxWaitMs || 120000) || 120000);
  const pollUrl = resolveTwitchCoverPollUrl(job, endpoint);
  const headers = {
    ...(process.env.VIVY_STREAM_SECRET ? { 'X-Vivy-Stream-Secret': process.env.VIVY_STREAM_SECRET } : {}),
  };
  let lastPayload = null;
  let attempt = 0;

  while (Date.now() < deadlineAt) {
    attempt += 1;
    const response = await fetchFn(pollUrl, { headers, signal: options.signal });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    lastPayload = json || { message: text };

    if (!response.ok || !json) {
      return {
        ok: false,
        error: `cover_async_http_${response.status}`,
        message: cleanText(json?.message || text || 'cover_async_poll_failed', '', 240),
        raw: lastPayload,
      };
    }

    const status = cleanText(json.status || json.asyncJob?.status, '', 40).toLowerCase();
    if (status === 'done' || status === 'complete' || status === 'completed') {
      const coverImageUrl = extractGeneratedImageUrl(json.result || json, req);
      return coverImageUrl
        ? { ok: true, coverImageUrl, raw: json, asyncJob: job, attempts: attempt }
        : { ok: false, error: 'cover_async_url_missing', raw: json, asyncJob: job, attempts: attempt };
    }

    if (status === 'error' || status === 'failed') {
      return {
        ok: false,
        error: 'cover_async_failed',
        message: cleanText(json.message || json.error || 'cover_async_failed', '', 240),
        raw: json,
        asyncJob: job,
        attempts: attempt,
      };
    }

    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(job.pollIntervalMs || 5000, remaining));
  }

  return {
    ok: false,
    error: 'cover_async_timeout',
    message: 'Timeout async cover BAT/Rome.',
    raw: lastPayload,
    asyncJob: job,
  };
}

async function generateTwitchCoverImage(input = {}) {
  if (!isTwitchCoverEnabled()) return { ok: false, skipped: true, reason: 'cover_disabled' };
  const fetchFn = input.fetchFn || fetch;
  const req = input.req || null;
  const endpoint = cleanText(
    process.env.VIVY_STREAM_COVER_URL || process.env.A11_IMAGE_GENERATE_URL || 'http://127.0.0.1:3000/api/tools/generate_sd',
    '',
    500
  );
  if (!endpoint) return { ok: false, skipped: true, reason: 'cover_endpoint_missing' };
  const prompt = buildTwitchCoverPrompt(input);
  if (!prompt) return { ok: false, skipped: true, reason: 'cover_prompt_missing' };
  const negativePrompt = buildTwitchCoverNegativePrompt(input, prompt);
  const identityPack = buildVivyVisualIdentityPack(input);
  const referenceImageUrls = identityPack.referenceImageUrls || [];
  const timeoutMs = Math.max(10_000, Math.min(5 * 60 * 1000, Number(process.env.VIVY_STREAM_COVER_TIMEOUT_MS || 120000) || 120000));
  const deadlineAt = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.VIVY_STREAM_SECRET ? { 'X-Vivy-Stream-Secret': process.env.VIVY_STREAM_SECRET } : {}),
      },
      body: JSON.stringify({
        prompt,
        width: Number(process.env.VIVY_STREAM_COVER_WIDTH || 1280) || 1280,
        height: Number(process.env.VIVY_STREAM_COVER_HEIGHT || 720) || 720,
        size_policy: 'landscape_16_9',
        negative_prompt: negativePrompt,
        referenceVisualContext: identityPack.prompt || '',
        ...(referenceImageUrls.length ? {
          referenceImageUrls,
          reference_image_urls: referenceImageUrls,
          referenceImageUrl: referenceImageUrls[0],
        } : {}),
        userId: 'vivy-twitch-live',
        conversationId: input.conversationId || '',
        source: 'vivy-twitch-cover',
        acceptAsyncImageJob: true,
        asyncStrategy: 'bat-sleep/rome-poll',
      }),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok || !json) {
      return {
        ok: false,
        error: `cover_http_${response.status}`,
        message: cleanText(json?.message || text || 'cover_generation_failed', '', 240),
        prompt,
      };
    }
    const coverImageUrl = extractGeneratedImageUrl(json, req);
    if (coverImageUrl) return { ok: true, coverImageUrl, prompt, raw: json };
    const asyncJob = extractTwitchCoverAsyncJob(json);
    if (asyncJob) {
      const asyncResult = await pollTwitchCoverAsyncJob(asyncJob, {
        fetchFn,
        endpoint,
        req,
        signal: controller.signal,
        deadlineAt,
      });
      return asyncResult.ok
        ? { ...asyncResult, prompt, raw: asyncResult.raw || json }
        : { ...asyncResult, prompt, raw: asyncResult.raw || json };
    }
    return { ok: false, error: 'cover_url_missing', prompt, raw: json };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? 'cover_timeout' : 'cover_failed',
      message: cleanText(error?.message || error, '', 240),
      prompt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildTwitchClipPrompt(input = {}) {
  const title = cleanText(input.publicTitle || input.title, 'Nouvelle composition Vivy', 140);
  const idea = sanitizeCoverVisualIdea(title, cleanText(input.winner?.text || input.idea, '', 700));
  const coverPrompt = cleanText(input.coverPrompt, '', 1400);
  const visualFocus = resolveVivyVisualFocus(input);
  const promptParts = [
    'Créer une boucle visuelle cinématique de 3 secondes, pleine image, sans titre ni paroles affichées.',
    idea ? `Sujet: ${idea}.` : '',
    visualFocus.prompt,
  ].filter(Boolean);
  appendVivyVisualIdentityBrief(promptParts, input);
  promptParts.push(...[
    coverPrompt ? `La première image définit exactement les personnages, les costumes, le décor et la composition: ${coverPrompt}.` : '',
    'Animer uniquement cette image avec des mouvements naturels subtils et premium: respiration, cheveux ou tissu, lumières, particules, profondeur et léger mouvement de caméra.',
    'Conserver strictement l’identité, le visage, la silhouette, les couleurs, le cadrage et la direction artistique de l’image source.',
    'Si un microphone est présent, préserver un contact physique stable pendant toute la boucle: main complète à cinq doigts, paume, poignet et avant-bras continus autour du manche, ou microphone entièrement posé sur son pied sans main cachée derrière. Aucun glissement, fusion, disparition ou apparition de doigts.',
    'La première et la dernière image doivent être visuellement compatibles pour une boucle fluide pendant toute la chanson.',
    'Un seul plan, aucun changement de scène, aucune coupe, aucun morphing, aucun nouveau personnage, aucune déformation.',
    'Aucun texte, aucun logo, aucune parole affichée, aucun sous-titre, aucune pseudo-écriture, aucun panneau illisible, aucun son.',
  ].filter(Boolean));
  return cleanText(promptParts.join(' '), '', 4200);
}

function extractGeneratedVideoUrl(payload = {}, req = null) {
  const candidates = [
    payload.video_url,
    payload.videoUrl,
    payload.url,
    payload.download_url,
    payload.downloadUrl,
    payload.output_url,
    payload.outputUrl,
    payload.videoPath,
    payload.video_path,
    payload.outputPath,
    payload.output_path,
    payload.result?.video_url,
    payload.result?.videoUrl,
    payload.result?.url,
    payload.result?.outputPath,
  ];
  for (const candidate of candidates) {
    const url = resolvePublicMediaUrl(candidate, req);
    if (url) return url;
  }
  return '';
}

async function generateTwitchCoverVideo(input = {}) {
  if (!isTwitchClipEnabled()) return { ok: false, skipped: true, reason: 'clip_disabled' };
  const coverImageUrl = cleanText(input.coverImageUrl, '', 1200);
  if (!coverImageUrl) return { ok: false, skipped: true, reason: 'clip_cover_missing' };
  const prompt = buildTwitchClipPrompt(input);
  if (!prompt) return { ok: false, skipped: true, reason: 'clip_prompt_missing' };

  const req = input.req || createTrustedTwitchRequest();
  const generateVideoFn = input.generateVideoFn || require('../routes/video-generate.cjs').generateVideoInternal;
  if (typeof generateVideoFn !== 'function') {
    return { ok: false, error: 'clip_generator_missing', prompt };
  }

  const durationSeconds = Math.max(2, Math.min(6, Number(process.env.VIVY_STREAM_CLIP_DURATION_SECONDS || 3) || 3));
  const timeoutMs = Math.max(30_000, Math.min(45 * 60 * 1000, Number(process.env.VIVY_STREAM_CLIP_TIMEOUT_MS || 2_700_000) || 2_700_000));
  const hasVideoProxy = Boolean(cleanText(
    process.env.A11_VIDEO_LOCAL_RUNNER_URL
    || process.env.A11_VIDEO_PROXY_URL
    || process.env.VIDEO_PROXY_URL,
    '',
    1200
  ));
  const hasComfyCloud = Boolean(cleanText(
    process.env.A11_COMFY_CLOUD_API_KEY
    || process.env.COMFY_CLOUD_API_KEY
    || process.env.A11_COMFY_ORG_API_KEY
    || process.env.A11_COMFY_API_KEY
    || process.env.COMFY_ORG_API_KEY
    || process.env.COMFYUI_API_KEY,
    '',
    1200
  ));
  const configuredProvider = cleanText(process.env.VIVY_STREAM_CLIP_PROVIDER, '', 40);
  const preferredProvider = configuredProvider && configuredProvider.toLowerCase() !== 'auto'
    ? configuredProvider
    : (hasComfyCloud ? 'comfy_cloud' : (hasVideoProxy ? 'runcomfy' : cleanText(process.env.A11_HF_VIDEO_PROVIDER || 'replicate', 'replicate', 40)));
  const platformProvider = cleanText(process.env.A11_HF_VIDEO_PROVIDER, 'replicate', 40);
  const fallbackProvider = cleanText(process.env.VIVY_STREAM_CLIP_FALLBACK_PROVIDER, 'xai', 40);
  const providers = [...new Set([
    preferredProvider,
    hasComfyCloud ? 'comfy_cloud' : '',
    hasVideoProxy ? 'runcomfy' : '',
    platformProvider,
    'replicate',
    fallbackProvider,
  ].filter(Boolean))];
  const retryDelayMs = Math.max(
    1000,
    Math.min(3 * 60 * 1000, Number(process.env.VIVY_STREAM_CLIP_RETRY_DELAY_MS || 45000) || 45000)
  );
  const retrySleep = input.sleepFn || sleep;
  const identityPack = buildVivyVisualIdentityPack(input);
  const referenceImageUrls = [...new Set([coverImageUrl, ...(identityPack.referenceImageUrls || [])].filter(Boolean))];
  let lastFailure = null;

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const maxAttempts = provider === preferredProvider ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let timeout = null;
      try {
        const generation = generateVideoFn({
          req,
          prompt,
          body: {
            prompt,
            sourceImageUrl: coverImageUrl,
            referenceImageUrls,
            referenceVisualContext: identityPack.prompt || '',
            negative_prompt: 'text, letters, words, caption, subtitles, title card, logo, watermark, signature, typography, signage, UI text, gibberish text, pseudo text, scribbles, fake writing, floating symbols, double exposure, ghost face, duplicate face, face morphing, malformed face, transient overlay, broken anatomy, extra limbs, extra arms, extra legs, extra fingers, missing fingers, deformed hands, fused hands, missing limbs, disembodied hand, mutated body',
            vocalPerformance: false,
            visualOnly: true,
            durationSeconds,
            fps: Math.max(8, Math.min(30, Number(process.env.VIVY_STREAM_CLIP_FPS || 24) || 24)),
            width: Number(process.env.VIVY_STREAM_CLIP_WIDTH || 1280) || 1280,
            height: Number(process.env.VIVY_STREAM_CLIP_HEIGHT || 720) || 720,
            format: 'mp4',
            videoProvider: provider,
            forceRealVideo: true,
            disableEmergencyVideo: true,
            userId: 'vivy-twitch-live',
            conversationId: input.conversationId || '',
            source: 'vivy-twitch-cover-clip',
          },
        });
        const result = await Promise.race([
          generation,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('clip_timeout')), timeoutMs);
            timeout.unref?.();
          }),
        ]);
        const coverVideoUrl = extractGeneratedVideoUrl(result, req);
        if (!coverVideoUrl) throw new Error('clip_url_missing');
        return { ok: true, coverVideoUrl, prompt, provider, raw: result };
      } catch (error) {
        lastFailure = error;
        const message = cleanText(error?.message || error, 'clip_failed', 240);
        const rateLimited = /(?:status[_ ]?429|\b429\b|rate.?limit|too many requests)/i.test(message);
        if (rateLimited && attempt < maxAttempts) {
          console.warn(
            '[vivy-twitch-clip] provider=%s rate-limited attempt=%s/%s retryInMs=%s',
            provider,
            attempt,
            maxAttempts,
            retryDelayMs
          );
          await retrySleep(retryDelayMs);
          continue;
        }
        const nextProvider = providers[index + 1] || '';
        const canFallback = Boolean(
          nextProvider
          && /model not supported|unsupported|unconfigured|provider|endpoint|missing|status_4\d\d|\b429\b|rate.?limit|401|403|404/i.test(message)
        );
        if (!canFallback) {
          index = providers.length;
          break;
        }
        console.warn(
          '[vivy-twitch-clip] provider=%s unavailable error=%s fallback=%s',
          provider,
          message,
          nextProvider
        );
        break;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  }

  return {
    ok: false,
    error: cleanText(lastFailure?.message || lastFailure, 'clip_failed', 120),
    message: cleanText(lastFailure?.message || lastFailure, '', 240),
    prompt,
  };
}

function getReadyLocalMedia(value = {}, logger = console, context = {}) {
  const media = getReadyMedia(value);
  if (!media) return null;
  if (isExternalMediaUrl(media.url) && !isLocalVivyMediaUrl(media.url)) {
    logger.warn?.(
      '[vivy-twitch-nossen] round=%s provider media ready but local asset missing url=%s',
      cleanText(context.roundId || '', 'unknown', 120),
      cleanText(media.url, '', 180)
    );
    return null;
  }
  return media;
}

function foldTwitchLyricText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const TWITCH_OPERATIONAL_LEAK_TERMS = [
  'nossen',
  'twitch',
  'live',
  'stream',
  'chat',
  'raid',
  'sub',
  'viewer',
  'viewers',
  'modo',
  'mod',
  'moderation',
  'obs',
  'overlay',
  'suno',
  'prompt',
  'canevas',
  'production',
  'serveur',
  'server',
  'notification',
  'notifications',
  'notif',
  'notifs',
  'commande',
  'camera',
  'micro',
  'donjon',
  'skin',
];

const TWITCH_VEHICLE_LEAK_TERMS = [
  'moto',
  'motard',
  'motarde',
  'casque',
  'visiere',
  'guidon',
  'bitume',
  'gyros',
  'gyrophare',
  'gyrophares',
  'helico',
  'helicos',
  'sirene',
  'sirenes',
  'comico',
  'volant',
];

const TWITCH_VEHICLE_LEAK_ALLOWANCE = 2;

const TWITCH_CONTEXT_LEAK_GROUPS = [
  {
    name: 'vehicle_chase',
    terms: TWITCH_VEHICLE_LEAK_TERMS,
    allow: /\b(?:moto|motard|biker|scooter|booster|derbi|tzr|casque|visiere|guidon|poursuite|course|rallye|voiture|volant|autoroute|route|bitume|police|flic|comico|sirene|sirenes|helico|helicos|gyros|gyrophare|tunnel|neon\s+run|drive)\b/i,
  },
  {
    name: 'childish_context',
    terms: [
      'gamin',
      'gamine',
      'enfant',
      'cartable',
      'ecole',
      'recre',
      'doudou',
      'gouter',
      'classe',
      'maitresse',
      'dessin anime jeunesse',
      'cartoon familial',
    ],
    allow: /\b(?:enfant|gamin|gamine|jeunesse|ecole|école|recre|récré|cartable|doudou|conte|fable|yakari|dessin\s+anime\s+jeunesse|cartoon\s+familial)\b/i,
  },
  {
    name: 'western_context',
    terms: [
      'cowboy',
      'sherif',
      'saloon',
      'duel',
      'lasso',
      'revolver',
      'epron',
      'eperon',
    ],
    allow: /\b(?:cowboy|cow\s*boy|western|sherif|shérif|saloon|duel|lasso|revolver|epron|épron|eperon|éperon|far\s+west)\b/i,
  },
];

function hasFoldedWord(text = '', term = '') {
  return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text);
}

function allowedTwitchContextLeakGroups(subject = '', context = '') {
  const foldedSubject = foldTwitchLyricText([subject, context].filter(Boolean).join('\n'));
  return new Set(TWITCH_CONTEXT_LEAK_GROUPS
    .filter((group) => group.allow.test(foldedSubject))
    .map((group) => group.name));
}

function buildTwitchContextIsolationGuidance({ winner = {}, routing = {}, seed = {} } = {}) {
  const source = [
    winner.text,
    routing?.songMood,
    seed?.notes,
    seed?.canvas,
  ].filter(Boolean).join('\n');
  const folded = foldTwitchLyricText(source);
  const lines = [];
  if (!TWITCH_CONTEXT_LEAK_GROUPS[0].allow.test(folded)) {
    lines.push('Interdiction de recyclage: pas de moto, guidon, casque, visière, gyros, hélicos, sirènes, comico, volant ou bitume si le sujet exact ne parle pas de course/poursuite/véhicule.');
  }
  if (!TWITCH_CONTEXT_LEAK_GROUPS[1].allow.test(folded)) {
    lines.push('Interdiction de recyclage: pas de champ enfantin/gamin/cartable/école/goûter/doudou si le sujet exact ne demande pas jeunesse, enfant, conte ou cartoon familial.');
  }
  if (!TWITCH_CONTEXT_LEAK_GROUPS[2].allow.test(folded)) {
    lines.push('Interdiction de recyclage: pas de cowboy, shérif, saloon, duel, lasso ou revolver si le sujet exact ne demande pas western.');
  }
  return lines.join('\n');
}

function isBawdyWordplayRequest(...values) {
  const folded = foldTwitchLyricText(values.filter(Boolean).join('\n'));
  return /\b(?:paillard|paillarde|grivois|grivoise|coquin|coquine|coquins|coquines|gaulois|gauloise|double\s+sens|sous\s+entendu|sous\s+entendus|tabou|taboo|adulte|erotique|erotiques|érotique|érotiques|sexuel|sexuelle|sexe|drogue|drogues|drog|fumette|ivresse|bourre|bourree|bourré|bourrée)\b/.test(folded);
}

function isHumorWordplayRequest(...values) {
  const folded = foldTwitchLyricText(values.filter(Boolean).join('\n'));
  return /\b(?:humour|humoristique|drole|droles|marrant|marrante|funny|blague|blagues|vanne|vannes|sarcasme|sarcastique|ironie|ironique|second\s+degre|satire|satirique|parodie|parodique|absurde|absurdite|quiproquo|malentendu|mal\s+entendu|double\s+sens|sous\s+entendu|sous\s+entendus|calembour|calembours|jeu\s+de\s+mots|jeux\s+de\s+mots|allusion|allusions|carambar|paillard|paillarde|grivois|grivoise|coquin|coquine|tabou|taboo)\b/.test(folded);
}

function isParodyFormatRequest(...values) {
  const folded = foldTwitchLyricText(values.filter(Boolean).join('\n'));
  return /\b(?:parodie|parodique|satire|satirique|emission|émission|plateau|jury|jurys|concours|casting|audition|battle|freestyle|rap\s+show|nouvelle\s+ecole|nouvelle\s+école|tele[-\s]?crochet|t[ée]l[ée][- ]crochet|interview|confessionnal|reality\s+show)\b/.test(folded);
}

function isPhoneticWordplayRequest(...values) {
  const folded = foldTwitchLyricText(values.filter(Boolean).join('\n'));
  return /\b(?:phonetique|phonetiques|jeu\s+de\s+mots\s+sonore|jeux\s+de\s+mots\s+sonores|calembour\s+sonore|calembours\s+sonores|homophone|homophones|homophonie|paronyme|paronymes|paronomase|contrepeterie|contrepeteries|double\s+lecture\s+orale|a\s+l['’]oreille|quand\s+on\s+l['’]entend|syllabe|syllabes|decoupage\s+sonore|decouper\s+les\s+mots)\b/.test(folded);
}

function buildPhoneticWordplayGuidance({ winner = {}, routing = {}, seed = {} } = {}) {
  if (!isPhoneticWordplayRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)) return '';
  return [
    'Règles privées non chantables pour jeux de mots phonétiques: la seconde lecture doit apparaître quand la ligne est prononcée à voix haute.',
    'Avant d’écrire, construis silencieusement une banque d’au moins huit pivots sonores tirés du vocabulaire exact du sujet: homophones, mots découpés en syllabes, liaisons ambiguës, paronymes, acronymes entendus comme des mots, échos phonétiques et rimes internes à double lecture.',
    'Une métaphore technique ne compte pas comme jeu phonétique. Deux termes du même domaine ne comptent pas non plus. Si le second sens ne s’entend pas sans explication, réécris la ligne.',
    'Donne une double intention aux mots-pivots: le contexte avant le mot active son sens normal, puis les mots qui suivent rendent audible une autre découpe ou un autre sens. Une opposition, une cause ou une conséquence doit relier les deux lectures.',
    'Privilégie la révélation retardée: la ligne paraît normale, puis sa fin oblige l’oreille à réentendre le mot-pivot autrement. Ne donne jamais la solution entre parenthèses et n’écris pas les deux orthographes côte à côte.',
    'Place au moins quatre pivots phonétiques distincts dans les couplets et un pivot central très audible dans le refrain. Chaque pivot doit déclencher une conséquence ou une réponse dans la scène, pas rester un mot isolé.',
    'Le texte doit rester naturel au premier degré. Ne mets aucune explication, parenthèse, slash, liste de variantes ou annotation du jeu de mots dans les paroles.',
    'Si le sujet comporte un sous-texte adulte, garde-le implicite et sonore: jamais anatomique, jamais frontal. Le public doit pouvoir entendre deux chansons dans la même phrase.',
  ].join('\n');
}

function isAssociativeWordplayRequest(...values) {
  const folded = foldTwitchLyricText(values.filter(Boolean).join('\n'));
  return /\b(?:allegorie|allegories|metaphore|metaphores|double\s+lecture|double\s+sens|sous\s+entendu|sous\s+entendus|association\s+d['’]idees|associations\s+d['’]idees|lien\s+d['’]idees|liens\s+d['’]idees|croisement|croisements|saugrenu|saugrenue|saugrenues|analogie|analogies|image\s+cachee|images\s+cachees|expression\s+detournee|expressions\s+detournees|proverbe|proverbes|comptine|comptines|allusion|allusions|paillard|paillarde|grivois|grivoise|coquin|coquine)\b/.test(folded);
}

function buildAssociativeWordplayGuidance({ winner = {}, routing = {}, seed = {} } = {}) {
  if (!isAssociativeWordplayRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)) return '';
  return [
    'Règles privées non chantables pour associations saugrenues cohérentes: fais se rencontrer deux univers par un vrai point commun perceptible.',
    'Construis silencieusement plusieurs chaînes: objet ou situation du sujet, propriété concrète, lecture humaine cachée, puis conséquence dans la scène. Le lien peut venir de la forme, texture, température, odeur, goût, geste, verbe, usage, expression populaire, proverbe, comptine ou référence culturelle.',
    'Utilise la syllepse, le zeugma, la métaphore filée, l’expression prise au pied de la lettre, la collision de registres et la référence détournée. Une association étrange est bonne si elle paraît évidente une seconde après l’avoir entendue.',
    'Ne te contente pas d’aligner des objets suggestifs. Fais-les agir, provoquer un malentendu, contaminer le décor ou revenir avec un sens différent plus tard.',
    'Développe au moins trois familles d’associations distinctes et fais-les se répondre. Le dernier refrain doit retourner une image du début avec une nouvelle lecture.',
    'Le sous-entendu adulte reste implicite, drôle et non anatomique. La chanson doit fonctionner comme histoire innocente et comme seconde histoire pour ceux qui captent les liens.',
  ].join('\n');
}

function buildV9SemanticResonanceGuidance({ lyricScope = {} } = {}) {
  const targetSeconds = Number(lyricScope?.targetDurationSeconds || 0);
  const pivotDose = targetSeconds >= 300
    ? 'cinq à huit mots-pivots'
    : targetSeconds >= 210
      ? 'trois à cinq mots-pivots'
      : 'un à trois mots-pivots';
  return [
    'Liaison V9 dynamique privée et non chantable: organise la chanson comme un bâtiment sémantique.',
    'La façade est le thème principal: elle reste immédiatement visible dans les personnages, actions, lieux, objets et verbes précis. Elle porte environ les trois quarts de la matière textuelle.',
    'Les combles abritent le sous-thème humain, comique ou dramatique: il ne remplace jamais la façade et ne doit pas être nommé comme une explication. Il apparaît par échos, choix, conséquences et changements de sens.',
    `Posologie textuelle adaptée à cette ampleur: travaille silencieusement ${pivotDose}, issus du vocabulaire exact du sujet.`,
    'Chaque mot-pivot suit une équation de répercussion: première lecture claire, retour dans un autre contexte, puis conséquence visible qui oblige à le comprendre autrement.',
    'Pour l’humour, la répercussion crée un quiproquo, une contradiction, une césure ou une conséquence disproportionnée. Pour le drame, le même mot revient chargé d’une perte, d’un choix, d’un coût ou d’une révélation.',
    'Un pivot ne compte que si son retour modifie la scène. Une répétition décorative, un synonyme plaqué ou une liste d’associations ne compte pas.',
    'Dose les retours: au maximum deux emplois significatifs du même pivot hors refrain; le refrain peut porter un pivot central dont le sens évolue au dernier retour.',
    'La dynamique est mathématique mais le résultat reste humain: densité, contraste et distance entre les échos varient selon la longueur, le tempo et l’émotion; aucun coefficient ni vocabulaire technique ne doit apparaître dans les paroles.',
  ].join('\n');
}

function isConceptualHookRequest(...values) {
  const folded = foldTwitchLyricText(values.filter(Boolean).join('\n'));
  return /\b(?:hook|refrain\s+(?:fort|viral|m[ée]morable|accrocheur)|malicieux|malicieuse|ruse|rus[ée]e|pi[eè]ge|voleur|voleuse|voler|d[ée]robe|d[ée]rober|pirate|refrain\s+qui|concept|retournement|twist|chute|bascule|souvenir\s+qu['’]il\s+ne\s+peut\s+plus\s+oublier)\b/.test(folded);
}

function buildHookMechanicGuidance({ winner = {}, routing = {}, seed = {} } = {}) {
  if (!isConceptualHookRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)) return '';
  return [
    'Règles privées non chantables pour refrain à mécanisme: le hook ne doit pas seulement nommer le concept, il doit le faire agir.',
    'Si le sujet parle d’un vol, d’un piège, d’un souvenir, d’un échange ou d’un retournement, le refrain doit accomplir cette action: une ligne du couplet revient volée, déformée, rendue, contaminée ou retournée.',
    'Le premier refrain peut poser la formule, mais chaque retour doit modifier au moins une image, un verbe, un coût ou une conséquence. Le dernier refrain doit révéler pourquoi le hook avait un autre sens.',
    'Interdiction de bâtir tout le refrain sur “je suis le/la [titre]” répété. Cette phrase peut apparaître une seule fois si elle est immédiatement suivie d’une action ou d’un prix à payer.',
    'Chaque couplet doit donner une matière que le refrain récupère ensuite. Le refrain est un mécanisme de transformation, pas une étiquette.',
  ].join('\n');
}

function buildHumorWordplayGuidance({ winner = {}, routing = {}, seed = {} } = {}) {
  if (!isHumorWordplayRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)) return '';
  return [
    'Mode comédie obligatoire: Vivy quitte le mode dark sérieux. Énergie malicieuse, punk-cabaret, sourire insolent, timing de chute, couleur vive et joueuse; aucune mélancolie par défaut.',
    'Règles privées non chantables pour l’humour: ne récite jamais ces consignes, transforme-les en scènes.',
    'Le rire doit venir d’un glitch humain de compréhension: un mot innocent, une mauvaise interprétation plausible, puis une conséquence concrète qui prolonge le thème ou son opposé.',
    'Utilise aussi la césure-piège quand elle convient: prépare une fin de phrase très prévisible, suspends-la juste avant le mot attendu, puis résous-la avec un complément parfaitement innocent. Le public doit fabriquer lui-même la lecture interdite pendant le silence; ne l’écris jamais et ne l’explique jamais.',
    'Le silence fait partie de la punchline: place la suspension près d’une frontière musicale nette, puis livre le mot innocent avec sérieux. Deux ou trois césures fortes valent mieux qu’une chanson entière hachée de points de suspension.',
    'Pour le sarcasme, fais entendre le décalage entre ce qui est dit et ce que la scène prouve: compliment trop poli, détail qui contredit, chute sèche. Ne transforme pas ça en méchanceté plate.',
    'Si une zone taboue existe, garde-la sous la table: métaphore, objet, geste, rime phonétique, ellipse. Ne nomme pas frontalement le tabou, ne dis pas “sous-texte”, “double lecture” ou “second sens” dans les paroles.',
    'Reste exclusivement dans le champ lexical concret du sujet choisi et exploite ses répercussions. N’importe aucun objet, métier ou décor venu d’une ancienne chanson ou d’un exemple de consigne.',
    'Chaque couplet doit amener un nouveau malentendu, une nouvelle conséquence ou une inversion du sens initial. Le refrain doit être innocent en surface et suspect quand on réécoute.',
    'Évite les substituts paresseux au rire: annoncer un secret, multiplier les clins d’œil, dire que les gens ont compris ou que seuls les initiés rient. La scène et la chute doivent suffire.',
    'Hors refrain, ne recycle ni la même phrase, ni le même moule syntaxique, ni la même idée reformulée. Chaque pré-refrain doit changer d’angle et chaque retour doit faire avancer la situation.',
  ].join('\n');
}

function buildParodyFormatGuidance({ winner = {}, routing = {}, seed = {} } = {}) {
  if (!isParodyFormatRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)) return '';
  return [
    'Règles privées non chantables pour parodie de format: choisis d’abord le format social imité, puis respecte sa grammaire comme un décor sérieux.',
    'Un format peut être un concours, un jury, une audition, une émission, un reportage, un confessionnal, une battle, un tutoriel ou une cérémonie. Le format donne les rôles, les transitions, les objets, les tics de langage et les moments obligés.',
    'Le moteur comique vient du contraste entre le cadre très professionnel et une situation minuscule, absurde ou trop humaine. Les personnages doivent prendre le cadre au sérieux; la chanson ne doit jamais expliquer qu’elle parodie.',
    'Construis une escalade nette: présentation crédible, première faille, juge ou témoin qui surinterprète, retour de gimmick, contradiction visible, puis chute qui transforme le format en piège comique.',
    'Chaque couplet doit ajouter une règle du faux format ou un personnage qui comprend de travers. Le refrain doit servir de slogan ou de gimmick qu’on peut reprendre, puis le dernier refrain doit le retourner.',
    'Évite le name-dropping et la copie de sketches existants: aucune formulation reconnaissable, aucun emprunt de punchline, aucun résumé de référence. Seule la mécanique est utilisée.',
    'Si le sujet parle de rap, garde de vraies rimes et une vraie attitude musicale; si le sujet parle d’un autre monde, adapte le format à ce monde au lieu de ramener automatiquement un concours de rap.',
  ].join('\n');
}

function buildBawdyWordplayGuidance({ winner = {}, routing = {}, seed = {} } = {}) {
  if (!isBawdyWordplayRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)) return '';
  return [
    'Règles privées non chantables pour paillarde intelligente: écris une chanson franchement adulte et drôle à double fond, suggestive mais non graphique.',
    'Chaque image doit fonctionner deux fois: lecture innocente en surface, sous-entendu comique dessous. Le plaisir vient du détour, du quiproquo, de la métaphore et du calembour.',
    'Cherche des allusions tordues façon blague de comptoir/Carambar adulte: rimes internes, mots à double lecture, césures qui laissent imaginer un mot tabou avant une résolution innocente, petites chutes en fin de ligne et refrains qu’on peut chanter en faisant semblant de ne rien comprendre.',
    'Dans une césure suggestive réussie, toute la grammaire avant la pause appelle un mot compromettant, mais le mot réellement chanté reste banal et cohérent. La blague appartient à l’auditeur, pas au narrateur.',
    'Le second récit doit être réellement perceptible par un adulte. Choisis au moins deux tensions liées au sujet parmi désir, maladresse érotique, ivresse, fumée ou substance clandestine, interdit social et lendemain embarrassant. Ne glorifie pas un produit dangereux, mais ne neutralise pas non plus l’allusion demandée.',
    'Place plusieurs allusions adultes concrètes et plusieurs vraies chutes réparties dans les couplets. Une ambiance complice, un secret, un sourire ou un clin d’œil sans mécanisme de sens ne compte pas comme blague.',
    'Si un champ lexical est donné, dérive tous les doubles sens de ses propriétés, gestes, usages et expressions réelles. N’importe jamais un autre champ lexical mémorisé.',
    'Ne dis pas “double sens” dans les paroles: fabrique-le. Ne raconte pas que c’est drôle: fais tomber les punchlines par conséquence, méprise, retour de rime ou image trop innocente pour être honnête.',
  ].join('\n');
}

function reinforceTwitchHumorRouting(routing = {}, { winner = {}, seed = {}, intentPlan = {} } = {}) {
  const humorRequested = isHumorWordplayRequest(
    winner.text,
    routing?.songMood,
    seed?.notes,
    seed?.canvas,
    intentPlan?.generationBrief,
    intentPlan?.reason
  );
  if (!humorRequested) return routing;
  if (
    isRapFreestyleRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)
    && !isHumorWordplayRequest(winner.text)
  ) {
    return routing;
  }

  const bawdyRequested = isBawdyWordplayRequest(
    winner.text,
    routing?.songMood,
    seed?.notes,
    seed?.canvas,
    intentPlan?.generationBrief,
    intentPlan?.reason
  );
  const currentMood = cleanText(routing?.songMood, '', 1200);
  const foldedMood = foldTwitchLyricText(currentMood);
  const alreadyComic = /\b(?:comedie|comédie|drole|drôle|humour|cabaret|guinguette|funk|funky|swing|zouk|fanfare|cartoon|burlesque|groove|malice|second\s+degre|sarcastique|satire)\b/.test(foldedMood);
  const comedyMood = bawdyRequested
    ? 'Direction humour obligatoire: cabaret-funk paillard intelligent, guinguette nerveuse, contrebasse ronde, piano bastringue ou synthé comique, chœurs de comptoir, énergie adulte malicieuse, timing de chute, jamais ballade sombre.'
    : 'Direction humour obligatoire: comédie pop-funk vive, groove rebondissant, petites ruptures de batterie pour les chutes, couleur cartoon adulte, malice punk-cabaret, refrain faussement innocent, jamais ballade sombre.';
  const songMood = alreadyComic
    ? `${currentMood}. ${comedyMood}`
    : cleanText([currentMood, comedyMood].filter(Boolean).join('. '), '', 1600);
  return {
    ...routing,
    songMood,
  };
}

function isHardcoreRaveRequest(...values) {
  const folded = foldTwitchLyricText(values.filter(Boolean).join(' '));
  if (!folded) return false;
  if (/\b(?:gabber|thunderdome|frenchcore|uptempo\s+hardcore|happy\s+hardcore)\b/.test(folded)) return true;
  if (!/\bhard[-\s]?core\b/.test(folded)) return false;
  if (/\b(?:rap|hip[-\s]?hop|punk|metal)\s+hard[-\s]?core\b|\bhard[-\s]?core\s+(?:rap|hip[-\s]?hop|punk|metal)\b/.test(folded)) return false;
  return /\b(?:rave|techno|90s?|1990|annees\s+90|oldschool|old\s+school|warehouse|rotterdam|hollandaise?)\b/.test(folded);
}

function reinforceTwitchHardcoreRouting(routing = {}, { winner = {}, seed = {}, intentPlan = {} } = {}) {
  const requested = isHardcoreRaveRequest(
    winner.text,
    routing?.songMood,
    seed?.notes,
    seed?.canvas,
    intentPlan?.generationBrief,
    intentPlan?.reason
  );
  if (!requested) return routing;
  const currentMood = cleanText(routing?.songMood, '', 1200);
  const foldedMood = foldTwitchLyricText(currentMood);
  if (/\b(?:gabber|thunderdome|kicks?\s+distordus)\b/.test(foldedMood)) return routing;
  const hardcoreMood = 'Direction hardcore 90s obligatoire: gabber façon Thunderdome et rave hollandaise oldschool, kicks distordus saturés au premier plan, 170-190 BPM, stabs hoover et sirènes rave, nappes sombres de warehouse industriel, énergie brute et martelée; jamais orchestral épique, jamais pop douce, jamais ballade.';
  return {
    ...routing,
    songMood: cleanText([currentMood, hardcoreMood].filter(Boolean).join('. '), '', 1600),
  };
}

function isRapFreestyleRequest(...values) {
  const folded = foldTwitchLyricText(values.filter(Boolean).join(' '));
  if (!folded) return false;
  if (/\b(?:freestyle|cypher|egotrip|ego\s+trip|punchlines?|kickage|multisyllabiques?)\b/.test(folded)) return true;
  return /\brap\b/.test(folded)
    && /\b(?:sans\s+refrain|pas\s+de\s+refrain|couplets?\s+continus?)\b/.test(folded);
}

function reinforceTwitchRapFreestyleRouting(routing = {}, { winner = {}, seed = {}, intentPlan = {} } = {}) {
  const requested = isRapFreestyleRequest(
    winner.text,
    routing?.songMood,
    seed?.notes,
    seed?.canvas,
    intentPlan?.generationBrief,
    intentPlan?.reason
  );
  if (!requested) return routing;
  const currentMood = cleanText(routing?.songMood, '', 1200);
  const foldedMood = foldTwitchLyricText(currentMood);
  if (/\bcouplets?\s+continus?\b/.test(foldedMood) && /\bpunchlines?\b/.test(foldedMood)) return routing;
  const freestyleMood = 'Direction freestyle rap obligatoire: couplets continus en phases, punchlines concrètes et fréquentes, rimes techniques multisyllabiques, variations de flow et de débit; refrain seulement si le sujet le demande explicitement; aucun objet central récurrent ni image répétée type vinyle, platine, disque ou boucle; jamais de traitement narratif de chanson à refrain.';
  return {
    ...routing,
    songMood: cleanText([currentMood, freestyleMood].filter(Boolean).join('. '), '', 1600),
  };
}

function buildRapFreestyleGuidance({ winner = {}, routing = {}, seed = {} } = {}) {
  if (!isRapFreestyleRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)) return '';
  return [
    'Règles privées non chantables pour freestyle rap: écris en couplets continus par phases, pas en chanson narrative à objet central.',
    'Chaque phase enchaîne des punchlines concrètes: comparaisons inattendues, retournements, attaques précises; vise au moins une vraie punchline toutes les quatre lignes.',
    'Rimes techniques exigées: multisyllabiques, internes et enchaînées; varie le flow et le débit entre les phases.',
    'Un refrain est optionnel: ajoute-le seulement si le sujet exact le demande, sinon aucune section refrain, pré-refrain ni pont.',
    'Aucune image ne revient plus d’une fois hors refrain: si vinyle, platine, disque, boucle ou machine est déjà apparu, trouve une image neuve. Le contexte social est une couleur de fond, jamais une banque d’images à recycler ni une consigne de refrain.',
    'Si le sujet demande un clash contre des artistes réels nommés, garde leurs noms et attaque frontalement leurs styles, carrières et personnages publics avec des punchlines crues et précises; n’imite pas leurs voix et n’invente pas de faits diffamatoires.',
  ].join('\n');
}

function assessTwitchLyricLoopiness(lyrics = '') {
  const lines = String(lyrics || '').split(/\r?\n/);
  const verseLines = [];
  let inChorus = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const tag = trimmed.match(/^\[([^\]]+)\]$/);
    if (tag) {
      inChorus = /chorus|refrain|hook/i.test(tag[1]);
      continue;
    }
    if (inChorus) continue;
    const folded = foldTwitchLyricText(trimmed).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (folded.split(' ').length < 4) continue;
    verseLines.push(folded);
  }
  if (verseLines.length < 6) {
    return { valid: true, reasons: [], duplicateRatio: 0, topLineCount: 0, verseLineCount: verseLines.length };
  }
  const counts = new Map();
  for (const line of verseLines) counts.set(line, (counts.get(line) || 0) + 1);
  let duplicates = 0;
  let topLineCount = 0;
  for (const count of counts.values()) {
    if (count > 1) duplicates += count - 1;
    if (count > topLineCount) topLineCount = count;
  }
  const duplicateRatio = duplicates / verseLines.length;
  const reasons = [];
  if (topLineCount >= 3) reasons.push('same_line_looped');
  if (duplicateRatio >= 0.25) reasons.push('verse_duplicate_ratio');
  return {
    valid: reasons.length === 0,
    reasons,
    duplicateRatio: Number(duplicateRatio.toFixed(3)),
    topLineCount,
    verseLineCount: verseLines.length,
  };
}

function buildShortTwitchIdeaExpansionGuidance({ winner = {}, routing = {}, seed = {} } = {}) {
  const text = cleanText(winner.text, '', 600);
  const folded = foldTwitchLyricText(text);
  if (!text) return '';
  const wordCount = countMeaningfulTwitchWords(text);
  const hasStructuredRequest = /\b(?:personnage|situation|probl[eè]me|histoire\s+compl[eè]te|sc[eé]nario|couplet|refrain|pont|morale|duo|voix)\b/.test(folded);
  if (hasStructuredRequest || (wordCount > 8 && text.length > 90)) return '';

  const parts = text.split(/\s*,\s*/).map((part) => cleanText(part, '', 120)).filter(Boolean);
  const title = parts[0] || text;
  const styleCue = parts.slice(1).join(', ');
  const styleText = styleCue || routing?.songMood || seed?.notes || '';
  return [
    `Brief Twitch court détecté: le viewer a donné surtout un titre/axe ("${title}")${styleText ? ` et une couleur ("${cleanText(styleText, '', 180)}")` : ''}.`,
    'Vivy doit enrichir elle-même: choisir une scène forte, un conflit, une progression et un refrain mémorable sans attendre un long brief utilisateur.',
    'L’enrichissement reste strictement dans le titre et le style demandés: ne pas importer d’ancien thème, de contexte Twitch, de moto, de gamin, de visière ou de vocabulaire recyclé si ce n’est pas dans la demande.',
    'Si un style précis est nommé, il devient une contrainte sonore prioritaire et doit guider les images, le débit, l’énergie et le vocabulaire de la chanson.',
  ].join('\n');
}

function sanitizeTwitchLyricsForPromptLeakage(lyrics = '') {
  const kept = [];
  let removed = 0;
  const forbidden = [
    /\br[èe]gles?\s+priv[ée]es?\b/i,
    /\bmode\s+(?:humour|paillarde?)\b/i,
    /\bnon\s+chantables?\b/i,
    /\bglitch\s+humain\b/i,
    /\bbanque\s+d['’]au\s+moins\s+huit\s+pivots\b/i,
    /\bpivots?\s+phon[ée]tiques?\s+distincts?\b/i,
    /\bdouble\s+intention\s+aux\s+mots[-\s]?pivots\b/i,
    /\bprivil[ée]gie\s+la\s+r[ée]v[ée]lation\s+retard[ée]e\b/i,
    /\bc[ée]sure[-\s]?pi[èe]ge\b/i,
    /\ble\s+silence\s+fait\s+partie\s+de\s+la\s+punchline\b/i,
    /\bla\s+blague\s+appartient\s+[àa]\s+l['’]auditeur\b/i,
    /\bseconde\s+lecture\s+doit\s+appara[îi]tre\b/i,
    /\bune\s+m[ée]taphore\s+technique\s+ne\s+compte\s+pas\b/i,
    /\bsi\s+le\s+second\s+sens\s+ne\s+s['’]entend\s+pas\b/i,
    /\bassociations?\s+saugrenues?\s+coh[ée]rentes?\b/i,
    /\bconstruis\s+silencieusement\s+plusieurs\s+cha[îi]nes\b/i,
    /\bd[ée]veloppe\s+au\s+moins\s+trois\s+familles\b/i,
    /\ble\s+lien\s+peut\s+venir\s+de\s+la\s+forme\b/i,
    /\butilise\s+la\s+syllepse\b/i,
    /\bliaison\s+v9\s+dynamique\b/i,
    /\bb[âa]timent\s+s[ée]mantique\b/i,
    /\bposologie\s+textuelle\b/i,
    /\bla\s+fa[çc]ade\s+est\s+le\s+th[èe]me\s+principal\b/i,
    /\bles\s+combles\s+abritent\s+le\s+sous[-\s]?th[èe]me\b/i,
    /\b[ée]quation\s+de\s+r[ée]percussion\b/i,
    /\bmauvaise\s+interpr[ée]tation\s+plausible\b/i,
    /\bcons[ée]quence\s+concr[èe]te\b/i,
    /\bsous[-\s]?texte\b/i,
    /\bdouble\s+lecture\b/i,
    /\bsecond\s+sens\b/i,
    /\bparodie\s+de\s+format\b/i,
    /\bformat\s+social\s+imit[ée]\b/i,
    /\bformat\s+donne\s+les\s+r[ôo]les\b/i,
    /\ble\s+moteur\s+comique\s+vient\s+du\s+contraste\b/i,
    /\bconstruis\s+une\s+escalade\s+nette\b/i,
    /\baucune\s+formulation\s+reconnaissable\b/i,
    /\bne\s+r[ée]cite\s+jamais\b/i,
    /\bne\s+nomme\s+pas\b/i,
    /\bne\s+dis\s+pas\b/i,
    /\bne\s+mets?\s+pas\s+le\s+mot\b/i,
    /\bne\s+chante\s+pas\b/i,
    /\bchaque\s+couplet\s+doit\b/i,
    /\bchamp\s+lexical\b/i,
    /\bexploite\s+ses\s+r[ée]percussions\b/i,
    /\bpour\s+un\s+th[èe]me\s+de\b/i,
    /\bsurface\s*:/i,
    /\bsous[-\s]?texte\s*:/i,
    /\bmorale\s+cach[ée]e\s*:/i,
    /\bsujet\s+visible\s*:/i,
    /\bdistribution\s+vocale(?:\s+choisie)?\s*:/i,
    /\bcasting\s+vocal\s*:/i,
    /\bvoix\s+s[ée]lectionn[ée]es?\s*:/i,
    /\bbanger\s+dans\s+les\s+paroles\b/i,
    /\bmati[èe]re\s+(?:[àa]\s+transformer|cr[ée]ative|composition)\s*:/i,
    /\bprompt\s+suno\s*:/i,
    /\bbrief\s+suno\s*:/i,
    /\bsuno[_\s-]?style[_\s-]?brief\b/i,
    /\bclean[_\s-]?lyrics\b/i,
    /\bparoles\s+propres\s*:/i,
    /\bparoles\s+finales\s*:/i,
    /\br[ée]ponds\s+uniquement\s+avec\s+les\s+paroles\b/i,
    /\b[ée]cris\s+les\s+paroles\s+compl[èe]tes\b/i,
    /\b[ée]cris\s+assez\s+de\s+mati[èe]re\b/i,
    /\butilise\s+des\s+sections\s+balis[ée]es\b/i,
    /\bsi\s+la\s+demande\s+contient\b/i,
    /\bsi\s+le\s+sujet\s+est\s+court\b/i,
    /\ble\s+budget\s+de\s+\d+\s+caract[èe]res\b/i,
    /\bcette\s+demande\s+est\s+autonome\b/i,
    /\bignore\s+l['’]historique\s+du\s+live\b/i,
    /\bconserve\s+tous\s+les\s+noms\b/i,
    /\bne\s+gonfle\s+jamais\s+la\s+dur[ée]e\b/i,
    /\bforme\s+de\s+chanson\s+vivante\b/i,
    /\blecture\s+s[ée]mantique\s+(?:du\s+sujet|sujet)\b/i,
    /\bconserver\s+les\s+indices\s+du\s+sujet\s+exact\b/i,
    /\bne\s+pas\s+inventer\s+un\s+h[ée]ros\s+intime\b/i,
    /\ble\s+mot\s+[«"'’]?\s*histoire\s*[»"'’]?\s+(?:est|reste)\s+ambigu/i,
    /\bserre\s+le\s+motif\s+central\s+jusqu/i,
    /\bd[ée]cor\s+de\s+la\s+sc[èe]ne\s*[:(]/i,
    /\bl['’]image\s+ouvre\s+la\s+sc[èe]ne\b/i,
    /\bdirection\s+sonore\s+partag[ée]e\b/i,
    /\bampleur\s+choisie\s+par\s+vivy\b/i,
    /\bvivy\s+d[ée]cide\s+la\s+longueur\b/i,
    /\bcontexte\s+social\s+est\s+une\s+boussole\b/i,
    /\baucun\s+ancien\s+th[èe]me\s+ne\s+doit\b/i,
    /\bvalidation\s+attendue\s+avant\s+suno\b/i,
    /\br[ée][ée]criture\s+obligatoire\b/i,
    /\bbrouillon\s+[àa]\s+transformer\b/i,
    /\btest\s+(?:oral|hook)\s+obligatoire\b/i,
    /\bcontrat\s+de\s+rimes?\b/i,
    /\bavant\s+suno\b/i,
    /\bprovider\s+pack\b/i,
    /\bfallback\b/i,
    /\bgrand\s+mod[èe]le\b/i,
    /\bllm\b/i,
    /\bnossen\b/i,
    /\bvivy\s+(?:[ée]crit|relit|renforce|analyse|pr[ée]pare)\b/i,
    /\bsong(?:text|mood|max|response|maxchars|artists?)\b/i,
    /\b(?:artist|singer)count\b/i,
    /\bvocalcast\b/i,
  ];
  for (const line of cleanLyrics(lyrics).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    const isSectionTag = /^\[[^\]]+\]$/.test(trimmed);
    if (!isSectionTag && forbidden.some((pattern) => pattern.test(trimmed))) {
      removed += 1;
      continue;
    }
    kept.push(line);
  }
  return {
    lyrics: cleanLyrics(kept.join('\n').replace(/\n{3,}/g, '\n\n')),
    removed,
  };
}

function assessTwitchSongLyrics(lyrics = '') {
  const text = cleanLyrics(lyrics);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const sectionCount = lines.filter((line) => /^\[(?:intro|verse|couplet|pre-chorus|pre-refrain|pré-refrain|chorus|refrain|bridge|pont|outro|final)(?:[^\]]*)\]$/i.test(line)).length;
  const sungLineCount = lines.filter((line) => !/^\[[^\]]+\]$/.test(line)).length;
  const conversational = /^(?:oui[,!. ]|je\s+(?:vois|comprends|peux|vais)|donc\b|si\s+(?:ça|cela)\s+aide\b|voici\b|bien\s+s[uû]r\b)/i.test(text)
    || /\b(?:dans\s+notre\s+[ée]change|on\s+peut\s+repartir\s+de\s+l[àa]|qu['’]est-ce\s+qui\s+change|je\s+vois\s+ce\s+que\s+tu\s+veux\s+dire)\b/i.test(text);
  const hasSongShape = sectionCount >= 1 || sungLineCount >= 6;
  const valid = text.length >= 120 && hasSongShape && !conversational;
  const reasons = [];
  if (text.length < 120) reasons.push('too_short');
  if (!hasSongShape) reasons.push('missing_song_shape');
  if (conversational) reasons.push('conversational_reply');
  return {
    valid,
    reasons,
    length: text.length,
    sectionCount,
    sungLineCount,
  };
}

function extractTwitchLyricSectionBlocks(lyrics = '') {
  const blocks = [];
  let current = null;
  for (const rawLine of cleanLyrics(lyrics).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      if (current?.lines?.length) blocks.push(current);
      const foldedHeader = foldTwitchLyricText(header[1]);
      current = {
        header: header[1],
        kind: /\b(final|dernier)\b/.test(foldedHeader) && /\b(chorus|refrain)\b/.test(foldedHeader)
          ? 'final_chorus'
          : /\b(chorus|refrain)\b/.test(foldedHeader)
            ? 'chorus'
            : /\b(pre|pré)\b/.test(foldedHeader)
              ? 'prechorus'
              : /\b(bridge|pont)\b/.test(foldedHeader)
                ? 'bridge'
                : /\b(outro|fin)\b/.test(foldedHeader)
                  ? 'outro'
                  : /\b(intro)\b/.test(foldedHeader)
                    ? 'intro'
                    : 'verse',
        lines: [],
      };
      continue;
    }
    if (!current) current = { header: 'Intro', kind: 'intro', lines: [] };
    current.lines.push(line);
  }
  if (current?.lines?.length) blocks.push(current);
  return blocks;
}

function assessTwitchHookMechanic(lyrics = '', subject = '') {
  const text = cleanLyrics(lyrics);
  const sungLines = text.split('\n').map((line) => line.trim()).filter((line) => line && !/^\[[^\]]+\]$/.test(line));
  const uniqueLines = new Set(sungLines.map((line) => foldTwitchLyricText(line))).size;
  const repeatedLineRatio = sungLines.length ? (sungLines.length - uniqueLines) / sungLines.length : 1;
  const blocks = extractTwitchLyricSectionBlocks(text);
  const choruses = blocks.filter((block) => block.kind === 'chorus' || block.kind === 'final_chorus');
  const firstChorus = choruses[0]?.lines?.join('\n') || '';
  const finalChorus = [...choruses].reverse().find((block) => block.kind === 'final_chorus')?.lines?.join('\n')
    || choruses.at(-1)?.lines?.join('\n')
    || '';
  const subjectHead = cleanText(String(subject || '').split(/[,.;:!?]/)[0], '', 140);
  const foldedSubjectHead = foldTwitchLyricText(subjectHead);
  const chorusText = choruses.map((block) => block.lines.join('\n')).join('\n');
  const foldedChorus = foldTwitchLyricText(chorusText);
  const titleEchoCount = foldedSubjectHead
    ? (foldedChorus.match(new RegExp(`\\b${foldedSubjectHead.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length
    : 0;
  let staticChorusLines = 0;
  if (choruses.length >= 2) {
    const laterChorusLines = new Set(choruses.slice(1)
      .flatMap((block) => block.lines.map((line) => foldTwitchLyricText(line))));
    for (const line of choruses[0].lines) {
      if (laterChorusLines.has(foldTwitchLyricText(line))) staticChorusLines += 1;
    }
  }
  const chorusSimilarity = firstChorus && finalChorus ? jaccardSimilarity(firstChorus, finalChorus) : 0;
  const actionVerbs = (foldTwitchLyricText(text).match(/\b(?:vole|voler|derobe|derober|prend|reprend|rend|revient|retourne|change|deforme|transforme|contamine|repond|efface|laisse|oublie|garde|emporte|attrape|piege)\b/g) || []).length;
  const reasons = [];
  if (choruses.length < 2) reasons.push('missing_hook_return');
  if (titleEchoCount >= 2 && repeatedLineRatio >= 0.14) reasons.push('title_slogan_loop');
  if (staticChorusLines >= 1 && chorusSimilarity >= 0.34) reasons.push('static_chorus');
  if (actionVerbs < 4) reasons.push('hook_not_acting');
  return {
    valid: reasons.length === 0,
    reasons,
    chorusCount: choruses.length,
    repeatedLineRatio,
    titleEchoCount,
    staticChorusLines,
    chorusSimilarity,
    actionVerbs,
  };
}

function sanitizeTwitchLyricsForSubjectDetailed(lyrics = '', subject = '', context = '') {
  const foldedSubject = foldTwitchLyricText([subject, context].filter(Boolean).join('\n'));
  const freestyleSubject = isRapFreestyleRequest(subject, context);
  const vehicleSubject = freestyleSubject
    || /\b(moto|motard|scooter|booster|tzr|derbi|casque|visiere|guidon|poursuite|course|rallye|voiture|volant|autoroute)\b/i
      .test(foldedSubject);
  const blockedTerms = TWITCH_OPERATIONAL_LEAK_TERMS
    .filter((term) => !hasFoldedWord(foldedSubject, term));
  const blockedVehicleTerms = vehicleSubject
    ? []
    : TWITCH_VEHICLE_LEAK_TERMS.filter((term) => !hasFoldedWord(foldedSubject, term));
  const allowedGroups = allowedTwitchContextLeakGroups(subject, context);
  const blockedGroups = freestyleSubject
    ? []
    : TWITCH_CONTEXT_LEAK_GROUPS
      .filter((group) => !allowedGroups.has(group.name))
      .map((group) => ({
        ...group,
        terms: group.terms.filter((term) => !hasFoldedWord(foldedSubject, term)),
      }))
      .filter((group) => group.terms.length);
  if (!blockedTerms.length && !blockedVehicleTerms.length && !blockedGroups.length) {
    return { lyrics: cleanLyrics(lyrics), removed: 0, groups: [] };
  }

  const kept = [];
  let removed = 0;
  let vehicleLinesTolerated = 0;
  const vehicleToleranceAllowed = /\b(?:rap|freestyle|cypher|egotrip|ego\s+trip|clash|punchlines?|sombre|street|rue|bitume|urbain|urbaine)\b/.test(foldedSubject);
  const groups = new Set();
  for (const line of String(lyrics || '').split(/\n/)) {
    const folded = foldTwitchLyricText(line);
    const isSectionTag = /^\s*\[[^\]]+\]\s*$/.test(line);
    const leaksOperational = !isSectionTag && blockedTerms.some((term) => hasFoldedWord(folded, term));
    const leaksVehicle = !isSectionTag && blockedVehicleTerms.some((term) => hasFoldedWord(folded, term));
    const leakedGroup = !isSectionTag
      ? blockedGroups.find((group) => group.terms.some((term) => hasFoldedWord(folded, term)))
      : null;
    if (leaksOperational || leaksVehicle || leakedGroup) {
      const vehicleOnlyLeak = !leaksOperational
        && (leaksVehicle || leakedGroup?.name === 'vehicle_chase')
        && (!leakedGroup || leakedGroup.name === 'vehicle_chase');
      if (vehicleOnlyLeak && vehicleToleranceAllowed && vehicleLinesTolerated < TWITCH_VEHICLE_LEAK_ALLOWANCE) {
        vehicleLinesTolerated += 1;
        kept.push(line);
        continue;
      }
      removed += 1;
      if (leaksOperational) groups.add('operational');
      if (leaksVehicle) groups.add('vehicle_chase');
      if (leakedGroup) groups.add(leakedGroup.name);
      continue;
    }
    kept.push(line);
  }
  return {
    lyrics: cleanLyrics(kept.join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\[\s*(Verse|Couplet)\s*\]/gi, '[Verse]')
    ),
    removed,
    tolerated: vehicleLinesTolerated,
    groups: Array.from(groups),
  };
}

function sanitizeTwitchLyricsForSubject(lyrics = '', subject = '', context = '') {
  return sanitizeTwitchLyricsForSubjectDetailed(lyrics, subject, context).lyrics;
}

function hasTwitchProviderLyricsLeakage(lyrics = '') {
  const text = cleanLyrics(lyrics, 12000);
  return /\bstyle\s*:/i.test(text)
    || /\b(?:prompt|brief|suno|mureka|provider|mod[èe]le|model|negative\s+prompt|distribution\s+vocale|casting\s+vocal|direction\s+sonore|canevas|mati[èe]re\s+(?:[àa]\s+transformer|cr[ée]ative|composition)|banger\s+dans\s+les\s+paroles|clean[_\s-]?lyrics|paroles\s+propres|consignes?|r[èe]gles?\s+priv[ée]es?|non\s+chantables?|fallback|grand\s+mod[èe]le|llm|provider\s+pack|ne\s+(?:mets|chante|r[ée]cite|dis)\s+pas)\b/i
    .test(text);
}

function hasTwitchProviderStyleLyricsLeakage(styleBrief = '') {
  const text = String(styleBrief || '');
  return /\[(?:intro|verse|couplet|pre[-\s]?chorus|pr[ée][- ]?refrain|chorus|refrain|bridge|pont|outro|final(?:\s+chorus)?)[^\]]*\]/i
    .test(text)
    || /\blyrics\s*:/i.test(text)
    || text.split(/\n/).filter((line) => line.trim()).length >= 5;
}

function sanitizeTwitchProviderStyleBrief(styleBrief = '', fallback = '') {
  const source = String(styleBrief || '');
  const withoutLyrics = hasTwitchProviderStyleLyricsLeakage(source)
    ? source.replace(/\blyrics\s*:[\s\S]*$/i, '').replace(/\[(?:intro|verse|couplet|pre[-\s]?chorus|pr[ée][- ]?refrain|chorus|refrain|bridge|pont|outro|final(?:\s+chorus)?)[^\]]*\][\s\S]*$/i, '')
    : source;
  return cleanText(withoutLyrics, '', 1200) || cleanText(fallback, 'French original song, expressive vocals, modern mix', 1200);
}

function buildTwitchProviderPack({
  lyrics = '',
  styleBrief = '',
  fallbackStyle = '',
  instrumentalMode = false,
  maxLyricsChars = 12000,
} = {}) {
  const styleHadLeakage = hasTwitchProviderStyleLyricsLeakage(styleBrief);
  const cleanStyleBrief = sanitizeTwitchProviderStyleBrief(styleBrief, fallbackStyle);
  if (instrumentalMode) {
    return {
      cleanLyrics: '',
      styleBrief: cleanStyleBrief,
      lyricLeakage: false,
      styleLeakage: styleHadLeakage,
    };
  }

  let cleanProviderLyrics = extractCleanTwitchLyricsBlock(lyrics, maxLyricsChars);
  const beforeLeakage = hasTwitchProviderLyricsLeakage(cleanProviderLyrics);
  const promptLeakage = sanitizeTwitchLyricsForPromptLeakage(cleanProviderLyrics);
  cleanProviderLyrics = cleanLyrics(promptLeakage.lyrics.split('\n')
    .filter((line) => /^\s*\[[^\]]+\]\s*$/.test(line) || !hasTwitchProviderLyricsLeakage(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n'), maxLyricsChars);
  cleanProviderLyrics = cleanLyrics(reduceMechanicalLyricRepeats(cleanProviderLyrics), maxLyricsChars);
  const afterLeakage = hasTwitchProviderLyricsLeakage(cleanProviderLyrics);
  return {
    cleanLyrics: cleanProviderLyrics,
    styleBrief: cleanStyleBrief,
    lyricLeakage: beforeLeakage || promptLeakage.removed > 0 || afterLeakage,
    styleLeakage: styleHadLeakage,
  };
}

function isTwitchInstrumentalSoundDesignRequest(...values) {
  const folded = foldTwitchLyricText(values.map((value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return [value.canvas, value.notes, value.text, value.message, value.prompt].filter(Boolean).join(' ');
  }).join(' '));
  return /\b(?:instrumental|instrumentale|instrumentaux|sans\s+paroles?|pas\s+de\s+paroles?|aucune?\s+paroles?|no\s+vocals?|no\s+lyrics?|no\s+singing|bruitages?|bruits?\s+sonores?|sfx|sound\s+effects?|foley|sound\s+design|ambiance\s+sonore)\b/.test(folded);
}

function isDefaultTwitchNossenNote(value = '') {
  const folded = foldTwitchLyricText(value);
  return /construire\s+une\s+vraie\s+progression\s+dramatique/.test(folded)
    && /troisieme\s+intention|troisième\s+intention/.test(folded)
    && /eviter\s+les\s+images\s+passe[-\s]+partout|éviter\s+les\s+images\s+passe[-\s]+partout/.test(folded);
}

function isDefaultTwitchNossenCanvas(value = '') {
  const folded = foldTwitchLyricText(value);
  return /matiere\s+twitch\s+gagnante|matière\s+twitch\s+gagnante/.test(folded)
    && /objectif\s+transformer\s+la\s+demande\s+gagnante/.test(folded)
    && /architecture\s+narrative\s+attendue/.test(folded)
    && /lecture\s+a\s+trois\s+intentions|lecture\s+à\s+trois\s+intentions/.test(folded);
}

function wantsNarrativeLyricGuidance({ winner = {}, seed = {}, intentPlan = {}, routing = {} } = {}) {
  const creative = foldTwitchLyricText([
    winner.text,
    isDefaultTwitchNossenNote(seed.notes) ? '' : seed.notes,
    isDefaultTwitchNossenCanvas(seed.canvas) ? '' : seed.canvas,
    intentPlan.intent,
    intentPlan.generationBrief,
    routing.songMood,
  ].filter(Boolean).join('\n'));
  return intentPlan.intent === 'narrative_fable'
    || /\b(?:histoire|scenario|sc[eé]nario|fable|morale|troisieme\s+intention|troisième\s+intention|personnage|scene\s+finale|sc[eè]ne\s+finale|duo|dialogue|couplet\s+1|couplet\s+2|pont\s+dramatique|bascule|version\s+longue|format\s+long|saga|fresque|no\s+limit|no\s+limite)\b/.test(creative);
}

function resolveTwitchSubjectFrame(...values) {
  const source = values
    .flatMap((value) => {
      if (!value) return [];
      if (typeof value === 'string') return [value];
      return [value.text, value.message, value.prompt, value.canvas, value.notes].filter(Boolean);
    })
    .join('\n');
  const folded = foldTwitchLyricText(source);
  const mentionsHistory = /\bhistoire\b/.test(folded);
  const collectiveStrong = [
    /\b(?:l[' ]histoire|histoire)\s+(?:generale|collective|mondiale|humaine|de\s+l[' ]humanite|des\s+peuples|des\s+civilisations)\b/,
    /\b(?:a|à)\s+travers\s+les\s+ages\b/,
    /\bau\s+fil\s+des\s+(?:ages|siecles|epoques)\b/,
    /\bdepuis\s+(?:la\s+)?prehistoire\b/,
    /\bdes\s+premiers\s+(?:hommes|peuples|empires)\s+(?:a|à|jusqu)/,
  ].filter((pattern) => pattern.test(folded)).length;
  const collectiveTerms = (folded.match(
    /\b(?:ages|siecles|epoques|prehistoire|antiquite|moyen\s+age|renaissance|civilisations?|humanite|peuples?|empires?|royaumes?|revolutions?|batailles?|guerres?|decouvertes?|inventions?|conquetes?|dynasties?|archives?|memoire\s+collective)\b/g
  ) || []).length;
  const personalStrong = [
    /\b(?:mon|ma|notre|nos|son|sa|leur)\s+histoire\b/,
    /\bhistoire\s+d[' ]amour\b/,
    /\bhistoire\s+(?:d[' ]un|d[' ]une)\s+(?:homme|femme|fille|garcon|garçon|couple|famille)\b/,
    /\b(?:ma|sa|notre|leur)\s+vie\b/,
  ].filter((pattern) => pattern.test(folded)).length;
  const personalTerms = (folded.match(
    /\b(?:souvenir|souvenirs|enfance|rupture|amour|couple|famille|solitude|journal\s+intime|confession|biographie|autobiographie)\b/g
  ) || []).length;

  const collectiveScore = collectiveStrong * 4 + Math.min(collectiveTerms, 5);
  const personalScore = personalStrong * 4 + Math.min(personalTerms, 4);
  if (collectiveScore >= 4 && collectiveScore > personalScore) {
    return {
      kind: 'collective_history',
      confidence: Math.min(0.99, 0.72 + collectiveScore * 0.04),
      reason: 'Les marqueurs temporels et civilisationnels désignent l’Histoire collective, pas une biographie intime.',
      guidance: 'Axe de sujet prioritaire: l’Histoire collective à travers plusieurs époques. Montrer peuples, civilisations, découvertes, conflits, transmissions et transformations du monde. Ne pas réduire le thème à un protagoniste contemporain solitaire, une chambre, une confession ou une romance, sauf demande explicite.',
    };
  }
  if (personalScore >= 4 && personalScore > collectiveScore) {
    return {
      kind: 'personal_story',
      confidence: Math.min(0.97, 0.72 + personalScore * 0.04),
      reason: 'Les possessifs et marqueurs biographiques désignent un parcours personnel.',
      guidance: 'Axe de sujet prioritaire: récit personnel ou relationnel. Suivre le personnage, ses choix et son évolution sans élargir artificiellement vers une fresque historique.',
    };
  }
  return {
    kind: mentionsHistory ? 'ambiguous_history' : 'open',
    confidence: mentionsHistory ? 0.45 : 0.35,
    reason: mentionsHistory
      ? 'Le mot « histoire » reste ambigu entre récit et Histoire collective.'
      : 'Aucune ambiguïté particulière entre récit personnel et Histoire collective.',
    guidance: mentionsHistory
      ? 'Le mot « histoire » est ambigu: conserver les indices du sujet exact. Ne pas inventer un héros intime si la demande évoque des âges, siècles, peuples, batailles, découvertes ou civilisations.'
      : '',
  };
}

function reinforceTwitchSubjectFrameRouting(routing = {}, subjectFrame = {}) {
  if (subjectFrame?.kind !== 'collective_history') return routing;
  const currentMood = cleanText(routing?.songMood, '', 520);
  const collectiveDirection = 'fresque historique collective et chronologique, progression entre époques, civilisations, batailles, découvertes et transmissions, instrumentation qui évolue avec les âges, aucune confession intime ni héros contemporain solitaire';
  return {
    ...routing,
    songMood: cleanText(`${collectiveDirection}, ${currentMood}`, collectiveDirection, 760),
  };
}

function wantsStrictRhymeCheck(...values) {
  const folded = foldTwitchLyricText(values.filter(Boolean).join('\n'));
  return /\b(?:rime|rimes|rimer|rap|flow|phon[ée]tique|calembour|calembours|jeux?\s+de\s+mots|allusion|allusions|paillard|paillarde|grivois|grivoise|double\s+sens|sous\s+entendu|sous\s+entendus)\b/.test(folded);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function resolveTwitchDurationAcceptance({
  durationSeconds = 0,
  minAcceptableSeconds = DEFAULT_MIN_ACCEPTABLE_SECONDS,
  env = process.env,
} = {}) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const desiredMinimum = Math.max(1, Number(minAcceptableSeconds) || DEFAULT_MIN_ACCEPTABLE_SECONDS);
  const hardMinimum = clampNumber(
    env.VIVY_STREAM_HARD_MIN_ACCEPTABLE_SECONDS,
    60,
    120,
    DEFAULT_HARD_MIN_ACCEPTABLE_SECONDS
  );
  const shortMixThreshold = clampNumber(
    env.VIVY_STREAM_SHORT_MIX_ACCEPT_SECONDS,
    hardMinimum,
    desiredMinimum,
    DEFAULT_SHORT_MIX_ACCEPT_SECONDS
  );
  const blocking = duration < hardMinimum;
  const shortMix = !blocking && duration < desiredMinimum;
  return {
    ok: !blocking,
    blocking,
    shortMix,
    note: shortMix ? 'version courte générée' : '',
    durationSeconds: Math.round(duration),
    hardMinimumSeconds: Math.round(hardMinimum),
    shortMixAcceptSeconds: Math.round(shortMixThreshold),
    desiredMinimumSeconds: Math.round(desiredMinimum),
  };
}

function isPaidMusicRetryConfirmed(payload = {}) {
  return payload.confirmPaidRetries === true
    || payload.adminConfirmPaidRetries === true
    || payload.paidRetryConfirmed === true
    || String(process.env.VIVY_STREAM_ALLOW_PAID_AUTO_EXTENSIONS || '').trim() === '1';
}

function parseRequestedDurationSeconds(text = '') {
  const raw = String(text || '');
  const minuteMatch = raw.match(/\b(\d+(?:[,.]\d+)?)\s*(?:min|minutes?)\b/i);
  if (minuteMatch) {
    const minutes = Number(String(minuteMatch[1]).replace(',', '.'));
    if (Number.isFinite(minutes) && minutes > 0) return Math.round(minutes * 60);
  }
  const secondMatch = raw.match(/\b(\d{2,4})\s*(?:s|sec|secs|secondes?)\b/i);
  if (secondMatch) {
    const seconds = Number(secondMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
  }
  return 0;
}

function resolveTwitchVivyLyricScope({
  winner = {},
  seed = {},
  intentPlan = {},
  routing = {},
  instrumentalMode = false,
  musicProvider = '',
  configuredTargetDurationSeconds = 0,
  configuredMinAcceptableSeconds = 0,
  defaultTargetDurationSeconds = DEFAULT_TARGET_DURATION_SECONDS,
} = {}) {
  const minTarget = clampNumber(process.env.VIVY_STREAM_MIN_TARGET_DURATION_SECONDS, 90, 300, DEFAULT_DYNAMIC_MIN_TARGET_SECONDS);
  const maxTarget = clampNumber(process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS, minTarget, 900, DEFAULT_DYNAMIC_MAX_TARGET_SECONDS);
  const freestyleMaxChars = clampNumber(process.env.VIVY_STREAM_FREESTYLE_MAX_CHARS, 8800, 16000, 12000);
  const freestyleMaxTokens = clampNumber(process.env.VIVY_STREAM_FREESTYLE_MAX_TOKENS, 8000, 16000, 10000);
  const creativeText = [
    winner.text,
    intentPlan.intent,
    intentPlan.generationBrief,
    routing.songMood,
  ].filter(Boolean).join('\n');
  const folded = foldTwitchLyricText(creativeText);
  const requestedDuration = parseRequestedDurationSeconds(creativeText);
  const explicitShort = /\b(?:court|courte|format\s+court|short|radio\s+edit|g[ée]n[ée]rique|opening|jingle|tiktok|shorts?|moins\s+de\s+3\s*min)\b/.test(folded);
  const explicitNoLimit = /\b(?:saga|fresque|no\s+limit|no\s+limite|sans\s+limite|aucune\s+limite|6\s*minutes?|7\s*minutes?|8\s*minutes?)\b/.test(folded);
  const explicitLong = explicitNoLimit
    || /\b(?:version\s+longue|format\s+long|forme\s+longue|morceau\s+long|chanson\s+longue|5\s*minutes?)\b/.test(folded);
  const explicitDevelopedStory = /\b(?:histoire\s+complete|histoire\s+compl[eè]te|histoire\s+du\s+d[eé]but\s+[aà]\s+la\s+fin|sc[eé]nario|scenario|mini\s+histoire|fable\s+narrative)\b/.test(folded);
  const scenarioSignals = (folded.match(/\b(?:personnage|situation|probleme|probl[eè]me|evolution|[ée]volution|scene\s+finale|sc[eè]ne\s+finale|couplet\s+1|couplet\s+2|pont|bascule|morale|troisieme\s+intention|troisième\s+intention|duo|dialogue)\b/g) || []).length;
  const userMaterialLength = String(winner.text || '').length
    + String(intentPlan.generationBrief || '').length;
  const subjectComplexity = userMaterialLength + scenarioSignals * 90;
  const humorWordplay = isHumorWordplayRequest(creativeText, seed.notes);
  const intenseSubject = /\b(?:intense|sombre|egotrip|ego\s+trip|clash|rage|rageu(?:x|se)s?|violent[es]?|violence|brutal[es]?|haine|vengeance|guerre|sanglant[es]?|nocturne|d[ée]mons?|enfer|apocalypse)\b/.test(folded);
  const freestyleSubject = isRapFreestyleRequest(creativeText, seed.notes);
  const murekaProvider = cleanText(musicProvider, '', 40).toLowerCase() === 'mureka';
  const structuredStory = explicitDevelopedStory
    || scenarioSignals >= 4
    || intentPlan.intent === 'narrative_fable';

  let label = 'ample';
  let target = clampNumber(defaultTargetDurationSeconds, minTarget, maxTarget, DEFAULT_TARGET_DURATION_SECONDS);
  let minAcceptable = DEFAULT_MIN_ACCEPTABLE_SECONDS;
  let minLyricsChars = 900;
  let maxChars = 6400;
  let maxTokens = 6200;
  let chaseDuration = false;

  if (configuredTargetDurationSeconds > 0) {
    target = clampNumber(configuredTargetDurationSeconds, minTarget, maxTarget, DEFAULT_TARGET_DURATION_SECONDS);
    label = 'fixée par configuration';
    chaseDuration = true;
  } else if (requestedDuration > 0) {
    target = clampNumber(requestedDuration, minTarget, maxTarget, DEFAULT_TARGET_DURATION_SECONDS);
    label = target >= 360 ? 'longue demandée' : target <= 210 ? 'courte demandée' : 'durée demandée';
    chaseDuration = true;
  } else if (explicitLong) {
    target = explicitNoLimit
      ? clampNumber(DEFAULT_NO_LIMIT_TARGET_SECONDS, minTarget, maxTarget, DEFAULT_NO_LIMIT_TARGET_SECONDS)
      : clampNumber(DEFAULT_LONG_TARGET_SECONDS, minTarget, maxTarget, DEFAULT_LONG_TARGET_SECONDS);
    label = explicitNoLimit ? 'no-limit créatif' : 'version longue';
    chaseDuration = !explicitNoLimit;
  } else if (explicitShort) {
    target = 180;
    label = 'format nerveux';
  } else if (structuredStory || subjectComplexity >= 680) {
    target = subjectComplexity >= 980 || scenarioSignals >= 7 ? 300 : 270;
    label = intentPlan.intent === 'narrative_fable' ? 'fable narrative' : 'histoire structurée';
  } else if (subjectComplexity >= 520) {
    target = 240;
    label = 'ample';
  }

  if (humorWordplay && requestedDuration <= 0 && !explicitLong && target < 210) {
    target = 210;
    label = 'comédie à mécanisme';
  }

  if (intenseSubject && configuredTargetDurationSeconds <= 0 && requestedDuration <= 0 && !explicitShort && target < DEFAULT_LONG_TARGET_SECONDS) {
    target = clampNumber(DEFAULT_LONG_TARGET_SECONDS, minTarget, maxTarget, DEFAULT_LONG_TARGET_SECONDS);
    label = 'intense longue';
  }

  if (target <= 210) {
    minAcceptable = 150;
    minLyricsChars = instrumentalMode ? 0 : 520;
    maxChars = 2600;
    maxTokens = 3600;
  } else if (target <= 300) {
    minAcceptable = 150;
    minLyricsChars = instrumentalMode ? 0 : 900;
    maxChars = 5600;
    maxTokens = 5600;
  } else if (target <= 420) {
    minAcceptable = 180;
    minLyricsChars = instrumentalMode ? 0 : 1400;
    maxChars = 8800;
    maxTokens = 7600;
  } else {
    minAcceptable = 210;
    minLyricsChars = instrumentalMode ? 0 : 1800;
    maxChars = 12000;
    maxTokens = 9000;
  }

  if (humorWordplay && !instrumentalMode) {
    minLyricsChars = Math.max(minLyricsChars, target <= 210 ? 820 : 1100);
    maxChars = Math.max(maxChars, target <= 210 ? 3600 : 6200);
    maxTokens = Math.max(maxTokens, target <= 210 ? 4200 : 6200);
  }

  if (murekaProvider && !instrumentalMode) {
    minLyricsChars = Math.max(minLyricsChars, target <= 210 ? 1400 : 1700);
    maxChars = Math.max(maxChars, target <= 210 ? 4200 : 6800);
    maxTokens = Math.max(maxTokens, target <= 210 ? 5200 : 6800);
  }

  if ((intenseSubject || freestyleSubject) && !instrumentalMode) {
    maxChars = Math.max(maxChars, freestyleMaxChars);
    maxTokens = Math.max(maxTokens, freestyleMaxTokens);
  }

  if (cleanText(musicProvider, '', 40).toLowerCase() === 'suno' && !instrumentalMode) {
    // Suno custom mode rejette les paroles au-dela de 5000 caracteres (API 400).
    maxChars = Math.min(maxChars, 4800);
  }

  if (chaseDuration) {
    minAcceptable = Math.max(minAcceptable, Math.round(target * 0.8));
  }

  if (configuredMinAcceptableSeconds > 0) {
    const configuredFloor = clampNumber(configuredMinAcceptableSeconds, 60, target, minAcceptable);
    minAcceptable = chaseDuration
      ? Math.max(minAcceptable, configuredFloor)
      : configuredFloor;
  }

  return {
    label,
    targetDurationSeconds: Math.round(target),
    minAcceptableSeconds: Math.round(Math.min(minAcceptable, target)),
    minLyricsChars,
    maxChars,
    maxTokens,
    chaseDuration,
    freeStructure: intenseSubject || freestyleSubject,
    reason: label === 'intense longue'
      ? 'Sujet intense: version longue d’office, structure libre en plusieurs longs couplets.'
      : explicitLong
      ? (explicitNoLimit ? 'La demande donne une carte blanche longue, sans obligation de remplir le maximum.' : 'La demande appelle une version longue sans étirer artificiellement.')
      : explicitShort
        ? 'La demande ressemble à un format court ou opening.'
        : structuredStory
          ? 'La demande contient une vraie structure narrative à développer.'
          : subjectComplexity >= 520
          ? 'La demande contient assez de matière narrative pour développer.'
          : 'Vivy choisit une ampleur équilibrée.',
  };
}

function buildTwitchInstrumentalDirection({ winner = {}, seed = {}, routing = {}, intentPlan = {} } = {}) {
  return cleanText([
    intentPlan?.generationBrief ? `Brief intention: ${intentPlan.generationBrief}` : '',
    intentPlan?.intent ? `Type de production: ${intentPlan.intent}. SFX=${intentPlan.sfxPriority || 'none'}. Voix=${intentPlan.vocalPolicy || 'forbid'}.` : '',
    'Mode demandé: instrumental pur / sound design. Ne pas écrire ni chanter de paroles.',
    'Suno doit recevoir une piste instrumentale: no vocals, no singing, no spoken words, no narration, no rap lead.',
    'Transformer l’histoire en motifs musicaux, silences, impacts, bruitages et textures diégétiques.',
    'Si le sujet contient des bruitages précis, les garder comme éléments sonores réels dans le style.',
    /cowboy|cow\s*boy|sherif|shérif|western|duel|saloon|cheval|revolver|soleil\s+couchant/i.test(`${winner.text || ''}\n${seed.canvas || ''}\n${routing.songMood || ''}`)
      ? 'Palette western utile: vent de poussière, pas de cheval, éperons, porte de saloon, cuir, revolver armé, sifflement, guitare sèche, cloche lointaine.'
      : '',
  ].filter(Boolean).join('\n'), '', 1400);
}

function logVivyIntentPlan(logger = console, plan = {}) {
  logger.info?.('[VivyIntentRouter] intent=%s', cleanText(plan.intent, 'unknown', 80));
  logger.info?.('[VivyIntentRouter] shouldGenerateLyrics=%s', plan.shouldGenerateLyrics === true ? 'true' : 'false');
  logger.info?.('[VivyIntentRouter] shouldUseVocals=%s', plan.shouldUseVocals === true ? 'true' : 'false');
  logger.info?.('[VivyIntentRouter] sfxPriority=%s', cleanText(plan.sfxPriority, 'none', 40));
  logger.info?.('[VivyIntentRouter] reason=%s', cleanText(plan.reason, 'not provided', 240));
}

async function probeMediaDurationSeconds(media = {}) {
  const reported = Number(media.durationSeconds || media.duration || 0);
  if (Number.isFinite(reported) && reported > 0) return reported;
  const filePath = String(media.path || '').trim();
  if (!filePath) return 0;
  try {
    const { stdout } = await execFileAsync(
      String(process.env.FFPROBE_BIN || 'ffprobe').trim() || 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 15000, windowsHide: true }
    );
    const duration = Number(String(stdout || '').trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function buildTwitchLyricsRequest({
  winner,
  routing,
  seed,
  lyricScope = {},
  socialPromptContextText = '',
  subjectFrame = {},
}) {
  const artists = Array.isArray(routing?.artists) && routing.artists.length
    ? routing.artists.join(' + ')
    : 'Vivy';
  const narrativeGuidance = wantsNarrativeLyricGuidance({ winner, routing, seed });
  const collectiveHistory = subjectFrame?.kind === 'collective_history';
  const activeNotes = seed?.notes && !isDefaultTwitchNossenNote(seed.notes) ? seed.notes : '';
  const rhymeRequested = /\b(?:rimes?|rap|flow|phon[ée]tique|calembours?|jeux?\s+de\s+mots|paillard|paillarde|grivois|grivoise)\b/i
    .test([winner.text, routing?.songMood, activeNotes].filter(Boolean).join('\n'));
  const sceneDecor = cleanText(sanitizeCoverVisualIdea(winner.text, winner.text), '', 300);
  return [
    `Écris les paroles complètes et directement chantables d'une chanson originale sur ce sujet exact: ${winner.text}`,
    subjectFrame?.guidance ? `Lecture sémantique du sujet: ${subjectFrame.guidance}` : '',
    sceneDecor
      ? `Décor de la scène (l'image ouvre la scène, tu chantes dedans): ${sceneDecor}. Ancre au moins une image concrète de ce décor sans jamais le décrire comme une consigne.`
      : '',
    `Direction sonore partagée avec la composition: ${routing?.songMood || 'moderne, précise et liée au sujet'}.`,
    `Casting vocal: ${artists}.`,
    lyricScope?.label ? `Ampleur choisie par Vivy: ${lyricScope.label}. ${lyricScope.reason || ''}` : '',
    lyricScope?.freeStructure
      ? 'Structure libre: plusieurs longs couplets continus qui montent en intensité; refrain, pré-refrain et pont facultatifs, seulement si le sujet les appelle.'
      : '',
    lyricScope?.targetDurationSeconds
      ? `Vivy décide la longueur: vise une forme adaptée à environ ${Math.round(lyricScope.targetDurationSeconds)} secondes de chanson, sans remplir artificiellement.`
      : 'Vivy décide librement la longueur selon l’histoire et l’énergie du sujet.',
    buildShortTwitchIdeaExpansionGuidance({ winner, routing, seed }),
    lyricScope?.minLyricsChars
      ? `Écris assez de matière pour que la chanson respire; vise au moins ${lyricScope.minLyricsChars} caractères utiles seulement si les scènes l’exigent, avec des sections qui avancent.`
      : '',
    lyricScope?.maxChars
      ? `Le budget de ${lyricScope.maxChars} caractères est un plafond, pas un objectif: privilégie la densité, la variation et la chute propre plutôt que le remplissage.`
      : '',
    activeNotes,
    socialPromptContextText
      ? `${socialPromptContextText}\nRègle absolue: ce contexte social est une boussole créative privée. Il ne doit jamais apparaître tel quel dans les paroles, ni sous forme de liste, de hashtag, de statistiques ou de phrase technique.`
      : '',
    buildV9SemanticResonanceGuidance({ lyricScope }),
    buildHookMechanicGuidance({ winner, routing, seed }),
    buildHumorWordplayGuidance({ winner, routing, seed }),
    buildParodyFormatGuidance({ winner, routing, seed }),
    buildRapFreestyleGuidance({ winner, routing, seed }),
    buildPhoneticWordplayGuidance({ winner, routing, seed }),
    buildAssociativeWordplayGuidance({ winner, routing, seed }),
    buildBawdyWordplayGuidance({ winner, routing, seed }),
    'Cette demande est autonome: ignore l’historique du live, les anciens titres, les anciennes chansons et le jukebox. Aucun ancien thème ne doit entrer dans les paroles sauf s’il est explicitement dans le sujet exact.',
    buildTwitchContextIsolationGuidance({ winner, routing, seed }),
    'Conserve tous les noms, objets et détails distinctifs du sujet. Ne remplace pas la demande par une histoire générique.',
    narrativeGuidance
      ? (collectiveHistory
        ? 'Traite la chanson comme une fresque historique collective: ouverture sur le temps long, traversée de plusieurs époques, conflits et découvertes, transmission entre générations, puis image finale reliant le passé au présent.'
        : 'Traite la chanson comme une mini-histoire complète: sujet + personnages + problème + évolution + scène finale + style musical.')
      : 'Garde une forme de chanson vivante: une idée forte, quelques images nettes, un refrain mémorable, sans transformer chaque demande en scénario scolaire.',
    narrativeGuidance
      ? 'Interprète la demande en trois intentions avant d’écrire: 1) sujet visible, 2) sous-thème humain ou émotionnel, 3) morale cachée / message de troisième intention. Cette morale ne doit pas devenir un sermon: elle doit passer par les choix, conséquences, images et retournement final.'
      : '',
    narrativeGuidance
      ? 'Si la demande contient une morale, un message caché, une fable, un comportement risqué ou un personnage qui veut paraître cool, transforme-le en enjeu clair sans glorifier le risque; la sortie doit montrer ce que le personnage comprend ou gagne autrement.'
      : '',
    'Si la demande contient déjà un scénario, des personnages, des rôles de voix, une scène finale ou une structure couplet/refrain, respecte-les comme des contraintes prioritaires.',
    narrativeGuidance
      ? (collectiveHistory
        ? 'Chaque section doit faire avancer le temps: [Verse 1] ouvre une première époque; [Verse 2] montre une civilisation, une bataille ou une découverte; [Pre-Chorus] relie les générations; [Chorus] porte l’idée intemporelle; [Bridge] marque une rupture historique; [Final Chorus] relie l’héritage au monde présent. Ne pas suivre un héros solitaire inventé.'
        : 'Chaque section doit avoir une fonction narrative claire: [Verse 1] expose le décor et le personnage principal; [Verse 2] installe le conflit; [Pre-Chorus] resserre la tension; [Chorus] donne la phrase émotionnelle mémorable; [Bridge] apporte la bascule ou le moment dramatique; [Final Chorus] résout ou révèle l’image finale.')
      : '',
    'Pour un duo ou plusieurs voix, attribue clairement les rôles dans les balises, fais alterner les points de vue et réserve le chant commun aux moments où l’histoire le justifie.',
    'Ne gonfle jamais la durée en recopiant les mêmes lignes: chaque couplet doit ajouter une information, le refrain peut revenir mais avec une variation ou une montée, et aucun remplissage mécanique.',
    'Ne fais pas une liste de consignes et ne décris pas le scénario de l’extérieur: chante les scènes au présent, avec actions, images, rimes et progression.',
    rhymeRequested
      ? 'Contrat de rimes: dans chaque couplet, choisis un schéma clair AABB ou ABAB et fais rimer les fins de vers par paires; ajoute des rimes internes ou assonances sans sacrifier le sens. Une seule paire isolée ne suffit pas.'
      : 'Écris avec musicalité: fins de vers qui se répondent, assonances naturelles et refrain facile à retenir, sans forcer des rimes au détriment de l’émotion.',
    narrativeGuidance
      ? 'Avant de répondre, vérifie mentalement: début lisible, problème lisible, bascule lisible, fin mémorable, morale cachée perceptible sans phrase scolaire, et aucun comportement dangereux présenté comme désirable.'
      : '',
    'Le contexte de diffusion, de vote, de live, de chat, de stream, de Twitch, de NOSSEN, de raid, de sub, de modération ou d’OBS est strictement interne: ne l’écris jamais dans les paroles sauf si ces mots sont explicitement dans le sujet exact.',
    'Si le sujet est court, amplifie uniquement son champ naturel au lieu de remplir avec le contexte technique ou le vocabulaire d’une autre chanson.',
    'Utilise des sections balisées [Intro], [Verse 1], [Verse 2], [Pre-Chorus], [Chorus], [Bridge], [Final Chorus], [Outro].',
    'Écris un refrain mémorable, des images concrètes, des rimes naturelles et des allusions liées au sujet.',
    'Ne parle jamais de prompt, de durée, de Suno, de production, de canevas ou de consignes.',
    'Réponds uniquement avec les paroles.',
  ].filter(Boolean).join('\n');
}

function createVivyStreamNossenRunner(options = {}) {
  const routeIntent = options.routeIntent || buildVivyNossenIntentPlan;
  const routeComposition = options.routeComposition || buildVivyNossenRoutingPlan;
  const writeLyrics = options.writeLyrics || buildVivyAiChat;
  const startMusic = options.startMusic || buildRealMusicForProduction;
  const pollMusic = options.pollMusic || getVivyMusicJob;
  const extendMusic = options.extendMusic || requestSunoMusicExtension;
  const probeDuration = options.probeDuration || probeMediaDurationSeconds;
  const updateLive = options.updateLive || (() => {});
  const buildSocialPromptContext = typeof options.buildSocialPromptContext === 'function'
    ? options.buildSocialPromptContext
    : null;
  const sleepFn = options.sleep || sleep;
  const logger = options.logger || console;
  const pollAttempts = Math.max(1, Number(options.pollAttempts || DEFAULT_POLL_ATTEMPTS));
  const pollIntervalMs = Math.max(10, Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS));
  const revealDelayMs = Math.max(0, Number(options.revealDelayMs ?? 4000));
  const fixedTargetDurationSeconds = Math.max(
    0,
    Number(options.targetDurationSeconds || process.env.VIVY_STREAM_FIXED_TARGET_DURATION_SECONDS || 0) || 0
  );
  const configuredMinAcceptableSeconds = Math.max(
    0,
    Number(options.minAcceptableSeconds || process.env.VIVY_STREAM_MIN_ACCEPTABLE_SECONDS || 0) || 0
  );
  const defaultTargetDurationSeconds = Math.max(
    150,
    Number(process.env.VIVY_STREAM_TARGET_DURATION_SECONDS || DEFAULT_TARGET_DURATION_SECONDS) || DEFAULT_TARGET_DURATION_SECONDS
  );
  const maxExtensions = Math.max(
    0,
    Math.min(5, Number(options.maxExtensions ?? process.env.VIVY_STREAM_SUNO_MAX_EXTENSIONS ?? DEFAULT_MAX_EXTENSIONS))
  );
  const lyricWriteTimeoutMs = Math.max(
    30_000,
    Math.min(10 * 60 * 1000, Number(options.lyricWriteTimeoutMs || process.env.VIVY_STREAM_LYRICS_TIMEOUT_MS || 300_000) || 300_000)
  );
  const lyricRewriteTimeoutMs = Math.max(
    20_000,
    Math.min(10 * 60 * 1000, Number(options.lyricRewriteTimeoutMs || process.env.VIVY_STREAM_LYRICS_REWRITE_TIMEOUT_MS || lyricWriteTimeoutMs) || lyricWriteTimeoutMs)
  );
  const activeRuns = new Map();

  async function update(input) {
    const result = await Promise.resolve(updateLive({ source: 'twitch-live', ...input }));
    if (result?.error === 'twitch_stream_offline') {
      throw new Error('twitch_stream_offline');
    }
    return result;
  }

  async function run(payload = {}) {
    const rawWinner = payload.winner || payload.nossenSeed?.winner;
    const roundId = cleanText(payload.roundId || payload.id, '', 120);
    if (!rawWinner?.text || !roundId) throw new Error('vivy_stream_winner_missing');
    const requestedClipMode = cleanText(payload.clipMode || payload.clipModeOverride, '', 40).toLowerCase();
    const imageOnlyMode = ['image', 'cover', 'artwork', 'jaquette'].includes(requestedClipMode);
    const clipEnv = imageOnlyMode
      ? {
          ...process.env,
          VIVY_STREAM_FULL_CLIP_ENABLED: '0',
          VIVY_STREAM_CLIP_ENABLED: '0',
          VIVY_STREAM_FULL_CLIP_MODE: 'image',
        }
      : requestedClipMode
      ? { ...process.env, VIVY_STREAM_FULL_CLIP_ENABLED: '1', VIVY_STREAM_FULL_CLIP_MODE: requestedClipMode }
      : process.env;
    const configuredFullClipSourceImageUrl = resolveTwitchFullClipSourceImageUrl(clipEnv);
    if (requestedClipMode) {
      logger.info?.('[vivy-full-clip] round=%s one-shot clip mode override=%s', roundId, requestedClipMode);
    }
    const providerDirective = extractTwitchMusicProviderDirective(rawWinner.text);
    const winner = {
      ...rawWinner,
      text: resolveTwitchCreativePlaceholders(providerDirective.text),
    };
    const storedMusicProvider = cleanText(
      rawWinner.musicProvider
      || rawWinner.music_provider
      || rawWinner.provider,
      '',
      40
    ).toLowerCase();
    let musicProvider = cleanText(
      providerDirective.provider || storedMusicProvider || process.env.VIVY_STREAM_MUSIC_PROVIDER || 'suno',
      'suno',
      40
    ).toLowerCase();
    const req = options.requestFactory ? options.requestFactory(payload) : createTrustedTwitchRequest();
    const sessionId = `twitch-${roundId}`;
    const conversationId = `vivy-twitch-${roundId}`;
      const seed = payload.nossenSeed || {};
      const fallbackInstrumentalMode = isTwitchInstrumentalSoundDesignRequest(winner.text, seed);
      const subjectFrame = resolveTwitchSubjectFrame(winner.text, seed);

    try {
      if (revealDelayMs) await sleepFn(revealDelayMs);
      logger.info?.('[vivy-twitch-nossen] round=%s analysis started', roundId);
      await update({
        action: 'progress',
        stage: 'analysis',
        progress: 12,
        title: winner.text,
        requestedBy: winner.author,
        message: 'Vivy analyse le thème gagnant.',
      });
      const intentPlan = await routeIntent({
        rawUserIdea: winner.text,
        commandName: cleanText(payload.commandName || winner.commandName || winner.command || 'nossen', 'nossen', 80),
        twitchMessage: cleanText(winner.message || winner.text, '', 2000),
        optionalContext: cleanText([
          seed.canvas,
          seed.notes,
          payload.optionalContext,
        ].filter(Boolean).join('\n\n'), '', 4000),
        canvas: seed.canvas,
        songText: winner.text,
        message: winner.text,
        notes: seed.notes,
        sessionId,
        conversationId,
      }, req);
      logVivyIntentPlan(logger, intentPlan);
      logger.info?.(
        '[VivySubjectFrame] round=%s kind=%s confidence=%s reason=%s',
        roundId,
        subjectFrame.kind,
        Number(subjectFrame.confidence || 0).toFixed(2),
        cleanText(subjectFrame.reason, '', 220)
      );
      const instrumentalMode = intentPlan?.shouldGenerateLyrics === false
        || intentPlan?.shouldUseVocals === false
        || fallbackInstrumentalMode;
      const soundDesignMode = intentPlan?.shouldPrioritizeSfx === true
        || intentPlan?.intent === 'sound_design_scene'
        || intentPlan?.sfxPriority === 'high';
      const instrumentalDirection = instrumentalMode
        ? buildTwitchInstrumentalDirection({ winner, seed, intentPlan })
        : '';
      const intentContext = cleanText([
        `VivyIntentRouter: intent=${intentPlan?.intent || 'unknown'}; shouldGenerateLyrics=${intentPlan?.shouldGenerateLyrics === true}; shouldUseVocals=${intentPlan?.shouldUseVocals === true}; shouldPrioritizeSfx=${intentPlan?.shouldPrioritizeSfx === true}; sfxPriority=${intentPlan?.sfxPriority || 'none'}; vocalPolicy=${intentPlan?.vocalPolicy || 'forbid'}.`,
        intentPlan?.generationBrief ? `Brief production: ${intentPlan.generationBrief}` : '',
      ].filter(Boolean).join('\n'), '', 1400);
      let routing = await routeComposition({
        canvas: cleanText([
          seed.canvas || winner.text,
          subjectFrame.guidance ? `Cadre sémantique prioritaire: ${subjectFrame.guidance}` : '',
          intentContext,
          instrumentalDirection,
        ].filter(Boolean).join('\n\n'), '', 6000),
        songText: winner.text,
        message: winner.text,
        notes: cleanText([
          seed.notes,
          subjectFrame.guidance ? `Cadre sémantique prioritaire: ${subjectFrame.guidance}` : '',
          intentContext,
          instrumentalDirection,
        ].filter(Boolean).join('\n\n'), '', 2600),
        sessionId,
        conversationId,
      }, req);
      routing = reinforceTwitchSubjectFrameRouting(routing, subjectFrame);
      const reinforcedRouting = reinforceTwitchHumorRouting(routing, { winner, seed, intentPlan });
      if (reinforcedRouting !== routing && reinforcedRouting?.songMood !== routing?.songMood) {
        logger.info?.(
          '[VivyHumorRouter] round=%s comedyMoodApplied=true bawdy=%s mood=%s',
          roundId,
          isBawdyWordplayRequest(winner.text, seed?.notes, seed?.canvas, intentPlan?.generationBrief) ? 'true' : 'false',
          cleanText(reinforcedRouting.songMood, '', 220)
        );
      }
      routing = reinforcedRouting;
      const hardcoreRouting = reinforceTwitchHardcoreRouting(routing, { winner, seed, intentPlan });
      if (hardcoreRouting !== routing) {
        logger.info?.(
          '[VivyGenreRouter] round=%s hardcore90sApplied=true mood=%s',
          roundId,
          cleanText(hardcoreRouting.songMood, '', 220)
        );
      }
      routing = hardcoreRouting;
      const freestyleRouting = reinforceTwitchRapFreestyleRouting(routing, { winner, seed, intentPlan });
      if (freestyleRouting !== routing) {
        logger.info?.(
          '[VivyGenreRouter] round=%s freestyleApplied=true mood=%s',
          roundId,
          cleanText(freestyleRouting.songMood, '', 220)
        );
      }
      routing = freestyleRouting;
      const outfitPick = pickVivyOutfitBrief({ subjectText: winner.text, mood: routing?.songMood });
      if (outfitPick.brief) {
        routing = {
          ...routing,
          songMood: cleanText([routing?.songMood, outfitPick.brief].filter(Boolean).join('. '), '', 1800),
        };
        logger.info?.(
          '[VivyWardrobe] round=%s outfit=%s accessories=%s',
          roundId,
          cleanText(outfitPick.selection?.main?.name || '', '', 80),
          outfitPick.selection?.accessories?.map((entry) => entry.name).join('+') || 'aucun'
        );
      }
      if (
        musicProvider === 'mureka'
        && !instrumentalMode
        && isConceptualHookRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)
        && String(process.env.VIVY_STREAM_ALLOW_MUREKA_CONCEPTUAL_HOOKS || '').trim() !== '1'
        && !/\bmureka\s+(?:obligatoire|forc[ée]e?|force|required)\b/.test(foldTwitchLyricText(rawWinner.text))
      ) {
        logger.warn?.(
          '[VivyProviderGuard] round=%s provider=mureka switchedTo=suno reason=conceptual_hook_requires_stronger_french_songcraft',
          roundId
        );
        musicProvider = 'suno';
      }
      const artists = !instrumentalMode && Array.isArray(routing?.artists) && routing.artists.length
        ? routing.artists.slice(0, 2)
        : instrumentalMode ? [] : ['vivy'];
      const lyricScope = resolveTwitchVivyLyricScope({
        winner,
        seed,
        intentPlan,
        routing,
        instrumentalMode,
        musicProvider,
        configuredTargetDurationSeconds: fixedTargetDurationSeconds,
        configuredMinAcceptableSeconds,
        defaultTargetDurationSeconds,
      });
      const publicTitle = buildTwitchPublicTrackTitle(winner.text);
      const targetDurationSeconds = lyricScope.targetDurationSeconds;
      const minAcceptableSeconds = lyricScope.minAcceptableSeconds;
      logger.info?.(
        '[VivyLyricScope] round=%s label=%s target=%ss minAccept=%ss minLyrics=%s maxChars=%s maxTokens=%s reason=%s',
        roundId,
        cleanText(lyricScope.label, 'ample', 80),
        Math.round(targetDurationSeconds),
        Math.round(minAcceptableSeconds),
        lyricScope.minLyricsChars,
        lyricScope.maxChars,
        lyricScope.maxTokens,
        cleanText(lyricScope.reason, '', 180)
      );
      let socialPromptContextText = '';
      if (!instrumentalMode && buildSocialPromptContext && process.env.VIVY_STREAM_SOCIAL_CONTEXT_DISABLED !== '1') {
        try {
          const socialContext = await buildSocialPromptContext({
            topic: winner.text,
            kind: 'chanson',
            limit: 6,
            roundId,
            winner,
            routing,
            seed,
          });
          socialPromptContextText = cleanText(
            socialContext?.promptText || socialContext?.text || socialContext?.promptBlock || '',
            '',
            1800
          );
          logger.info?.(
            '[VivySocialContext] round=%s applied=%s chars=%s',
            roundId,
            socialPromptContextText ? 'true' : 'false',
            socialPromptContextText.length
          );
        } catch (error) {
          logger.warn?.(
            '[VivySocialContext] round=%s skipped error=%s',
            roundId,
            cleanText(error?.message || String(error), '', 180)
          );
        }
      }

      await update({
        action: 'progress',
        stage: 'lyrics',
        progress: instrumentalMode ? 100 : 8,
        title: publicTitle,
        message: instrumentalMode
          ? 'Vivy prépare une scène instrumentale avec bruitages.'
          : `Vivy écrit pour ${artists.join(' + ')} (${lyricScope.label === 'ample' ? 'format ample' : lyricScope.label}).`,
      });
      let lyrics = '';
      if (!instrumentalMode) {
        const lyricsMessage = buildTwitchLyricsRequest({
          winner,
          routing,
          seed,
          lyricScope,
          socialPromptContextText,
          subjectFrame,
        });
        let usedEmergencyLyricsFallback = false;
        let lyricsPayload = null;
        try {
          const lyricWriteStartedAt = Date.now();
          lyricsPayload = await withTimeout(() => writeLyrics({
            mode: 'song',
            language: 'fr',
            conversationId,
            sessionId,
            sessionName: `Twitch Live - ${winner.text}`,
            history: [],
            message: lyricsMessage,
            songText: winner.text,
            songMood: routing?.songMood,
            songArtists: artists,
            artistCount: artists.length,
            singerCount: artists.length,
            vocalCast: artists.join(' + '),
            songMaxTokens: lyricScope.maxTokens,
            lyricMaxTokens: lyricScope.maxTokens,
            songResponseMaxChars: lyricScope.maxChars,
            lyricScope,
            disableSongcraftFallback: true,
            allowEmergencySongcraftFallback: true,
          }, req), lyricWriteTimeoutMs, 'vivy_lyrics_write');
          logger.info?.(
            '[vivy-twitch-nossen] round=%s lyrics write completed latencyMs=%s provider=%s model=%s chars=%s',
            roundId,
            Date.now() - lyricWriteStartedAt,
            cleanText(lyricsPayload?.provider || lyricsPayload?.source || '', '', 80),
            cleanText(lyricsPayload?.model || '', '', 120),
            cleanText(lyricsPayload?.vocalLyrics || lyricsPayload?.publicLyrics || lyricsPayload?.assistant || lyricsPayload?.content, '', lyricScope.maxChars).length
          );
        } catch (error) {
          logger.warn?.(
            '[vivy-twitch-nossen] round=%s lyrics write fallback error=%s; using last-context emergency lyrics',
            roundId,
            cleanText(error?.message || String(error), '', 160)
          );
          usedEmergencyLyricsFallback = true;
          lyricsPayload = {
            publicLyrics: buildTwitchEmergencyLyrics({ winner, routing, seed, intentPlan, lyricScope, artists }),
          };
        }
        let rawLyrics = extractCleanTwitchLyricsBlock(
          lyricsPayload?.vocalLyrics
          || lyricsPayload?.publicLyrics
          || lyricsPayload?.assistant
          || lyricsPayload?.content,
          lyricScope.maxChars
        );
        if (!rawLyrics) {
          rawLyrics = buildTwitchEmergencyLyrics({ winner, routing, seed, intentPlan, lyricScope, artists });
        }
        const subjectContext = [
          routing?.songMood,
          seed?.notes,
          seed?.canvas,
          intentPlan?.generationBrief,
        ].filter(Boolean).join('\n');
        let contextLeakage = sanitizeTwitchLyricsForSubjectDetailed(rawLyrics, winner.text, subjectContext);
        lyrics = contextLeakage.lyrics;
        if (contextLeakage.removed > 0) {
          logger.warn?.(
            '[VivyContextGuard] round=%s stage=initial removed=%s groups=%s',
            roundId,
            contextLeakage.removed,
            contextLeakage.groups.join(',')
          );
        }
        let promptLeakage = sanitizeTwitchLyricsForPromptLeakage(lyrics);
        if (promptLeakage.removed > 0) {
          logger.warn?.(
            '[vivy-twitch-nossen] round=%s stripped prompt-rule leakage from lyrics lines=%s',
            roundId,
            promptLeakage.removed
          );
          lyrics = promptLeakage.lyrics;
        }
        const dedupedLyrics = reduceMechanicalLyricRepeats(lyrics);
        if (dedupedLyrics !== lyrics) {
          logger.warn?.('[vivy-twitch-nossen] round=%s removed mechanical lyric repetitions before Suno', roundId);
          lyrics = dedupedLyrics;
        }
        const phoneticWordplayRequested = isPhoneticWordplayRequest(
          winner.text,
          routing?.songMood,
          seed?.notes,
          seed?.canvas
        );
        const associativeWordplayRequested = isAssociativeWordplayRequest(
          winner.text,
          routing?.songMood,
          seed?.notes,
          seed?.canvas
        );
        const bawdyWordplayRequested = isBawdyWordplayRequest(
          winner.text,
          routing?.songMood,
          seed?.notes,
          seed?.canvas
        );
        const hookMechanicRequested = isConceptualHookRequest(
          winner.text,
          routing?.songMood,
          seed?.notes,
          seed?.canvas
        );
        const strictRhymeRequested = wantsStrictRhymeCheck(
          winner.text,
          routing?.songMood,
          seed?.notes
        );
        const freestyleRequested = isRapFreestyleRequest(
          winner.text,
          routing?.songMood,
          seed?.notes,
          seed?.canvas
        );
        let lyricAssessment = assessTwitchSongLyrics(lyrics);
        if (!lyricAssessment.valid) {
          logger.warn?.(
            '[vivy-twitch-nossen] round=%s rejected non-song lyric response reasons=%s length=%s sections=%s sungLines=%s',
            roundId,
            lyricAssessment.reasons.join(','),
            lyricAssessment.length,
            lyricAssessment.sectionCount,
            lyricAssessment.sungLineCount
          );
        }
        let rhymeAssessment = assessTwitchRhymeSignals(lyrics);
        let loopAssessment = assessTwitchLyricLoopiness(lyrics);
        if (!loopAssessment.valid) {
          logger.warn?.(
            '[VivyLoopCheck] round=%s loopy verses reasons=%s topLine=%s duplicateRatio=%s verseLines=%s',
            roundId,
            loopAssessment.reasons.join(','),
            loopAssessment.topLineCount,
            loopAssessment.duplicateRatio,
            loopAssessment.verseLineCount
          );
        }
        let hookAssessment = hookMechanicRequested
          ? assessTwitchHookMechanic(lyrics, winner.text)
          : { valid: true, reasons: [] };
        if (hookMechanicRequested && !hookAssessment.valid) {
          logger.warn?.(
            '[VivyHookCheck] round=%s weak hook reasons=%s chorus=%s repeats=%s titleEcho=%s actionVerbs=%s similarity=%s',
            roundId,
            hookAssessment.reasons.join(','),
            hookAssessment.chorusCount,
            Number(hookAssessment.repeatedLineRatio || 0).toFixed(3),
            hookAssessment.titleEchoCount,
            hookAssessment.actionVerbs,
            Number(hookAssessment.chorusSimilarity || 0).toFixed(3)
          );
        }
        if (strictRhymeRequested && !rhymeAssessment.valid) {
          logger.warn?.(
            '[VivyRhymeCheck] round=%s weak rhymes matches=%s opportunities=%s needed=%s ratio=%s',
            roundId,
            rhymeAssessment.matches,
            rhymeAssessment.opportunities,
            rhymeAssessment.needed,
            rhymeAssessment.ratio
          );
        }
        const humorNeedsRewrite = isHumorWordplayRequest(winner.text, routing?.songMood, seed?.notes, seed?.canvas)
          && (lyrics.length < Math.min(lyricScope.minLyricsChars || 0, 1100) || promptLeakage.removed > 0);
        const wordplayNeedsPolish = phoneticWordplayRequested || associativeWordplayRequested;
        const invalidLyricsNeedRewrite = !lyricAssessment.valid || usedEmergencyLyricsFallback;
        const lyricsTooShortForScope = lyricScope.minLyricsChars > 0 && lyrics.length < lyricScope.minLyricsChars;
        const rhymeNeedsRewrite = strictRhymeRequested && !rhymeAssessment.valid && lyrics.length >= 600;
        const hookNeedsRewrite = hookMechanicRequested && !hookAssessment.valid && lyrics.length >= 600;
        const loopNeedsRewrite = !loopAssessment.valid && lyrics.length >= 400;
        if (humorNeedsRewrite || wordplayNeedsPolish || invalidLyricsNeedRewrite || lyricsTooShortForScope || rhymeNeedsRewrite || hookNeedsRewrite || loopNeedsRewrite) {
          await update({
            action: 'progress',
            stage: 'lyrics',
            progress: 64,
            message: invalidLyricsNeedRewrite
              ? 'Vivy écarte une réponse de chat parasite et réécrit de vraies paroles.'
              : wordplayNeedsPolish
              ? 'Vivy relit le texte à l’oreille et renforce les doubles lectures avant Suno.'
              : hookNeedsRewrite
              ? 'Vivy refuse un refrain trop statique et reconstruit le hook.'
              : lyricsTooShortForScope
              ? 'Vivy densifie les paroles avant composition pour éviter un morceau qui tourne en rond.'
              : rhymeNeedsRewrite
              ? 'Vivy renforce les rimes avant composition.'
              : loopNeedsRewrite
              ? 'Vivy casse une boucle d’images et réécrit les couplets avant Suno.'
              : 'Vivy resserre les malentendus et réécrit les paroles avant Suno.',
          });
          const rewriteSessionId = `${sessionId}-lyrics-rewrite`;
          const rewriteConversationId = `${conversationId}-lyrics-rewrite`;
          let rewritePayload = null;
          try {
            const lyricRewriteStartedAt = Date.now();
            rewritePayload = await withTimeout(() => writeLyrics({
              mode: 'song',
              language: 'fr',
              conversationId: rewriteConversationId,
              sessionId: rewriteSessionId,
              sessionName: `Twitch Live - ${winner.text} - rewrite`,
              history: [],
              message: [
                lyricsMessage,
                '',
                'Brouillon à transformer, ne le commente pas:',
                lyrics,
                '',
                invalidLyricsNeedRewrite
                  ? 'Réponse invalide détectée: le brouillon est une réponse de conversation, une explication ou un texte sans structure de chanson. Ignore entièrement sa formulation et repars du sujet exact.'
                  : wordplayNeedsPolish
                  ? 'Passe de réécriture exigeante: conserve seulement la prémisse utile. Si l’histoire, le refrain ou les chutes sont plats, remplace-les entièrement au lieu de les paraphraser.'
                  : lyricsTooShortForScope
                  ? `Réécriture obligatoire: la version précédente est trop courte pour ${musicProvider === 'mureka' ? 'Mureka V9' : 'la durée choisie'} (${lyrics.length}/${lyricScope.minLyricsChars} caractères utiles). Développe de vraies scènes, pas du remplissage.`
                  : rhymeNeedsRewrite
                  ? `Réécriture obligatoire: les rimes sont trop faibles (${rhymeAssessment.matches}/${rhymeAssessment.opportunities} paires détectées). Reprends chaque couplet avec un vrai schéma AABB ou ABAB, des fins de vers qui se répondent et des rimes internes naturelles.`
                  : hookNeedsRewrite
                  ? `Réécriture obligatoire: le hook est trop statique (${hookAssessment.reasons.join(',')}). Le refrain ne doit pas seulement nommer le concept; il doit voler, rendre, déformer, retourner ou transformer une matière du couplet. Change le dernier refrain pour révéler un second sens.`
                  : loopNeedsRewrite
                  ? `Réécriture obligatoire: les couplets bouclent sur les mêmes lignes ou la même image (${loopAssessment.reasons.join(',')}, ligne dominante x${loopAssessment.topLineCount}). Garde l’énergie, mais remplace chaque répétition hors refrain par une scène, une image ou une punchline neuve.`
                  : 'Réécriture obligatoire: la version précédente était trop courte ou récitait les consignes.',
                hookMechanicRequested
                  ? 'Test hook obligatoire: chaque couplet doit fournir une image ou une phrase que le refrain récupère ensuite. Le refrain doit varier à chaque retour; évite “je suis le/la [titre]” comme simple slogan répété. Le dernier refrain doit payer le prix du concept ou retourner son sens.'
                  : '',
                phoneticWordplayRequested
                  ? 'Test oral obligatoire: insère au moins quatre jeux fondés sur le son et un pivot phonétique central dans le refrain. Prépare chaque mot-pivot par son sens normal, puis fais apparaître sa seconde intention par la fin de la ligne, une opposition ou une conséquence. Une simple métaphore, une rime ou deux mots techniques voisins ne comptent pas.'
                  : '',
                associativeWordplayRequested
                  ? 'Croise au moins trois familles d’idées par forme, texture, odeur, geste, expression populaire, proverbe, comptine ou usage détourné. Chaque association doit produire un malentendu ou une conséquence; ne fais pas une liste d’objets.'
                  : '',
                bawdyWordplayRequested
                  ? 'Le brouillon échoue s’il se contente de secrets, sourires, clins d’œil ou personnages qui “ont compris”. Rends le second récit adulte nettement perceptible sans anatomie graphique: plusieurs allusions concrètes, plusieurs chutes, au moins deux tensions entre désir, ivresse, fumée clandestine, interdit et lendemain embarrassant. Ajoute deux ou trois césures-pièges: la phrase appelle un mot tabou pendant une pause, puis un complément innocent la termine sans jamais écrire le mot imaginé. Ne reprends aucune ligne faible du brouillon.'
                  : '',
                (freestyleRequested || lyricScope.freeStructure)
                  ? 'Écris maintenant uniquement les paroles finales: plusieurs longs couplets continus, sans pré-refrain ni pont obligatoires; ajoute un refrain seulement si le sujet exact le demande.'
                  : 'Écris maintenant uniquement les paroles finales, avec au moins deux couplets, un pré-refrain, un refrain, un pont et un dernier refrain.',
                'Chaque couplet doit contenir une scène concrète, un malentendu nouveau et une conséquence comique. Hors refrain, interdiction de reprendre la même idée ou le même moule de phrase. Les rimes doivent exister à l’oreille, pas seulement par hasard sur deux mots. Ne cite jamais les mots: surface, sous-texte, double lecture, consigne, prompt, règle privée, pivot phonétique, association d’idées.',
              ].filter(Boolean).join('\n'),
              songText: winner.text,
              songMood: routing?.songMood,
              songArtists: artists,
              artistCount: artists.length,
              singerCount: artists.length,
              vocalCast: artists.join(' + '),
              songMaxTokens: lyricScope.maxTokens,
              lyricMaxTokens: lyricScope.maxTokens,
              songResponseMaxChars: lyricScope.maxChars,
              lyricScope,
              disableSongcraftFallback: true,
              allowEmergencySongcraftFallback: true,
            }, req), lyricRewriteTimeoutMs, 'vivy_lyrics_rewrite');
            logger.info?.(
              '[vivy-twitch-nossen] round=%s lyrics rewrite completed latencyMs=%s provider=%s model=%s chars=%s',
              roundId,
              Date.now() - lyricRewriteStartedAt,
              cleanText(rewritePayload?.provider || rewritePayload?.source || '', '', 80),
              cleanText(rewritePayload?.model || '', '', 120),
              cleanText(rewritePayload?.vocalLyrics || rewritePayload?.publicLyrics || rewritePayload?.assistant || rewritePayload?.content, '', lyricScope.maxChars).length
            );
          } catch (error) {
            logger.warn?.(
              '[vivy-twitch-nossen] round=%s lyrics rewrite skipped error=%s; keeping cleaned first draft',
              roundId,
              cleanText(error?.message || String(error), '', 160)
            );
          }
          if (rewritePayload) {
            const preRewriteLyrics = lyrics;
            rawLyrics = extractCleanTwitchLyricsBlock(
              rewritePayload?.vocalLyrics
              || rewritePayload?.publicLyrics
              || rewritePayload?.assistant
              || rewritePayload?.content,
              lyricScope.maxChars
            );
            if (!rawLyrics) {
              rawLyrics = buildTwitchEmergencyLyrics({ winner, routing, seed, intentPlan, lyricScope, artists });
            }
            contextLeakage = sanitizeTwitchLyricsForSubjectDetailed(rawLyrics, winner.text, subjectContext);
            lyrics = contextLeakage.lyrics;
            if (contextLeakage.removed > 0) {
              logger.warn?.(
                '[VivyContextGuard] round=%s stage=rewrite removed=%s groups=%s',
                roundId,
                contextLeakage.removed,
                contextLeakage.groups.join(',')
              );
            }
            promptLeakage = sanitizeTwitchLyricsForPromptLeakage(lyrics);
            if (promptLeakage.removed > 0) {
              logger.warn?.(
                '[vivy-twitch-nossen] round=%s stripped prompt-rule leakage from rewritten lyrics lines=%s',
                roundId,
                promptLeakage.removed
              );
              lyrics = promptLeakage.lyrics;
            }
            const dedupedRewrite = reduceMechanicalLyricRepeats(lyrics);
            if (dedupedRewrite !== lyrics) {
              logger.warn?.('[vivy-twitch-nossen] round=%s removed mechanical lyric repetitions from rewrite before Suno', roundId);
              lyrics = dedupedRewrite;
            }
            if (
              !invalidLyricsNeedRewrite
              && lyrics.length < (lyricScope.minLyricsChars || 0)
              && preRewriteLyrics.length > lyrics.length
            ) {
              logger.warn?.(
                '[vivy-twitch-nossen] round=%s rewrite regressed length (%s chars vs draft %s, min %s); keeping original draft',
                roundId,
                lyrics.length,
                preRewriteLyrics.length,
                lyricScope.minLyricsChars || 0
              );
              lyrics = preRewriteLyrics;
            }
          }
          lyricAssessment = assessTwitchSongLyrics(lyrics);
          rhymeAssessment = assessTwitchRhymeSignals(lyrics);
          loopAssessment = assessTwitchLyricLoopiness(lyrics);
          if (!loopAssessment.valid) {
            logger.warn?.(
              '[VivyLoopCheck] round=%s rewritten verses still loopy reasons=%s topLine=%s duplicateRatio=%s',
              roundId,
              loopAssessment.reasons.join(','),
              loopAssessment.topLineCount,
              loopAssessment.duplicateRatio
            );
          }
          hookAssessment = hookMechanicRequested
            ? assessTwitchHookMechanic(lyrics, winner.text)
            : { valid: true, reasons: [] };
          if (hookMechanicRequested && !hookAssessment.valid) {
            logger.warn?.(
              '[VivyHookCheck] round=%s rewritten hook still weak reasons=%s chorus=%s repeats=%s titleEcho=%s actionVerbs=%s similarity=%s',
              roundId,
              hookAssessment.reasons.join(','),
              hookAssessment.chorusCount,
              Number(hookAssessment.repeatedLineRatio || 0).toFixed(3),
              hookAssessment.titleEchoCount,
              hookAssessment.actionVerbs,
              Number(hookAssessment.chorusSimilarity || 0).toFixed(3)
            );
          }
          if (strictRhymeRequested && !rhymeAssessment.valid) {
            logger.warn?.(
              '[VivyRhymeCheck] round=%s rewritten lyrics still weak matches=%s opportunities=%s needed=%s ratio=%s',
              roundId,
              rhymeAssessment.matches,
              rhymeAssessment.opportunities,
              rhymeAssessment.needed,
              rhymeAssessment.ratio
            );
          }
        }
        if (!lyricAssessment.valid) {
          const emergencyLyrics = buildTwitchEmergencyLyrics({ winner, routing, seed, intentPlan, lyricScope, artists });
          const emergencyAssessment = assessTwitchSongLyrics(emergencyLyrics);
          if (emergencyAssessment.valid) {
            logger.warn?.(
              '[vivy-twitch-nossen] round=%s replaced invalid lyrics with contextual emergency lyrics reasons=%s length=%s',
              roundId,
              lyricAssessment.reasons.join(','),
              emergencyAssessment.length
            );
            lyrics = emergencyLyrics;
            lyricAssessment = emergencyAssessment;
          } else {
            logger.error?.(
              '[vivy-twitch-nossen] round=%s refusing invalid lyrics before Suno reasons=%s length=%s sections=%s sungLines=%s',
              roundId,
              lyricAssessment.reasons.join(','),
              lyricAssessment.length,
              lyricAssessment.sectionCount,
              lyricAssessment.sungLineCount
            );
            throw new Error(`vivy_stream_lyrics_invalid_${lyricAssessment.reasons.join('_') || 'unknown'}`);
          }
        }
        if (hasTwitchProviderLyricsLeakage(lyrics)) {
          const providerLeakage = sanitizeTwitchLyricsForPromptLeakage(lyrics);
          lyrics = cleanLyrics(providerLeakage.lyrics.split('\n')
            .filter((line) => /^\s*\[[^\]]+\]\s*$/.test(line) || !hasTwitchProviderLyricsLeakage(line))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n'), lyricScope.maxChars);
          logger.warn?.(
            '[VivyProviderGuard] round=%s stripped final provider leakage before Suno removed=%s chars=%s',
            roundId,
            providerLeakage.removed,
            lyrics.length
          );
          lyricAssessment = assessTwitchSongLyrics(lyrics);
          if (!lyricAssessment.valid) {
            const emergencyLyrics = buildTwitchEmergencyLyrics({ winner, routing, seed, intentPlan, lyricScope, artists });
            logger.warn?.(
              '[VivyProviderGuard] round=%s provider scrub left invalid lyrics reasons=%s; using contextual emergency lyrics',
              roundId,
              lyricAssessment.reasons.join(',')
            );
            lyrics = emergencyLyrics;
            lyricAssessment = assessTwitchSongLyrics(lyrics);
          }
        }
        if (lyricScope.minLyricsChars > 0 && lyrics.length < lyricScope.minLyricsChars) {
          logger.warn?.(
            '[VivyLyricScope] round=%s lyrics shorter than chosen scope length=%s min=%s label=%s',
            roundId,
            lyrics.length,
            lyricScope.minLyricsChars,
            cleanText(lyricScope.label, 'unknown', 80)
          );
        }
      }

      await update({
        action: 'progress',
        stage: 'composition',
        progress: 5,
        title: publicTitle,
        message: instrumentalMode
          ? `Scène instrumentale prête, ${musicProvider} lance la composition.`
          : `Paroles prêtes, ${musicProvider} lance la composition.`,
      });
      const instrumentalMaterial = instrumentalMode
        ? cleanText([
          winner.text,
          seed.canvas,
          intentContext,
          routing?.songMood ? `Direction sonore: ${routing.songMood}` : '',
          instrumentalDirection,
        ].filter(Boolean).join('\n\n'), '', 6000)
        : '';
      const productionMood = instrumentalMode
        ? cleanText([
          routing?.songMood || winner.text,
          instrumentalDirection,
          soundDesignMode ? 'Prioritize sound design, concrete SFX and foley in the arrangement.' : '',
          intentPlan?.vocalPolicy === 'distant_indistinct_only'
            ? 'Distant indistinct whispers are allowed only as non-lyrical background texture; no sung words, no lead voice.'
          : 'Instrumental score only, sound effects and foley allowed, no vocals, no singing, no lyrics, no spoken narration.',
        ].filter(Boolean).join(', '), '', 1200)
        : routing?.songMood;
      const providerPack = buildTwitchProviderPack({
        lyrics,
        styleBrief: productionMood,
        fallbackStyle: instrumentalMode
          ? winner.text
          : 'French original song, expressive vocals, modern mix',
        instrumentalMode,
        maxLyricsChars: lyricScope.maxChars || 12000,
      });
      logger.info?.(
        '[VivyProviderPack] round=%s provider=%s cleanLyricsChars=%s styleBriefChars=%s instrumental=%s lyricLeakage=%s styleLeakage=%s',
        roundId,
        musicProvider,
        providerPack.cleanLyrics.length,
        providerPack.styleBrief.length,
        instrumentalMode === true ? 'true' : 'false',
        providerPack.lyricLeakage === true ? 'true' : 'false',
        providerPack.styleLeakage === true ? 'true' : 'false'
      );
      let coverImageUrl = '';
      let fullClipSourceImageUrl = '';
      let coverPrompt = '';
      let coverVideoUrl = '';
      let coverVideoPrompt = '';
      const coverPromise = generateTwitchCoverImage({
        publicTitle,
        winner,
        routing,
        intentPlan,
        subjectFrame,
        lyrics: providerPack.cleanLyrics || lyrics,
        styleBrief: providerPack.styleBrief,
        artists,
        vocalCast: artists.join(' + '),
        conversationId,
        req,
      }).then(async (cover) => {
        if (!cover?.ok || !cover.coverImageUrl) {
          if (configuredFullClipSourceImageUrl && isTwitchFullClipEnabled(clipEnv)) {
            coverImageUrl = configuredFullClipSourceImageUrl;
            fullClipSourceImageUrl = configuredFullClipSourceImageUrl;
            coverPrompt = 'operator-provided-full-clip-source-image';
            logger.info?.(
              '[vivy-full-clip] round=%s using configured source image after cover fallback url=%s',
              roundId,
              cleanText(configuredFullClipSourceImageUrl, '', 180)
            );
            await update({
              action: 'cover',
              roundId,
              title: publicTitle,
              coverImageUrl,
              coverPrompt,
              requestedBy: winner.author,
            }).catch((error) => {
              logger.warn?.('[vivy-twitch-cover] round=%s configured source state update failed: %s', roundId, cleanText(error?.message || error, '', 180));
            });
            return { ok: true, coverImageUrl, prompt: coverPrompt, configuredSource: true };
          }
          if (cover && !cover.skipped) {
            logger.warn?.(
              '[vivy-twitch-cover] round=%s skipped error=%s message=%s',
              roundId,
              cleanText(cover.error || cover.reason || 'unknown', '', 80),
              cleanText(cover.message || '', '', 180)
            );
          }
          return cover;
        }
        coverImageUrl = cover.coverImageUrl;
        fullClipSourceImageUrl = configuredFullClipSourceImageUrl || cover.coverImageUrl;
        coverPrompt = cover.prompt || '';
        if (isCoverTextStampEnabled(process.env)) {
          try {
            const coverResponse = await fetch(coverImageUrl, { signal: AbortSignal.timeout?.(20000) });
            if (coverResponse.ok) {
              const stamped = await stampCoverText(Buffer.from(await coverResponse.arrayBuffer()), {
                title: publicTitle,
                signature: 'Vivy ★',
              });
              const uploaded = await uploadBufferToR2({
                userId: 'vivy-twitch-live',
                filename: `vivy-cover-titled-${roundId}.jpg`,
                buffer: stamped,
                contentType: 'image/jpeg',
              });
              if (uploaded?.url) {
                coverImageUrl = uploaded.url;
                logger.info?.('[vivy-twitch-cover] round=%s title stamped onto cover', roundId);
              }
            }
          } catch (error) {
            logger.warn?.(
              '[vivy-twitch-cover] round=%s text stamp skipped: %s',
              roundId,
              cleanText(error?.message || error, '', 160)
            );
          }
        }
        logger.info?.('[vivy-twitch-cover] round=%s ready url=%s', roundId, cleanText(coverImageUrl, '', 180));
        await update({
          action: 'cover',
          roundId,
          title: publicTitle,
          coverImageUrl,
          coverPrompt,
          requestedBy: winner.author,
        }).catch((error) => {
          logger.warn?.('[vivy-twitch-cover] round=%s cover state update failed: %s', roundId, cleanText(error?.message || error, '', 180));
        });
        if (isTwitchFullClipEnabled(clipEnv)) {
          logger.info?.('[vivy-twitch-clip] round=%s short cover clip skipped because full clip pack is enabled', roundId);
          if (configuredFullClipSourceImageUrl) {
            logger.info?.(
              '[vivy-full-clip] round=%s using configured source image for scene generation url=%s',
              roundId,
              cleanText(configuredFullClipSourceImageUrl, '', 180)
            );
          }
          if (fullClipSourceImageUrl && coverImageUrl && fullClipSourceImageUrl !== coverImageUrl) {
            logger.info?.('[vivy-full-clip] round=%s using unstamped cover source for scene generation', roundId);
          }
          return cover;
        }
        const clip = await generateTwitchCoverVideo({
          publicTitle,
          winner,
          coverImageUrl,
          coverPrompt,
          artists,
          vocalCast: artists.join(' + '),
          conversationId,
          req,
        });
        if (!clip?.ok || !clip.coverVideoUrl) {
          if (clip && !clip.skipped) {
            logger.warn?.(
              '[vivy-twitch-clip] round=%s skipped error=%s message=%s',
              roundId,
              cleanText(clip.error || clip.reason || 'unknown', '', 100),
              cleanText(clip.message || '', '', 180)
            );
          }
          return { ...cover, clip };
        }
        coverVideoUrl = clip.coverVideoUrl;
        coverVideoPrompt = clip.prompt || '';
        logger.info?.('[vivy-twitch-clip] round=%s ready url=%s', roundId, cleanText(coverVideoUrl, '', 180));
        await update({
          action: 'clip',
          roundId,
          title: publicTitle,
          coverVideoUrl,
          coverVideoPrompt,
          coverImageUrl,
          requestedBy: winner.author,
        }).catch((error) => {
          logger.warn?.('[vivy-twitch-clip] round=%s clip state update failed: %s', roundId, cleanText(error?.message || error, '', 180));
        });
        return { ...cover, clip };
      }).catch((error) => {
        logger.warn?.('[vivy-twitch-cover] round=%s failed: %s', roundId, cleanText(error?.message || error, '', 180));
        return null;
      });
      void coverPromise;
      const fullClipPreparePromise = coverPromise.then(async () => {
        if (!coverImageUrl && !coverVideoUrl) {
          return { ok: false, skipped: true, reason: 'full_clip_media_missing' };
        }
        const generateVideoFn = require('../routes/video-generate.cjs').generateVideoInternal;
        logger.info?.(
          '[vivy-full-clip] round=%s preparing scene loops target=%ss cover=%s seed=%s',
          roundId,
          Math.round(targetDurationSeconds),
          coverImageUrl ? 'true' : 'false',
          coverVideoUrl ? 'true' : 'false'
        );
        const prepared = await prepareTwitchFullSongClip({
          env: clipEnv,
          publicTitle,
          winner,
          lyrics: providerPack.cleanLyrics || lyrics,
          durationSeconds: targetDurationSeconds,
          trackUrl: '',
          coverImageUrl: fullClipSourceImageUrl || coverImageUrl,
          coverPrompt,
          seedVideoUrl: coverVideoUrl,
          coverVideoUrl,
          coverVideoPrompt,
          styleBrief: providerPack.styleBrief,
          artists,
          vocalCast: artists.join(' + '),
          intentPlan,
          subjectFrame,
          instrumentalMode,
          conversationId,
          req,
          generateVideoFn,
          logger,
        });
        if (!prepared?.ok || prepared.skipped) {
          if (prepared && !prepared.skipped) {
            logger.warn?.(
              '[vivy-full-clip] round=%s prepare skipped error=%s message=%s',
              roundId,
              cleanText(prepared.error || prepared.reason || 'unknown', '', 120),
              cleanText(prepared.message || '', '', 180)
            );
          }
          return prepared;
        }
        logger.info?.(
          '[vivy-full-clip] round=%s scene loops prepared scenes=%s generatedSceneLoops=%s',
          roundId,
          Array.isArray(prepared.storyboard) ? prepared.storyboard.length : 0,
          prepared.generatedSceneLoops === true ? 'true' : 'false'
        );
        return prepared;
      }).catch((error) => {
        logger.warn?.('[vivy-full-clip] round=%s prepare failed: %s', roundId, cleanText(error?.message || error, '', 180));
        return { ok: false, error: 'full_clip_prepare_failed', message: cleanText(error?.message || error, '', 180) };
      });
      void fullClipPreparePromise;
      const productionInput = {
        mode: 'song',
        language: 'fr',
        conversationId,
        sessionId,
        sessionName: `Twitch Live - ${winner.text}`,
        message: instrumentalMode
          ? 'NOSSEN Twitch Live: production instrumentale finale.'
          : 'NOSSEN Twitch Live: production finale.',
        prompt: providerPack.styleBrief,
        title: publicTitle,
        songTitle: publicTitle,
        songSource: 'Twitch Live',
        songArtists: artists,
        artistCount: artists.length,
        singerCount: artists.length,
        vocalCast: artists.join(' + '),
        songMood: providerPack.styleBrief,
        vivyIntent: intentPlan?.intent || '',
        vivyIntentReason: intentPlan?.reason || '',
        shouldPrioritizeSfx: intentPlan?.shouldPrioritizeSfx === true,
        sfxPriority: intentPlan?.sfxPriority || 'none',
        vocalPolicy: intentPlan?.vocalPolicy || (instrumentalMode ? 'forbid' : 'allow'),
        lyrics: providerPack.cleanLyrics,
        songText: instrumentalMode ? instrumentalMaterial : providerPack.cleanLyrics,
        instrumental: instrumentalMode,
        forceInstrumental: instrumentalMode,
        forceRealMusic: true,
        generateMusic: true,
        makeSong: true,
        preserveSelectedVoice: !instrumentalMode,
        allowExternalVoiceMix: false,
        externalVoiceMix: false,
        forceExternalVoiceMix: false,
        previewInstrumental: false,
        disableEmergencyMedia: true,
        musicProvider,
        musicModel: musicProvider === 'mureka'
          ? process.env.VIVY_MUREKA_MODEL || 'mureka-9'
          : musicProvider === 'elevenlabs'
            ? process.env.VIVY_ELEVENLABS_MUSIC_MODEL || 'music_v2'
            : process.env.VIVY_SUNO_LONG_MODEL || process.env.VIVY_SUNO_MODEL || 'V5_5',
        longSong: targetDurationSeconds >= 300,
        targetDurationSeconds,
        requireLocalSunoAudio: true,
        sunoLocalAudioRequired: true,
        sunoStatusAudioFetchAttempts: Number(process.env.VIVY_STREAM_SUNO_AUDIO_FETCH_ATTEMPTS || 4),
        sunoStatusAudioFetchTimeoutMs: Number(process.env.VIVY_STREAM_SUNO_AUDIO_FETCH_TIMEOUT_MS || 180000),
        sunoStatusAudioRetryDelayMs: Number(process.env.VIVY_STREAM_SUNO_AUDIO_RETRY_DELAY_MS || 3000),
      };
      let result = await startMusic('song', productionInput, req);
      let media = getReadyLocalMedia(result, logger, { roundId });
      const taskId = getMusicTaskId(result);
      let latestTaskId = taskId;
      logger.info?.(
        '[vivy-twitch-nossen] round=%s provider=%s submitted task=%s status=%s model=%s',
        roundId,
        musicProvider,
        taskId || 'immediate',
        cleanText(result?.status || result?.state || 'unknown', '', 80),
        cleanText(result?.model || productionInput.musicModel || 'unknown', '', 80)
      );

      if (!media && !taskId) throw new Error('vivy_stream_suno_task_missing');
      for (let attempt = 1; !media && attempt <= pollAttempts; attempt += 1) {
        await sleepFn(attempt <= 2 ? Math.min(5000, pollIntervalMs) : pollIntervalMs);
        result = await pollMusic(taskId, productionInput, req);
        if (String(result?.state || '').toLowerCase() === 'error') {
          logger.warn?.(
            '[vivy-twitch-nossen] round=%s suno rejected task=%s status=%s message=%s',
            roundId,
            taskId,
            cleanText(result?.status || 'error', '', 80),
            cleanText(result?.message || result?.providerDetail || 'unknown', '', 220)
          );
          throw new Error(result?.message || 'vivy_stream_suno_failed');
        }
        media = getReadyLocalMedia(result, logger, { roundId });
        await update({
          action: 'progress',
          stage: 'composition',
          progress: Math.min(94, 8 + Math.round((attempt / pollAttempts) * 86)),
          message: `${musicProvider} compose le morceau (${attempt}/${pollAttempts}, souvent 2 à 5 min).`,
        });
      }
      if (!media) throw new Error('vivy_stream_suno_timeout');

      let durationSeconds = Math.max(1, Number(await probeDuration(media) || media.durationSeconds || targetDurationSeconds));
      const mustChaseRequestedDuration = fixedTargetDurationSeconds > 0 || lyricScope.chaseDuration === true;
      const extensionGoalSeconds = mustChaseRequestedDuration ? targetDurationSeconds : minAcceptableSeconds;
      const canExtendWithSuno = musicProvider === 'suno';
      const paidMusicRetryConfirmed = isPaidMusicRetryConfirmed(payload);
      const rescueFloorSeconds = resolveTwitchDurationAcceptance({
        durationSeconds,
        minAcceptableSeconds,
      }).hardMinimumSeconds;
      const rescueExtensionNeeded = durationSeconds < rescueFloorSeconds;
      const extensionAllowed = paidMusicRetryConfirmed || rescueExtensionNeeded;
      if (canExtendWithSuno && durationSeconds < extensionGoalSeconds && !extensionAllowed) {
        logger.info?.(
          '[vivy-twitch-nossen] round=%s short duration=%ss target=%ss extension skipped: paid_retry_not_confirmed',
          roundId,
          Math.round(durationSeconds),
          Math.round(extensionGoalSeconds)
        );
      }
      if (canExtendWithSuno && rescueExtensionNeeded && !paidMusicRetryConfirmed) {
        logger.warn?.(
          '[vivy-twitch-nossen] round=%s duration=%ss below hard floor %ss: rescue extension allowed to avoid losing the round',
          roundId,
          Math.round(durationSeconds),
          Math.round(rescueFloorSeconds)
        );
      }
      const extensionStopSeconds = paidMusicRetryConfirmed ? extensionGoalSeconds : rescueFloorSeconds;
      for (let extensionIndex = 1; canExtendWithSuno && extensionAllowed && extensionIndex <= maxExtensions && durationSeconds < extensionStopSeconds; extensionIndex += 1) {
        const audioId = getSunoAudioId(media) || getSunoAudioId(result);
        if (!audioId) {
          logger.warn?.(
            '[vivy-twitch-nossen] round=%s short duration=%ss but no Suno audioId for extension',
            roundId,
            Math.round(durationSeconds)
          );
          break;
        }
        await update({
          action: 'progress',
          stage: 'composition',
          progress: Math.min(96, 72 + extensionIndex * 6),
          message: `Suno a rendu ${Math.round(durationSeconds)}s, extension ${extensionIndex}/${maxExtensions} vers ${Math.round(extensionGoalSeconds)}s.`,
        });
        const uploadUrl = resolvePublicMediaUrl(media.url || media.audioUrl || media.audio_url, req);
        logger.info?.(
          '[vivy-twitch-nossen] round=%s extending short suno audioId=%s upload=%s duration=%ss target=%ss attempt=%s/%s promptChars=%s styleChars=%s',
          roundId,
          cleanText(audioId, '', 80),
          uploadUrl ? 'true' : 'false',
          Math.round(durationSeconds),
          Math.round(extensionGoalSeconds),
          extensionIndex,
          maxExtensions,
          String(productionInput.songText || '').length,
          String(productionInput.songMood || productionInput.prompt || '').length
        );
        const vocalExtensionPrompt = instrumentalMode
          ? ''
          : buildVocalExtensionPrompt(lyrics, {
            durationSeconds,
            targetDurationSeconds: extensionGoalSeconds,
            extensionIndex,
            maxExtensions,
          });
        const extensionPrompt = instrumentalMode
          ? productionInput.songText
          : vocalExtensionPrompt || lyrics;
        logger.info?.(
          '[vivy-twitch-nossen] round=%s extension continuation attempt=%s/%s promptChars=%s fullLyricsChars=%s',
          roundId,
          extensionIndex,
          maxExtensions,
          String(extensionPrompt || '').length,
          String(lyrics || '').length
        );
        let extensionStart;
        try {
          const extensionDurationHint = targetDurationSeconds >= 420
            ? 'long-form continuation toward the requested extended ending'
            : targetDurationSeconds >= 300
              ? 'full-song continuation toward the requested ending'
              : 'compact continuation to finish the same song cleanly';
          extensionStart = await extendMusic({
            audioId,
            uploadUrl: uploadUrl || undefined,
            forceUploadExtend: Boolean(uploadUrl),
            model: productionInput.musicModel || getSunoModel(result, 'V5_5'),
            sourceTaskId: latestTaskId || undefined,
            sourceDurationSeconds: durationSeconds,
            continueAtSeconds: Math.max(1, Math.floor(durationSeconds - 8)),
            targetDurationSeconds: extensionGoalSeconds,
            title: winner.text,
            style: [
              productionInput.songMood || productionInput.prompt,
              `same subject and story: ${cleanText(winner.text, '', 180)}`,
              instrumentalMode
                ? `${extensionDurationHint}, keep sound design motifs, complete clean ending`
                : `${extensionDurationHint} with sung lead vocals`,
              instrumentalMode
                ? 'continue the same instrumental scene, no vocals, no sung words, no spoken narration'
                : `continue after about ${Math.round(durationSeconds)} seconds; do not restart the intro or first verse; use the remaining lyric sections as the next part`,
              instrumentalMode
                ? 'complete clean ending, no short radio edit'
                : 'build toward one varied final hook, bridge and outro; do not repeat the previous chorus verbatim or loop the same refrain',
            ].filter(Boolean).join(', '),
            prompt: extensionPrompt,
            instrumental: instrumentalMode,
            forceInstrumental: instrumentalMode,
            previewInstrumental: false,
            sessionSunoApiKey: productionInput.sessionSunoApiKey,
          }, req);
        } catch (error) {
          logger.warn?.(
            '[vivy-twitch-nossen] round=%s extension unavailable after %ss: %s',
            roundId,
            Math.round(durationSeconds),
            cleanText(error?.message || error, 'unknown', 220)
          );
          await update({
            action: 'progress',
            stage: 'composition',
            progress: 96,
            message: `Extension indisponible; Vivy finalise la meilleure version disponible (${Math.round(durationSeconds)}s).`,
          });
          break;
        }
        let extendedMedia = getReadyLocalMedia(extensionStart, logger, { roundId });
        const extensionTaskId = getMusicTaskId(extensionStart);
        latestTaskId = extensionTaskId || latestTaskId;
        for (let attempt = 1; !extendedMedia && extensionTaskId && attempt <= pollAttempts; attempt += 1) {
          await sleepFn(attempt <= 2 ? Math.min(5000, pollIntervalMs) : pollIntervalMs);
          const extensionResult = await pollMusic(extensionTaskId, productionInput, req);
          if (String(extensionResult?.state || '').toLowerCase() === 'error') {
            logger.warn?.(
              '[vivy-twitch-nossen] round=%s extension rejected task=%s status=%s message=%s',
              roundId,
              extensionTaskId,
              cleanText(extensionResult?.status || 'error', '', 80),
              cleanText(extensionResult?.message || extensionResult?.providerDetail || 'unknown', '', 220)
            );
            break;
          }
          extendedMedia = getReadyLocalMedia(extensionResult, logger, { roundId });
          await update({
            action: 'progress',
            stage: 'composition',
            progress: Math.min(98, 78 + Math.round((attempt / pollAttempts) * 16)),
            message: `Suno étend le morceau (${attempt}/${pollAttempts}).`,
          });
        }
        if (!extendedMedia) {
          await update({
            action: 'progress',
            stage: 'composition',
            progress: 96,
            message: `Extension non récupérée; Vivy finalise la meilleure version disponible (${Math.round(durationSeconds)}s).`,
          });
          break;
        }
        const previousDurationSeconds = durationSeconds;
        const candidateDurationSeconds = Math.max(1, Number(await probeDuration(extendedMedia) || extendedMedia.durationSeconds || 0));
        if (!(candidateDurationSeconds > 0)) break;
        if (candidateDurationSeconds <= previousDurationSeconds + 8) {
          logger.warn?.(
            '[vivy-twitch-nossen] round=%s extension made no real progress previous=%ss candidate=%ss',
            roundId,
            Math.round(previousDurationSeconds),
            Math.round(candidateDurationSeconds)
          );
          break;
        }
        media = extendedMedia;
        result = extensionStart;
        durationSeconds = candidateDurationSeconds;
      }
      const durationAcceptance = resolveTwitchDurationAcceptance({
        durationSeconds,
        minAcceptableSeconds,
      });
      if (!durationAcceptance.ok) {
        throw new Error(`vivy_stream_suno_too_short_${Math.round(durationSeconds)}s`);
      }
      if (durationAcceptance.shortMix) {
        logger.warn?.(
          '[vivy-twitch-nossen] round=%s accepted short mix duration=%ss desiredMin=%ss hardMin=%ss',
          roundId,
          durationAcceptance.durationSeconds,
          durationAcceptance.desiredMinimumSeconds,
          durationAcceptance.hardMinimumSeconds
        );
        await update({
          action: 'progress',
          stage: 'composition',
          progress: 97,
          message: `Version courte générée (${durationAcceptance.durationSeconds}s); Vivy archive et lance le vote sans retry payant.`,
        });
      }

      await update({
        action: 'progress',
        stage: 'mix',
        progress: 88,
        message: durationAcceptance.shortMix
          ? 'Audio prêt en version courte générée, Vivy attend le pack vidéo avant de lancer la lecture.'
          : 'Audio prêt, Vivy attend le pack vidéo avant de lancer la lecture.',
      });
      const fullClipReadyWaitMs = resolveFullClipReadyWaitMs(process.env);
      let shareVideoUrl = '';
      const buildFullClipFinalizeInput = () => ({
        env: clipEnv,
        publicTitle,
        winner,
        durationSeconds,
        trackUrl: media.url,
        audioPath: media.path || '',
        coverImageUrl,
        coverPrompt,
        coverVideoUrl,
        coverVideoPrompt,
        styleBrief: providerPack.styleBrief,
        artists,
        vocalCast: artists.join(' + '),
        conversationId,
        req,
        logger,
      });
      const preparedFullClip = await withTimeout(
        () => fullClipPreparePromise,
        fullClipReadyWaitMs,
        'vivy_full_clip_ready'
      ).catch((error) => {
        logger.warn?.(
          '[vivy-full-clip] round=%s not ready after %sms, releasing audio playback: %s',
          roundId,
          fullClipReadyWaitMs,
          cleanText(error?.message || error, '', 180)
        );
        return {
          ok: false,
          skipped: true,
          reason: 'full_clip_ready_timeout',
          message: `Pack vidéo non prêt après ${Math.round(fullClipReadyWaitMs / 1000)}s; lecture audio libérée.`,
        };
      });
      if (preparedFullClip?.ok) {
        await update({
          action: 'progress',
          stage: 'mix',
          progress: 94,
          message: 'Boucles vidéo prêtes, montage final synchronisé avec le morceau.',
        });
        const fullClip = await finalizeTwitchFullSongClip(preparedFullClip, buildFullClipFinalizeInput());
        if (!fullClip?.ok || !fullClip.coverVideoUrl) {
          if (fullClip && !fullClip.skipped) {
            logger.warn?.(
              '[vivy-full-clip] round=%s skipped error=%s message=%s',
              roundId,
              cleanText(fullClip.error || fullClip.reason || 'unknown', '', 120),
              cleanText(fullClip.message || '', '', 180)
            );
          }
        } else {
          coverVideoUrl = fullClip.coverVideoUrl;
          coverVideoPrompt = fullClip.prompt || coverVideoPrompt;
          shareVideoUrl = fullClip.shareVideoUrl || '';
          logger.info?.(
            '[vivy-full-clip] round=%s ready url=%s scenes=%s generatedSceneLoops=%s repairedLoops=%s',
            roundId,
            cleanText(fullClip.coverVideoUrl, '', 180),
            Array.isArray(fullClip.storyboard) ? fullClip.storyboard.length : 0,
            fullClip.generatedSceneLoops === true ? 'true' : 'false',
            Math.max(0, Number(fullClip.repairedLoopCount || 0))
          );
        }
      } else if (preparedFullClip?.reason === 'full_clip_ready_timeout') {
        const lateFinalizeInput = buildFullClipFinalizeInput();
        const lateAttachPromise = fullClipPreparePromise
          .then(async (prepared) => {
            if (!prepared?.ok || prepared.skipped) {
              if (prepared && !prepared.skipped) {
                logger.warn?.(
                  '[vivy-full-clip] round=%s late prepare failed error=%s message=%s',
                  roundId,
                  cleanText(prepared.error || prepared.reason || 'unknown', '', 120),
                  cleanText(prepared.message || '', '', 180)
                );
              }
              return null;
            }
            logger.info?.('[vivy-full-clip] round=%s scene loops ready after playback, late montage started', roundId);
            const fullClip = await finalizeTwitchFullSongClip(prepared, lateFinalizeInput);
            if (!fullClip?.ok || !fullClip.coverVideoUrl) {
              logger.warn?.(
                '[vivy-full-clip] round=%s late montage failed error=%s message=%s',
                roundId,
                cleanText(fullClip?.error || fullClip?.reason || 'unknown', '', 120),
                cleanText(fullClip?.message || '', '', 180)
              );
              return null;
            }
            await update({
              action: 'clip',
              source: 'vivy-full-clip-late',
              trackUrl: media.url,
              coverVideoUrl: fullClip.coverVideoUrl,
              coverVideoPrompt: fullClip.prompt || '',
              shareVideoUrl: fullClip.shareVideoUrl || '',
            });
            logger.info?.(
              '[vivy-full-clip] round=%s late clip attached url=%s share=%s',
              roundId,
              cleanText(fullClip.coverVideoUrl, '', 180),
              cleanText(fullClip.shareVideoUrl || 'none', '', 180)
            );
            return fullClip;
          })
          .catch((error) => {
            logger.warn?.(
              '[vivy-full-clip] round=%s late attach failed: %s',
              roundId,
              cleanText(error?.message || error, '', 180)
            );
            return null;
          });
        void lateAttachPromise;
      } else if (preparedFullClip && !preparedFullClip.skipped) {
        logger.warn?.(
          '[vivy-full-clip] round=%s unavailable before ready error=%s message=%s',
          roundId,
          cleanText(preparedFullClip.error || preparedFullClip.reason || 'unknown', '', 120),
          cleanText(preparedFullClip.message || '', '', 180)
        );
      }

      // V9 dynamique sur le MP3 live: Djeff entend la différence direct, on
      // masterise chaque round (local ffmpeg, quelques secondes). Le MP3 servi
      // devient la version masterisée; la relique WAV/FLAC garde son profil.
      try {
        const masterPath = cleanText(media?.path, '', 1200);
        if (masterPath && /\.mp3$/i.test(masterPath)) {
          const mastered = await masterVivyMusicFile(masterPath);
          if (mastered?.ok) {
            logger.info?.(
              '[vivy-twitch-nossen] round=%s master V9 applique %s->%s octets I=%s TP=%s LRA=%s',
              roundId, mastered.originalSize, mastered.masteredSize, mastered.targetLufs, mastered.truePeak, mastered.lra
            );
          } else if (mastered && !mastered.skipped) {
            logger.warn?.('[vivy-twitch-nossen] round=%s master non applique: %s', roundId, cleanText(mastered.reason || mastered.message || '', '', 120));
          }
        }
      } catch (error) {
        logger.warn?.('[vivy-twitch-nossen] round=%s master erreur (audio brut conserve): %s', roundId, cleanText(error?.message || error, '', 120));
      }

      await update({
        action: 'progress',
        stage: 'mix',
        progress: 100,
        message: durationAcceptance.shortMix
          ? (coverVideoUrl
            ? 'Version courte générée, pack audio + vidéo prêt, lancement de la lecture.'
            : 'Version courte générée, lancement avec visuel de secours.')
          : (coverVideoUrl
            ? 'Pack audio + vidéo prêt, lancement de la lecture.'
            : 'Audio prêt, lancement avec visuel de secours.'),
      });
      await update({
        action: 'ready',
        title: publicTitle,
        trackTitle: publicTitle,
        trackUrl: media.url,
        durationSeconds,
        ...(durationAcceptance.shortMix
          ? { qualityNote: durationAcceptance.note, shortMix: true }
          : {}),
        requestedBy: winner.author,
        coverImageUrl,
        coverPrompt,
        coverVideoUrl,
        coverVideoPrompt,
        shareVideoUrl,
        lyrics: instrumentalMode ? '' : (providerPack?.cleanLyrics || lyrics || ''),
      });
      logger.info?.(
        '[vivy-twitch-nossen] round=%s ready task=%s duration=%ss',
        roundId,
        latestTaskId || taskId || 'immediate',
        Math.round(durationSeconds)
      );
      return { ok: true, roundId, taskId, media, routing, lyrics };
    } catch (error) {
      const message = cleanText(error?.message || error, 'Échec de la composition Twitch.', 240);
      logger.error?.('[vivy-twitch-nossen] round=%s failed: %s', roundId, message);
      await update({
        action: 'error',
        message: `NOSSEN Twitch arrêté: ${message}`,
      });
      throw error;
    }
  }

  function start(payload = {}) {
    const roundId = cleanText(payload.roundId || payload.id, '', 120);
    if (!roundId) return { started: false, error: 'round_id_missing', promise: null };
    if (activeRuns.has(roundId)) {
      return { started: false, error: 'round_already_running', promise: activeRuns.get(roundId) };
    }
    const promise = run(payload).finally(() => activeRuns.delete(roundId));
    promise.catch(() => {});
    activeRuns.set(roundId, promise);
    return { started: true, promise };
  }

  return {
    isRunning: (roundId) => activeRuns.has(cleanText(roundId, '', 120)),
    run,
    start,
  };
}

module.exports = {
  buildTwitchLyricsRequest,
  buildTwitchCoverNegativePrompt,
  buildTwitchCoverPrompt,
  buildTwitchClipPrompt,
  buildTwitchPublicTrackTitle,
  buildVocalExtensionPrompt,
  buildTwitchEmergencyLyrics,
  createTrustedTwitchRequest,
  createVivyStreamNossenRunner,
  extractCleanTwitchLyricsBlock,
  extractTwitchMusicProviderDirective,
  generateTwitchCoverImage,
  generateTwitchCoverVideo,
  getMusicTaskId,
  getReadyMedia,
  probeMediaDurationSeconds,
  reduceMechanicalLyricRepeats,
  resolveTwitchCreativePlaceholders,
  resolveTwitchDurationAcceptance,
  resolveTwitchFullClipSourceImageUrl,
  resolveTwitchSubjectFrame,
  resolveTwitchVivyLyricScope,
  isConceptualHookRequest,
  isHardcoreRaveRequest,
  isRapFreestyleRequest,
  reinforceTwitchHardcoreRouting,
  reinforceTwitchHumorRouting,
  reinforceTwitchRapFreestyleRouting,
  buildRapFreestyleGuidance,
  assessTwitchLyricLoopiness,
  assessTwitchHookMechanic,
  assessTwitchRhymeSignals,
  assessTwitchSongLyrics,
  buildTwitchProviderPack,
  sanitizeTwitchLyricsForPromptLeakage,
  sanitizeTwitchLyricsForSubjectDetailed,
};
