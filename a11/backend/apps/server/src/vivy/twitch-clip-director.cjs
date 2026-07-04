'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { uploadBufferToR2 } = require('../../lib/file-storage.cjs');
const {
  appendVivyVisualIdentityBrief,
  buildVivyVisualIdentityPack,
  resolveVivyVisualFocus,
} = require('./visual-identities.cjs');

const SECTION_HEADER_RE = /^\s*\[([^\]]+)\]\s*$/;
const DEFAULT_FULL_CLIP_SCENES = 8;
const DEFAULT_CLOUD_SCENE_COUNT = 8;
const DEFAULT_INSTRUMENTAL_SCENE_COUNT = 8;
const DEFAULT_UNIQUE_LOOP_COUNT = 5;
const DEFAULT_DREAM_CLIP_SCENES = 8;
const DEFAULT_DREAM_CLIP_MAX_SECONDS = 300;
const DEFAULT_DREAM_CLIP_MIN_COVERAGE = 0.72;
const FULL_THROTTLE_LOOP_SECONDS = 8;
const DEFAULT_GRID_DEMOSAIC_ORDER = [4, 1, 5, 7, 2, 8];
const DEFAULT_SOURCE_CROP_WIDTH_RATIO = 0.58;
const DEFAULT_SOURCE_CROP_X_BIAS = 0.62;
const DEFAULT_SOURCE_CROP_Y_BIAS = 0.5;
const DEFAULT_EDITOR_BPM = 120;
const DEFAULT_EDITOR_MIN_SEGMENT_SECONDS = 2.5;
const DEFAULT_EDITOR_MAX_SEGMENT_SECONDS = 8;
const DEFAULT_EDITOR_TRANSITION_SECONDS = 0.28;
const DEFAULT_EDITOR_MAX_SEGMENTS = 64;
const VIDEO_LOOP_NEGATIVE_PROMPT = [
  'text',
  'letters',
  'words',
  'caption',
  'subtitles',
  'title card',
  'logo',
  'watermark',
  'signature',
  'typography',
  'signage',
  'UI text',
  'gibberish text',
  'pseudo text',
  'scribbles',
  'fake writing',
  'floating symbols',
  'double exposure',
  'ghost face',
  'duplicate face',
  'face morphing',
  'malformed face',
  'transient overlay',
  'broken anatomy',
  'extra limbs',
  'extra arms',
  'extra legs',
  'extra fingers',
  'missing fingers',
  'deformed hands',
  'fused hands',
  'missing limbs',
  'disembodied hand',
  'mutated body',
].join(', ');

function cleanText(value = '', fallback = '', max = 400) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, Math.max(20, Number(max) || 400)).trim();
}

function cleanLyrics(value = '', max = 16000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, Math.max(200, Number(max) || 16000))
    .trim();
}

