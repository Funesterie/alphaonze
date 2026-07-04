const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  assessVideoOcrSamples,
  buildProfessionalEditPlan,
  buildReusableLoopPlan,
  buildSceneVisualPrompt,
  buildTwitchFullClipStoryboard,
  composeLoopMontage,
  demosaicGridVideo,
  generateTwitchFullSongClip,
  isTwitchFullClipEnabled,
  parseLyricSectionsForClip,
  probeVideoInfo,
  prepareTwitchFullSongClip,
  resolveProfessionalEditConfig,
  resolveTwitchGridDemosaicConfig,
  resolveTwitchFullClipMode,
  resolveTwitchFullClipProvider,
  resolveTwitchFullClipRenderDurationSeconds,
} = require('../src/vivy/twitch-clip-director.cjs');

const SAMPLE_LYRICS = `
[Intro]
La ville retient son souffle sous les néons
Une voix cherche la sortie dans les machines

[Verse 1]
Elle traverse les câbles comme une rivière
Les vieux écrans répondent par éclairs

[Chorus]
Vivy rallume la nuit
Chaque bug devient une étoile

[Bridge]
Tout se coupe, le noir avale les murs
Puis un battement revient dans le serveur

[Final Chorus]
Vivy rallume la nuit
La ville entière chante dans ses circuits
`;

test('Vivy full clip director turns lyrics into timed visual scenes', () => {
  const sections = parseLyricSectionsForClip(SAMPLE_LYRICS);
  assert.equal(sections.length, 5);
  assert.equal(sections[2].kind, 'chorus');
  assert.equal(sections[3].kind, 'bridge');

  const storyboard = buildTwitchFullClipStoryboard({
    publicTitle: 'Vivy rallume la nuit',
    winner: { text: 'Vivy rallume la nuit, électro-pop lumineuse' },
    lyrics: SAMPLE_LYRICS,
    durationSeconds: 180,
    maxScenes: 4,
    styleBrief: 'electro-pop lumineuse, synthés brillants',
    artists: ['Vivy'],
  });

  assert.equal(storyboard.length, 4);
  assert.ok(storyboard.some((scene) => scene.kind === 'chorus'));
  assert.ok(storyboard.some((scene) => scene.kind === 'bridge'));
  assert.equal(storyboard.at(-1).endSeconds, 180);
  assert.match(storyboard.find((scene) => scene.kind === 'chorus').prompt, /motif visuel central récurrent|motif visuel central recurrent/i);
  assert.match(storyboard.find((scene) => scene.kind === 'bridge').prompt, /bascule dramatique/i);
  assert.match(storyboard[0].prompt, /Référence visuelle chanteuse IA/i);
  assert.match(storyboard[0].prompt, /ne jamais la rendre blonde/i);
  assert.match(storyboard[0].prompt, /pas de pseudo-écriture/i);
  assert.match(storyboard[0].prompt, /overlay Twitch ajoute les infos lisibles/i);
  assert.doesNotMatch(storyboard[0].prompt, /La ville retient son souffle sous les néons/i);
  assert.doesNotMatch(storyboard[0].prompt, /Boucle vidéo musicale pour "/i);
  assert.doesNotMatch(storyboard[0].prompt, /pour Funesterie/i);
  assert.doesNotMatch(storyboard[0].prompt, /official Funesterie/i);
  assert.match(storyboard[0].prompt, /aucune affiche, aucun générique, aucun lettrage visible/i);
});

test('Vivy full clip director preserves a complete hand-to-microphone contact', () => {
  const prompt = buildSceneVisualPrompt({
    publicTitle: 'Vivy transforme la nuit en scène',
    winner: {
      text: 'Vivy chante dans un club nocturne avec un micro de studio et des néons roses',
    },
    scene: {
      kind: 'chorus',
      header: 'Refrain',
      text: 'La lumière rose monte pendant que Vivy garde le micro',
    },
    styleBrief: 'goth cyber-pop adulte, énergie progressive',
    artists: ['vivy'],
    vocalCast: 'Vivy',
  });

  assert.match(prompt, /main complète à cinq doigts/i);
  assert.match(prompt, /poignet et un avant-bras visibles/i);
  assert.match(prompt, /aucun doigt ne disparaît derrière le micro/i);
  assert.match(prompt, /aucune main ne fusionne avec lui/i);
});

test('Vivy full clip follows the short clip switch unless explicitly disabled', () => {
  assert.equal(isTwitchFullClipEnabled({}), true);
  assert.equal(isTwitchFullClipEnabled({ VIVY_STREAM_CLIP_ENABLED: '1' }), true);
  assert.equal(isTwitchFullClipEnabled({ VIVY_STREAM_CLIP_ENABLED: '0' }), false);
  assert.equal(isTwitchFullClipEnabled({ VIVY_STREAM_CLIP_ENABLED: '1', VIVY_STREAM_FULL_CLIP_ENABLED: '0' }), false);
  assert.equal(isTwitchFullClipEnabled({ VIVY_STREAM_CLIP_ENABLED: '0', VIVY_STREAM_FULL_CLIP_ENABLED: '1' }), true);
});

test('Vivy full clip supports up to eight storyboard scenes when explicitly requested', () => {
  const storyboard = buildTwitchFullClipStoryboard({
    publicTitle: 'Repousser les limites',
    winner: { text: 'Vivy traverse une ville électrique, chaque refrain ouvre un monde' },
    lyrics: [
      '[Intro]', 'La ville s’allume',
      '[Verse 1]', 'Premier monde sous la pluie',
      '[Pre-Chorus]', 'La tension grimpe',
      '[Chorus]', 'Repousser les limites',
      '[Verse 2]', 'Deuxième monde dans les machines',
      '[Bridge]', 'Tout se brise',
      '[Final Chorus]', 'Repousser les limites plus haut',
      '[Outro]', 'Le ciel répond',
    ].join('\n'),
    durationSeconds: 240,
    maxScenes: 8,
    artists: ['Vivy', 'A11'],
  });

  assert.equal(storyboard.length, 8);
  assert.equal(storyboard.at(-1).endSeconds, 240);
});

test('Vivy full clip keeps instrumental songs as a smooth cinematic flow', async () => {
  const generated = [];
  const result = await generateTwitchFullSongClip({
    env: {
      VIVY_STREAM_FULL_CLIP_SCENES: '8',
      VIVY_STREAM_FULL_CLIP_INSTRUMENTAL_SCENES: '8',
      VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS: '1',
      VIVY_STREAM_FULL_CLIP_LOOP_SECONDS: '2',
      VIVY_STREAM_FULL_CLIP_WIDTH: '160',
      VIVY_STREAM_FULL_CLIP_HEIGHT: '90',
      VIVY_STREAM_FULL_CLIP_FPS: '8',
      A11_VIDEO_FFMPEG_BIN: 'ffmpeg',
      A11_VIDEO_LOCAL_RUNNER_URL: 'http://127.0.0.1:17882/api/tools/generate_video',
    },
    publicTitle: 'La Belle et les Codeurs',
    winner: {
      text: 'La Belle et les Codeurs, musique instrumentale romantique style Roméo et Juliette, no vocals',
    },
    intentPlan: {
      intent: 'instrumental_music',
      shouldGenerateLyrics: false,
      shouldUseVocals: false,
      generationBrief: 'Instrumental romantic orchestral piece, no vocals.',
    },
    instrumentalMode: true,
    lyrics: [
      '[Intro]', 'Fausse ligne que le clip ne doit pas traiter comme paroles',
      '[Verse 1]', 'Pseudo couplet technique',
      '[Chorus]', 'Pseudo refrain qui casserait le montage',
      '[Bridge]', 'Pseudo pont',
      '[Final Chorus]', 'Pseudo final',
    ].join('\n'),
    durationSeconds: 165,
    coverImageUrl: 'https://files.example.com/poster-with-text.jpg',
    generateVideoFn: async ({ body }) => {
      generated.push(body.prompt);
      return { ok: true, video_url: 'data-video-placeholder' };
    },
    fetchFn: async () => new Response(Buffer.from('bad-video')),
    logger: { warn() {} },
  });

  assert.equal(generated.length, 4);
  assert.equal(result.ok, false);
  assert.match(generated[0], /installation du décor/i);
  assert.match(generated.join('\n'), /scène narrative concrète|bascule dramatique|image finale/i);
  assert.doesNotMatch(generated.join('\n'), /refrain visuel récurrent|motif visuel central récurrent/i);
  assert.doesNotMatch(generated.join('\n'), /Pseudo refrain qui casserait le montage/i);
});

test('Vivy full clip does not turn a fruit song into a singer portrait', () => {
  const prompt = buildSceneVisualPrompt({
    publicTitle: 'Une Poire se fait Amender',
    winner: {
      text: 'Une Poire se fait Amender et demande Jus-stice, histoire chantée avec jeux de mots fruités',
    },
    scene: {
      header: 'Vivy',
      kind: 'verse',
      index: 0,
      text: [
        'La poire au comptoir attend son ticket',
        'On m’a prise pour une fille qui coule sans verrous',
      ].join('\n'),
    },
    styleBrief: 'comédie pop-funk vive',
    coverPrompt: 'Pochette avec une poire au comptoir, sans humains.',
    artists: ['Vivy'],
  });

  assert.match(prompt, /Sujet visuel prioritaire non humain/i);
  assert.match(prompt, /casting vocal n’est pas le casting visuel/i);
  assert.match(prompt, /Fonction de ce plan: scène narrative concrète/i);
  assert.doesNotMatch(prompt, /Moment de la chanson|\[Vivy\]|\[Verse 1\]/i);
  assert.doesNotMatch(prompt, /Référence visuelle chanteuse IA|official Funesterie identity/i);
  assert.doesNotMatch(prompt, /fille qui coule/i);
  assert.match(prompt, /ne pas ajouter de chanteur, chanteuse, portrait ou corps humain/i);
});

test('Vivy full clip locks creator and Vivy as two distinct visual identities', () => {
  const prompt = buildSceneVisualPrompt({
    publicTitle: 'Duo homme femme',
    winner: {
      text: 'Duo homme femme, Le créateur et Vivy. Voix masculine : fatigue, bugs, doute. Voix féminine : Vivy répond et transforme les erreurs en musique.',
    },
    scene: {
      header: 'Couplet 1',
      kind: 'verse',
      index: 0,
      text: [
        'Les lignes s’effondrent, le code clignote rouge',
        'Je vois ton écran trembler sous les erreurs',
      ].join('\n'),
    },
    styleBrief: 'électro-rock anime, duo vocal contrasté homme/femme',
    artists: ['Djeff', 'Vivy'],
  });

  assert.match(prompt, /Référence visuelle créateur humain/i);
  assert.match(prompt, /Référence visuelle chanteuse IA/i);
  assert.match(prompt, /Casting visuel obligatoire/i);
  assert.match(prompt, /deux personnages distincts/i);
  assert.match(prompt, /la chanteuse IA n’est pas le créateur/i);
  assert.match(prompt, /aucun plan ne doit remplacer le créateur par une seconde chanteuse IA/i);
  assert.doesNotMatch(prompt, /official Funesterie/i);
});

test('Vivy full clip defaults to five generated video loops and reuses chorus scenes', async () => {
  const generated = [];
  const result = await generateTwitchFullSongClip({
    env: {
      A11_COMFY_CLOUD_API_KEY: 'comfy-secret',
      VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS: '1',
      VIVY_STREAM_FULL_CLIP_LOOP_SECONDS: '2',
      VIVY_STREAM_FULL_CLIP_WIDTH: '160',
      VIVY_STREAM_FULL_CLIP_HEIGHT: '90',
      VIVY_STREAM_FULL_CLIP_FPS: '8',
      A11_VIDEO_FFMPEG_BIN: 'ffmpeg',
    },
    publicTitle: 'Cinq boucles',
    winner: { text: 'Vivy traverse trois mondes lumineux' },
    lyrics: [
      '[Intro]', 'La ville respire encore sous les néons',
      '[Verse 1]', 'Premier monde, les machines ouvrent les yeux',
      '[Pre-Chorus]', 'La tension grimpe dans les câbles bleus',
      '[Chorus]', 'Vivy rallume la nuit',
      '[Verse 2]', 'Deuxième monde, les écrans deviennent rivière',
      '[Bridge]', 'Tout se coupe, le noir avale les murs',
      '[Final Chorus]', 'Vivy rallume la nuit plus haut',
      '[Outro]', 'La ville entière chante dans ses circuits',
    ].join('\n'),
    durationSeconds: 9,
    coverImageUrl: 'https://files.example.com/cover.png',
    generateVideoFn: async ({ body }) => {
      generated.push(body.prompt);
      return { ok: true, video_url: 'data-video-placeholder' };
    },
    fetchFn: async () => new Response(Buffer.from('bad-video')),
    logger: { warn() {} },
  });

  assert.equal(generated.length, 5);
  assert.match(generated.join('\n'), /motif visuel central récurrent/i);
  assert.equal(result.ok, false);
});

test('Vivy DreamClip mode generates every planned scene without loop reuse', async () => {
  const env = {
    A11_COMFY_CLOUD_API_KEY: 'comfy-secret',
    VIVY_STREAM_FULL_CLIP_MODE: 'dreamclip',
    VIVY_STREAM_FULL_CLIP_SCENES: '8',
    VIVY_STREAM_FULL_CLIP_LOOP_SECONDS: '2',
    VIVY_STREAM_FULL_CLIP_WIDTH: '160',
    VIVY_STREAM_FULL_CLIP_HEIGHT: '90',
    VIVY_STREAM_FULL_CLIP_FPS: '8',
    A11_VIDEO_FFMPEG_BIN: 'ffmpeg',
  };
  const mode = resolveTwitchFullClipMode(env);
  assert.equal(mode.mode, 'dreamclip');
  assert.equal(mode.dream, true);
  assert.equal(mode.allowStaticFallback, false);
  assert.equal(resolveTwitchFullClipRenderDurationSeconds(env, 480), 300);

  const storyboard = buildTwitchFullClipStoryboard({
    publicTitle: 'Clip de rêve',
    winner: { text: 'Vivy traverse huit tableaux de rêve' },
    lyrics: [
      '[Intro]', 'La porte s’ouvre sur la ville',
      '[Verse 1]', 'Premier monde, les néons avancent',
      '[Pre-Chorus]', 'La tension monte dans les vitres',
      '[Chorus]', 'Le refrain traverse le ciel',
      '[Verse 2]', 'Deuxième monde, les machines dansent',
      '[Bridge]', 'Le décor bascule sans texte',
      '[Final Chorus]', 'Le refrain revient plus haut',
      '[Outro]', 'La dernière lumière reste',
    ].join('\n'),
    durationSeconds: 180,
    maxScenes: 8,
    styleBrief: 'électro-pop cinématique',
    artists: ['Vivy'],
  });
  const loopPlan = buildReusableLoopPlan(storyboard, env);
  assert.equal(loopPlan.reuseEnabled, false);
  assert.equal(loopPlan.uniqueScenes.length, storyboard.length);

  const generated = [];
  const result = await generateTwitchFullSongClip({
    env,
    publicTitle: 'Clip de rêve',
    winner: { text: 'Vivy traverse huit tableaux de rêve' },
    lyrics: [
      '[Intro]', 'La porte s’ouvre sur la ville',
      '[Verse 1]', 'Premier monde, les néons avancent',
      '[Pre-Chorus]', 'La tension monte dans les vitres',
      '[Chorus]', 'Le refrain traverse le ciel',
      '[Verse 2]', 'Deuxième monde, les machines dansent',
      '[Bridge]', 'Le décor bascule sans texte',
      '[Final Chorus]', 'Le refrain revient plus haut',
      '[Outro]', 'La dernière lumière reste',
    ].join('\n'),
    durationSeconds: 480,
    coverImageUrl: 'https://files.example.com/cover.png',
    generateVideoFn: async ({ body }) => {
      generated.push(body.prompt);
      return { ok: true, video_url: 'data-video-placeholder' };
    },
    fetchFn: async () => new Response(Buffer.from('bad-video')),
    logger: { warn() {} },
  });

  assert.equal(generated.length, 8);
  assert.equal(result.ok, false);
});

test('Vivy DreamClip omits rejected text-glitch scenes instead of publishing static fallbacks', async () => {
  const result = await prepareTwitchFullSongClip({
    env: {
      A11_COMFY_CLOUD_API_KEY: 'comfy-secret',
      VIVY_STREAM_FULL_CLIP_MODE: 'dreamclip',
      VIVY_STREAM_FULL_CLIP_SCENES: '2',
      VIVY_STREAM_FULL_CLIP_WIDTH: '160',
      VIVY_STREAM_FULL_CLIP_HEIGHT: '90',
      VIVY_STREAM_FULL_CLIP_FPS: '8',
      VIVY_STREAM_FULL_CLIP_VISUAL_QA: '1',
    },
    publicTitle: 'Rêve sans faux texte',
    winner: { text: 'Deux scènes de rêve sans lettres' },
    lyrics: '[Intro]\nLa lumière entre\n[Chorus]\nLe rêve répond',
    durationSeconds: 120,
    coverImageUrl: 'https://files.example.com/cover.png',
    generateVideoFn: async () => ({ ok: true, video_url: 'data-video-placeholder' }),
    fetchFn: async () => new Response(Buffer.from('bad-video')),
    videoQualityInspector: async () => ({ rejected: true, reason: 'generated_text_detected' }),
    logger: { warn() {} },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /full_clip_no_scene_loops|dreamclip_insufficient_generated_scenes/i);
});

test('Vivy video prompts never carry quoted lyrics or enable lip sync implicitly', async () => {
  let generatedBody = null;
  const prompt = buildSceneVisualPrompt({
    publicTitle: 'Qui a mangé le soleil',
    winner: {
      text: 'Qui a mangé le soleil, comédie pop. Une fille face caméra demande: “Qui a mangé le soleil ?”. Refrain: “Le soleil reste dans ton cœur”.',
    },
    scene: {
      header: 'Refrain',
      kind: 'chorus',
      index: 1,
      text: 'Le soleil reste dans ton cœur\nRemets-le dans le ciel',
    },
    styleBrief: 'voix féminine, refrain viral, guitare légère, lumière chaude',
    artists: [],
  });

  assert.doesNotMatch(prompt, /Qui a mangé le soleil|Le soleil reste dans ton cœur|Remets-le dans le ciel/i);
  assert.match(prompt, /jeune femme adulte/i);
  assert.match(prompt, /plan large dynamique/i);
  assert.match(prompt, /lumière chaude/i);

  await generateTwitchFullSongClip({
    env: {
      A11_COMFY_CLOUD_API_KEY: 'comfy-secret',
      VIVY_STREAM_FULL_CLIP_GENERATE_SCENE_LOOPS: '1',
      VIVY_STREAM_FULL_CLIP_LOOP_SECONDS: '2',
      VIVY_STREAM_FULL_CLIP_WIDTH: '160',
      VIVY_STREAM_FULL_CLIP_HEIGHT: '90',
      VIVY_STREAM_FULL_CLIP_FPS: '8',
      A11_VIDEO_FFMPEG_BIN: 'ffmpeg',
      VIVY_STREAM_FULL_CLIP_VISUAL_QA: '0',
    },
    publicTitle: 'Test visuel',
    winner: { text: 'Une femme traverse une ville au soleil' },
    lyrics: '[Verse 1]\nElle avance dans la lumière',
    durationSeconds: 2,
    coverImageUrl: 'https://files.example.com/cover.png',
    generateVideoFn: async ({ body }) => {
      generatedBody = body;
      return { ok: true, video_url: 'data-video-placeholder' };
    },
    fetchFn: async () => new Response(Buffer.from('bad-video')),
    logger: { warn() {} },
  });

  assert.equal(generatedBody.vocalPerformance, false);
  assert.equal(generatedBody.visualOnly, true);
  assert.match(generatedBody.negative_prompt, /ghost face/i);
});

test('Vivy video OCR guard rejects one strong text frame or repeated suspicious frames', () => {
  const strong = assessVideoOcrSamples([
    { text: '', confidence: 0 },
    { text: 'reste encore', confidence: 48 },
    { text: '', confidence: 0 },
  ]);
  assert.equal(strong.rejected, true);
  assert.equal(strong.reason, 'generated_text_detected');

  const repeated = assessVideoOcrSamples([
    { text: 'fauxxx', confidence: 32 },
  ]);
  assert.equal(repeated.rejected, true);

  const clean = assessVideoOcrSamples([
    { text: '', confidence: 0 },
    { text: '@', confidence: 70 },
    { text: 'ab', confidence: 90 },
  ]);
  assert.equal(clean.rejected, false);
});

test('Vivy full clip auto provider lets the video route fallback between cloud providers', () => {
  assert.equal(resolveTwitchFullClipProvider({}), '');
  assert.equal(resolveTwitchFullClipProvider({ VIVY_STREAM_CLIP_PROVIDER: 'auto' }), '');
  assert.equal(resolveTwitchFullClipProvider({ VIVY_STREAM_CLIP_PROVIDER: 'auto', A11_COMFY_CLOUD_API_KEY: 'comfy-secret' }), '');
  assert.equal(resolveTwitchFullClipProvider({ A11_VIDEO_LOCAL_RUNNER_URL: 'http://127.0.0.1:17882/api/tools/generate_video' }), '');
  assert.equal(resolveTwitchFullClipProvider({ VIVY_STREAM_CLIP_PROVIDER: 'auto', A11_COMFY_CLOUD_API_KEY: 'comfy-secret', A11_VIDEO_PROXY_URL: 'https://sd.funesterie.me/api/tools/generate_video' }), '');
  assert.equal(resolveTwitchFullClipProvider({ VIVY_STREAM_CLIP_PROVIDER: 'auto', VIVY_STREAM_CLIP_PROVIDER_FALLBACK: '0', A11_COMFY_CLOUD_API_KEY: 'comfy-secret' }), 'comfy_cloud');
  assert.equal(resolveTwitchFullClipProvider({ VIVY_STREAM_CLIP_PROVIDER: 'auto', VIVY_STREAM_CLIP_PROVIDER_FALLBACK: '0', A11_VIDEO_LOCAL_RUNNER_URL: 'http://127.0.0.1:17882/api/tools/generate_video' }), 'runcomfy');
  assert.equal(resolveTwitchFullClipProvider({ VIVY_STREAM_CLIP_PROVIDER: 'replicate', A11_VIDEO_PROXY_URL: 'https://sd.funesterie.me/api/tools/generate_video' }), 'replicate');
});

test('Vivy full clip keeps 3x3 demosaic as explicit repair mode only', () => {
  const legacy = resolveTwitchGridDemosaicConfig({
    VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID: '1',
  });
  assert.equal(legacy.enabled, false);
  assert.equal(legacy.legacyRequested, true);
  assert.equal(legacy.reason, 'grid_demosaic_requires_explicit_repair_mode');

  const repair = resolveTwitchGridDemosaicConfig({
    VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID: 'repair',
  });
  assert.equal(repair.enabled, true);
  assert.equal(repair.mode, 'repair');
  assert.equal(repair.reason, 'grid_demosaic_repair_mode');
});

test('Vivy professional edit plan cuts, retimes and transitions by song section', () => {
  const config = resolveProfessionalEditConfig({
    VIVY_STREAM_FULL_CLIP_BPM: '150',
    VIVY_STREAM_FULL_CLIP_MAX_EDIT_SEGMENT_SECONDS: '3',
    VIVY_STREAM_FULL_CLIP_TRANSITION_SECONDS: '0.2',
  });
  assert.equal(config.enabled, true);
  assert.equal(config.bpm, 150);

  const plan = buildProfessionalEditPlan([
    { scene: { sceneId: 'verse', kind: 'verse', durationSeconds: 14 }, videoPath: 'verse.mp4' },
    { scene: { sceneId: 'chorus', kind: 'chorus', durationSeconds: 12 }, videoPath: 'chorus.mp4' },
    { scene: { sceneId: 'bridge', kind: 'bridge', durationSeconds: 10 }, videoPath: 'bridge.mp4' },
  ], { config });

  assert.equal(plan.enabled, true);
  assert.equal(plan.mode, 'section_sync_professional_edit');
  assert.ok(plan.segmentCount > 3);
  assert.ok(plan.segments.some((segment) => segment.sourceSceneId === 'chorus' && segment.speed > 1));
  assert.ok(plan.segments.some((segment) => segment.sourceSceneId === 'bridge' && segment.speed < 1));
  assert.ok(plan.segments.some((segment) => segment.transition === 'fade'));
  assert.ok(plan.segments.some((segment) => segment.sourceOffsetSeconds > 0));
  assert.equal(
    Number(plan.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0).toFixed(3)),
    36
  );
});

test('Vivy professional edit stays direct when generated videos already cover their sections', () => {
  const plan = buildProfessionalEditPlan([
    {
      scene: { sceneId: 'intro', kind: 'intro', durationSeconds: 12 },
      videoPath: 'intro.mp4',
      sourceDurationSeconds: 13,
    },
    {
      scene: { sceneId: 'verse', kind: 'verse', durationSeconds: 12 },
      videoPath: 'verse.mp4',
      sourceDurationSeconds: 13,
    },
  ], {
    config: resolveProfessionalEditConfig({
      VIVY_STREAM_FULL_CLIP_PRO_EDIT: 'auto',
      VIVY_STREAM_FULL_CLIP_MAX_EDIT_SEGMENT_SECONDS: '3',
    }),
  });

  assert.equal(plan.enabled, false);
  assert.equal(plan.mode, 'auto_direct_concat');
  assert.equal(plan.segmentCount, 2);
  assert.ok(plan.segments.every((segment) => segment.speed === 1 && segment.transition === 'cut'));
});

test('Vivy full clip director can compose a loop montage with ffmpeg', async (t) => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (ffmpeg.status !== 0) {
    t.skip('ffmpeg unavailable');
    return;
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vivy-clip-director-test-'));
  try {
    const red = path.join(tempDir, 'red.mp4');
    const blue = path.join(tempDir, 'blue.mp4');
    const out = path.join(tempDir, 'out.mp4');
    for (const [file, color] of [[red, 'red'], [blue, 'blue']]) {
      const result = spawnSync('ffmpeg', [
        '-y',
        '-f', 'lavfi',
        '-i', `color=c=${color}:s=160x90:d=0.5:r=8`,
        '-an',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        file,
      ], { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }

    const result = await composeLoopMontage({
      scenes: [
        { sceneId: 'scene-01', durationSeconds: 1 },
        { sceneId: 'scene-02', durationSeconds: 1 },
      ],
      loopVideos: [{ path: red }, { path: blue }],
      outputPath: out,
      width: 160,
      height: 90,
      fps: 8,
      ffmpegBin: 'ffmpeg',
      env: { VIVY_STREAM_FULL_CLIP_PRO_EDIT: '1' },
    });

    assert.equal(result.sourceSceneCount, 2);
    assert.equal(result.segmentCount, 2);
    assert.equal(result.editPlan.enabled, true);
    assert.ok(result.sizeBytes > 0);
    assert.ok(fs.existsSync(out));
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test('Vivy full clip director can demosaic a 3x3 video contact sheet', async (t) => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  const ffprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (ffmpeg.status !== 0 || ffprobe.status !== 0) {
    t.skip('ffmpeg/ffprobe unavailable');
    return;
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vivy-demosaic-test-'));
  try {
    const source = path.join(tempDir, 'grid.mp4');
    const output = path.join(tempDir, 'demosaic.mp4');
    const result = spawnSync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=1:r=8',
      '-f', 'lavfi', '-i', 'color=c=green:s=160x90:d=1:r=8',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1:r=8',
      '-f', 'lavfi', '-i', 'color=c=yellow:s=160x90:d=1:r=8',
      '-f', 'lavfi', '-i', 'color=c=magenta:s=160x90:d=1:r=8',
      '-f', 'lavfi', '-i', 'color=c=cyan:s=160x90:d=1:r=8',
      '-f', 'lavfi', '-i', 'color=c=white:s=160x90:d=1:r=8',
      '-f', 'lavfi', '-i', 'color=c=gray:s=160x90:d=1:r=8',
      '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=1:r=8',
      '-filter_complex', 'xstack=inputs=9:layout=0_0|160_0|320_0|0_90|160_90|320_90|0_180|160_180|320_180[out]',
      '-map', '[out]',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      source,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const demosaic = await demosaicGridVideo({
      inputPath: source,
      outputPath: output,
      width: 160,
      height: 90,
      fps: 8,
      env: {
        VIVY_STREAM_FULL_CLIP_DEMOSAIC_GRID: 'repair',
        VIVY_STREAM_FULL_CLIP_DEMOSAIC_ACTIVE_HEIGHT_RATIO: '1',
        VIVY_STREAM_FULL_CLIP_DEMOSAIC_SEGMENT_SECONDS: '0.5',
      },
    });
    assert.equal(demosaic.ok, true);
    assert.ok(demosaic.segmentCount >= 2);
    const info = await probeVideoInfo(output, {});
    assert.equal(info.width, 160);
    assert.equal(info.height, 90);
    assert.ok(info.durationSeconds > 0.9);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});