function foldForVisualLookup(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeModeToken(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function slugify(value = '', fallback = 'vivy-clip') {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function sectionKind(header = '') {
  const normalized = String(header || '').toLowerCase();
  if (/intro/.test(normalized)) return 'intro';
  if (/pre|pré/.test(normalized)) return 'prechorus';
  if (/chorus|refrain/.test(normalized)) return /final|dernier/.test(normalized) ? 'final_chorus' : 'chorus';
  if (/bridge|pont/.test(normalized)) return 'bridge';
  if (/outro|fin/.test(normalized)) return 'outro';
  return 'verse';
}

function isPerformerOnlyHeader(header = '') {
  const normalized = String(header || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+& ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return /^(?:solo\s+)?(?:vivy|djeff|jeff|a11|alpha\s+onze|k44|kaen44)(?:\s*(?:\+|&|et|x)\s*(?:vivy|djeff|jeff|a11|alpha\s+onze|k44|kaen44))*$/.test(normalized)
    || /^(?:duo|trio|tous|ensemble|choeur|chœur)(?:\s+(?:vivy|djeff|jeff|a11|alpha\s+onze|k44|kaen44))*$/.test(normalized);
}

function visualHeaderForScene(scene = {}) {
  if (!isPerformerOnlyHeader(scene.header)) return cleanText(scene.header, 'Section', 80);
  if (scene.kind === 'chorus' || scene.kind === 'final_chorus') return scene.kind === 'final_chorus' ? 'Final Chorus' : 'Chorus';
  if (scene.kind === 'bridge') return 'Bridge';
  if (scene.kind === 'prechorus') return 'Pre-Chorus';
  if (scene.kind === 'intro') return 'Intro';
  if (scene.kind === 'outro') return 'Outro';
  return `Verse ${Math.max(1, Number(scene.index || 0) + 1)}`;
}

function parseLyricSectionsForClip(lyrics = '') {
  const lines = cleanLyrics(lyrics).split('\n');
  const sections = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const header = line.match(SECTION_HEADER_RE);
    if (header) {
      if (current) sections.push(current);
      current = {
        header: cleanText(header[1], 'Section', 80),
        kind: sectionKind(header[1]),
        lines: [],
      };
      continue;
    }
    if (!line) continue;
    if (!current) {
      current = { header: 'Intro', kind: 'intro', lines: [] };
    }
    current.lines.push(line);
  }
  if (current) sections.push(current);

  return sections
    .map((section, index) => ({
      ...section,
      index,
      text: section.lines.join('\n'),
      weight: Math.max(1, section.lines.join(' ').length),
    }))
    .filter((section) => section.text);
}

function sectionPriority(section = {}) {
  if (section.kind === 'final_chorus') return 100;
  if (section.kind === 'chorus') return 92;
  if (section.kind === 'bridge') return 86;
  if (section.kind === 'intro') return 80;
  if (section.kind === 'outro') return 72;
  return 60 + Math.min(20, Number(section.index || 0));
}

function pickStoryboardSections(sections = [], maxScenes = DEFAULT_FULL_CLIP_SCENES) {
  const limit = Math.max(1, Math.min(8, Number(maxScenes) || DEFAULT_FULL_CLIP_SCENES));
  if (sections.length <= limit) return sections;

  const picked = [];
  const add = (section) => {
    if (picked.length >= limit) return;
    if (section && !picked.some((item) => item.index === section.index)) picked.push(section);
  };

  add(sections.find((section) => section.kind === 'intro') || sections[0]);
  add(sections.find((section) => section.kind === 'chorus' || section.kind === 'final_chorus'));
  add(sections.find((section) => section.kind === 'bridge'));
  add([...sections].reverse().find((section) => ['final_chorus', 'outro', 'chorus'].includes(section.kind)) || sections.at(-1));

  const remaining = [...sections]
    .filter((section) => !picked.some((item) => item.index === section.index))
    .sort((a, b) => sectionPriority(b) - sectionPriority(a));
  for (const section of remaining) {
    if (picked.length >= limit) break;
    add(section);
  }

  return picked.sort((a, b) => a.index - b.index);
}

function allocateSceneTimings(sections = [], durationSeconds = 180) {
  const totalDuration = Math.max(15, Number(durationSeconds) || 180);
  const totalWeight = Math.max(1, sections.reduce((sum, section) => sum + Number(section.weight || 1), 0));
  let cursor = 0;
  return sections.map((section, index) => {
    const isLast = index === sections.length - 1;
    const rawDuration = isLast
      ? Math.max(1, totalDuration - cursor)
      : Math.max(6, (Number(section.weight || 1) / totalWeight) * totalDuration);
    const end = isLast ? totalDuration : Math.min(totalDuration, cursor + rawDuration);
    const scene = {
      ...section,
      startSeconds: Number(cursor.toFixed(2)),
      endSeconds: Number(end.toFixed(2)),
      durationSeconds: Number(Math.max(1, end - cursor).toFixed(2)),
    };
    cursor = end;
    return scene;
  });
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const VIDEO_VISUAL_STOPWORDS = new Set([
  'avec', 'dans', 'pour', 'plus', 'mais', 'sans', 'sous', 'tout', 'tous',
  'toute', 'toutes', 'comme', 'quand', 'chaque', 'encore', 'entre', 'vers',
  'elle', 'elles', 'leur', 'leurs', 'nous', 'vous', 'notre', 'votre', 'mes',
  'tes', 'ses', 'des', 'les', 'une', 'aux', 'qui', 'que', 'quoi', 'dont',
  'intro', 'verse', 'couplet', 'refrain', 'chorus', 'bridge', 'pont',
  'final', 'outro', 'suis', 'chant', 'chante', 'paroles', 'titre', 'vivy',
]);

function buildImageOnlySceneMotifs(text = '', fallback = '', blockedText = '') {
  const lookup = foldForVisualLookup(`${text} ${fallback}`)
    .replace(new RegExp(escapeRegex(foldForVisualLookup(blockedText)), 'g'), ' ');
  const concepts = [
    [/\b(soleil|aube|matin|lumiere|rayon|ciel|orbite)\b/, 'source de lumière chaude mobile, horizon ouvert et ombres qui reculent'],
    [/\b(nuit|ombre|noir|obscur|lune)\b/, 'nuit profonde, contre-jour et points lumineux isolés'],
    [/\b(ville|rue|immeuble|village|quartier)\b/, 'décor urbain habité avec profondeur et circulation visuelle'],
    [/\b(machine|robot|ecran|cable|circuit|code|serveur)\b/, 'mécanismes lumineux, câbles en mouvement et impulsions électriques abstraites'],
    [/\b(espace|etoile|galaxie|nebuleuse|vaisseau|planete)\b/, 'profondeur spatiale, silhouettes orbitales et poussière stellaire'],
    [/\b(route|moto|voiture|course|poursuite|helico)\b/, 'trajectoire rapide, véhicule en mouvement et caméra de poursuite stable'],
    [/\b(pluie|riviere|mer|ocean|eau|vague)\b/, 'reflets liquides, pluie visible et mouvement naturel de l’eau'],
    [/\b(feu|flamme|brule|incendie)\b/, 'lueurs ardentes, fumée contrôlée et chaleur visible dans le décor'],
    [/\b(foret|arbre|marais|nature|fleur|jardin)\b/, 'végétation en mouvement, profondeur organique et lumière traversante'],
    [/\b(coeur|humeur|emotion|joie|triste|colere|peur)\b/, 'changement de couleur et de lumière incarnant l’émotion sans symbole écrit'],
    [/\b(danse|rythme|batterie|guitare|musique)\b/, 'gestes rythmiques, objets vibrants et mouvement de caméra cadencé'],
    [/\b(porte|cle|fenetre|sortie|passage)\b/, 'seuil visuel, ouverture progressive et déplacement vers un nouvel espace'],
  ]
    .filter(([pattern]) => pattern.test(lookup))
    .map(([, description]) => description)
    .slice(0, 4);
  if (!concepts.length) {
    concepts.push('action concrète lisible, objet symbolique unique, décor profond et lumière expressive');
  }
  return `repères purement visuels: ${concepts.join('; ')}; aucune lettre ni aucun mot ne doit matérialiser ces idées`;
}

function removeTitlePhraseFromVideoText(value = '', title = '') {
  let result = cleanText(value, '', 1000);
  const cleanTitle = cleanText(title, '', 180);
  if (cleanTitle.length >= 4) {
    result = result.replace(new RegExp(escapeRegex(cleanTitle), 'ig'), ' ');
  }
  const sourceHead = cleanText(String(value || '').split(/[,.;:!?]/)[0], '', 160);
  if (sourceHead.length >= 4) {
    result = result.replace(new RegExp(escapeRegex(sourceHead), 'ig'), ' ');
  }
  return cleanText(result.replace(/^[\s,.;:!?-]+/, ''), '', 700);
}

function stripLyricsAndDialogueFromVisualBrief(value = '', title = '') {
  let result = removeTitlePhraseFromVideoText(value, title)
    .replace(/«[^»]*»/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/\b(?:refrain|hook|paroles?|lyrics?|couplet|verse|pont|bridge|intro|outro)\b[^:.;!?]{0,60}[:=-]\s*[^.;!?]*/gi, ' ')
    .replace(/\b(?:refrain|hook)\s+(?:lumineux|viral|puissant|mémorable|memorable|final|énorme|enorme)\b[^.;!?]*/gi, ' ')
    .replace(/:\s*/g, '. ')
    .replace(/\s*\.\s*\.+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
  const folded = foldForVisualLookup(result);
  const explicitlyYoung = /\b(enfant|petite fille|fillette|adolescente|ado|jeune fille mineure)\b/.test(folded);
  if (!explicitlyYoung) {
    result = result.replace(/\bune fille\b/gi, 'une jeune femme adulte');
  }
  return cleanText(result.replace(/^(?:et|puis|qui|mais)\s+/i, ''), '', 420);
}

function sanitizeVideoStyleBrief(value = '') {
  return cleanText(value, '', 800)
    .split(/[,.;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/\b(?:voix|vocal|vocals|chant|chante|chanteuse|chanteur|paroles?|lyrics?|refrain|chorus|couplet|verse|microphone|micro)\b/i.test(part))
    .slice(0, 8)
    .join(', ');
}

function buildSceneCameraDirection(scene = {}) {
  if (scene.kind === 'intro') {
    return 'Plan large d’établissement, décor entier lisible, sujet à taille humaine, aucun visage plein cadre.';
  }
  if (scene.kind === 'chorus' || scene.kind === 'final_chorus') {
    return 'Plan large dynamique avec symbole central récurrent, mouvement de caméra ample et silhouette entière.';
  }
  if (scene.kind === 'bridge') {
    return 'Plan moyen stable, bascule de lumière et geste clair, sans surimpression ni double exposition.';
  }
  if (scene.kind === 'outro') {
    return 'Plan large de résolution, mouvement lent vers le décor final, composition simple et stable.';
  }
  return 'Plan moyen narratif montrant une action concrète et son décor, visage non recadré en très gros plan.';
}

function buildSceneVisualPrompt({
  publicTitle = '',
  winner = {},
  scene = {},
  styleBrief = '',
  coverPrompt = '',
  artists = [],
  vocalCast = '',
  subjectFrame = {},
} = {}) {
  const idea = cleanText(winner?.text || '', '', 600)
    .replace(/^\s*!(?:vivy|nossen|chanson|song|th[eè]me|idee|idée)\b[\s:,-]*/i, '');
  const safeIdea = stripLyricsAndDialogueFromVisualBrief(idea, publicTitle);
  const style = sanitizeVideoStyleBrief(styleBrief);
  const visualFocus = resolveVivyVisualFocus({ publicTitle, winner, styleBrief, intentPlan: {}, idea: winner?.text });
  const imageOnlyMotifs = buildImageOnlySceneMotifs(
    scene.text,
    safeIdea || idea,
    publicTitle || String(idea).split(/[,.;:!?]/)[0]
  );
  const motifs = visualFocus.nonHumanFocus
    ? 'le sujet non humain du titre, son décor, les accessoires de la scène, le conflit symbolique et une conséquence comique lisible sans personnage humain'
    : imageOnlyMotifs;
  const role = scene.kind === 'chorus' || scene.kind === 'final_chorus'
    ? 'motif visuel central récurrent, symbole très mémorable'
    : scene.kind === 'bridge'
      ? 'bascule dramatique, changement de lumière et tension'
      : scene.kind === 'intro'
        ? 'installation du décor, premier signe fort'
        : scene.kind === 'outro'
          ? 'image finale, résolution lisible'
          : 'scène narrative concrète qui fait avancer l’histoire';

  const promptParts = [
    'Boucle visuelle cinématique 16:9, pleine image, aucune affiche, aucun générique, aucun lettrage visible.',
    safeIdea ? `Action visuelle à traduire uniquement par décor, geste et lumière: ${safeIdea}.` : 'Représenter le concept par action, décor et lumière, jamais par mots écrits.',
    subjectFrame?.guidance ? `Lecture sémantique obligatoire: ${subjectFrame.guidance}` : '',
    `Fonction de ce plan: ${role}.`,
    buildSceneCameraDirection(scene),
    visualFocus.prompt,
  ].filter(Boolean);
  appendVivyVisualIdentityBrief(promptParts, {
    publicTitle,
    winner,
    sceneText: scene.text,
    styleBrief,
    artists,
    vocalCast,
  });
  promptParts.push(...[
    motifs ? `Repères visuels de la scène: ${motifs}.` : '',
    style ? `Couleur musicale: ${style}.` : '',
    coverPrompt
      ? (visualFocus.nonHumanFocus
        ? 'Conserver uniquement la palette, le décor et le sujet non humain de la jaquette; ne pas ajouter de chanteur, chanteuse, portrait ou corps humain.'
        : 'Conserver seulement l’identité des personnages, la palette et la lumière de la jaquette; créer un cadrage neuf adapté à ce plan, sans recopier son titre, ses paroles, ses panneaux ni sa composition d’affiche.')
      : '',
    'La jaquette peut contenir du texte, une fiche identité, une interface ou des logos: ne jamais les recopier dans la vidéo; transformer ces zones en décor, lumière, ombre, architecture ou particules.',
    'Ne reproduis jamais une mise en page de poster, fiche personnage, overlay, panneau latéral, liste de missions ou bloc typographique: le plan doit être une scène cinéma pleine image.',
    'Plan court, cinématique, lisible en direct Twitch, mouvement subtil et fluide, boucle propre. Aucun chant face caméra sauf demande explicite; bouche naturelle et stable.',
    'Budget de complexité: un sujet détaillé au premier plan, trois personnages détaillés maximum; les groupes restent en silhouettes lointaines. Montrer des corps complets et reliés, avec tête, torse, bras et jambes cohérents.',
    'Aucun membre isolé, torse absent, tête manquante, instrument flottant ou fusion entre instrument et corps. Toute coupe de cadrage se fait seulement au bord de l’image, jamais au milieu d’un corps central.',
    'Si un microphone apparaît, son support physique reste explicite pendant toute la boucle: soit un pied de micro stable sans main cachée, soit une main complète à cinq doigts qui entoure le manche, reliée sans rupture à un poignet et un avant-bras visibles. Aucun doigt ne disparaît derrière le micro et aucune main ne fusionne avec lui.',
    'Intégrité temporelle stricte: visage, mains, silhouette et arrière-plan restent cohérents; aucune surimpression, aucun visage fantôme, aucun objet qui fusionne, aucun élément parasite qui apparaît entre deux images.',
    'Aucun texte dans l’image: pas de titre, pas de paroles, pas de faux titre, pas de sous-titre, pas de paragraphe, pas de liste, pas de pseudo-écriture, pas de glyphes illisibles, pas de panneau UI; l’overlay Twitch ajoute les infos lisibles.',
    'Aucun logo, aucune parole affichée, aucun son.',
  ].filter(Boolean));
  return cleanText(promptParts.join(' '), '', 4200);
}

function resolveTwitchFullClipMode(env = process.env) {
  const raw = normalizeModeToken(env.VIVY_STREAM_FULL_CLIP_MODE || env.VIVY_STREAM_CLIP_MODE || '');
  const dreamByName = [
    'dream',
    'dreamclip',
    'dream-clip',
    'clip-de-reve',
    'clip-reve',
    'reve',
    'full-generated',
    'fully-generated',
    'generated-a-z',
    'a-z',
    'az',
    'premium',
    'cinema',
  ].includes(raw);
  const economyByName = [
    'economy',
    'eco',
    'debrouille',
    'de-brouille',
    'loops',
    'loop',
    'montage',
    'classic',
    'classique',
  ].includes(raw);
  const dream = !economyByName && (dreamByName || toBoolean(env.VIVY_STREAM_DREAMCLIP_ENABLED));
  const sceneCount = Math.round(clampNumber(
    env.VIVY_STREAM_DREAMCLIP_SCENES || env.VIVY_STREAM_FULL_CLIP_SCENES,
    2,
    8,
    DEFAULT_DREAM_CLIP_SCENES
  ));
  const maxDurationSeconds = clampNumber(
    env.VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS || env.VIVY_STREAM_FULL_CLIP_MAX_DURATION_SECONDS,
    90,
    420,
    DEFAULT_DREAM_CLIP_MAX_SECONDS
  );
  const explicitStaticFallback = String(env.VIVY_STREAM_DREAMCLIP_ALLOW_STATIC_FALLBACK ?? '').trim();
  return {
    mode: dream ? 'dreamclip' : 'economy',
    label: dream ? 'Vivy DreamClip' : 'Vivy Clip Éco',
    dream,
    economy: !dream,
    sceneCount,
    uniqueLoopCount: dream
      ? sceneCount
      : clampNumber(env.VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS, 1, 8, DEFAULT_UNIQUE_LOOP_COUNT),
    maxDurationSeconds,
    minGeneratedCoverage: clampNumber(
      env.VIVY_STREAM_DREAMCLIP_MIN_GENERATED_COVERAGE,
      0.25,
      1,
      DEFAULT_DREAM_CLIP_MIN_COVERAGE
    ),
    allowStaticFallback: dream
      ? (explicitStaticFallback ? toBoolean(explicitStaticFallback) : false)
      : true,
    requireSceneGeneration: dream,
  };
}

function resolveTwitchFullClipRenderDurationSeconds(env = process.env, durationSeconds = 0) {
  const requested = Math.max(0, Number(durationSeconds || 0) || 0);
  if (!requested) return 0;
  const mode = resolveTwitchFullClipMode(env);
  if (!mode.dream) return requested;
  return Math.min(requested, mode.maxDurationSeconds);
}

function resolveFullClipUniqueLoopCount(env = process.env) {
  const mode = resolveTwitchFullClipMode(env);
  if (mode.dream) return mode.uniqueLoopCount;
  return clampNumber(env.VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS, 1, 8, DEFAULT_UNIQUE_LOOP_COUNT);
}

function shouldReuseFullClipLoops(env = process.env) {
  const mode = resolveTwitchFullClipMode(env);
  if (mode.dream) {
    const explicitDreamReuse = String(env.VIVY_STREAM_DREAMCLIP_REUSE_LOOPS ?? '').trim();
    if (explicitDreamReuse) return toBoolean(explicitDreamReuse);
    return false;
  }
  const explicit = String(env.VIVY_STREAM_FULL_CLIP_REUSE_CHORUS ?? '').trim();
  return explicit ? toBoolean(explicit) : true;
}

function estimateTwitchFullClipCost(env = process.env, overrides = {}) {
  const modeToken = cleanText(overrides.mode, '', 40);
  const clipEnv = modeToken ? { ...env, VIVY_STREAM_FULL_CLIP_MODE: modeToken } : env;
  const mode = resolveTwitchFullClipMode(clipEnv);
  const loopSeconds = clampNumber(clipEnv.VIVY_STREAM_FULL_CLIP_LOOP_SECONDS, 2, 8, FULL_THROTTLE_LOOP_SECONDS);
  const uniqueLoops = mode.dream
    ? mode.sceneCount
    : clampNumber(clipEnv.VIVY_STREAM_FULL_CLIP_UNIQUE_LOOPS, 1, 8, DEFAULT_UNIQUE_LOOP_COUNT);
  const videoSecondsGenerated = uniqueLoops * loopSeconds;
  const costPerVideoSecondEur = clampNumber(clipEnv.VIVY_STREAM_CLIP_COST_PER_VIDEO_SECOND_EUR, 0.001, 10, 0.06);
  const typical = Number((videoSecondsGenerated * costPerVideoSecondEur).toFixed(2));
  return {
    mode: mode.mode,
    label: mode.label,
    dream: mode.dream,
    sceneCount: mode.sceneCount,
    uniqueLoops,
    loopSeconds,
    videoSecondsGenerated,
    costPerVideoSecondEur,
    estimatedCostEur: {
      low: Number((typical * 0.5).toFixed(2)),
      typical,
      high: Number((typical * 2).toFixed(2)),
    },
    note: 'Estimation vidéo seule (hors chanson et jaquette), basée sur VIVY_STREAM_CLIP_COST_PER_VIDEO_SECOND_EUR; les retries provider peuvent doubler le coût réel.',
  };
}

function resolveReusableLoopKey(scene = {}, counters = {}) {
  const kind = cleanText(scene.kind, 'verse', 40);
  if (kind === 'intro') return 'loop-intro';
  if (kind === 'chorus' || kind === 'final_chorus' || kind === 'prechorus') return 'loop-chorus';
  if (kind === 'bridge' || kind === 'outro') return 'loop-bridge';
  counters.verse = Number(counters.verse || 0) + 1;
  return counters.verse <= 1 ? 'loop-verse-1' : 'loop-verse-2';
}

function collapseReusableLoopKey(key = '', uniqueLimit = DEFAULT_UNIQUE_LOOP_COUNT) {
  if (uniqueLimit >= 5) return key;
  if (uniqueLimit >= 4) {
    return key === 'loop-verse-2' ? 'loop-verse-1' : key;
  }
  if (uniqueLimit >= 3) {
    if (key === 'loop-verse-2') return 'loop-verse-1';
    if (key === 'loop-bridge') return 'loop-chorus';
    return key;
  }
  if (uniqueLimit >= 2) return key === 'loop-chorus' ? 'loop-chorus' : 'loop-verse-1';
  return 'loop-main';
}

function loopRepresentativePriority(scene = {}) {
  const kind = cleanText(scene.kind, 'verse', 40);
  if (kind === 'final_chorus') return 100;
  if (kind === 'chorus') return 92;
  if (kind === 'prechorus') return 72;
  if (kind === 'bridge') return 66;
  if (kind === 'intro') return 64;
  if (kind === 'outro') return 62;
  return 50 + Math.min(10, Number(scene.index || 0));
}

function buildReusableLoopPlan(storyboard = [], env = process.env) {
  const scenes = Array.isArray(storyboard) ? storyboard : [];
  const uniqueLimit = resolveFullClipUniqueLoopCount(env);
  const reuseEnabled = shouldReuseFullClipLoops(env);
  const counters = { verse: 0 };
  const plannedScenes = scenes.map((scene) => {
    const rawKey = reuseEnabled ? resolveReusableLoopKey(scene, counters) : scene.sceneId;
    const loopKey = reuseEnabled ? collapseReusableLoopKey(rawKey, uniqueLimit) : rawKey;
    return { ...scene, loopKey };
  });
  const byKey = new Map();
  for (const scene of plannedScenes) {
    const loopKey = scene.loopKey || scene.sceneId;
    if (!byKey.has(loopKey)) {
      byKey.set(loopKey, {
        ...scene,
        loopKey,
        sceneId: loopKey,
        representativeSceneId: scene.sceneId,
      });
      continue;
    }
    const existing = byKey.get(loopKey);
    if (loopRepresentativePriority(scene) > loopRepresentativePriority(existing)) {
      byKey.set(loopKey, {
        ...scene,
        loopKey,
        sceneId: loopKey,
        representativeSceneId: scene.sceneId,
      });
    }
  }
  return {
    reuseEnabled,
    uniqueLoopLimit: uniqueLimit,
    scenes: plannedScenes,
    uniqueScenes: Array.from(byKey.values()).slice(0, uniqueLimit),
  };
}

function resolveProfessionalEditConfig(env = process.env) {
  const explicit = String(env.VIVY_STREAM_FULL_CLIP_PRO_EDIT ?? env.VIVY_STREAM_FULL_CLIP_EDITOR ?? '').trim();
  const modeText = explicit.toLowerCase();
  const disabled = ['0', 'false', 'no', 'off', 'none', 'direct', 'simple'].includes(modeText);
  const forced = ['1', 'true', 'yes', 'on', 'force', 'forced', 'always'].includes(modeText);
  const auto = !explicit || ['auto', 'case-by-case', 'cas-par-cas'].includes(modeText);
  const bpm = clampNumber(env.VIVY_STREAM_FULL_CLIP_BPM, 60, 190, DEFAULT_EDITOR_BPM);
  const beatSeconds = 60 / bpm;
  return {
    enabled: !disabled,
    auto,
    forced,
    mode: disabled ? 'off' : (forced ? 'force' : 'auto'),
    bpm,
    beatSeconds,
    barSeconds: beatSeconds * 4,
    minSegmentSeconds: clampNumber(
      env.VIVY_STREAM_FULL_CLIP_MIN_EDIT_SEGMENT_SECONDS,
      1.25,
      8,
      DEFAULT_EDITOR_MIN_SEGMENT_SECONDS
    ),
    maxSegmentSeconds: clampNumber(
      env.VIVY_STREAM_FULL_CLIP_MAX_EDIT_SEGMENT_SECONDS,
      2,
      16,
      DEFAULT_EDITOR_MAX_SEGMENT_SECONDS
    ),
    transitionSeconds: clampNumber(
      env.VIVY_STREAM_FULL_CLIP_TRANSITION_SECONDS,
      0,
      1.2,
      DEFAULT_EDITOR_TRANSITION_SECONDS
    ),
    maxSegments: Math.round(clampNumber(
      env.VIVY_STREAM_FULL_CLIP_MAX_EDIT_SEGMENTS,
      8,
      160,
      DEFAULT_EDITOR_MAX_SEGMENTS
    )),
  };
}

function shouldUseProfessionalEdit(entries = [], config = {}) {
  if (!config.enabled) return false;
  if (config.forced) return true;
  const usable = Array.isArray(entries) ? entries : [];
  if (!usable.length) return false;
  const totalDuration = usable.reduce((sum, entry) => sum + Math.max(0, Number(entry.durationSeconds || 0)), 0);
  if (totalDuration < 24) return false;
  const maxSegment = Math.max(config.minSegmentSeconds || 2.5, config.maxSegmentSeconds || 8);
  const uniquePaths = new Set(usable.map((entry) => entry.videoPath).filter(Boolean));
  const loopKeys = usable.map((entry) => entry.scene?.loopKey || entry.scene?.sceneId || '').filter(Boolean);
  const repeatedLoopKey = new Set(loopKeys).size < loopKeys.length;
  const repeatedVideo = uniquePaths.size < usable.length;
  const longSection = usable.some((entry) => Number(entry.durationSeconds || 0) > maxSegment * 1.35);
  const hasMusicalReturn = usable.some((entry) => ['chorus', 'final_chorus', 'prechorus', 'bridge'].includes(entry.scene?.kind));
  const needsLooping = usable.some((entry) => {
    const sourceDuration = Number(entry.sourceDurationSeconds || entry.videoInfo?.durationSeconds || 0);
    if (!(sourceDuration > 0)) return Number(entry.durationSeconds || 0) > maxSegment * 1.5;
    return Number(entry.durationSeconds || 0) > sourceDuration * 1.35;
  });
  const fullSourceCoverage = usable.every((entry) => {
    const sourceDuration = Number(entry.sourceDurationSeconds || entry.videoInfo?.durationSeconds || 0);
    return sourceDuration > 0 && sourceDuration >= Number(entry.durationSeconds || 0) * 0.85;
  });
  if (fullSourceCoverage && !repeatedLoopKey && !repeatedVideo && !needsLooping) return false;
  return repeatedLoopKey || repeatedVideo || longSection || needsLooping || (hasMusicalReturn && usable.length >= 3);
}

function roundDurationToMusicalGrid(seconds, config = {}) {
  const value = Math.max(0.2, Number(seconds) || 0);
  const grid = Math.max(0.25, Number(config.beatSeconds || 0) * 2 || 1);
  return Number(Math.max(0.2, Math.round(value / grid) * grid).toFixed(3));
}

function segmentStyleForScene(scene = {}, segmentIndex = 0, segmentCount = 1, config = {}) {
  const kind = cleanText(scene.kind, 'verse', 40);
  const isLast = segmentIndex >= segmentCount - 1;
  if (kind === 'intro') {
    return { speed: 0.92, transition: 'fade', cutStyle: 'installation' };
  }
  if (kind === 'prechorus') {
    return { speed: 1.03, transition: segmentIndex % 2 ? 'cut' : 'fade', cutStyle: 'montee' };
  }
  if (kind === 'chorus') {
    return { speed: segmentIndex % 2 ? 1.08 : 1.04, transition: 'cut', cutStyle: 'refrain-impact' };
  }
  if (kind === 'final_chorus') {
    return { speed: isLast ? 0.96 : 1.08, transition: isLast ? 'fade' : 'cut', cutStyle: 'refrain-final' };
  }
  if (kind === 'bridge') {
    return { speed: segmentIndex % 2 ? 0.88 : 0.94, transition: 'fade', cutStyle: 'bascule' };
  }
  if (kind === 'outro') {
    return { speed: 0.84, transition: 'fade', cutStyle: 'retombee' };
  }
  return {
    speed: [1, 0.96, 1.04][segmentIndex % 3],
    transition: segmentIndex % 3 === 0 ? 'fade' : 'cut',
    cutStyle: 'progression',
  };
}

function preferredSegmentSecondsForScene(scene = {}, config = {}) {
  const kind = cleanText(scene.kind, 'verse', 40);
  const max = Math.max(config.minSegmentSeconds || 2.5, config.maxSegmentSeconds || 8);
  const bar = Math.max(1, config.barSeconds || 2);
  if (kind === 'chorus' || kind === 'final_chorus') return Math.min(max, Math.max(2.4, roundDurationToMusicalGrid(bar * 1.5, config)));
  if (kind === 'prechorus') return Math.min(max, Math.max(2.2, roundDurationToMusicalGrid(bar, config)));
  if (kind === 'bridge') return Math.min(max, Math.max(3.5, roundDurationToMusicalGrid(bar * 2, config)));
  if (kind === 'intro' || kind === 'outro') return Math.min(max, Math.max(3, roundDurationToMusicalGrid(bar * 1.5, config)));
  return Math.min(max, Math.max(3, roundDurationToMusicalGrid(bar * 2, config)));
}

function buildProfessionalEditPlan(entries = [], options = {}) {
  const config = options.config || resolveProfessionalEditConfig(options.env || process.env);
  const usable = (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({
      ...entry,
      index,
      scene: entry.scene || {},
      videoPath: entry.videoPath || '',
      durationSeconds: Math.max(0, Number(entry.scene?.durationSeconds || entry.durationSeconds || 0)),
      sourceDurationSeconds: Number(entry.sourceDurationSeconds || entry.videoInfo?.durationSeconds || 0),
    }))
    .filter((entry) => entry.videoPath && entry.durationSeconds > 0);

  if (!usable.length) {
    return { enabled: config.enabled, bpm: config.bpm, segmentCount: 0, segments: [] };
  }

  const useProfessionalEdit = shouldUseProfessionalEdit(usable, config);

  if (!useProfessionalEdit) {
    return {
      enabled: false,
      mode: config.enabled ? 'auto_direct_concat' : 'direct_concat',
      bpm: config.bpm,
      segmentCount: usable.length,
      segments: usable.map((entry, index) => ({
        id: `edit-${String(index + 1).padStart(3, '0')}`,
        sourceSceneId: entry.scene.sceneId || `scene-${index + 1}`,
        sourceIndex: entry.index,
        videoPath: entry.videoPath,
        durationSeconds: Number(entry.durationSeconds.toFixed(3)),
        sourceOffsetSeconds: 0,
        speed: 1,
        transition: 'cut',
        cutStyle: 'direct',
        scene: entry.scene,
      })),
    };
  }

  const totalDuration = usable.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  let estimatedSegments = usable.reduce((sum, entry) => (
    sum + Math.max(1, Math.ceil(entry.durationSeconds / preferredSegmentSecondsForScene(entry.scene, config)))
  ), 0);
  const pressure = estimatedSegments > config.maxSegments
    ? estimatedSegments / Math.max(1, config.maxSegments)
    : 1;

  const segments = [];
  let globalIndex = 0;
  for (const entry of usable) {
    const preferred = preferredSegmentSecondsForScene(entry.scene, config) * pressure;
    const count = Math.max(1, Math.ceil(entry.durationSeconds / Math.max(config.minSegmentSeconds, preferred)));
    estimatedSegments = Math.max(estimatedSegments, count);
    let remaining = entry.durationSeconds;
    for (let part = 0; part < count; part += 1) {
      const remainingParts = count - part;
      const rawDuration = part === count - 1
        ? remaining
        : Math.max(config.minSegmentSeconds, remaining / remainingParts);
      const duration = Number(Math.max(0.25, rawDuration).toFixed(3));
      remaining = Math.max(0, remaining - duration);
      const style = segmentStyleForScene(entry.scene, part, count, config);
      const sourceOffset = Number(((globalIndex % 4) * Math.max(0.5, config.barSeconds / 2)).toFixed(3));
      segments.push({
        id: `edit-${String(globalIndex + 1).padStart(3, '0')}`,
        sourceSceneId: entry.scene.sceneId || `scene-${entry.index + 1}`,
        sourceIndex: entry.index,
        videoPath: entry.videoPath,
        durationSeconds: duration,
        sourceOffsetSeconds: sourceOffset,
        speed: Number(style.speed.toFixed(3)),
        transition: style.transition,
        cutStyle: style.cutStyle,
        scene: entry.scene,
      });
      globalIndex += 1;
    }
  }

  const drift = Number((totalDuration - segments.reduce((sum, segment) => sum + segment.durationSeconds, 0)).toFixed(3));
  if (segments.length && Math.abs(drift) >= 0.01) {
    const last = segments[segments.length - 1];
    last.durationSeconds = Number(Math.max(0.25, last.durationSeconds + drift).toFixed(3));
  }

  return {
    enabled: true,
    mode: 'section_sync_professional_edit',
    bpm: config.bpm,
    beatSeconds: Number(config.beatSeconds.toFixed(3)),
    segmentCount: segments.length,
    sourceSceneCount: usable.length,
    totalDurationSeconds: Number(totalDuration.toFixed(3)),
    maxSegments: config.maxSegments,
    transitionSeconds: config.transitionSeconds,
    segments,
  };
}

function isInstrumentalClipMode(input = {}) {
  if (input.instrumentalMode === true || input.instrumental === true || input.forceInstrumental === true) return true;
  if (input.intentPlan?.shouldGenerateLyrics === false || input.intentPlan?.shouldUseVocals === false) return true;
  const source = cleanText([
    input.intentPlan?.intent,
    input.intentPlan?.generationBrief,
    input.intentPlan?.reason,
    input.winner?.text,
    input.styleBrief,
  ].filter(Boolean).join(' '), '', 4000)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /\b(?:instrumental|instrumentale|sans\s+paroles?|sans\s+chant|no\s+vocals?|no\s+lyrics?|no\s+singing|sound\s+design|ambiance\s+sonore|cinematic|cinematique)\b/.test(source);
}

function buildInstrumentalFlowSections(input = {}, maxScenes = DEFAULT_INSTRUMENTAL_SCENE_COUNT) {
  const title = cleanText(input.publicTitle || input.winner?.text, 'Vivy Live', 120);
  const idea = cleanText(input.winner?.text || input.intentPlan?.generationBrief || input.styleBrief, title, 600);
  const style = cleanText(input.styleBrief || input.intentPlan?.generationBrief, '', 500);
  const limit = Math.max(1, Math.min(8, Number(maxScenes) || DEFAULT_INSTRUMENTAL_SCENE_COUNT));
  const sections = [
    {
      header: 'Ouverture cinématique',
      kind: 'intro',
      text: `${title}. Mise en place lente du décor, silhouette principale, tension émotionnelle, premiers motifs visuels.`,
      weight: 3,
    },
    {
      header: 'Développement instrumental',
      kind: 'verse',
      text: `${idea}. La caméra suit une progression continue, gestes sobres, regards, lumière qui change avec les instruments.`,
      weight: 4,
    },
    {
      header: 'Montée centrale',
      kind: 'bridge',
      text: `${style || idea}. Le conflit symbolique devient visible, mouvement plus ample, décor qui respire avec la musique.`,
      weight: 4,
    },
    {
      header: 'Plan symbole',
      kind: 'verse',
      text: `${title}. Gros plan sur l’objet, le regard, le signe ou la machine qui porte le thème; aucun texte, seulement une image claire.`,
      weight: 3,
    },
    {
      header: 'Traversée',
      kind: 'verse',
      text: `${idea}. La caméra accompagne un déplacement fluide dans le décor, comme un clip sans paroles qui raconte par gestes et lumière.`,
      weight: 4,
    },
    {
      header: 'Point de rupture',
      kind: 'bridge',
      text: `${style || title}. Moment le plus intense: ciel, décor ou espace intérieur se transforme avec les percussions et les cordes.`,
      weight: 4,
    },
    {
      header: 'Après-coup',
      kind: 'outro',
      text: `${title}. La tension retombe, les traces de l’histoire restent visibles, le mouvement ralentit sans couper brutalement.`,
      weight: 3,
    },
    {
      header: 'Résolution visuelle',
      kind: 'outro',
      text: `${title}. Image finale mémorable, apaisement ou révélation, boucle propre sans texte affiché.`,
      weight: 3,
    },
  ];
  return sections.slice(0, limit).map((section, index) => ({ ...section, index, lines: [section.text] }));
}

function buildTwitchFullClipStoryboard(input = {}) {
  const instrumentalFlow = isInstrumentalClipMode(input);
  const sections = instrumentalFlow
    ? buildInstrumentalFlowSections(input, input.maxScenes)
    : parseLyricSectionsForClip(input.lyrics);
  const fallbackSections = sections.length ? sections : [{
    header: 'Vivy Live',
    kind: 'chorus',
    index: 0,
    lines: [cleanText(input.winner?.text || input.publicTitle, 'Vivy Live', 260)],
    text: cleanText(input.winner?.text || input.publicTitle, 'Vivy Live', 260),
    weight: 1,
  }];
  const picked = pickStoryboardSections(
    fallbackSections,
    clampNumber(input.maxScenes, 1, 8, DEFAULT_FULL_CLIP_SCENES)
  );
  const timed = allocateSceneTimings(picked, input.durationSeconds);
  return timed.map((scene, index) => ({
    ...scene,
    sceneId: `scene-${String(index + 1).padStart(2, '0')}`,
    prompt: buildSceneVisualPrompt({ ...input, scene }),
  }));
}

function resolveFullClipSceneCount(env = process.env, input = {}) {
  const mode = resolveTwitchFullClipMode(env);
  if (mode.dream) return mode.sceneCount;
  if (isInstrumentalClipMode(input)) {
    return clampNumber(
      env.VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES,
      1,
      8,
      DEFAULT_INSTRUMENTAL_SCENE_COUNT
    );
  }
  return clampNumber(env.VIVY_STREAM_FULL_CLIP_SCENES, 1, 8, DEFAULT_CLOUD_SCENE_COUNT);
}

function resolveFfmpegBinary(env = process.env) {
  const explicit = String(env.A11_VIDEO_FFMPEG_BIN || env.FFMPEG_BIN || '').trim();
  if (explicit) return explicit;
  if (process.platform === 'win32') {
    try {
      const lookup = spawnSync('where.exe', ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
      const candidate = String(lookup.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (candidate) return candidate;
    } catch {}
  }
  return 'ffmpeg';
}

function resolveFfprobeBinary(env = process.env) {
  const explicit = String(env.A11_VIDEO_FFPROBE_BIN || env.FFPROBE_BIN || '').trim();
  if (explicit) return explicit;
  if (process.platform === 'win32') {
    try {
      const lookup = spawnSync('where.exe', ['ffprobe'], { encoding: 'utf8', windowsHide: true });
      const candidate = String(lookup.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (candidate) return candidate;
    } catch {}
  }
  return 'ffprobe';
}

function runProcess(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`process_failed_${code}:${stderr || stdout}`));
    });
  });
}

async function downloadToFile(url = '', targetPath = '', fetchFn = globalThis.fetch) {
  const value = String(url || '').trim();
  if (!value) throw new Error('clip_loop_url_missing');
  if (!/^https?:\/\//i.test(value) && fs.existsSync(value)) {
    await fsp.copyFile(value, targetPath);
    return targetPath;
  }
  if (typeof fetchFn !== 'function') throw new Error('fetch_unavailable_for_clip_download');
  const response = await fetchFn(value);
  if (!response.ok) throw new Error(`clip_loop_download_${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('clip_loop_download_empty');
  await fsp.writeFile(targetPath, buffer);
  return targetPath;
}

function parseGridOrder(value = '', fallback = DEFAULT_GRID_DEMOSAIC_ORDER) {
  const parsed = String(value || '')
    .split(/[,\s;|]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= 0);
  return parsed.length ? parsed : fallback;
}

function resolveTwitchGridDemosaicConfig(env = process.env) {
  const rawMode = String(env.VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID || env.VIVY_STREAM_CLIP_DEMOSAIC_GRID || '').trim().toLowerCase();
  const explicitMode = String(env.VIVY_STREAM_FULL_CLIP_DEMOSAIC_MODE || env.VIVY_STREAM_CLIP_DEMOSAIC_MODE || '').trim().toLowerCase();
  const mode = explicitMode || rawMode;
  const enabled = ['repair', 'manual-repair', 'mosaic-repair', 'demosaic-repair'].includes(mode);
  const legacyRequested = toBoolean(rawMode) && !enabled;
  const columns = clampNumber(env.VIVY_STREAM_FULL_CLIP_DEMOSAIC_COLUMNS, 1, 5, 3);
  const rows = clampNumber(env.VIVY_STREAM_FULL_CLIP_DEMOSAIC_ROWS, 1, 5, 3);
  const activeHeightRatio = clampNumber(env.VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO, 0.5, 1, 0.9);
  return {
    enabled,
    mode: enabled ? mode : '',
    legacyRequested,
    reason: legacyRequested
      ? 'grid_demosaic_requires_explicit_repair_mode'
      : (enabled ? 'grid_demosaic_repair_mode' : 'grid_demosaic_disabled'),
    columns,
    rows,
    order: parseGridOrder(env.VIVY_STREAM_FULL_CLIP_DEMOSAIC_ORDER),
    segmentSeconds: clampNumber(env.VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS, 0.5, 8, 1.25),
    activeHeightRatio,
  };
}

async function probeVideoInfo(videoPath = '', env = process.env) {
  if (!videoPath) throw new Error('video_probe_path_missing');
  const ffprobeBin = resolveFfprobeBinary(env);
  const { stdout } = await runProcess(ffprobeBin, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=width,height',
    '-of', 'json',
    videoPath,
  ]);
  const payload = JSON.parse(stdout || '{}');
  const stream = Array.isArray(payload.streams)
    ? payload.streams.find((item) => Number(item.width) > 0 && Number(item.height) > 0)
    : null;
  return {
    width: Number(stream?.width || 0),
    height: Number(stream?.height || 0),
    durationSeconds: Number(payload.format?.duration || 0),
  };
}

function assessVideoOcrSamples(samples = []) {
  const normalized = (Array.isArray(samples) ? samples : []).map((sample) => {
    const text = cleanText(sample?.text, '', 500);
    const alphaChars = (text.match(/\p{L}/gu) || []).length;
    const confidence = Number(sample?.confidence || 0);
    return {
      text,
      alphaChars,
      confidence: Number.isFinite(confidence) ? confidence : 0,
    };
  });
  const suspicious = normalized.filter((sample) => sample.alphaChars >= 4 && sample.confidence >= 25);
  const strong = normalized.filter((sample) => (
    (sample.alphaChars >= 8 && sample.confidence >= 35)
    || (sample.alphaChars >= 4 && sample.confidence >= 55)
  ));
  return {
    ok: strong.length === 0 && suspicious.length < 1,
    rejected: strong.length > 0 || suspicious.length >= 1,
    reason: strong.length > 0 || suspicious.length >= 1 ? 'generated_text_detected' : '',
    suspiciousSamples: suspicious.length,
    strongSamples: strong.length,
    samples: normalized,
  };
}

async function inspectVideoLoopQuality(videoPath = '', options = {}) {
  const env = options.env || process.env;
  const explicit = String(env.VIVY_STREAM_FULL_CLIP_VISUAL_QA ?? '').trim();
  if (explicit && !toBoolean(explicit)) {
    return { ok: true, rejected: false, skipped: true, reason: 'visual_qa_disabled' };
  }
  try {
    const info = await probeVideoInfo(videoPath, env);
    if (!(info.durationSeconds > 0)) {
      return { ok: true, rejected: false, skipped: true, reason: 'visual_qa_duration_missing' };
    }
    const Tesseract = require('tesseract.js');
    const recognize = Tesseract?.recognize || Tesseract?.default?.recognize;
    if (typeof recognize !== 'function') {
      return { ok: true, rejected: false, skipped: true, reason: 'visual_qa_ocr_unavailable' };
    }
    const workDir = options.workDir || path.dirname(videoPath);
    const framePrefix = `${path.basename(videoPath, path.extname(videoPath))}-qa`;
    const sampleRatios = [0.18, 0.42, 0.68, 0.88];
    const samples = [];
    for (let index = 0; index < sampleRatios.length; index += 1) {
      const timestamp = Math.max(0.05, Math.min(info.durationSeconds - 0.05, info.durationSeconds * sampleRatios[index]));
      const framePath = path.join(workDir, `${framePrefix}-${index + 1}.png`);
      await runProcess(resolveFfmpegBinary(env), [
        '-y',
        '-ss', String(Number(timestamp.toFixed(3))),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=1920:-2:flags=lanczos,format=gray,eq=contrast=2.1:brightness=0.04,unsharp=5:5:1.2',
        framePath,
      ]);
      const timeoutMs = clampNumber(env.VIVY_STREAM_FULL_CLIP_OCR_TIMEOUT_MS, 3000, 60000, 20000);
      const ocrResult = await Promise.race([
        recognize(framePath, 'eng', { logger: () => {} }),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('visual_qa_ocr_timeout')), timeoutMs);
          timer.unref?.();
        }),
      ]);
      samples.push({
        text: ocrResult?.data?.text || ocrResult?.text || '',
        confidence: ocrResult?.data?.confidence || 0,
      });
      await fsp.rm(framePath, { force: true }).catch(() => {});
    }
    return {
      ...assessVideoOcrSamples(samples),
      durationSeconds: info.durationSeconds,
    };
  } catch (error) {
    return {
      ok: true,
      rejected: false,
      skipped: true,
      reason: 'visual_qa_failed_open',
      message: cleanText(error?.message || error, '', 180),
    };
  }
}

async function createSafeImageMotionLoop({
  imageUrl = '',
  outputPath = '',
  durationSeconds = 4,
  width = 1280,
  height = 720,
  fps = 24,
  fetchFn = globalThis.fetch,
  env = process.env,
} = {}) {
  if (!imageUrl) throw new Error('safe_loop_image_missing');
  if (!outputPath) throw new Error('safe_loop_output_missing');
  const sourcePath = `${outputPath}-source.jpg`;
  await downloadToFile(imageUrl, sourcePath, fetchFn);
  const frames = Math.max(1, Math.round(durationSeconds * fps));
  const filter = [
    `scale=${Math.ceil(width * 1.08)}:${Math.ceil(height * 1.08)}:force_original_aspect_ratio=increase`,
    `crop=${Math.ceil(width * 1.08)}:${Math.ceil(height * 1.08)}`,
    `zoompan=z='min(zoom+0.00035,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');
  try {
    await runProcess(resolveFfmpegBinary(env), [
      '-y',
      '-loop', '1',
      '-framerate', String(fps),
      '-i', sourcePath,
      '-vf', filter,
      '-frames:v', String(frames),
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-movflags', '+faststart',
      outputPath,
    ]);
  } finally {
    await fsp.rm(sourcePath, { force: true }).catch(() => {});
  }
  const stats = await fsp.stat(outputPath);
  if (!stats.size) throw new Error('safe_loop_output_empty');
  return { ok: true, outputPath, sizeBytes: stats.size, mode: 'clean_cover_motion_fallback' };
}

async function demosaicGridVideo({
  inputPath = '',
  outputPath = '',
  width = 1280,
  height = 720,
  fps = 24,
  env = process.env,
  config = null,
  ffmpegBin = resolveFfmpegBinary(env),
} = {}) {
  if (!inputPath) throw new Error('grid_demosaic_input_missing');
  if (!outputPath) throw new Error('grid_demosaic_output_missing');
  const grid = config || resolveTwitchGridDemosaicConfig(env);
  if (!grid.enabled) return { ok: false, skipped: true, reason: grid.reason || 'grid_demosaic_disabled' };
  const info = await probeVideoInfo(inputPath, env);
  if (!(info.width > 0) || !(info.height > 0) || !(info.durationSeconds > 0)) {
    throw new Error('grid_demosaic_probe_failed');
  }

  const columns = Math.max(1, Number(grid.columns || 3));
  const rows = Math.max(1, Number(grid.rows || 3));
  const activeHeight = Math.max(rows, Math.min(info.height, Math.round(info.height * Number(grid.activeHeightRatio || 0.9))));
  const cellWidth = Math.floor(info.width / columns);
  const cellHeight = Math.floor(activeHeight / rows);
  const desiredAspect = width / height;
  let cropWidth = cellWidth;
  let cropHeight = cellHeight;
  if (cellWidth / cellHeight > desiredAspect) {
    cropWidth = Math.max(2, Math.floor(cellHeight * desiredAspect));
  } else {
    cropHeight = Math.max(2, Math.floor(cellWidth / desiredAspect));
  }
  cropWidth -= cropWidth % 2;
  cropHeight -= cropHeight % 2;
  const order = parseGridOrder((grid.order || []).join(','), DEFAULT_GRID_DEMOSAIC_ORDER)
    .filter((cell) => cell < columns * rows);
  const usableOrder = order.length ? order : [Math.floor((columns * rows) / 2)];
  const segmentSeconds = Math.max(0.5, Number(grid.segmentSeconds || 1.25));
  const segmentCount = Math.max(1, Math.ceil(info.durationSeconds / segmentSeconds));
  const filters = [];
  const labels = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const start = Number((index * segmentSeconds).toFixed(3));
    const end = Number(Math.min(info.durationSeconds, start + segmentSeconds).toFixed(3));
    if (!(end > start)) continue;
    const cell = usableOrder[index % usableOrder.length];
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    const x = Math.max(0, Math.min(info.width - cropWidth, Math.round(column * cellWidth + ((cellWidth - cropWidth) / 2))));
    const y = Math.max(0, Math.min(info.height - cropHeight, Math.round(row * cellHeight + ((cellHeight - cropHeight) / 2))));
    const label = `v${index}`;
    filters.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,crop=${cropWidth}:${cropHeight}:${x}:${y},scale=${width}:${height}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p[${label}]`);
    labels.push(`[${label}]`);
  }
  if (!labels.length) throw new Error('grid_demosaic_no_segments');
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0[outv]`);

  const scriptPath = `${outputPath}.filter.txt`;
  await fsp.writeFile(scriptPath, filters.join(';\n'), 'utf8');
  try {
    await runProcess(ffmpegBin, [
      '-y',
      '-i', inputPath,
      '-filter_complex_script', scriptPath,
      '-map', '[outv]',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-movflags', '+faststart',
      outputPath,
    ]);
  } finally {
    await fsp.rm(scriptPath, { force: true }).catch(() => {});
  }
  const stats = await fsp.stat(outputPath);
  if (!stats.size) throw new Error('grid_demosaic_output_empty');
  return {
    ok: true,
    outputPath,
    sizeBytes: stats.size,
    segmentCount: labels.length,
    sourceWidth: info.width,
    sourceHeight: info.height,
    sourceDurationSeconds: info.durationSeconds,
  };
}

async function composeLoopMontage({
  scenes = [],
  loopVideos = [],
  outputPath = '',
  width = 1280,
  height = 720,
  fps = 24,
  ffmpegBin = resolveFfmpegBinary(),
  env = process.env,
  editPlan = null,
} = {}) {
  const usable = scenes
    .map((scene, index) => {
      const loop = loopVideos[index] || {};
      return {
        scene,
        videoPath: loop.path || loop.videoPath || '',
        sourceDurationSeconds: Number(loop.sourceDurationSeconds || loop.videoInfo?.durationSeconds || 0),
        videoInfo: loop.videoInfo || null,
        reused: loop.reused === true,
      };
    })
    .filter((entry) => entry.videoPath && Number(entry.scene?.durationSeconds) > 0);
  if (!usable.length) throw new Error('full_clip_no_segments');
  if (!outputPath) throw new Error('full_clip_output_missing');

  const professionalEditPlan = editPlan || buildProfessionalEditPlan(usable, { env });
  const segments = professionalEditPlan.segments?.length
    ? professionalEditPlan.segments
    : usable.map((entry, index) => ({
      id: `edit-${String(index + 1).padStart(3, '0')}`,
      sourceIndex: index,
      videoPath: entry.videoPath,
      durationSeconds: Number(entry.scene.durationSeconds || 1),
      sourceOffsetSeconds: 0,
      speed: 1,
      transition: 'cut',
      scene: entry.scene,
    }));

  const args = ['-y'];
  segments.forEach((segment) => {
    const duration = Math.max(0.25, Number(segment.durationSeconds || 1));
    const speed = clampNumber(segment.speed, 0.35, 2.25, 1);
    const offset = Math.max(0, Number(segment.sourceOffsetSeconds || 0));
    const sourceWindow = Math.max(0.35, duration * speed + 0.2);
    args.push('-stream_loop', '-1', '-t', String(Number((offset + sourceWindow + 0.5).toFixed(3))), '-i', segment.videoPath);
  });

  const transitionSeconds = Math.max(0, Number(professionalEditPlan.transitionSeconds || 0));
  const filters = segments.map((segment, index) => {
    const duration = Math.max(0.25, Number(segment.durationSeconds || 1));
    const speed = clampNumber(segment.speed, 0.35, 2.25, 1);
    const offset = Math.max(0, Number(segment.sourceOffsetSeconds || 0));
    const sourceWindow = Math.max(0.35, duration * speed + 0.2);
    const fade = segment.transition === 'fade' && transitionSeconds > 0 && duration > transitionSeconds * 3
      ? Math.min(transitionSeconds, duration / 5)
      : 0;
    const fadeFilter = fade > 0
      ? `,fade=t=in:st=0:d=${Number(fade.toFixed(3))},fade=t=out:st=${Number(Math.max(0, duration - fade).toFixed(3))}:d=${Number(fade.toFixed(3))}`
      : '';
    return `[${index}:v]trim=start=${Number(offset.toFixed(3))}:duration=${Number(sourceWindow.toFixed(3))},setpts=(PTS-STARTPTS)/${Number(speed.toFixed(3))},trim=duration=${Number(duration.toFixed(3))},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p${fadeFilter}[v${index}]`;
  });
  const concatInputs = segments.map((_, index) => `[v${index}]`).join('');
  filters.push(`${concatInputs}concat=n=${segments.length}:v=1:a=0[outv]`);

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[outv]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-movflags', '+faststart',
    outputPath
  );

  await runProcess(ffmpegBin, args);
  const stats = await fsp.stat(outputPath);
  if (!stats.size) throw new Error('full_clip_output_empty');
  return {
    outputPath,
    sizeBytes: stats.size,
    segmentCount: segments.length,
    sourceSceneCount: usable.length,
    editPlan: {
      enabled: professionalEditPlan.enabled === true,
      mode: professionalEditPlan.mode || (professionalEditPlan.enabled ? 'section_sync_professional_edit' : 'direct_concat'),
      bpm: professionalEditPlan.bpm,
      segmentCount: segments.length,
      sourceSceneCount: usable.length,
      transitionSeconds: professionalEditPlan.transitionSeconds || 0,
      cuts: segments.map((segment) => ({
        id: segment.id,
        sceneId: segment.sourceSceneId || segment.scene?.sceneId || '',
        durationSeconds: segment.durationSeconds,
        speed: segment.speed,
        transition: segment.transition,
        cutStyle: segment.cutStyle,
      })).slice(0, 80),
    },
  };
}

function buildClipAudioMuxArgs({ videoPath = '', audioPath = '', outputPath = '' } = {}) {
  return [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ];
}

async function muxAudioIntoClip({
  videoPath = '',
  audioPath = '',
  audioUrl = '',
  outputPath = '',
  ffmpegBin = resolveFfmpegBinary(),
  fetchFn = globalThis.fetch,
  workDir = '',
} = {}) {
  if (!videoPath || !outputPath) throw new Error('clip_audio_mux_paths_missing');
  let localAudio = cleanText(audioPath, '', 1200);
  if (localAudio) {
    const exists = await fsp.access(localAudio).then(() => true).catch(() => false);
    if (!exists) localAudio = '';
  }
  if (!localAudio && /^https?:\/\//i.test(String(audioUrl || '').trim())) {
    const downloaded = path.join(
      workDir || path.dirname(outputPath),
      `clip-audio-${crypto.randomBytes(4).toString('hex')}.mp3`
    );
    await downloadToFile(String(audioUrl).trim(), downloaded, fetchFn);
    localAudio = downloaded;
  }
  if (!localAudio) throw new Error('clip_audio_source_missing');
  await runProcess(ffmpegBin, buildClipAudioMuxArgs({ videoPath, audioPath: localAudio, outputPath }));
  const stats = await fsp.stat(outputPath);
  if (!stats.size) throw new Error('clip_audio_mux_empty');
  return { outputPath, audioPath: localAudio, sizeBytes: stats.size };
}

async function generateSceneLoop({
  scene = {},
  coverImageUrl = '',
  sourceImageUrl = '',
  referenceImageUrls = [],
  referenceVisualContext = '',
  req = null,
  generateVideoFn = null,
  conversationId = '',
  provider = '',
  durationSeconds = 4,
  width = 1280,
  height = 720,
  fps = 24,
} = {}) {
  if (typeof generateVideoFn !== 'function') throw new Error('full_clip_generator_missing');
  const resolvedSourceImageUrl = cleanText(sourceImageUrl || coverImageUrl, '', 1200);
  const useCroppedSourceOnly = resolvedSourceImageUrl && coverImageUrl && resolvedSourceImageUrl !== coverImageUrl;
  const visualReferences = useCroppedSourceOnly
    ? [resolvedSourceImageUrl, ...(Array.isArray(referenceImageUrls) ? referenceImageUrls : [])]
    : [coverImageUrl, resolvedSourceImageUrl, ...(Array.isArray(referenceImageUrls) ? referenceImageUrls : [])];
  const references = [...new Set(visualReferences.filter(Boolean))];
  const result = await generateVideoFn({
    req,
    prompt: scene.prompt,
    body: {
      prompt: scene.prompt,
      sourceImageUrl: resolvedSourceImageUrl,
      referenceImageUrls: references,
      referenceVisualContext,
      negative_prompt: VIDEO_LOOP_NEGATIVE_PROMPT,
      negativePrompt: VIDEO_LOOP_NEGATIVE_PROMPT,
      vocalPerformance: false,
      visualOnly: true,
      durationSeconds,
      fps,
      width,
      height,
      format: 'mp4',
      videoProvider: provider || undefined,
      forceRealVideo: true,
      disableEmergencyVideo: true,
      userId: 'vivy-twitch-live',
      conversationId,
      source: 'vivy-twitch-full-clip-scene',
    },
  });
  const videoUrl = cleanText(
    result?.video_url || result?.videoUrl || result?.url || result?.result?.video_url || result?.result?.videoUrl,
    '',
    1200
  );
  if (!videoUrl) throw new Error('full_clip_scene_url_missing');
  return { ok: true, videoUrl, raw: result };
}

async function prepareFullClipSourceImage({
  coverImageUrl = '',
  publicTitle = '',
  fetchFn = globalThis.fetch,
  env = process.env,
  logger = console,
} = {}) {
  const sourceUrl = cleanText(coverImageUrl, '', 1200);
  if (!sourceUrl) return '';
  const explicit = String(env.VIVY_STREAM_FULL_CLIP_CROP_SOURCE_IMAGE ?? '').trim();
  if (explicit && !toBoolean(explicit)) return sourceUrl;
  try {
    // Lazy-load sharp so installations that only use short clips do not pay startup cost.
    const sharp = require('sharp');
    if (typeof fetchFn !== 'function') return sourceUrl;
    const response = await fetchFn(sourceUrl);
    if (!response.ok) throw new Error(`source_image_fetch_${response.status}`);
    const inputBuffer = Buffer.from(await response.arrayBuffer());
    const image = sharp(inputBuffer, { failOn: 'none' });
    const metadata = await image.metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    if (!(width > 0) || !(height > 0)) throw new Error('source_image_metadata_missing');

    const widthRatio = clampNumber(
      env.VIVY_STREAM_FULL_CLIP_SOURCE_CROP_WIDTH_RATIO,
      0.35,
      1,
      DEFAULT_SOURCE_CROP_WIDTH_RATIO
    );
    const xBias = clampNumber(
      env.VIVY_STREAM_FULL_CLIP_SOURCE_CROP_X_BIAS,
      0,
      1,
      DEFAULT_SOURCE_CROP_X_BIAS
    );
    const yBias = clampNumber(
      env.VIVY_STREAM_FULL_CLIP_SOURCE_CROP_Y_BIAS,
      0,
      1,
      DEFAULT_SOURCE_CROP_Y_BIAS
    );
    let cropWidth = Math.max(320, Math.round(width * widthRatio));
    let cropHeight = Math.max(180, Math.round(cropWidth * 9 / 16));
    if (cropHeight > height) {
      cropHeight = height;
      cropWidth = Math.min(width, Math.round(cropHeight * 16 / 9));
    }
    cropWidth = Math.min(cropWidth, width);
    cropHeight = Math.min(cropHeight, height);
    const left = Math.max(0, Math.min(width - cropWidth, Math.round((width - cropWidth) * xBias)));
    const top = Math.max(0, Math.min(height - cropHeight, Math.round((height - cropHeight) * yBias)));
    const outputBuffer = await sharp(inputBuffer, { failOn: 'none' })
      .extract({
        left,
        top,
        width: Math.min(cropWidth, width - left),
        height: Math.min(cropHeight, height - top),
      })
      .resize(1280, 720, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    const uploaded = await uploadBufferToR2({
      userId: 'vivy-twitch-live',
      filename: `${slugify(publicTitle || 'vivy-clip-source')}-${crypto.randomBytes(4).toString('hex')}-source.jpg`,
      buffer: outputBuffer,
      contentType: 'image/jpeg',
    });
    return cleanText(uploaded?.url, sourceUrl, 1200);
  } catch (error) {
    logger.warn?.('[vivy-full-clip] source image crop unavailable, using cover source: %s', cleanText(error?.message || error, '', 160));
    return sourceUrl;
  }
}

function isTwitchFullClipEnabled(env = process.env) {
  const explicit = String(env.VIVY_STREAM_FULL_CLIP_ENABLED ?? '').trim();
  if (explicit) return toBoolean(explicit);
  const clipExplicit = String(env.VIVY_STREAM_CLIP_ENABLED ?? '').trim();
  return clipExplicit ? toBoolean(clipExplicit) : true;
}

function hasConfiguredVideoProxy(env = process.env) {
  return Boolean(cleanText(
    env.A11_VIDEO_LOCAL_RUNNER_URL
    || env.A11_VIDEO_PROXY_URL
    || env.VIDEO_PROXY_URL,
    '',
    1200
  ));
}

function hasConfiguredComfyCloud(env = process.env) {
  return Boolean(cleanText(
    env.A11_COMFY_CLOUD_API_KEY
    || env.COMFY_CLOUD_API_KEY
    || env.A11_COMFY_ORG_API_KEY
    || env.A11_COMFY_API_KEY
    || env.COMFY_ORG_API_KEY
    || env.COMFYUI_API_KEY,
    '',
    1200
  ));
}

function resolveTwitchFullClipProvider(env = process.env) {
  const configured = cleanText(env.VIVY_STREAM_FULL_CLIP_PROVIDER || env.VIVY_STREAM_CLIP_PROVIDER, '', 40);
  if (configured && configured.toLowerCase() !== 'auto') return configured;
  const routeFallbackRaw = String(env.VIVY_STREAM_FULL_CLIP_PROVIDER_FALLBACK ?? env.VIVY_STREAM_CLIP_PROVIDER_FALLBACK ?? '').trim();
  const shouldLetVideoRouteFallback = routeFallbackRaw ? toBoolean(routeFallbackRaw) : true;
  if (shouldLetVideoRouteFallback) return '';
  if (hasConfiguredComfyCloud(env)) return 'comfy_cloud';
  if (hasConfiguredVideoProxy(env)) return 'runcomfy';
  return cleanText(env.A11_HF_VIDEO_PROVIDER || 'replicate', 'replicate', 40);
}

async function generateTwitchFullSongClip(input = {}) {
  const env = input.env || process.env;
  if (!isTwitchFullClipEnabled(env)) return { ok: false, skipped: true, reason: 'full_clip_disabled' };

  const seedVideoUrl = cleanText(input.seedVideoUrl || input.coverVideoUrl, '', 1200);
  const coverImageUrl = cleanText(input.coverImageUrl, '', 1200);
  if (!seedVideoUrl && !coverImageUrl) return { ok: false, skipped: true, reason: 'full_clip_media_missing' };

  const clipMode = resolveTwitchFullClipMode(env);
  const renderDurationSeconds = resolveTwitchFullClipRenderDurationSeconds(env, input.durationSeconds);
  const maxScenes = resolveFullClipSceneCount(env, input);
  const storyboard = buildTwitchFullClipStoryboard({
    ...input,
    maxScenes,
    durationSeconds: renderDurationSeconds || input.durationSeconds,
  });
  const identityPack = buildVivyVisualIdentityPack(input);
  const width = clampNumber(env.VIVY_STREAM_FULL_CLIP_WIDTH, 320, 1920, 1280);
  const height = clampNumber(env.VIVY_STREAM_FULL_CLIP_HEIGHT, 180, 1080, 720);
  const fps = clampNumber(env.VIVY_STREAM_FULL_CLIP_FPS, 8, 30, 24);
  const loopSeconds = clampNumber(env.VIVY_STREAM_FULL_CLIP_LOOP_SECONDS, 2, 8, FULL_THROTTLE_LOOP_SECONDS);
  const explicitSceneLoops = String(env.VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS ?? '').trim();
  const shouldGenerateSceneLoops = clipMode.requireSceneGeneration
    ? true
    : (explicitSceneLoops ? toBoolean(explicitSceneLoops) : true);
  const provider = resolveTwitchFullClipProvider(env);
  const generateVideoFn = input.generateVideoFn || null;
  const fetchFn = input.fetchFn || globalThis.fetch;
  const logger = input.logger || console;

  const prepared = await prepareTwitchFullSongClip({
    ...input,
    env,
    storyboard,
    identityPack,
    seedVideoUrl,
    coverImageUrl,
    width,
    height,
    fps,
    loopSeconds,
    shouldGenerateSceneLoops,
    clipMode,
    provider,
    generateVideoFn,
    fetchFn,
    logger,
  });
  if (!prepared?.ok) return prepared;
  return finalizeTwitchFullSongClip(prepared, {
    ...input,
    durationSeconds: renderDurationSeconds || input.durationSeconds,
    sourceDurationSeconds: input.durationSeconds,
    width,
    height,
    fps,
    logger,
  });
}

async function prepareTwitchFullSongClip(input = {}) {
  const env = input.env || process.env;
  if (!isTwitchFullClipEnabled(env)) return { ok: false, skipped: true, reason: 'full_clip_disabled' };

  const seedVideoUrl = cleanText(input.seedVideoUrl || input.coverVideoUrl, '', 1200);
  const coverImageUrl = cleanText(input.coverImageUrl, '', 1200);
  if (!seedVideoUrl && !coverImageUrl) return { ok: false, skipped: true, reason: 'full_clip_media_missing' };

  const clipMode = input.clipMode || resolveTwitchFullClipMode(env);
  const renderDurationSeconds = resolveTwitchFullClipRenderDurationSeconds(env, input.durationSeconds) || input.durationSeconds;
  const maxScenes = resolveFullClipSceneCount(env, input);
  const storyboard = Array.isArray(input.storyboard) && input.storyboard.length
    ? input.storyboard
    : buildTwitchFullClipStoryboard({ ...input, maxScenes, durationSeconds: renderDurationSeconds });
  const identityPack = input.identityPack || buildVivyVisualIdentityPack(input);
  const width = clampNumber(input.width || env.VIVY_STREAM_FULL_CLIP_WIDTH, 320, 1920, 1280);
  const height = clampNumber(input.height || env.VIVY_STREAM_FULL_CLIP_HEIGHT, 180, 1080, 720);
  const fps = clampNumber(input.fps || env.VIVY_STREAM_FULL_CLIP_FPS, 8, 30, 24);
  const loopSeconds = clampNumber(input.loopSeconds || env.VIVY_STREAM_FULL_CLIP_LOOP_SECONDS, 2, 8, FULL_THROTTLE_LOOP_SECONDS);
  const explicitSceneLoops = String(env.VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS ?? '').trim();
  const shouldGenerateSceneLoops = clipMode.requireSceneGeneration
    ? true
    : (typeof input.shouldGenerateSceneLoops === 'boolean'
      ? input.shouldGenerateSceneLoops
      : (explicitSceneLoops ? toBoolean(explicitSceneLoops) : true));
  const provider = input.provider || resolveTwitchFullClipProvider(env);
  const generateVideoFn = input.generateVideoFn || null;
  const fetchFn = input.fetchFn || globalThis.fetch;
  const logger = input.logger || console;
  const qualityInspector = input.videoQualityInspector || inspectVideoLoopQuality;
  const concurrency = clampNumber(env.VIVY_STREAM_FULL_CLIP_CONCURRENCY, 1, 3, 2);
  const gridDemosaic = resolveTwitchGridDemosaicConfig(env);
  const loopPlan = buildReusableLoopPlan(storyboard, env);
  const plannedStoryboard = loopPlan.scenes;
  const uniqueScenes = loopPlan.uniqueScenes;
  const sourceImageUrl = await prepareFullClipSourceImage({
    coverImageUrl,
    publicTitle: input.publicTitle || input.winner?.text,
    fetchFn,
    env,
    logger,
  });
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vivy-full-clip-'));
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  };
  try {
    const uniqueLoopVideos = new Map();
    let cursor = 0;
    async function worker() {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= uniqueScenes.length) return;
        const scene = uniqueScenes[index];
        let sceneUrl = clipMode.dream ? '' : seedVideoUrl;
        if (shouldGenerateSceneLoops && coverImageUrl && generateVideoFn) {
          try {
            const generated = await generateSceneLoop({
              scene,
              coverImageUrl,
              sourceImageUrl,
              referenceImageUrls: identityPack.referenceImageUrls,
              referenceVisualContext: identityPack.prompt || '',
              req: input.req || null,
              generateVideoFn,
              conversationId: input.conversationId || '',
              provider,
              durationSeconds: loopSeconds,
              width,
              height,
              fps,
            });
            sceneUrl = generated.videoUrl || sceneUrl;
          } catch (error) {
            logger.warn?.(
              '[vivy-full-clip] scene=%s generation failed%s: %s',
              scene.sceneId,
              clipMode.dream ? ', dreamclip skips static seed fallback' : ', reusing seed loop',
              cleanText(error?.message || error, '', 180)
            );
          }
        }
        if (!sceneUrl) continue;
        const loopPath = path.join(workDir, `${scene.sceneId}.mp4`);
        await downloadToFile(sceneUrl, loopPath, fetchFn);
        let finalLoopPath = loopPath;
        let demosaic = null;
        if (gridDemosaic.enabled) {
          const demosaicPath = path.join(workDir, `${scene.sceneId}-demosaic.mp4`);
          try {
            demosaic = await demosaicGridVideo({
              inputPath: loopPath,
              outputPath: demosaicPath,
              width,
              height,
              fps,
              env,
              config: gridDemosaic,
            });
            if (demosaic?.ok) finalLoopPath = demosaicPath;
          } catch (error) {
            logger.warn?.('[vivy-full-clip] scene=%s grid demosaic failed, keeping original loop: %s', scene.sceneId, cleanText(error?.message || error, '', 180));
          }
        }
        let visualQa = await qualityInspector(finalLoopPath, {
          env,
          workDir,
          scene,
          logger,
        });
        if (visualQa?.rejected && sourceImageUrl && clipMode.allowStaticFallback) {
          const safeLoopPath = path.join(workDir, `${scene.sceneId}-safe-motion.mp4`);
          try {
            await createSafeImageMotionLoop({
              imageUrl: sourceImageUrl,
              outputPath: safeLoopPath,
              durationSeconds: loopSeconds,
              width,
              height,
              fps,
              fetchFn,
              env,
            });
            finalLoopPath = safeLoopPath;
            visualQa = {
              ...visualQa,
              fallbackApplied: true,
              fallbackMode: 'clean_cover_motion',
            };
            logger.warn?.(
              '[vivy-video-qa] scene=%s rejected=%s suspicious=%s strong=%s fallback=clean_cover_motion',
              scene.sceneId,
              visualQa.reason || 'generated_text_detected',
              visualQa.suspiciousSamples || 0,
              visualQa.strongSamples || 0
            );
          } catch (error) {
            logger.warn?.(
              '[vivy-video-qa] scene=%s fallback failed, keeping generated loop: %s',
              scene.sceneId,
              cleanText(error?.message || error, '', 180)
            );
          }
        } else if (visualQa?.rejected && clipMode.dream) {
          logger.warn?.(
            '[vivy-video-qa] scene=%s rejected=%s dreamclip omits scene instead of publishing static fallback',
            scene.sceneId,
            visualQa.reason || 'generated_text_detected'
          );
          continue;
        }
        uniqueLoopVideos.set(scene.loopKey || scene.sceneId, {
          sceneId: scene.sceneId,
          loopKey: scene.loopKey || scene.sceneId,
          path: finalLoopPath,
          originalPath: loopPath,
          url: sceneUrl,
          demosaic,
          visualQa,
          videoInfo: await probeVideoInfo(finalLoopPath, env).catch(() => null),
        });
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(concurrency, Math.max(1, uniqueScenes.length)) },
      () => worker()
    ));
    const fallbackLoop = Array.from(uniqueLoopVideos.values()).find(Boolean);
    if (!fallbackLoop) throw new Error('full_clip_no_scene_loops');
    if (clipMode.dream) {
      const coverage = uniqueScenes.length ? uniqueLoopVideos.size / uniqueScenes.length : 0;
      if (coverage < clipMode.minGeneratedCoverage) {
        throw new Error(`dreamclip_insufficient_generated_scenes_${uniqueLoopVideos.size}_of_${uniqueScenes.length}`);
      }
    }
    const loopVideos = plannedStoryboard.map((scene) => {
      const sourceLoop = uniqueLoopVideos.get(scene.loopKey) || fallbackLoop;
      return {
        ...sourceLoop,
        sceneId: scene.sceneId,
        loopKey: scene.loopKey,
        reused: sourceLoop.loopKey !== scene.sceneId,
      };
    });
    return {
      ok: true,
      prepared: true,
      workDir,
      cleanup,
      storyboard: plannedStoryboard,
      loopVideos,
      uniqueLoopCount: uniqueLoopVideos.size,
      uniqueLoopLimit: loopPlan.uniqueLoopLimit,
      loopReuseEnabled: loopPlan.reuseEnabled,
      width,
      height,
      fps,
      provider,
      generatedSceneLoops: shouldGenerateSceneLoops,
      gridDemosaic: gridDemosaic.enabled,
      repairedLoopCount: Array.from(uniqueLoopVideos.values()).filter((loop) => loop.visualQa?.fallbackApplied).length,
      clipMode: clipMode.mode,
      clipModeLabel: clipMode.label,
      renderDurationSeconds,
      sourceDurationSeconds: input.durationSeconds,
      publicTitle: input.publicTitle,
      winner: input.winner,
    };
  } catch (error) {
    await cleanup();
    return {
      ok: false,
      error: cleanText(error?.message || error, 'full_clip_prepare_failed', 160),
      message: cleanText(error?.message || error, '', 240),
      storyboard: plannedStoryboard,
    };
  }
}

async function finalizeTwitchFullSongClip(prepared = {}, input = {}) {
  if (!prepared?.ok) return prepared;
  const logger = input.logger || console;
  const storyboard = Number(input.durationSeconds) > 0
    ? allocateSceneTimings(prepared.storyboard || [], Number(input.durationSeconds))
    : (prepared.storyboard || []);
  const width = clampNumber(input.width || prepared.width, 320, 1920, prepared.width || 1280);
  const height = clampNumber(input.height || prepared.height, 180, 1080, prepared.height || 720);
  const fps = clampNumber(input.fps || prepared.fps, 8, 30, prepared.fps || 24);
  try {
    const workDir = prepared.workDir || os.tmpdir();
    const outputPath = path.join(workDir, `${slugify(input.publicTitle || prepared.publicTitle || input.winner?.text || prepared.winner?.text || 'vivy-full-clip')}-${crypto.randomBytes(4).toString('hex')}.mp4`);
    const montage = await composeLoopMontage({
      scenes: storyboard,
      loopVideos: prepared.loopVideos || [],
      outputPath,
      width,
      height,
      fps,
      ffmpegBin: resolveFfmpegBinary(input.env || process.env),
      env: input.env || process.env,
    });
    const buffer = await fsp.readFile(outputPath);
    const uploaded = await uploadBufferToR2({
      userId: 'vivy-twitch-live',
      filename: path.basename(outputPath),
      buffer,
      contentType: 'video/mp4',
    });
    let shareVideoUrl = '';
    const audioPath = cleanText(input.audioPath, '', 1200);
    const rawTrackUrl = cleanText(input.audioUrl || input.trackUrl, '', 1200);
    const audioUrl = /^https?:\/\//i.test(rawTrackUrl) ? rawTrackUrl : '';
    if (audioPath || audioUrl) {
      try {
        const sharePath = `${outputPath.replace(/\.mp4$/i, '')}-share.mp4`;
        await muxAudioIntoClip({
          videoPath: outputPath,
          audioPath,
          audioUrl,
          outputPath: sharePath,
          ffmpegBin: resolveFfmpegBinary(input.env || process.env),
          fetchFn: input.fetchFn || globalThis.fetch,
          workDir,
        });
        const shareBuffer = await fsp.readFile(sharePath);
        const uploadedShare = await uploadBufferToR2({
          userId: 'vivy-twitch-live',
          filename: path.basename(sharePath),
          buffer: shareBuffer,
          contentType: 'video/mp4',
        });
        shareVideoUrl = uploadedShare.url;
      } catch (error) {
        logger.warn?.('[vivy-full-clip] share mux skipped: %s', cleanText(error?.message || error, '', 180));
      }
    }
    return {
      ok: true,
      coverVideoUrl: uploaded.url,
      shareVideoUrl,
      prompt: storyboard.map((scene) => `${scene.sceneId} ${scene.header}: ${scene.prompt}`).join('\n'),
      storyboard,
      montage,
      provider: prepared.generatedSceneLoops ? prepared.provider : 'ffmpeg-loop-montage',
      generatedSceneLoops: prepared.generatedSceneLoops,
      uniqueLoopCount: prepared.uniqueLoopCount,
      repairedLoopCount: prepared.repairedLoopCount || 0,
      loopReuseEnabled: prepared.loopReuseEnabled,
      gridDemosaic: prepared.gridDemosaic === true,
      clipMode: prepared.clipMode || 'economy',
      clipModeLabel: prepared.clipModeLabel || 'Vivy Clip Éco',
      renderDurationSeconds: prepared.renderDurationSeconds || Number(input.durationSeconds || 0) || 0,
      sourceDurationSeconds: prepared.sourceDurationSeconds || Number(input.sourceDurationSeconds || input.durationSeconds || 0) || 0,
    };
  } catch (error) {
    logger.warn?.('[vivy-full-clip] finalize failed: %s', cleanText(error?.message || error, '', 180));
    return {
      ok: false,
      error: cleanText(error?.message || error, 'full_clip_failed', 160),
      message: cleanText(error?.message || error, '', 240),
      storyboard,
    };
  } finally {
    if (typeof prepared.cleanup === 'function') await prepared.cleanup();
  }
}

module.exports = {
  allocateSceneTimings,
  assessVideoOcrSamples,
  buildClipAudioMuxArgs,
  buildProfessionalEditPlan,
  buildSceneVisualPrompt,
  buildReusableLoopPlan,
  buildTwitchFullClipStoryboard,
  composeLoopMontage,
  createSafeImageMotionLoop,
  demosaicGridVideo,
  estimateTwitchFullClipCost,
  finalizeTwitchFullSongClip,
  generateTwitchFullSongClip,
  hasConfiguredVideoProxy,
  inspectVideoLoopQuality,
  isTwitchFullClipEnabled,
  muxAudioIntoClip,
  probeVideoInfo,
  parseLyricSectionsForClip,
  pickStoryboardSections,
  prepareTwitchFullSongClip,
  resolveProfessionalEditConfig,
  resolveTwitchGridDemosaicConfig,
  resolveTwitchFullClipMode,
  resolveTwitchFullClipProvider,
  resolveTwitchFullClipRenderDurationSeconds,
};
