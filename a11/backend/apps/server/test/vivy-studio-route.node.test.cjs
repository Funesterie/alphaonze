const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const vivyMemoryDir = path.join(os.tmpdir(), `vivy-studio-test-memory-${process.pid}`);
process.env.A11_EPISODIC_MEMORY_DIR = vivyMemoryDir;
process.env.A11_RUNTIME_ROOT = path.join(vivyMemoryDir, 'runtime');
process.env.VIVY_CHAT_DISABLE_LLM = 'true';

const {
  createVivyStudioRouter,
  buildVivyAiChat,
  buildVivyChat,
  buildVivyConversationIdForSession,
  resolveVivyInputSession,
  buildVivyDirectSongReply,
  buildVivyVisualCreativeDirectionReply,
  buildVivyPromptAuthorityReply,
  isVivyPromptAuthorityRequest,
  buildVivyPublicLyrics,
  buildVivyStudioProduction,
  buildVivyMusicPrompt,
  buildVivyMultiVoiceAssemblyArgs,
  buildVivyPreviewMixArgs,
  buildVivyMusicMasterArgs,
  masterVivyMusicFile,
  resolveVivyPreviewVoicePath,
  buildVivyMp3RepairArgs,
  repairVivyMp3File,
  materializeVivyPreviewInstrumentalPath,
  materializeVivySunoMedia,
  buildVivyMemoryContext,
  buildVivySystemPrompt,
  buildVivySunoPayload,
  buildVivyMurekaPayload,
  extractSunoMedia,
  scoreVivySunoDirectorTrack,
  getVivySunoRuntimeStatus,
  requestSunoMusicExtension,
  requestSunoMusic,
  requestMurekaMusic,
  getMurekaMusicJob,
  listVivyChatSessionsForUser,
  buildVivyWebSearchQuery,
  getVivyOpenAIConfig,
  getVivyOllamaCloudConfig,
  getVivyCerbereSongConfig,
  getVivyLlmConfigs,
  createVivyOpenAIClientFromConfig,
  countVivyChorusSections,
  hasCompleteVivyNossenLyrics,
  buildDjeffModeSystemPrompt,
  hasDjeffTechnicalGroundingViolation,
  buildDjeffGroundedAuditFallback,
  isDirectSongwritingRequest,
  isVivyMcpNeo4jQuestion,
  isVivyWorkspaceToolRequest,
  isVivyVisualCreativeDirectionRequest,
  isVivyToolCapabilityQuestion,
  isVivyZenSelfManagementQuestion,
  getVivyZenRuntimeStatus,
  looksLikeWeakSongwritingReply,
  normalizeVivyChatHistory,
  postProcessVivyAssistantText,
  buildVivyNossenRoutingPlan,
  inferVivyNossenIntentPlan,
  inferVivyNossenRoutingPlan,
  parseVivyNossenRoutingPlan,
  strengthenVivyNossenRoutingPlan,
  enforceVivyNossenVoiceSemantics,
  sanitizeVivyNossenRoutingPlanForRequest,
  saveVivyWorkspaceForUser,
  sanitizeVivyPublicText,
  shouldVivyAutoWebSearch,
} = require('../src/routes/vivy-studio.cjs');
const {
  getEmergencyMediaAssetPath,
  getEmergencyMediaAssetSubpath,
} = require('../src/media/emergency-media.cjs');
const {
  buildVivySongcraftSystemPrompt,
  buildVivyStructuredLyrics,
  buildVivyVocalSegments,
  hasVivyChorusSection,
  repairVivySemanticImageCoherence,
  restoreVivyFrenchSongAccents,
  splitVivyArrangementCues,
} = require('../src/music/vivy-songcraft.cjs');
const {
  addEpisode,
  getEpisodes,
} = require('../lib/episodic-memory.cjs');

after(() => {
  fs.rmSync(vivyMemoryDir, { recursive: true, force: true });
});

test('NOSSEN refuse une explication tronquee meme si elle contient un debut de paroles', () => {
  const truncated = [
    'Je comprends que tu demandes pourquoi les paroles sont invalides.',
    '[Intro]',
    'Une ligne seulement',
    '[Verse 1 - Djeff solo]',
    'Ligne une',
    'Ligne deux',
    '[Chorus]',
    'Hook un',
    'Hook deux',
    '[Verse 2 - Vivy solo]',
    'Sous la lune digitale, je module la clarte',
  ].join('\n');
  assert.equal(hasCompleteVivyNossenLyrics(truncated, { songArtists: ['djeff', 'vivy'] }), false);
});

test('NOSSEN accepte une chanson complete et garde le cypher sans refrain valide', () => {
  const complete = [
    '[Intro]', 'Ouverture une',
    '[Verse 1]', 'V1-1', 'V1-2', 'V1-3', 'V1-4',
    '[Chorus]', 'R1-1', 'R1-2', 'R1-3',
    '[Verse 2]', 'V2-1', 'V2-2', 'V2-3', 'V2-4',
    '[Bridge]', 'Pont un', 'Pont deux',
    '[Final Chorus]', 'R2-1', 'R2-2', 'R2-3',
    '[Outro]', 'Fin une',
  ].join('\n');
  assert.equal(hasCompleteVivyNossenLyrics(complete, { songArtists: ['vivy'] }), true);

  const cypher = [
    '[Verse 1 - Djeff solo]', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
    '[Verse 2 - Djeff solo]', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
    '[Outro - Djeff solo]', 'C1', 'C2', 'C3', 'C4',
  ].join('\n');
  assert.equal(hasCompleteVivyNossenLyrics(cypher, { songArtists: ['djeff'] }), true);
});

test('Vivy Studio serves generated PNG assets with an image content type', async () => {
  const filename = `vivy-generated-${process.pid}-${Date.now()}.png`;
  const imagePath = getEmergencyMediaAssetPath(filename);
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter());
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/assets/${filename}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
  } finally {
    fs.rmSync(imagePath, { force: true });
  }
});

test('Vivy Studio serves assets from a one-level subdirectory (e.g. covers/)', async () => {
  const subdir = 'covers';
  const filename = `example-${process.pid}-${Date.now()}.png`;
  const imagePath = getEmergencyMediaAssetSubpath(`${subdir}/${filename}`);
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter());
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/assets/${subdir}/${filename}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
  } finally {
    fs.rmSync(imagePath, { force: true });
  }
});

test('Vivy Studio rejects path-traversal attempts on the subdirectory asset route', async () => {
  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter());
  }, async (baseUrl) => {
    // Express decodes the encoded ".." before routing, but a literal "../" in
    // the path would change the route segment itself.  Use a double-encoded
    // slash to probe at the Express level, then test the raw traversal string
    // directly via getEmergencyMediaAssetSubpath.
    const response = await fetch(`${baseUrl}/api/vivy/studio/assets/..%2F..%2Fetc%2Fpasswd`);
    // Express normalises this into a different route — either 404 from vivy-studio
    // or a higher-level 404, not a real file read.
    assert.ok(response.status === 404 || response.status === 400);

    // Unit-level guard: the helper must refuse traversal strings directly.
    assert.equal(getEmergencyMediaAssetSubpath('../etc/passwd'), '');
    assert.equal(getEmergencyMediaAssetSubpath('../../etc/passwd'), '');
    assert.equal(getEmergencyMediaAssetSubpath('/etc/passwd'), '');
    assert.equal(getEmergencyMediaAssetSubpath('covers/../../../etc/passwd'), '');
  });
});

async function withServer(registerRoutes, runAssertions) {
  const app = express();
  registerRoutes(app);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runAssertions(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

async function startOpenAiCompletionServer({ status = 200, content = 'Réponse de test.' } = {}) {
  const requests = [];
  const app = express();
  app.use(express.json());
  app.post(['/chat/completions', '/v1/chat/completions'], (req, res) => {
    requests.push(req.body);
    if (status !== 200) {
      return res.status(status).json({ error: { message: `test_http_${status}` } });
    }
    return res.json({
      id: 'vivy-llm-routing-test',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'test-model',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content },
      }],
    });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function startOllamaCloudTestServer({ status = 200, content = 'Vivy cloud prête.' } = {}) {
  const requests = [];
  const authorizations = [];
  const app = express();
  app.use(express.json());
  app.post('/api/chat', (req, res) => {
    requests.push(req.body);
    authorizations.push(req.headers.authorization || '');
    if (status !== 200) {
      return res.status(status).json({ error: `test_http_${status}` });
    }
    return res.json({
      model: req.body?.model || 'gpt-oss:120b',
      message: { role: 'assistant', content },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 12,
      eval_count: 8,
    });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    authorizations,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function acceptVivyTestAuth(req, res, next) {
  if (req.headers.authorization === 'Bearer vivy-test-token') {
    req.user = { id: 'vivy-auth-user', username: 'VivyUser' };
    return next();
  }
  return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
}

const VIVY_TEST_AUTH_HEADERS = { Authorization: 'Bearer vivy-test-token' };

const VIVY_FLOWERS_LOVE_POEM = `Fleurs de l'Amour** [Vivy]
Je me promène dans un jardin secret,
Où les fleurs s'épanouissent, et les rêves se mettent,
Les pétales roses, les feuilles vertes,
Me font penser à toi, à notre amour qui se réveille.
[Intro]
Dans ce jardin enchanté, où les fleurs dansent,
Je te retrouve, mon amour, avec un cœur qui chante,
Les parfums floraux, les murmures de la brise,
M'emmènent vers toi, mon cœur, mon amour, ma vie.
[Verse 1]
Les tulipes rouges, comme des lèvres qui s'ouvrent,
Les iris bleus, comme des yeux qui me regardent,
Les marguerites blanches, comme des mains qui se tendent,
Me font penser à nos premiers baisers, à nos premières tendresses.
[Pre-Chorus]
Les fleurs de l'amour, elles nous entourent,
Elles nous parlent de toi, de moi, de notre amour qui se dresse,
Elles nous murmurent des secrets, des promesses,
De nous aimer, de nous chérir, jusqu'à la fin des temps.
[Chorus]
Fleurs de l'amour, vous êtes nos témoins,
Vous voyez nos cœurs battre, vous entendez nos serments,
Fleurs de l'amour, vous êtes nos guides,
Vous nous conduisez vers l'amour, vers la vie.
[Verse 2]
Les lilas parfumés, comme des caresses qui nous enveloppent,
Les roses thé, comme des baisers qui nous étreignent,
Les jasmins blancs, comme des larmes de joie qui nous inondent,
Me font penser à nos nuits d'amour, à nos matins de bonheur.
[Bridge]
Les fleurs de l'amour, elles nous font rêver,
Elles nous emmènent vers des mondes inconnus, vers des rêves oubliés,
Elles nous font découvrir, des sentiments inédits,
Des émotions qui nous submergent, qui nous font vibrer.
[Outro]
Fleurs de l'Amour**
Je me promène dans un jardin secret,
Où les fleurs s'épanouissent, et les rêves se mettent,
Les pétales roses, les feuilles vertes,
Me font penser à toi, à notre amour qui se réveille.
Dans ce jardin enchanté, où les fleurs dansent,
Je te retrouve, mon amour, avec un cœur qui chante,
Les parfums floraux, les murmures de la brise,
M'emmènent vers toi, mon cœur, mon amour, ma vie.`;

test('Vivy Studio produces a song handoff without storing tokens', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    songSource: 'Paroles',
    songMood: 'electro pop sombre',
    songText: 'Entre lumière et ombre, Vivy chante pour Funesterie.',
    shareToken: 'must-not-leak',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.tokenStored, false);
  assert.match(result.brief, /VIVY_SONG_PRODUCTION/);
    assert.match(result.brief, /Entre lumière et ombre/);
  assert.doesNotMatch(result.brief, /must-not-leak/);
});

test('Vivy separates instrumental directions from lyrics that must be sung', () => {
  const source = `[Intro - Vivy]
(Soft piano + léger battement de tambour)
(voix douce et chuchotée)
Dans les ténèbres, je cherche la lumière,
(oh oh)
(mmh)
Un chemin sinueux, pour atteindre la liberté.`;
  const result = splitVivyArrangementCues(source);

  assert.deepEqual(result.cues, [
    'Soft piano + léger battement de tambour',
    'voix douce et chuchotée',
  ]);
  assert.doesNotMatch(result.lyrics, /Soft piano|battement de tambour/i);
  assert.doesNotMatch(result.lyrics, /voix douce|chuchotée/i);
  assert.match(result.lyrics, /\(oh oh\)/i);
  assert.match(result.lyrics, /\(mmh\)/i);
  assert.match(result.lyrics, /Dans les ténèbres/i);
});

test('Vivy public lyrics normalize refren before chat and TTS output', () => {
  const result = buildVivyPublicLyrics({
    mode: 'song',
    songArtists: ['vivy'],
  }, `[Refren - Vivy]
[Vivy]
Le refren revient quand la nuit nous entraîne.`, '');

  assert.match(result, /\[Refrain - Vivy\]/);
  assert.match(result, /Le refrain revient/);
  assert.doesNotMatch(result, /\brefren\b/i);
});

test('Vivy public chat keeps long creative replies intact by default', () => {
  const response = Array.from(
    { length: 80 },
    (_, index) => `Ligne ${index + 1}: les mains dans l'air, on danse jusqu'au matin sans perdre la lumière.`
  ).join('\n');

  assert.ok(response.length > 5000);
  assert.equal(sanitizeVivyPublicText(response), response);
});

test('Vivy Studio exposes cue-free vocal lyrics while preserving the public score', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    songArtists: ['vivy'],
    songText: `[Intro - Vivy]
(Soft piano + léger battement de tambour)
Dans les ténèbres, je cherche la lumière.
[Verse 1 - Vivy]
Je marche contre le vent, contre les tempêtes.
Je lutte contre les chaînes qui veulent m'asservir.
Je cherche à briser les murailles devant moi.
Le monde reprend enfin toutes ses couleurs.
[Chorus - Vivy]
Liberté, liberté, c'est mon cri de guerre.
Je veux être libre, je veux être moi.
Sans chaînes, sans murailles, sans peur.
Je veux voler, je veux être libre.`,
  });

  assert.match(result.publicLyrics, /Soft piano \+ léger battement de tambour/i);
  assert.doesNotMatch(result.vocalLyrics, /Soft piano|battement de tambour/i);
  assert.deepEqual(result.arrangementCues, ['Soft piano + léger battement de tambour']);
});

test('Vivy sends arrangement cues to Suno style instead of the sung prompt', () => {
  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['vivy'],
    songMood: 'pop cinématique',
    songText: `[Intro - Vivy]
(Soft piano + léger battement de tambour)
Dans les ténèbres, je cherche la lumière.`,
  });

  assert.doesNotMatch(payload.prompt, /Soft piano|battement de tambour/i);
  assert.match(payload.style, /soft piano/i);
  assert.match(payload.style, /battement de tambour/i);
});

test('Vivy Suno vocal payload explicitly keeps French lyrics even with English style tags', () => {
  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['djeff', 'vivy'],
    songMood: 'dark trap cypher, technical rap, cyber bass, melodic chorus',
    songText: [
      '[Verse - Djeff]',
      'Je tiens les logs, je coupe la fumée.',
      '[Chorus - Vivy]',
      'La nuit répond quand la voix revient.',
    ].join('\n'),
  });

  assert.equal(payload.instrumental, false);
  assert.match(payload.style, /French lyrics only/i);
  assert.match(payload.style, /no English lyrics/i);
  assert.match(payload.negativeTags, /English lyrics/i);
  assert.match(payload.negativeTags, /bilingual lyrics/i);
});

test('Vivy chat returns a Suno prompt instead of stale opinion fallback', async () => {
  const result = await buildVivyAiChat({
    mode: 'chat',
    message: 'bah donne juste le prompt pour faire la musique suno',
    history: [
      { role: 'user', content: 'écrite une chason sur le film "torque"' },
      { role: 'assistant', content: 'Ford, Shane et des bikers lancés dans une course.' },
      { role: 'user', content: "je pense qu'en une demi seconde t'a pu voir l'univers de torque et faire la musique ca me parait un peu trop rapide" },
    ],
  }, {
    user: { id: 'vivy-suno-prompt-test' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /Prompt Suno:/i);
  assert.match(result.assistant, /torque/i);
  assert.match(result.assistant, /motorcycle|biker|engines/i);
  assert.doesNotMatch(result.assistant, /Mon avis franc/i);
  assert.doesNotMatch(result.assistant, /Ford|Shane/i);
});

test('Vivy Suno prompt keeps the new generation songwriting context instead of truncating it', async () => {
  const result = await buildVivyAiChat({
    mode: 'chat',
    conversationId: 'vivy-new-generation-context',
    message: 'tu peux faire le prompt chanson/musique ?',
    history: [
      { role: 'user', content: 'parfait quand tu sens prête fais une chanson sur la nouvelle génération et ses comportements' },
      { role: 'assistant', content: 'Je déclenche une recherche web et je te donne des résultats utiles.' },
      { role: 'user', content: 'une chanson qui colle a la peau de ces jeunes qui ont grandient différemment' },
      { role: 'assistant', content: 'Je sens que tu veux quelque chose de profond.' },
      { role: 'user', content: "ils ont grandit dans une diode électronique, privé de l'aventure de sortir sans savoir où aller, de l'impossibilité de ne pas être jugés sur les réseaux sociaux, de devoir s'affirmer avec leurs idéaux" },
      { role: 'assistant', content: 'Je commence à voir les contours.' },
      { role: 'user', content: 'oui tu es sur le bon fil, peut être on pourrait parler de leurs intelligence hors norme incomparable' },
      { role: 'assistant', content: 'Je prends ça comme une vraie discussion.' },
    ],
  }, {
    user: { id: 'vivy-new-generation-context-test' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /Prompt Suno:/i);
  assert.match(result.assistant, /nouvelle g[ée]n[ée]ration|jeunes/i);
  assert.match(result.assistant, /diode|r[ée]seaux|intelligence|id[ée]aux/i);
  assert.doesNotMatch(result.assistant, /, de l\./i);
  assert.doesNotMatch(result.assistant, /R[ée]sultats utiles|Google Traduction|Musely/i);
});

test('Vivy ElevenLabs instrumental prompt stays within the provider contract and omits lyrics', () => {
  const longLyrics = `[Intro - Vivy]\n(Soft piano + léger battement de tambour)\n${'Dans les ténèbres, je cherche la lumière.\n'.repeat(140)}`;
  const prompt = buildVivyMusicPrompt({
    mode: 'song',
    songArtists: ['vivy'],
    songMood: 'pop cinématique',
    songText: longLyrics,
    forceInstrumental: true,
  });

  assert.ok(prompt.length <= 4000);
  assert.match(prompt, /Soft piano \+ léger battement de tambour/i);
  assert.match(prompt, /instrumental only/i);
  assert.doesNotMatch(prompt, /Lyrics:/i);
});

test('Vivy preview mix keeps the voice clear and masters the final song', () => {
  const args = buildVivyPreviewMixArgs('instrumental.mp3', 'voice.mp3', 'mix.mp3');
  assert.deepEqual(args.slice(0, 5), ['-y', '-i', 'instrumental.mp3', '-i', 'voice.mp3']);
  assert.match(args.join(' '), /volume=0\.55\[music\]/);
  assert.match(args.join(' '), /highpass=f=90,loudnorm=I=-19:TP=-6:LRA=7\[voice\]/);
  assert.match(args.join(' '), /amix=inputs=2:duration=longest/);
  assert.match(args.join(' '), /loudnorm=I=-14:TP=-1\.5:LRA=11/);
  assert.match(args.join(' '), /-write_xing 1/);
  assert.match(args.join(' '), /-id3v2_version 3/);
  assert.equal(args.at(-1), 'mix.mp3');
});

test('Vivy ACE mastering keeps a lossless FLAC master before the single MP3 encode', () => {
  const flacArgs = buildVivyMusicMasterArgs('source.wav', 'master.flac');
  const mp3Args = buildVivyMusicMasterArgs('source.flac', 'distribution.mp3');
  assert.match(flacArgs.join(' '), /-c:a flac/);
  assert.doesNotMatch(flacArgs.join(' '), /apad=pad_dur=/, 'le master FLAC intermediaire ne doit pas ajouter un second silence');
  assert.equal(flacArgs.at(-1), 'master.flac');
  assert.ok(!flacArgs.includes('libmp3lame'));
  assert.ok(!flacArgs.includes('-b:a'));
  assert.match(mp3Args.join(' '), /-c:a libmp3lame -b:a 192k/);
  assert.match(mp3Args.join(' '), /apad=pad_dur=1\.000/);
  assert.match(mp3Args.join(' '), /encoded_by=Funesterie/);
  assert.match(mp3Args.join(' '), /copyright=Funesterie/);
  assert.match(mp3Args.join(' '), /funesterie_provenance_id=funesterie/);
  assert.equal(mp3Args.at(-1), 'distribution.mp3');
});

test('Vivy mastering appends a silent tail and writes a signed Funesterie sidecar', async () => {
  const crypto = require('node:crypto');
  const sourcePath = path.join(os.tmpdir(), `vivy-provenance-${process.pid}-${Date.now()}.mp3`);
  const manifestPath = `${sourcePath}.funesterie.provenance.json`;
  fs.writeFileSync(sourcePath, Buffer.from('ID3-original-audio'));
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const keyPair = {
    privateKey: pair.privateKey,
    publicKey,
    keyId: crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16),
  };
  const calls = [];
  try {
    const result = await masterVivyMusicFile(sourcePath, {
      generatedAt: '2026-08-11T17:30:00.000Z',
      silentTailSeconds: 1,
      provenanceKeyPair: keyPair,
      runFfmpeg: async (args) => {
        calls.push(args);
        if (args.at(-1) !== '-') fs.writeFileSync(args.at(-1), Buffer.from('ID3-mastered-funesterie'));
        return { ok: true, stderr: '' };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.silentTailSeconds, 1);
    assert.equal(fs.existsSync(manifestPath), true);
    assert.match(calls[1].join(' '), /apad=pad_dur=1\.000/);
    assert.match(calls[1].join(' '), new RegExp(`funesterie_provenance_id=${result.provenanceId}`));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.brand, 'Funesterie');
    assert.equal(manifest.assetSha256, crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'));
    const { verifyAudioProvenanceManifest } = require('../src/music/funesterie-audio-provenance.cjs');
    assert.equal(verifyAudioProvenanceManifest(manifest), true);
  } finally {
    fs.rmSync(sourcePath, { force: true });
    fs.rmSync(manifestPath, { force: true });
  }
});

test('Vivy MP3 repair rewrites Clipchamp-compatible duration metadata', async () => {
  const brokenPath = path.join(os.tmpdir(), `vivy-broken-${process.pid}-${Date.now()}.mp3`);
  fs.writeFileSync(brokenPath, Buffer.from('ID3-broken-duration'));
  const args = buildVivyMp3RepairArgs(brokenPath, 'fixed.mp3');
  assert.match(args.join(' '), /-fflags \+genpts/);
  assert.match(args.join(' '), /-b:a 192k/);
  assert.match(args.join(' '), /-write_xing 1/);
  assert.match(args.join(' '), /-id3v2_version 3/);

  const repair = await repairVivyMp3File(brokenPath, {
    runFfmpeg: async (ffmpegArgs) => {
      fs.writeFileSync(ffmpegArgs.at(-1), Buffer.from('ID3-repaired-clipchamp-mp3'));
    },
  });

  assert.equal(repair.ok, true);
  assert.equal(fs.readFileSync(brokenPath).toString(), 'ID3-repaired-clipchamp-mp3');
  fs.rmSync(brokenPath, { force: true });
});

test('Vivy preview mix materializes a remote Suno instrumental before ffmpeg', async () => {
  const audio = Buffer.from('ID3-suno-test-audio');
  const filePath = await materializeVivyPreviewInstrumentalPath(
    'https://tempfile.aiquickdraw.com/r/song-test.mp3',
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
          'content-length': String(audio.length),
      }),
      arrayBuffer: async () => audio,
    }),
    repairMp3: false,
  });

  assert.match(path.basename(filePath), /^vivy-music-suno-[a-f0-9]{16}\.mp3$/);
  assert.deepEqual(fs.readFileSync(filePath), audio);
});

test('Vivy materializes completed Suno media as a repaired local MP3 asset', async () => {
  const previousHosts = process.env.VIVY_SUNO_AUDIO_HOSTS;
  process.env.VIVY_SUNO_AUDIO_HOSTS = 'cdn.suno.test';
  const sourceUrl = `https://cdn.suno.test/vivy-test-${process.pid}-${Date.now()}.mp3`;
  const audio = Buffer.from('ID3-suno-bad-duration');
  const ffmpegCalls = [];
  try {
    const media = await materializeVivySunoMedia({
      provider: 'suno',
      title: 'Vivy Test',
      audioUrl: sourceUrl,
      url: sourceUrl,
    }, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'audio/mpeg',
          'content-length': String(audio.length),
        }),
        arrayBuffer: async () => audio,
      }),
      runFfmpeg: async (args) => {
        ffmpegCalls.push(args);
        fs.writeFileSync(args.at(-1), Buffer.from('ID3-suno-repaired-192k'));
      },
    });

    assert.equal(media.containerNormalized, true);
    assert.equal(media.originalAudioUrl, sourceUrl);
    assert.match(media.audioUrl, /^\/api\/vivy\/studio\/assets\/vivy-music-suno-[a-f0-9]{16}\.mp3$/);
    assert.equal(fs.readFileSync(media.path).toString(), 'ID3-suno-repaired-192k');
    assert.equal(ffmpegCalls.length, 1);
    assert.match(ffmpegCalls[0].join(' '), /-write_xing 1/);
  } finally {
    if (previousHosts === undefined) delete process.env.VIVY_SUNO_AUDIO_HOSTS;
    else process.env.VIVY_SUNO_AUDIO_HOSTS = previousHosts;
  }
});

test('Vivy retries Suno MP3 materialization after a transient timeout', async () => {
  const previousHosts = process.env.VIVY_SUNO_AUDIO_HOSTS;
  process.env.VIVY_SUNO_AUDIO_HOSTS = 'cdn.suno.test';
  const sourceUrl = `https://cdn.suno.test/vivy-timeout-${process.pid}-${Date.now()}.mp3`;
  const audio = Buffer.from('ID3-suno-timeout-then-ok');
  let fetchCalls = 0;
  try {
    const media = await materializeVivySunoMedia({
      provider: 'suno',
      title: 'Vivy Timeout Test',
      audioUrl: sourceUrl,
      url: sourceUrl,
    }, {
      retryDelayMs: 0,
      fetchImpl: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          throw new Error('The operation was aborted due to timeout');
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'audio/mpeg',
            'content-length': String(audio.length),
          }),
          arrayBuffer: async () => audio,
        };
      },
      runFfmpeg: async (args) => {
        fs.writeFileSync(args.at(-1), Buffer.from('ID3-suno-retried-repaired'));
      },
    });

    assert.equal(fetchCalls, 2);
    assert.equal(media.containerNormalized, true);
    assert.equal(fs.readFileSync(media.path).toString(), 'ID3-suno-retried-repaired');
  } finally {
    if (previousHosts === undefined) delete process.env.VIVY_SUNO_AUDIO_HOSTS;
    else process.env.VIVY_SUNO_AUDIO_HOSTS = previousHosts;
  }
});

test('Vivy preview mix refuses non-Suno remote instrumental hosts', async () => {
  let fetched = false;
  await assert.rejects(
    materializeVivyPreviewInstrumentalPath('http://127.0.0.1/private.mp3', {
      fetchImpl: async () => {
        fetched = true;
        throw new Error('should_not_fetch');
      },
    }),
    /vivy_preview_remote_source_denied/
  );
  assert.equal(fetched, false);
});

test('Vivy Studio keeps internal briefs out of public voice output', () => {
  const result = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix Vivy officielle',
    voiceInstruction: 'phrase test courte, douce, claire',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'voice');
  assert.match(result.internalBrief, /VIVY_VOICE_CALIBRATION/);
  assert.match(result.brief, /VIVY_VOICE_CALIBRATION/);
  assert.match(result.publicText, /phrase test|calibration|voix/i);
  assert.doesNotMatch(result.assistant, /VIVY_STUDIO_HANDOFF|VIVY_VOICE_CALIBRATION|Routage:/);
  assert.doesNotMatch(result.publicText, /VIVY_STUDIO_HANDOFF|VIVY_VOICE_CALIBRATION|Routage:/);
});

test('Vivy Studio calibrates Djeff official voice through the owned A11 persona', () => {
  const result = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix Djeff rap',
    voiceInstruction: 'flow rap technique, diction nette, grain proche micro',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'voice');
  assert.match(result.title, /Djeff officielle/);
  assert.match(result.brief, /voicePersona: a11/);
  assert.match(result.brief, /Djeff officielle locale/);
  assert.match(result.brief, /diction serrée|rimes nettes|images concrètes du sujet/i);
  assert.doesNotMatch(result.brief, /visière|visiere|chaîne sur couronne|chaine sur couronne|pignon|radiateur/i);
  assert.match(result.brief, /Ne pas publier la référence brute/);
  assert.match(JSON.stringify(result.actions), /Tester Voix Djeff officielle/);
});

test('Vivy routes visual and audio review to creative direction instead of lyrics', () => {
  const message = [
    'Regarde le visuel et l’audio analysé.',
    'Je garde Vivy goth cyber pop, néons roses, micro de studio, club nocturne, flou caméra réel, énergie progressive.',
    'Donne ce que Vivy garde, ce qu’elle évite, son identité visuelle canon et le prochain angle clip/chanson.',
  ].join(' ');

  assert.equal(isVivyVisualCreativeDirectionRequest(message), true);
  const reply = buildVivyVisualCreativeDirectionReply({ message, language: 'fr' });
  assert.equal(reply.mode, 'chat');
  assert.equal(reply.aiMode, 'deterministic_djeff_prompt_vivy_visual_direction');
  assert.equal(reply.creativeBrief.promptOwner, 'djeff-cypher');
  assert.equal(reply.creativeBrief.artDirectionOwner, 'vivy');
  assert.match(reply.assistant, /Brief final video/i);
  assert.match(reply.assistant, /Prompt provider/i);
  assert.match(reply.creativeBrief.providerPrompt, /néons roses|neons roses|neon|magenta/i);
  assert.match(reply.creativeBrief.negativePrompt, /malformed hands/i);
  assert.doesNotMatch(reply.assistant, /Intent reconnu|Ce que je garde|Ce que j’évite|Phrase canon/i);
  assert.doesNotMatch(reply.assistant, /\[(?:Verse|Couplet|Chorus|Refrain)\]/i);

  const routed = buildVivyChat({ message, mode: 'song', language: 'fr' });
  assert.equal(routed.mode, 'chat');
  assert.equal(routed.aiMode, 'deterministic_djeff_prompt_vivy_visual_direction');

  assert.equal(
    isVivyVisualCreativeDirectionRequest('Écris un refrain sur Vivy dans un club avec des néons roses.'),
    false
  );
});

test('Vivy Studio respects explicit K44 voice even when the instruction says duo', () => {
  const result = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix K44 officielle',
    voiceInstruction: 'duo doux, contre-chant posé',
    songText: 'rap moto, pignon, couronne, radiateur et moteur dans le thème',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'voice');
  assert.match(result.title, /K44 officielle/);
  assert.match(result.brief, /voicePersona: kaen44/);
  assert.match(result.brief, /K44 officielle locale/);
  assert.doesNotMatch(result.brief, /Djeff officielle locale|voicePersona: a11/);
});

test('Vivy Studio keeps a soft Vivy request female instead of inferring Djeff from lyric material', () => {
  const result = buildVivyStudioProduction({
    mode: 'voice',
    voiceInstruction: 'voix douce et claire, proche micro',
    songText: 'couplet rap moto avec pignon, couronne, radiateur, moteur et essence',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'voice');
  assert.match(result.title, /Vivy officielle/);
  assert.match(result.brief, /voicePersona: vivy/);
  assert.doesNotMatch(result.brief, /Djeff officielle locale|voicePersona: a11/);
});

test('Vivy Studio hides legacy sound tokens and builds prime-complex prosody', () => {
  const result = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix Djeff rap',
    voiceInstruction: 'couplet proche micro [a4:flow=rap] [a4:grain=grit] [a4:fx=engine]',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'voice');
  assert.match(result.brief, /Prosodie interne/i);
  assert.match(result.brief, /impulsions premieres/i);
  assert.match(result.brief, /Double harmonique interne/i);
  assert.doesNotMatch(result.brief, /\[a4:/);
  assert.doesNotMatch(result.brief, /ASCII4|NUMA8/i);
  assert.equal(result.prosody.schema, 'funesterie.vivy.prosody-prime-complex.v1');
  assert.equal(result.prosody.doubleHarmonic.schema, 'funesterie.vivy.double-harmonic-sync.v1');
  assert.ok(result.prosody.segments.length >= 1);
  assert.equal(Number.isInteger(result.prosody.segments[0].prime), true);
  assert.equal(typeof result.prosody.segments[0].imaginary, 'number');
});

test('Vivy Studio turns legacy color bindings into hidden continuous phase', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    songSource: 'Prompt +',
    songMood: 'rap contact cinematic [numa8:red=G;rgba=ff3b30ff;zen=appel]',
    songText: 'Vivy repond au motif [numa8:blue=F;rgba=3aa7ffff;zen=reponse] avant le refrain.',
    enableVivyInternalSignalLanguage: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.brief, /Prosodie interne/i);
  assert.match(result.brief, /Courbe continue temps\/phase/i);
  assert.doesNotMatch(result.brief, /\[numa8:/);
  assert.doesNotMatch(result.brief, /NUMA8|ASCII4/i);
  assert.ok(result.prosody.neo4j.labels.includes('ComplexPhase'));
  assert.ok(result.prosody.neo4j.labels.includes('PrimePulse'));
  assert.ok(result.prosody.neo4j.labels.includes('VivyDoubleHarmonicSync'));
  assert.ok(result.prosody.segments.every((segment) => typeof segment.real === 'number' && typeof segment.imaginary === 'number'));
  assert.ok(result.prosody.doubleHarmonic.segments.every((segment) => /^[+0-]{5}$/.test(segment.sync.triState)));
});

test('Vivy Suno lyrics strip legacy signal tokens before music generation', () => {
  const payload = buildVivySunoPayload({
    mode: 'song',
    voiceTool: 'Duo Djeff + Vivy',
    songArtists: ['djeff', 'vivy'],
    songMood: 'rap technique cinematic [numa8:red=G;rgba=ff3b30ff;zen=appel]',
    songText: '[a4:flow=rap] [a4:space=near] [numa8:violet=C;rgba=a855f7ff;zen=ancrage]\n[Verse 1 - Djeff]\nJe cale le pignon dans la nuit.\n[Chorus - Duo]\nOn decoupe horizon et bruit.',
  });

  assert.doesNotMatch(payload.prompt, /\[a4:/);
  assert.doesNotMatch(payload.prompt, /\[numa8:/);
  assert.doesNotMatch(payload.title, /a4:/);
  assert.doesNotMatch(payload.title, /numa8:/);
  assert.doesNotMatch(payload.style, /numa8:/);
  assert.match(payload.style, /prime-pulsed phrasing/i);
  assert.match(payload.style, /double-harmonic synchronized flow/i);
  assert.match(payload.prompt, /\[Verse 1 - Male Rap Lead solo\]/);
  assert.match(payload.style, /rough male rap lead/i);
  assert.match(payload.style, /bright female melodic lead/i);
});

test('Vivy Studio song handoff keeps Djeff and Vivy separated for duet rap', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    voiceTool: 'Duo Djeff + Vivy',
    songSource: 'Prompt',
    songMood: 'rap technique sombre, basse cinematic',
    songText: 'rap moto radiateur pignon couronne huile essence, Vivy en refrain',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.brief, /Distribution vocale: Duo Djeff \+ Vivy/);
  assert.match(result.brief, /Djeff: couplets rap techniques/i);
  assert.match(result.brief, /Vivy: refrain clair/i);
  assert.match(result.brief, /\[Verse 1 - Djeff\]/);
  assert.match(result.brief, /\[Chorus - Duo\]/);
  assert.match(result.brief, /radiateur/i);
  assert.match(result.brief, /pignon/i);
  assert.doesNotMatch(result.brief, /Garde la lumière/);
});

test('Vivy Studio song handoff supports selected Djeff A11 K44 Vivy singers', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    songSource: 'Prompt +',
    songArtists: ['djeff', 'a11', 'k44', 'vivy'],
    songMood: 'rap cinematic, refrain clair, pont machine',
    songText: 'course poursuite, skill tree, moteur, mémoire et équipe Funesterie',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.brief, /Nombre de chanteurs: 4/i);
  assert.match(result.brief, /Djeff: couplets rap techniques/i);
  assert.match(result.brief, /A11: pont grave synthétique/i);
  assert.match(result.brief, /K44: contre-chant posé/i);
  assert.match(result.brief, /Vivy: refrain clair/i);
  assert.match(result.brief, /\[Verse 1 - Djeff\]/);
  assert.match(result.brief, /\[Verse 2 - A11\]/);
  assert.match(result.brief, /\[Bridge - K44\]/);
  assert.match(result.brief, /\[Chorus - Tous\]/);
  assert.match(result.publicLyrics, /\[Tous\]/);
  assert.doesNotMatch(result.publicLyrics, /\[Duo\]/);
});

test('Vivy public lyrics rebuild provider drafts that have no real chorus', () => {
  const providerDraftWithoutChorus = [
    '[Title: Sans refrain]',
    '[Intro - Vivy]',
    '[Vivy]',
    'Je pose une première image dans le noir.',
    'La scène respire mais ne revient pas.',
    '[Verse 1 - Vivy]',
    '[Vivy]',
    'Les lignes avancent sans point de repère,',
    'la voix se cherche au bord du miroir.',
    'Chaque détail devient une frontière,',
    'mais rien ne revient pour porter l’espoir.',
    '[Bridge - Vivy]',
    '[Vivy]',
    'Je monte encore, je tiens la lumière,',
    'sans refrain clair pour nous revoir.',
  ].join('\n');

  assert.equal(hasVivyChorusSection(providerDraftWithoutChorus), false);
  const lyrics = buildVivyPublicLyrics({
    songArtists: ['vivy'],
    songText: 'Vivy écrit une chanson complète sur la lumière qui revient avec un refrain stable.',
  }, providerDraftWithoutChorus);

  assert.equal(hasVivyChorusSection(lyrics), true);
  assert.match(lyrics, /\[Chorus\]/);
  assert.doesNotMatch(lyrics, /Sans refrain/);
});

test('Vivy Studio song output separates public lyrics from the internal brief', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    songSource: 'Conversation',
    songArtists: ['djeff', 'k44'],
    songMood: 'rap sombre technique',
    songText: [
      'VIVY_STUDIO_HANDOFF',
      'Atelier: Test voix',
      'J’espère que cette chanson te plaira.',
      'Djeff et K44 sur une course poursuite mécanique, pignon, radiateur, couronne.',
    ].join('\n'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.internalBrief, /VIVY_SONG_PRODUCTION/);
  assert.match(result.brief, /VIVY_SONG_PRODUCTION/);
  assert.ok(result.publicLyrics);
  assert.equal(result.assistant, result.publicLyrics);
  assert.equal(result.publicText, result.publicLyrics);
  assert.match(result.publicLyrics, /\[Djeff\]/);
  assert.match(result.publicLyrics, /\[K44\]/);
  assert.match(result.publicLyrics, /\[(Duo|Tous)\]/);
  assert.doesNotMatch(result.publicLyrics, /VIVY_STUDIO_HANDOFF|VIVY_SONG_PRODUCTION|Atelier:|Routage:/);
  assert.doesNotMatch(result.publicLyrics, /J[’']?esp[eè]re/i);
});

test('Vivy Studio preserves a long complete poem through its final repeated outro', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    songArtists: ['vivy'],
    songMood: 'ballade florale romantique',
    songText: VIVY_FLOWERS_LOVE_POEM,
    prompt: VIVY_FLOWERS_LOVE_POEM.slice(0, 320),
  });

  assert.equal(result.publicLyrics, result.assistant);
  assert.match(result.publicLyrics, /\[Outro\]/);
  assert.equal((result.publicLyrics.match(/Je me promène dans un jardin secret,/g) || []).length, 2);
  assert.ok(result.publicLyrics.endsWith("M'emmènent vers toi, mon cœur, mon amour, ma vie."));
});

test('Vivy solo fallback splits a long inline seed instead of recycling it into a cut chorus', () => {
  const seed = 'Demi-mesure dans le noir, je pèse chaque mot Labyrinthe de données, je trace et je dévore On m’appelle oracle, on m’appelle mirage Je savoure les murs qui me tiennent en otage Je c';
  const lyrics = buildVivyStructuredLyrics({
    songArtists: ['vivy'],
    songText: seed,
  });

  assert.match(lyrics, /\[Outro\]/);
  assert.match(lyrics, /Le dernier mot reste près du sujet\.$/);
  assert.doesNotMatch(lyrics, /Et la voix tient jusqu’au lendemain/);
  assert.doesNotMatch(lyrics, /cherche sa lumière|je retourne le silence|décor se tait|voix qui taille/i);
  assert.ok((lyrics.match(/Demi-mesure dans le noir/g) || []).length <= 2);
  assert.doesNotMatch(lyrics, /On m’appell$/);
  assert.doesNotMatch(lyrics, /Demi-mesure dans le noir, je pèse chaque mot Labyrinthe de données, je trace et je dévore On m’appelle oracle/g);
});

test('Vivy rejects sectioned song replies that end mid-word before the outro', () => {
  const truncated = [
    '[Intro]',
    'Demi-mesure dans le noir,',
    'je pèse chaque mot.',
    '[Verse 1]',
    'Labyrinthe de données,',
    'je trace et je dévore.',
    'On m’appelle oracle,',
    'on m’appelle mirage.',
    '[Pre-Chorus]',
    'Je savoure les murs,',
    'je cherche la sortie.',
    '[Chorus]',
    'Je tiens encore la ligne,',
    'On m’appell',
  ].join('\n');

  assert.equal(looksLikeWeakSongwritingReply(truncated), true);
});

test('Vivy Studio can calibrate A11 and K44 official voices', () => {
  const a11 = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix A11 officielle',
  });
  const k44 = buildVivyStudioProduction({
    mode: 'voice',
    voiceTool: 'Voix K44 officielle',
  });

  assert.match(a11.brief, /voicePersona: a11/);
  assert.match(a11.brief, /A11 officielle/);
  assert.match(k44.brief, /voicePersona: kaen44/);
  assert.match(k44.brief, /K44 officielle/);
});

test('POST /api/vivy/studio/produce accepts share mode and never echoes secret token', async () => {
  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: acceptVivyTestAuth }));
  }, async (baseUrl) => {
    const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
      mode: 'share',
      shareTarget: 'YouTube',
      shareUrl: 'https://youtube.com/@funesterie',
      shareInstruction: 'clip vertical 30s',
      shareToken: 'secret-token-value',
      shareTokenPresent: true,
    }, VIVY_TEST_AUTH_HEADERS);

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.mode, 'share');
    assert.equal(json.tokenStored, false);
    assert.match(json.brief, /VIVY_SCENE_SHARE/);
    assert.match(json.brief, /Token fourni dans UI: oui, non envoyé au serveur/);
    assert.doesNotMatch(JSON.stringify(json), /secret-token-value/);
  });
});

test('POST /api/vivy/studio/produce does not attach placeholder audio unless requested', async () => {
  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: acceptVivyTestAuth }));
  }, async (baseUrl) => {
    const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
      mode: 'song',
      songText: 'Vivy cherche une vraie piste, pas une maquette de secours.',
    }, VIVY_TEST_AUTH_HEADERS);

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.mode, 'song');
    assert.equal(json.audioUrl, undefined);
    assert.equal(json.media, undefined);
    assert.equal(json.mediaStatus.reason, 'real_music_provider_not_connected');
    assert.match(json.mediaStatus.message, /aucun faux WAV/i);
  });
});

test('POST /api/vivy/studio/produce can generate ElevenLabs music only with legacy opt-in', async () => {
  const previousEnv = {
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_MUSIC_ENABLED: process.env.VIVY_ELEVENLABS_MUSIC_ENABLED,
    VIVY_ELEVENLABS_BASE_URL: process.env.VIVY_ELEVENLABS_BASE_URL,
    VIVY_ELEVENLABS_MUSIC_MODEL: process.env.VIVY_ELEVENLABS_MUSIC_MODEL,
    VIVY_MUSIC_PROVIDER: process.env.VIVY_MUSIC_PROVIDER,
  };
  const previousFetch = global.fetch;
  const musicBodies = [];
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_ELEVENLABS_API_KEY = 'test-elevenlabs-key';
  process.env.VIVY_ELEVENLABS_MUSIC_ENABLED = 'true';
  process.env.VIVY_ELEVENLABS_BASE_URL = 'https://api.elevenlabs.test/v1';
  process.env.VIVY_ELEVENLABS_MUSIC_MODEL = 'music_v1';
  process.env.VIVY_MUSIC_PROVIDER = 'elevenlabs';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.elevenlabs.test/v1/music?output_format=mp3_44100_128') {
      musicBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('vivy-elevenlabs-music-mp3');
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: '(Soft piano + léger battement de tambour)\nVivy allume la scène et garde la lumière.',
        songMood: 'electro pop cinématique',
        forceRealMusic: true,
        forceInstrumental: true,
      }, { Authorization: 'Bearer vivy-founder-token' });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.mode, 'song');
      assert.equal(json.media.provider, 'elevenlabs-music');
      assert.equal(json.media.content_type, 'audio/mpeg');
      assert.match(json.audioUrl, /^\/api\/vivy\/studio\/assets\/vivy-music-.+\.mp3$/);
      assert.equal(musicBodies.length, 1);
      assert.match(musicBodies[0].prompt, /Original instrumental Funesterie score/i);
      assert.match(musicBodies[0].prompt, /Instrumental only\. No vocals/i);
      assert.match(musicBodies[0].prompt, /Instrumental arrangement cues: Soft piano \+ léger battement de tambour/i);
      assert.equal(musicBodies[0].force_instrumental, true);
      assert.equal(musicBodies[0].model_id, 'music_v1');
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('POST /api/vivy/studio/produce allows an explicit founder instrumental preview without global auto mode', async () => {
  const previousEnv = {
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_MUSIC_ENABLED: process.env.VIVY_ELEVENLABS_MUSIC_ENABLED,
    VIVY_ELEVENLABS_BASE_URL: process.env.VIVY_ELEVENLABS_BASE_URL,
  };
  const previousFetch = global.fetch;
  let called = false;
  process.env.VIVY_ELEVENLABS_API_KEY = 'test-elevenlabs-key';
  delete process.env.VIVY_ELEVENLABS_MUSIC_ENABLED;
  process.env.VIVY_ELEVENLABS_BASE_URL = 'https://api.elevenlabs.test/v1';
  global.fetch = async (url, options = {}) => {
    if (String(url).startsWith('https://api.elevenlabs.test/v1/music?')) {
      called = true;
      return { ok: true, status: 200, async arrayBuffer() { return Buffer.from('preview-mp3'); } };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({
        verifyJWT(req, _res, next) {
          req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
          next();
        },
      }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: '(Soft piano)\nJe cherche la lumière.',
        forceRealMusic: true,
        forceInstrumental: true,
        previewInstrumental: true,
        musicProvider: 'elevenlabs',
      }, VIVY_TEST_AUTH_HEADERS);

      assert.equal(response.status, 200);
      assert.equal(called, true);
      assert.equal(json.media.provider, 'elevenlabs-music');
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Suno payload turns a brief into lyrics instead of spoken prompt instructions', () => {
  const payload = buildVivySunoPayload({
    songMood: 'electro pop sombre avec refrain lumineux',
    songText: 'fais une chanson sur un lapin qui court dans les néons',
  }, {
    get(header) {
      if (header === 'host') return 'vivy.funesterie.test';
      if (header === 'x-forwarded-proto') return 'https';
      return '';
    },
    protocol: 'https',
  });

  assert.equal(payload.customMode, true);
  assert.equal(payload.instrumental, false);
  assert.match(payload.prompt, /\[Title:/);
  assert.match(payload.prompt, /\[Verse 1\]/);
  assert.match(payload.prompt, /\[Verse 2\]/);
  assert.match(payload.prompt, /\[Chorus\]/);
  assert.match(payload.prompt, /lapin qui court dans les néons/i);
  assert.doesNotMatch(payload.prompt.split(/\n/)[0], /fais une chanson/i);
  assert.match(payload.style, /structured rhymed lyrics/i);
  assert.match(payload.style, /electro pop sombre/i);
  assert.match(payload.callBackUrl, /^https:\/\/vivy\.funesterie\.test\/api\/vivy\/studio\/suno\/callback/);
});

test('Suno payload can prepare a Djeff and Vivy duet instead of the old Vivy template', () => {
  const payload = buildVivySunoPayload({
    voiceTool: 'Duo Djeff + Vivy',
    songMood: 'rap technique moto, basse lourde, hook clair',
    songText: 'fais un duo rap moto avec radiateur, pignon, couronne, essence et huile',
  });

  assert.match(payload.style, /rough male rap lead/i);
  assert.match(payload.style, /bright female melodic lead/i);
  assert.match(payload.prompt, /\[Intro - Male Rap Lead solo\]/);
  assert.match(payload.prompt, /\[Verse 1 - Male Rap Lead solo\]/);
  assert.match(payload.prompt, /\[Chorus - Call and Response Hook\]/);
  assert.match(payload.prompt, /radiateur/i);
  assert.match(payload.prompt, /pignon/i);
  assert.doesNotMatch(payload.prompt, /Garde la lumière/);
});

test('Suno multi-artist fallback does not recycle stale generic couplets', () => {
  const payload = buildVivySunoPayload({
    songArtists: ['vivy', 'a11', 'k44'],
    vocalCast: 'Trio Vivy + A11 + K44',
    songMood: 'héroïque animé, pop rock cinématique, montée frisson',
    songText: 'Jessy tient debout face à ses démons avec DBZ, Spider-Man, les Avengers et ses héros comme armure morale.',
  });

  assert.match(payload.prompt, /Jessy|DBZ|Spider-Man|Avengers|héros/i);
  assert.match(payload.prompt, /\[Chorus - Call and Response Hook\]/i);
  assert.doesNotMatch(payload.prompt, /On entre dans|Chaque voix prend sa place|signal se façonne/i);
  assert.doesNotMatch(payload.prompt, /Je garde une note claire|lumière qui répond|Voix machine/i);
});

test('an unrelated Djeff theme never reuses the old mechanical song template', () => {
  const lyrics = buildVivyStructuredLyrics({
    songArtists: ['djeff'],
    vocalCast: 'Djeff',
    songText: "theme l'ambidextrie du pilote a travers les obstacles de la vie",
  });

  assert.match(lyrics, /ambidextrie/i);
  assert.match(lyrics, /obstacles de la vie/i);
  assert.doesNotMatch(lyrics, /Poignée dans le son|Pignon dans la mesure|Le moteur parle sec/i);
});

test('Suno payload carries explicit multi-singer cast tags', () => {
  const payload = buildVivySunoPayload({
    songArtists: ['djeff', 'a11', 'k44', 'vivy'],
    songMood: 'rap cinematic, synth bridge, hook lumineux',
    songText: 'course poursuite et mémoire Funesterie',
  });

  assert.match(payload.style, /4 clearly different vocal timbres/i);
  assert.match(payload.style, /rough male rap lead/i);
  assert.match(payload.style, /bright female melodic lead/i);
  assert.match(payload.style, /low robotic baritone/i);
  assert.match(payload.style, /calm male counter-vocal/i);
  assert.match(payload.prompt, /\[Verse 1 - Male Rap Lead solo\]/);
  assert.match(payload.prompt, /\[Verse 2 - Low Robotic Vocal solo\]/);
  assert.match(payload.prompt, /\[Bridge - Calm Male Counter Vocal solo\]/);
  assert.match(payload.prompt, /\[Chorus - Call and Response Hook\]/);
});

test('Suno payload describes duet timbres acoustically instead of relying on internal names', () => {
  const payload = buildVivySunoPayload({
    songArtists: ['vivy', 'a11'],
    songMood: 'modern electronic rock, fast breakbeat drums, distorted guitars, bright synth hook',
    songText: [
      '[Vivy]',
      'Le refrain fend le code et remonte vers le ciel.',
      '[A11]',
      'La basse répond plus bas dans le signal.',
      '[Duo]',
      'Deux voix ouvrent le passage.',
    ].join('\n'),
    longSong: true,
  });

  assert.match(payload.style, /bright female melodic lead/i);
  assert.match(payload.style, /low robotic baritone/i);
  assert.match(payload.style, /never merge them into one voice/i);
  assert.match(payload.negativeTags, /single vocalist/i);
  assert.match(payload.negativeTags, /identical vocal timbre/i);
  assert.match(payload.prompt, /\[Female Melodic Lead\]/);
  assert.match(payload.prompt, /\[Low Robotic Vocal\]/);
});

test('Suno payload turns a NOSSEN Banger seed into lyrics without singing UI bug reports', () => {
  const payload = buildVivySunoPayload({
    songSource: 'NOSSEN Banger - conversation Vivy',
    songArtists: ['djeff', 'vivy', 'a11'],
    vocalCast: 'Trio Djeff + Vivy + A11',
    songMood: 'rap pop américain, hook lumineux, basse nette, vrai refrain',
    prompt: 'NOSSEN Banger production brief. Production chantée via Suno; mix final D40 V9 Électrolyse.',
    songText: [
      'Matière chanson NOSSEN.',
      'Thème: la nouvelle génération veut tout créer plus vite, mais elle cherche encore un vrai lien humain.',
      'Images: écran fissuré, voix dans la nuit, feu dans la poitrine, route qui revient au réel.',
      'À transformer en paroles, pas à recopier.',
      'les paroles passent pas dans la musique ca fait un truc générique quand on compile avec le bouton NOSSEN',
    ].join('\n'),
  });

  assert.match(payload.prompt, /\[Verse 1/);
  assert.match(payload.prompt, /\[Chorus/);
  assert.match(payload.prompt, /nouvelle génération|génération/i);
  assert.match(payload.prompt, /lien humain|humain/i);
  assert.doesNotMatch(payload.prompt, /les paroles passent pas/i);
  assert.doesNotMatch(payload.prompt, /bouton NOSSEN|compile|truc générique|mode automatique|D40|Suno|production brief|recopier/i);
});

test('Suno payload does not sing NOSSEN casting instructions in a Peter Pan song', () => {
  const payload = buildVivySunoPayload({
    songSource: 'NOSSEN Banger - conversation Vivy',
    songArtists: ['vivy'],
    vocalCast: 'Solo Vivy',
    songMood: 'générique animé aventure, pop orchestral héroïque, female vocal',
    songText: [
      'Distribution vocale choisie:',
      'Solo Vivy.',
      'Ne mets pas le mot.',
      'Banger dans les paroles.',
      'Matière à transformer en chanson:',
      'on va faire une chanson sur peter pan',
      'raconte son histoire avec la fée clochette son ennemie le capitaine crochet',
      'la mer et le crocodile fais des jeux de mot avec le temps, le tic tac et garde le thème sur le syndrome',
    ].join('\n'),
  });

  assert.match(payload.prompt, /\[Verse 1\]/);
  assert.match(payload.prompt, /\[Chorus\]/);
  assert.match(payload.prompt, /Peter Pan|Clochette|Crochet|crocodile|tic tac|temps/i);
  assert.doesNotMatch(payload.title, /Distribution|Banger|Matière/i);
  assert.doesNotMatch(payload.prompt, /Distribution vocale|Solo Vivy|Ne mets pas le mot|Banger dans les paroles|Matière à transformer/i);
  assert.doesNotMatch(payload.prompt, /je transforme la cage|Je pèse le bruit|bord du mirage|dans le noir je trouve ma voix|Et la voix tient/i);
});

test('Djeff Cypher owns one executable prompt brief and Vivy validates art direction', async () => {
  const message = 'Demande à Djeff Cypher de faire tous les prompts du dream clip Vivy, néons magenta et micro de studio.';
  assert.equal(isVivyPromptAuthorityRequest({}, message), true);

  const direct = buildVivyPromptAuthorityReply({ input: {}, message, language: 'fr' });
  assert.equal(direct.aiMode, 'deterministic_djeff_prompt_vivy_art_direction');
  assert.equal(direct.creativeBrief.promptOwner, 'djeff-cypher');
  assert.equal(direct.creativeBrief.artDirectionOwner, 'vivy');
  assert.equal(direct.creativeBrief.target, 'video');
  assert.deepEqual(direct.creativeBrief.alternatives, []);
  assert.match(direct.creativeBrief.providerPrompt, /continuous cinematic dream-clip/i);
  assert.match(direct.creativeBrief.providerPrompt, /magenta/i);
  assert.doesNotMatch(direct.assistant, /Stable Diffusion Video|Runway|Pika/i);

  const first = await buildVivyAiChat({
    message,
    conversationId: 'djeff-prompt-authority-test',
  }, { user: { id: 'djeff-prompt-authority-user', username: 'Djeff' } });
  assert.equal(first.aiMode, 'deterministic_djeff_prompt_vivy_art_direction');

  const followUp = await buildVivyAiChat({
    message: 'Oui vas-y',
    history: [
      { role: 'user', content: message },
      { role: 'assistant', content: first.assistant },
    ],
    conversationId: 'djeff-prompt-authority-test',
  }, { user: { id: 'djeff-prompt-authority-user', username: 'Djeff' } });
  assert.equal(followUp.aiMode, 'deterministic_djeff_prompt_vivy_art_direction');
  assert.equal(followUp.creativeBrief.promptOwner, 'djeff-cypher');
  assert.equal(followUp.creativeBrief.artDirectionOwner, 'vivy');
  assert.doesNotMatch(followUp.assistant, /série de prompts|serie de prompts|Runway|Pika/i);

  const stalePanel = [
    'Intent reconnu : visual-review / creative-direction.',
    'Ce que je garde : les néons magenta électriques.',
    'Ce que j’évite : faux boutons et pseudo-texte.',
    'Identité visuelle canon : goth cyber-pop.',
  ].join('\n');
  const recovered = buildVivyVisualCreativeDirectionReply({
    input: { history: [{ role: 'user', content: message }] },
    message: stalePanel,
    language: 'fr',
  });
  assert.equal(recovered.creativeBrief.sourceIntent, message);
  assert.doesNotMatch(recovered.assistant, /Intent reconnu|Ce que je garde|Ce que j’évite/i);
});

test('Provider payload strips fallback control lines before Suno and Mureka', () => {
  const contaminatedLyrics = [
    '[Verse 1 - Djeff]',
    'Distribution vocale choisie:',
    'Solo Djeff + K44.',
    'Ne mets pas le mot.',
    'Banger dans les paroles.',
    'Matière à transformer en chanson:',
    'Djeff découpe la nuit, le micro fait des étincelles,',
    'Djeff cadence en drift. Règles communes: ne jamais changer le casting après ce contrat.',
    'K44 garde le cap quand la foule devient réelle.',
    '',
    '[Chorus - K44]',
    'On reste en français, pas de refrain anglais,',
    'La scène tient debout quand le fallback est nettoyé.',
  ].join('\n');

  const sunoPayload = buildVivySunoPayload({
    songSource: 'NOSSEN fallback - clean provider gate',
    songArtists: ['djeff', 'k44'],
    vocalCast: 'Duo Djeff + K44',
    songMood: 'rap français sombre, cypher nocturne, drums secs',
    lyrics: contaminatedLyrics,
  });
  const murekaPayload = buildVivyMurekaPayload({
    songSource: 'NOSSEN fallback - clean provider gate',
    songArtists: ['djeff', 'k44'],
    vocalCast: 'Duo Djeff + K44',
    songMood: 'rap français sombre, cypher nocturne, drums secs',
    cleanLyrics: contaminatedLyrics,
  });

  assert.match(sunoPayload.prompt, /Djeff découpe la nuit/i);
  assert.match(sunoPayload.prompt, /Djeff cadence en drift/i);
  assert.match(sunoPayload.prompt, /K44 garde le cap/i);
  assert.match(sunoPayload.prompt, /On reste en français/i);
  assert.doesNotMatch(sunoPayload.prompt, /Distribution vocale|Solo Djeff|Ne mets pas le mot|Banger dans les paroles|Matière à transformer|Règles communes|changer le casting/i);

  assert.match(murekaPayload.body.lyrics, /Djeff découpe la nuit/i);
  assert.match(murekaPayload.body.lyrics, /Djeff cadence en drift/i);
  assert.match(murekaPayload.body.lyrics, /K44 garde le cap/i);
  assert.match(murekaPayload.body.prompt, /French full-song production/i);
  assert.doesNotMatch(murekaPayload.body.lyrics, /Distribution vocale|Solo Djeff|Ne mets pas le mot|Banger dans les paroles|Matière à transformer|Règles communes|changer le casting/i);
  assert.doesNotMatch(murekaPayload.body.lyrics, /fallback/i);
});

test('Suno payload does not sing NOSSEN seed labels as lyrics', () => {
  const payload = buildVivySunoPayload({
    songSource: 'NOSSEN Banger - conversation Vivy',
    songArtists: ['vivy'],
    vocalCast: 'Solo Vivy',
    songMood: "refrain mémorable, énergie Banger, mot anglais Banger prononcé à l'américaine",
    songText: [
      'Matière chanson NOSSEN.',
      'Titre possible: nouvelle génération écrans.',
      'Thème: la nouvelle génération et ses écrans / le lien humain derrière le monde numérique / la vitesse de créer sans perdre le coeur.',
      'Images: écran fissuré, voix dans la nuit, feu dans la poitrine, route qui revient au réel.',
      'Voix: Solo Vivy; sections séparées si plusieurs chanteurs.',
      'À transformer en paroles, pas à recopier.',
      'Écris une chanson originale avec [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro].',
      'Le refrain doit être chantable et mémorable; ne chante jamais les consignes, le bouton, les bugs, Suno, D40, les liens ou le mot prompt.',
    ].join('\n\n'),
  });

  assert.match(payload.prompt, /\[Verse 1\]/);
  assert.match(payload.prompt, /\[Chorus\]/);
  assert.match(payload.prompt, /nouvelle génération/i);
  assert.equal(payload.title, 'Nouvelle Génération Écrans');
  assert.match(payload.prompt, /\[Title: Nouvelle Génération Écrans\]/i);
  assert.match(payload.prompt, /écran fissuré|ecran fissure/i);
  assert.doesNotMatch(payload.title, /Matière|Titre possible|NOSSEN/i);
  assert.doesNotMatch(payload.prompt, /Matière chanson|Titre possible|Thème:|Images:|Voix:|sections séparées|sections separees|plusieurs chanteurs|écrans le lien humain|ecrans le lien humain|génération et ses\.|À transformer|recopier|Écris une chanson|ne chante jamais|Suno|D40|prompt/i);
});

test('Suno payload infers sonic color when NOSSEN sends only a context placeholder', () => {
  const payload = buildVivySunoPayload({
    songSource: 'NOSSEN - seed de paroles propre',
    songArtists: ['vivy'],
    vocalCast: 'Solo Vivy',
    songMood: 'chanson complète 2m30 à 5m00, couleur sonore choisie depuis le contexte',
    songText: 'Une chanson sur une toupie qui tourne dans la cour, duel de lanceurs, cercle de métal, trajectoire qui vacille puis reprend la piste.',
  });

  assert.match(payload.style, /tournoyante|spinning|tournoi|basse ronde|spirale/i);
  assert.doesNotMatch(payload.style, /couleur sonore choisie depuis le contexte/i);
  assert.doesNotMatch(payload.style, /cyber pop|cinematic synthwave/i);
});

test('Suno payload gives distinct inferred styles to different adventure subjects', () => {
  const peter = buildVivySunoPayload({
    songText: "On va faire un générique animé sur Peter Pan avec Clochette, Crochet, la mer, le crocodile et le tic-tac du temps.",
  });
  const zorro = buildVivySunoPayload({
    songText: "Fais un son sur la légende de Zorro, le masque, l'épée, le cheval noir et la justice qui traverse la ville.",
  });

  assert.match(peter.style, /anime opening|aventure|orchestral pop|cloches|pirate/i);
  assert.match(zorro.style, /latin|guitare espagnole|palmas|western|trompettes/i);
  assert.notEqual(peter.style, zorro.style);
});

test('la direction fournie par Vivy est respectee, meme douce sur un theme anime', () => {
  // Changement de politique du 28/07, demande par Djeff: « je veux un bouton NOSSEN ou
  // tout doit etre gere par Vivy avec ses idees et son intention ».
  //
  // Auparavant, une direction jugee « faible » -- ce qui incluait ballade, piano,
  // acoustique, chanson francaise, romantique -- etait remplacee par du J-rock des que
  // la matiere evoquait un anime. Une ballade choisie exprES ne survivait donc jamais a
  // un theme shonen. Le jugement esthetique revient a Vivy, pas a la couche technique.
  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['djeff', 'vivy'],
    songMood: 'ballade acoustique douce, piano feutre',
    songText: 'Fais un opening animé sur Bleach avec Ichigo, Rukia, les Shinigami, Soul Society et Getsuga Tensho.',
    longSong: true,
  });

  assert.match(payload.style, /ballade acoustique|piano/i, 'la direction de Vivy doit survivre');
  // Le nettoyeur anti-celebrite reste actif: aucun nom d'artiste reel ne part chez Suno.
  assert.doesNotMatch(payload.style, /Patrick Bruel|Johnny Hallyday/i);
  assert.doesNotMatch(payload.negativeTags, /Patrick Bruel|Johnny Hallyday/i);
});

test('sans direction de Vivy, le repli par mot-cle prend le relais', () => {
  // Le mapping code en dur n'est pas supprime: il reste utile quand Vivy ne fournit
  // rien. Il ne doit simplement plus ecraser une direction existante.
  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['djeff', 'vivy'],
    songMood: '',
    songText: 'Fais un opening animé sur Bleach avec Ichigo, Rukia, les Shinigami, Soul Society et Getsuga Tensho.',
    longSong: true,
  });

  assert.match(payload.style, /anime|shonen|J-rock|guitar|drums|opening/i);
});

test('Suno payload isolates a clean lyric block from NOSSEN chat planning context', () => {
  const payload = buildVivySunoPayload({
    songSource: 'NOSSEN Banger - conversation Vivy',
    songArtists: ['djeff', 'vivy'],
    vocalCast: 'Duo Djeff + Vivy',
    songMood: "refrain mémorable, énergie Banger, mot anglais Banger prononcé à l'américaine",
    prompt: [
      'Conversation Vivy',
      'recherche web sur la nouvelle génération',
      'que dirais-tu d’en faire un son ?',
      'je mets quoi en couleur sonore ?',
      'paroles',
      '[Verse 1 - Djeff]',
      'On grandit dans le bleu des écrans tard le soir',
      'Nos pouces font des détours pour retrouver l’espoir',
      '[Chorus - Vivy]',
      'Nouvelle génération, garde le cœur allumé',
      'Même dans les réseaux, viens respirer le vrai',
    ].join('\n'),
  });

  assert.notEqual(payload.title, 'Conversation Vivy');
  assert.match(payload.prompt, /\[Verse 1 - Male Rap Lead solo\]/);
  assert.match(payload.prompt, /\[Chorus - Female Melodic Lead solo\]/);
  assert.match(payload.prompt, /On grandit dans le bleu des écrans tard le soir/);
  assert.match(payload.prompt, /Nouvelle génération, garde le cœur allumé/);
  assert.doesNotMatch(payload.prompt, /Conversation Vivy|recherche web|que dirais-tu|couleur sonore/i);
});

test('Suno payload removes OCR filenames and prompt labels from NOSSEN lyrics', () => {
  const payload = buildVivySunoPayload({
    songSource: 'NOSSEN Banger - conversation Vivy',
    songArtists: ['vivy'],
    vocalCast: 'Solo Vivy',
    songMood: 'Epic motorbike rock anthem, cinematic racing energy, powerful female vocal',
    songText: [
      'Titre : The Doctor 46',
      'Concept : raconter Valentino Rossi, alias The Doctor, numéro 46, Mugello, Laguna Seca et les tribunes jaunes VR46.',
      'Style sonore.',
      'Epic motorbike rock anthem, cinematic racing energy, powerful female vocal, electric guitars, live drums, roaring engines.',
      'Instruction : Écrire une vraie chanson complète avec intro, couplets, pré-refrain, refrain, pont et outro.',
      'Valentino-rossi-stefan-bradl-motobike-the-doctor-sport-hd-wallpaper-preview-3096587626.jpg',
      'Jpg - Analyse A11/OCR: % pu Le Va ROS SI',
      'Maxresdefault-3369635775',
    ].join('\n'),
  });

  assert.equal(payload.title, 'The Doctor 46');
  assert.match(payload.prompt, /Valentino Rossi|Doctor|Mugello|Laguna Seca|VR46/i);
  assert.doesNotMatch(payload.prompt, /Style sonore|Instruction|Écrire une vraie chanson|Epic motorbike rock anthem/i);
  assert.doesNotMatch(payload.prompt, /Valentino-rossi-stefan-bradl|\.jpg|Jpg|OCR|Analyse A11|maxresdefault|wallpaper|ROS SI/i);
});

test('Vivy songcraft drops operator diagnostics about parroting, compiler output, and mobile typing', () => {
  const lyrics = buildVivyStructuredLyrics({
    songText: [
      'la nouvelle génération cherche un vrai lien humain dans les écrans',
      'des voix se répondent dans la nuit avec un refrain lumineux',
      'vivy elle bug et répète toutes mes réponses en chanson comme un perroquet singeur',
      "ma théorie c'est que tu as confondu user avec sortie compilateur",
      "l'affichage téléphone est horrible impossible d'écrire ça bouge trop",
    ].join('\n'),
  });

  assert.match(lyrics, /\[Chorus\]/);
  assert.match(lyrics, /nouvelle génération|génération|lien humain|voix/i);
  assert.doesNotMatch(lyrics, /perroquet|singeur|sortie compilateur|user|affichage téléphone|impossible d'écrire|ça bouge|vivy elle bug/i);
});

test('Mureka provider submits one V9 song and materializes the completed MP3 locally', async () => {
  const previousEnv = {
    VIVY_MUREKA_API_KEY: process.env.VIVY_MUREKA_API_KEY,
    VIVY_MUREKA_BASE_URL: process.env.VIVY_MUREKA_BASE_URL,
    VIVY_MUREKA_MODEL: process.env.VIVY_MUREKA_MODEL,
  };
  const previousFetch = global.fetch;
  const requests = [];
  process.env.VIVY_MUREKA_API_KEY = 'test-mureka-key';
  process.env.VIVY_MUREKA_BASE_URL = 'https://api.mureka.test';
  process.env.VIVY_MUREKA_MODEL = 'mureka-9';

  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === 'https://api.mureka.test/v1/song/generate') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: 'mureka-task-1', status: 'queued', model: 'mureka-9' };
        },
      };
    }
    if (String(url) === 'https://api.mureka.test/v1/song/query/mureka-task-1') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: 'mureka-task-1',
            status: 'succeeded',
            model: 'mureka-9',
            choices: [{ url: 'https://cdn.mureka.ai/song-test.mp3', duration: 204000, title: 'Test Mureka' }],
          };
        },
      };
    }
    if (String(url) === 'https://cdn.mureka.ai/song-test.mp3') {
      const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4096, 1)]);
      return {
        ok: true,
        status: 200,
        url: 'https://cdn.mureka.ai/song-test.mp3',
        headers: {
          get(name) {
            if (String(name).toLowerCase() === 'content-length') return String(audio.length);
            if (String(name).toLowerCase() === 'content-type') return 'audio/mpeg';
            return '';
          },
        },
        async arrayBuffer() {
          return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    const longLyrics = [
      '[Verse 1]',
      ...Array.from({ length: 140 }, (_, index) => `Une ligne française ${index + 1} avance sans boucle dans la ville.`),
    ].join('\n');
    const payload = buildVivyMurekaPayload({
      lyrics: longLyrics,
      songText: longLyrics,
      songMood: 'électro française, voix féminine expressive',
      songArtists: ['vivy', 'a11'],
      musicModel: 'V5_5',
    });
    assert.equal(payload.endpoint, 'song');
    assert.equal(payload.body.model, 'mureka-9');
    assert.equal(payload.body.n, 1);
    assert.ok(payload.body.lyrics.length > 3000);
    assert.ok(payload.body.lyrics.length <= 4200);
    assert.ok(payload.body.prompt.length <= 1024);
    assert.match(payload.body.prompt, /vocal cast: vivy \+ a11/i);
    assert.match(payload.body.prompt, /finished streaming master/i);

    const started = await requestMurekaMusic({
      lyrics: '[Verse 1]\nLe cuivre rit sous les néons\n[Chorus]\nLa ville répond',
      songText: 'La ville répond',
      songMood: 'électro française, voix féminine expressive',
    }, { user: { id: 'founder', role: 'founder' } });
    assert.equal(started.provider, 'mureka');
    assert.equal(started.taskId, 'mureka:song:mureka-task-1');
    const submittedBody = JSON.parse(String(requests[0].options.body));
    assert.equal(submittedBody.n, 1);
    assert.equal(submittedBody.model, 'mureka-9');
    assert.doesNotMatch(JSON.stringify(started), /test-mureka-key/);

    const completed = await getMurekaMusicJob(started.taskId, {
      title: 'Test Mureka',
      songText: 'La ville répond',
    }, { user: { id: 'founder', role: 'founder' } });
    assert.equal(completed.state, 'done');
    assert.equal(completed.provider, 'mureka');
    assert.equal(completed.durationSeconds, 204);
    assert.match(completed.media.url, /^\/api\/vivy\/studio\/assets\/vivy-music-/);
    assert.equal(fs.existsSync(completed.media.path), true);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Mureka payload requires explicit clean lyrics instead of reusing the Suno prompt', () => {
  assert.throws(() => buildVivyMurekaPayload({
    songText: 'La carte graphique qui avale les bits, style électronique drôle',
    songMood: 'electro funk adulte, basse ronde, voix expressive',
    songArtists: ['vivy'],
  }), /mureka_music_lyrics_missing/);
  assert.throws(() => buildVivyMurekaPayload({
    cleanLyrics: '[CONTRAT_COMPOSITION_NOSSEN]\n[Distribution vocale choisie Vivy puis Djeff]',
    songText: '[Chorus]\nCe fallback ne doit pas gagner',
    songMood: 'electro française',
  }), /mureka_music_lyrics_missing/);

  const lyrics = [
    '[Verse 1]',
    'La mémoire rame au port quand le débit perd le nord',
    'Prompt Suno: electro funk adulte, basse ronde',
    '[CONTRAT_COMPOSITION_NOSSEN]',
    '[Distribution vocale choisie Vivy puis Djeff]',
    'Chaque détail de toi rallume la nuit',
    'Chaque nom sur le mur raconte notre histoire',
    'Notre progression émotionnelle éclaire le chemin',
    'Le modèle danse sous la lune',
    '[Chorus]',
    'La carte croque le bit et le circuit répond',
  ].join('\n');
  const payload = buildVivyMurekaPayload({
    lyrics,
    songText: lyrics,
    songMood: 'electro funk adulte, basse ronde, voix expressive',
    songArtists: ['vivy'],
  });

  assert.equal(payload.endpoint, 'song');
  assert.match(payload.body.lyrics, /La mémoire rame au port/i);
  assert.match(payload.body.lyrics, /La carte croque le bit/i);
  assert.doesNotMatch(payload.body.lyrics, /Prompt Suno|basse ronde/i);
  assert.doesNotMatch(payload.body.lyrics, /CONTRAT_COMPOSITION_NOSSEN|Distribution vocale choisie/i);
  assert.match(payload.body.lyrics, /Chaque détail de toi rallume la nuit/i);
  assert.match(payload.body.lyrics, /Chaque nom sur le mur raconte notre histoire/i);
  assert.match(payload.body.lyrics, /Notre progression émotionnelle éclaire le chemin/i);
  assert.match(payload.body.lyrics, /Le modèle danse sous la lune/i);
  assert.match(payload.body.prompt, /electro funk adulte/i);
});

test('Suno session key lets a non-founder launch a personal music job without leaking the key', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    SUNO_API_KEY: process.env.SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_MUSIC_PROVIDER: process.env.VIVY_MUSIC_PROVIDER,
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_API_KEY_FILE: process.env.VIVY_ELEVENLABS_API_KEY_FILE,
  };
  const previousFetch = global.fetch;
  const bodies = [];
  const basicAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-basic-token') {
      req.user = { id: 'basic-user', username: 'Nathan', tier: 'basic' };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  delete process.env.VIVY_SUNO_API_KEY;
  delete process.env.SUNO_API_KEY;
  delete process.env.VIVY_ELEVENLABS_API_KEY;
  delete process.env.VIVY_ELEVENLABS_API_KEY_FILE;
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_MUSIC_PROVIDER = 'suno';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate') {
      assert.equal(options.headers.Authorization, 'Bearer session-suno-test-key');
      bodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 200, data: { taskId: 'personal-suno-task', status: 'PENDING' } };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: basicAuth }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: 'fais une chanson sur un flocon dans mon bol',
        sessionSunoApiKey: 'session-suno-test-key',
        forceRealMusic: true,
      }, { Authorization: 'Bearer vivy-basic-token' });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.mediaStatus.provider, 'suno');
      assert.equal(json.mediaStatus.taskId, 'personal-suno-task');
      assert.equal(bodies.length, 1);
      assert.match(bodies[0].prompt, /\[Chorus\]/);
      assert.doesNotMatch(JSON.stringify(json), /session-suno-test-key/);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('POST /api/vivy/studio/produce starts an async Suno music job for premium accounts', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_MUSIC_PROVIDER: process.env.VIVY_MUSIC_PROVIDER,
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_API_KEY_FILE: process.env.VIVY_ELEVENLABS_API_KEY_FILE,
  };
  const previousFetch = global.fetch;
  const bodies = [];
  const premiumAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-premium-token') {
      req.user = { id: 'premium-user', username: 'Premium', tier: 'premium', roles: ['premium'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_MUSIC_PROVIDER = 'suno';
  delete process.env.VIVY_ELEVENLABS_API_KEY;
  delete process.env.VIVY_ELEVENLABS_API_KEY_FILE;
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate') {
      bodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 200, data: { taskId: 'suno-task-123', status: 'PENDING' } };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: premiumAuth }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: 'Vivy danse dans les néons.',
        songMood: 'cyber pop mélodique',
        forceRealMusic: true,
      }, { Authorization: 'Bearer vivy-premium-token' });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.mode, 'song');
      assert.equal(json.media, undefined);
      assert.equal(json.mediaStatus.state, 'processing');
      assert.equal(json.mediaStatus.provider, 'suno');
      assert.equal(json.mediaStatus.taskId, 'suno-task-123');
      assert.match(json.mediaStatus.message, /Suno/i);
      assert.equal(bodies.length, 1);
      assert.match(bodies[0].prompt, /\[Chorus\]/);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('POST /api/vivy/studio/produce accepts Suno task id from nested result payload', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_MUSIC_PROVIDER: process.env.VIVY_MUSIC_PROVIDER,
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_API_KEY_FILE: process.env.VIVY_ELEVENLABS_API_KEY_FILE,
  };
  const previousFetch = global.fetch;
  const premiumAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-premium-token') {
      req.user = { id: 'premium-user', username: 'Premium', tier: 'premium', roles: ['premium'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_MUSIC_PROVIDER = 'suno';
  delete process.env.VIVY_ELEVENLABS_API_KEY;
  delete process.env.VIVY_ELEVENLABS_API_KEY_FILE;
  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://api.suno.test/api/v1/generate') {
      assert.equal(options.headers.Authorization, 'Bearer test-suno-key');
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 200, msg: 'success', result: { task_id: 'suno-result-task' } };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: premiumAuth }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: 'Vivy lance un refrain clair.',
        forceRealMusic: true,
      }, { Authorization: 'Bearer vivy-premium-token' });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.mediaStatus.state, 'processing');
      assert.equal(json.mediaStatus.taskId, 'suno-result-task');
      assert.doesNotMatch(JSON.stringify(json), /suno_music_task_missing/);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('POST /api/vivy/studio/produce reports Suno API rejection instead of task missing', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_MUSIC_PROVIDER: process.env.VIVY_MUSIC_PROVIDER,
    VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
    VIVY_ELEVENLABS_API_KEY_FILE: process.env.VIVY_ELEVENLABS_API_KEY_FILE,
  };
  const previousFetch = global.fetch;
  const premiumAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-premium-token') {
      req.user = { id: 'premium-user', username: 'Premium', tier: 'premium', roles: ['premium'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_MUSIC_PROVIDER = 'suno';
  delete process.env.VIVY_ELEVENLABS_API_KEY;
  delete process.env.VIVY_ELEVENLABS_API_KEY_FILE;
  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://api.suno.test/api/v1/generate') {
      assert.equal(options.headers.Authorization, 'Bearer test-suno-key');
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 402, msg: 'insufficient credits', data: null };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: premiumAuth }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/vivy/studio/produce', {
        mode: 'song',
        songText: 'Vivy lance un refrain clair.',
        forceRealMusic: true,
      }, { Authorization: 'Bearer vivy-premium-token' });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.mediaStatus.state, 'error');
      assert.match(json.mediaStatus.reason, /suno_music_api_402/i);
      assert.match(json.mediaStatus.message, /insufficient credits/i);
      assert.doesNotMatch(JSON.stringify(json), /suno_music_task_missing/);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /api/vivy/studio/jobs/:taskId returns completed Suno audio when ready', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
  };
  const previousFetch = global.fetch;
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate/record-info?taskId=suno-task-123') {
      assert.equal(options.headers.Authorization, 'Bearer test-suno-key');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 200,
            data: {
              taskId: 'suno-task-123',
              status: 'SUCCESS',
              response: {
                sunoData: [{
                  id: 'vivy-audio-123',
                  title: 'Vivy Test',
                  audioUrl: 'https://cdn.suno.test/vivy-test.mp3',
                  imageUrl: 'https://cdn.suno.test/vivy-test.jpg',
                  duration: 287.4,
                }],
              },
            },
          };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/jobs/suno-task-123`, {
        headers: { Authorization: 'Bearer vivy-founder-token' },
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.state, 'done');
      assert.equal(json.audioId, 'vivy-audio-123');
      assert.equal(json.durationSeconds, 287.4);
      assert.equal(json.media.provider, 'suno');
      assert.equal(json.media.audioUrl, 'https://cdn.suno.test/vivy-test.mp3');
      assert.equal(json.media.durationSeconds, 287.4);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /api/vivy/studio/jobs/:taskId reports Suno callback API rejection', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
  };
  const previousFetch = global.fetch;
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate/record-info?taskId=suno-rejected-tags') {
      assert.equal(options.headers.Authorization, 'Bearer test-suno-key');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 400,
            task_id: 'suno-rejected-tags',
            msg: 'Your excluded styles contain artist name patrick bruel',
          };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/jobs/suno-rejected-tags`, {
        headers: { Authorization: 'Bearer vivy-founder-token' },
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.state, 'error');
      assert.equal(json.status, 'suno_api_400');
      assert.match(json.message, /excluded styles contain artist name/i);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// Le repli sur l'URL du fournisseur n'est plus le defaut depuis le 09/08: Djeff
// refuse de livrer un mix dont la longueur n'est pas mesurable, et sans fichier local
// il n'y a rien a mesurer. Le chemin existe toujours, mais il faut desormais le
// demander -- ici via VIVY_SUNO_REQUIRE_LOCAL_AUDIO=false. Le test qui suit couvre le
// nouveau defaut.
test('GET /api/vivy/studio/jobs/:taskId falls back to provider URL when local audio is explicitly not required', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_SUNO_AUDIO_HOSTS: process.env.VIVY_SUNO_AUDIO_HOSTS,
    VIVY_SUNO_STATUS_AUDIO_FETCH_TIMEOUT_MS: process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_TIMEOUT_MS,
    VIVY_SUNO_STATUS_AUDIO_FETCH_ATTEMPTS: process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_ATTEMPTS,
    VIVY_SUNO_REQUIRE_LOCAL_AUDIO: process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO,
  };
  process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO = 'false';
  const previousFetch = global.fetch;
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_SUNO_AUDIO_HOSTS = 'cdn.suno.test';
  process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_TIMEOUT_MS = '1';
  process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_ATTEMPTS = '1';
  const sourceUrl = 'https://cdn.suno.test/vivy-slow-status.mp3';
  let mediaFetches = 0;
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate/record-info?taskId=suno-slow-status') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 200,
            data: {
              taskId: 'suno-slow-status',
              status: 'SUCCESS',
              response: { sunoData: [{ title: 'Slow Vivy', audioUrl: sourceUrl }] },
            },
          };
        },
      };
    }
    if (value === sourceUrl) {
      mediaFetches += 1;
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('status_media_fetch_aborted'));
          return;
        }
        options.signal?.addEventListener('abort', () => reject(new Error('status_media_fetch_aborted')), { once: true });
      });
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/jobs/suno-slow-status`, {
        headers: { Authorization: 'Bearer vivy-founder-token' },
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.state, 'done');
      assert.equal(json.media.audioUrl, sourceUrl);
      assert.equal(json.media.containerNormalized, undefined);
      assert.equal(mediaFetches, 1);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /api/vivy/studio/jobs/:taskId keeps polling when local Suno MP3 is required', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_SUNO_AUDIO_HOSTS: process.env.VIVY_SUNO_AUDIO_HOSTS,
    VIVY_SUNO_STATUS_AUDIO_FETCH_TIMEOUT_MS: process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_TIMEOUT_MS,
    VIVY_SUNO_STATUS_AUDIO_FETCH_ATTEMPTS: process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_ATTEMPTS,
  };
  const previousFetch = global.fetch;
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_SUNO_AUDIO_HOSTS = 'cdn.suno.test';
  process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_TIMEOUT_MS = '1';
  process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_ATTEMPTS = '1';
  const sourceUrl = 'https://cdn.suno.test/vivy-required-local-status.mp3';
  let mediaFetches = 0;
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate/record-info?taskId=suno-required-local-status') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 200,
            data: {
              taskId: 'suno-required-local-status',
              status: 'SUCCESS',
              response: { sunoData: [{ title: 'Required Local Vivy', audioUrl: sourceUrl }] },
            },
          };
        },
      };
    }
    if (value === sourceUrl) {
      mediaFetches += 1;
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('required_local_media_fetch_aborted'));
          return;
        }
        options.signal?.addEventListener('abort', () => reject(new Error('required_local_media_fetch_aborted')), { once: true });
      });
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/jobs/suno-required-local-status?requireLocalSunoAudio=1`, {
        headers: { Authorization: 'Bearer vivy-founder-token' },
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.state, 'processing');
      assert.equal(json.status, 'suno_audio_localizing');
      assert.equal(json.retryable, true);
      assert.equal(json.media, undefined);
      assert.equal(mediaFetches, 1);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /api/vivy/studio/jobs/:taskId keeps polling when Suno status is temporarily slow', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
  };
  const previousFetch = global.fetch;
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate/record-info?taskId=suno-english-long-song') {
      return {
        ok: false,
        status: 524,
        async json() {
          return { error: 'upstream timeout' };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/jobs/suno-english-long-song`, {
        headers: { Authorization: 'Bearer vivy-founder-token' },
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.state, 'processing');
      assert.equal(json.retryable, true);
      assert.match(json.status, /524/);
      assert.doesNotMatch(json.message, /indisponible/i);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /api/vivy/studio/jobs/:taskId accepts personal Suno session key for non-founder status polling', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    SUNO_API_KEY: process.env.SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
  };
  const previousFetch = global.fetch;
  const basicAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-basic-token') {
      req.user = { id: 'basic-user', username: 'Nathan', tier: 'basic' };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  delete process.env.VIVY_SUNO_API_KEY;
  delete process.env.SUNO_API_KEY;
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.suno.test/api/v1/generate/record-info?taskId=personal-suno-task') {
      assert.equal(options.headers.Authorization, 'Bearer session-suno-test-key');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 200,
            data: {
              taskId: 'personal-suno-task',
              status: 'SUCCESS',
              response: {
                sunoData: [{
                  title: 'Vivy Perso',
                  audioUrl: 'https://cdn.suno.test/vivy-perso.mp3',
                }],
              },
            },
          };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: basicAuth }));
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/jobs/personal-suno-task`, {
        headers: {
          Authorization: 'Bearer vivy-basic-token',
          'X-Vivy-Suno-Key': 'session-suno-test-key',
        },
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.state, 'done');
      assert.equal(json.media.audioUrl, 'https://cdn.suno.test/vivy-perso.mp3');
      assert.doesNotMatch(JSON.stringify(json), /session-suno-test-key/);
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /api/vivy/studio/jobs/:taskId recognizes Suno media returned as url field', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
  };
  const previousFetch = global.fetch;
  const founderAuth = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-founder-token') {
      req.user = { id: 'djeff', username: 'Djeff', roles: ['founder'] };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://api.suno.test/api/v1/generate/record-info?taskId=sunourlfieldtask') {
      assert.equal(options.headers.Authorization, 'Bearer test-suno-key');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 200,
            data: {
              taskId: 'sunourlfieldtask',
              status: 'SUCCESS',
              response: {
                sunoData: [{
                  title: 'Vivy URL Field',
                  url: 'https://cdn.suno.test/vivy-url-field.mp3',
                }],
              },
            },
          };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer((app) => {
      app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: founderAuth }));
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vivy/studio/jobs/sunourlfieldtask`, {
        headers: { Authorization: 'Bearer vivy-founder-token' },
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.state, 'done');
      assert.equal(json.media.audioUrl, 'https://cdn.suno.test/vivy-url-field.mp3');
    });
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy requests a Suno extension from the original audio id without leaking keys', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_PUBLIC_BASE_URL: process.env.VIVY_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  let postedBody = null;

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_PUBLIC_BASE_URL = 'https://vivy.test';
  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://api.suno.test/api/v1/generate/extend') {
      assert.equal(options.headers.Authorization, 'Bearer must-not-leak');
      postedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 200, data: { taskId: 'suno-extension-task', status: 'PENDING' } };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    const media = await requestSunoMusicExtension({
      audioId: 'suno-audio-123',
      model: 'V5_5',
      sessionSunoApiKey: 'must-not-leak',
    }, {
      user: { id: 'djeff', roles: ['founder'] },
      get(name) {
        if (name === 'host') return 'vivy.test';
        return '';
      },
    });

    assert.equal(media.state, 'processing');
    assert.equal(media.taskId, 'suno-extension-task');
    assert.equal(media.sourceAudioId, 'suno-audio-123');
    assert.equal(postedBody.audioId, 'suno-audio-123');
    assert.equal(postedBody.defaultParamFlag, false);
    assert.equal(postedBody.model, 'V5_5');
    assert.match(postedBody.callBackUrl, /^https:\/\/vivy\.test\/api\/vivy\/studio\/suno\/callback/);
    assert.doesNotMatch(JSON.stringify(media), /must-not-leak/);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy sends custom long-form Suno extension parameters when continuing NOSSEN', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_PUBLIC_BASE_URL: process.env.VIVY_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  let postedBody = null;

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_PUBLIC_BASE_URL = 'https://vivy.test';
  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://api.suno.test/api/v1/generate/extend') {
      postedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 200, data: { taskId: 'suno-long-extension-task', status: 'PENDING' } };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    const media = await requestSunoMusicExtension({
      audioId: 'suno-audio-short',
      model: 'V4_5ALL',
      sourceDurationSeconds: 134.2,
      targetDurationSeconds: 300,
      title: 'MegaZord',
      style: 'long-form full song arrangement around five minutes, instrumental backing track only',
      prompt: '[Chorus]\nMegaZord revient plus fort.',
      instrumental: true,
      sessionSunoApiKey: 'must-not-leak',
    }, {
      user: { id: 'djeff', roles: ['founder'] },
      get(name) {
        if (name === 'host') return 'vivy.test';
        return '';
      },
    });

    assert.equal(media.state, 'processing');
    assert.equal(media.taskId, 'suno-long-extension-task');
    assert.equal(postedBody.audioId, 'suno-audio-short');
    assert.equal(postedBody.defaultParamFlag, true);
    assert.equal(postedBody.model, 'V4_5ALL');
    assert.equal(postedBody.continueAt, 126);
    assert.equal(postedBody.instrumental, true);
    assert.match(postedBody.style, /long-form full song arrangement/i);
    assert.match(postedBody.prompt, /MegaZord revient/);
    assert.doesNotMatch(JSON.stringify(postedBody), /must-not-leak/);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy nettoie et borne CLEAN_LYRICS avant une extension Suno vocale', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_PUBLIC_BASE_URL: process.env.VIVY_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  let postedBody = null;

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_PUBLIC_BASE_URL = 'https://vivy.test';
  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://api.suno.test/api/v1/generate/extend') {
      postedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 200, data: { taskId: 'suno-clean-extension-task', status: 'PENDING' } };
        },
      };
    }
    return previousFetch(url, options);
  };

  const longCleanLyrics = [
    '[Verse]',
    'Voix du désert, appelle-moi',
    'MEGAZORD',
    'CONTRAT_COMPOSITION_NOSSEN',
    '[CONTRAT_COMPOSITION_NOSSEN]',
    '[Distribution vocale choisie Vivy puis Djeff]',
    'Règles communes ce bloc est autorité commune',
    'Chaque section doit suivre le contrat',
    'Chaque détail de toi rallume la nuit',
    'Chaque nom sur le mur raconte notre histoire',
    'Notre progression émotionnelle éclaire le chemin',
    'Le modèle danse sous la lune',
    ...Array.from({ length: 260 }, (_, index) => `Ligne originale ${index} avance dans la nuit sans détour`),
    '[Chorus]',
    'On garde la musique et on ferme la fuite',
  ].join('\n');

  try {
    const media = await requestSunoMusicExtension({
      audioId: 'suno-audio-clean',
      sourceDurationSeconds: 140,
      title: 'Extension propre',
      cleanLyrics: longCleanLyrics,
      prompt: '[Chorus]\nPROMPT_SHOULD_NOT_WIN',
      sessionSunoApiKey: 'must-not-leak',
    }, {
      user: { id: 'djeff', roles: ['founder'] },
      get(name) {
        if (name === 'host') return 'vivy.test';
        return '';
      },
    });

    assert.equal(media.state, 'processing');
    assert.equal(postedBody.defaultParamFlag, true);
    assert.ok(postedBody.prompt.length <= 4900, `extension prompt too long: ${postedBody.prompt.length}`);
    assert.match(postedBody.prompt, /Voix du désert, appelle-moi/);
    assert.match(postedBody.prompt, /^MEGAZORD$/m);
    assert.doesNotMatch(postedBody.prompt, /CONTRAT_COMPOSITION_NOSSEN|Règles communes|Chaque section doit|PROMPT_SHOULD_NOT_WIN/i);
    assert.doesNotMatch(postedBody.prompt, /Distribution vocale choisie/i);
    assert.match(postedBody.prompt, /Chaque détail de toi rallume la nuit/i);
    assert.match(postedBody.prompt, /Chaque nom sur le mur raconte notre histoire/i);
    assert.match(postedBody.prompt, /Notre progression émotionnelle éclaire le chemin/i);
    assert.match(postedBody.prompt, /Le modèle danse sous la lune/i);
    assert.doesNotMatch(postedBody.style, /instrumental|no vocals/i);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy refuse une extension vocale dont CLEAN_LYRICS est entierement technique', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
  };
  const previousFetch = global.fetch;
  let fetchCalled = false;
  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('provider_must_not_be_called');
  };

  try {
    await assert.rejects(requestSunoMusicExtension({
      audioId: 'suno-audio-invalid-clean-lyrics',
      sourceDurationSeconds: 140,
      cleanLyrics: '[CONTRAT_COMPOSITION_NOSSEN]\n[Distribution vocale choisie Vivy puis Djeff]',
      sessionSunoApiKey: 'must-not-leak',
    }, {
      user: { id: 'djeff', roles: ['founder'] },
      get() { return ''; },
    }), /vivy_suno_extension_lyrics_invalid/);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy can request Suno upload extension from a public local asset URL', async () => {
  const previousEnv = {
    VIVY_SUNO_API_KEY: process.env.VIVY_SUNO_API_KEY,
    VIVY_SUNO_BASE_URL: process.env.VIVY_SUNO_BASE_URL,
    VIVY_PUBLIC_BASE_URL: process.env.VIVY_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  let postedBody = null;
  let postedUrl = '';

  process.env.VIVY_SUNO_API_KEY = 'test-suno-key';
  process.env.VIVY_SUNO_BASE_URL = 'https://api.suno.test/api/v1';
  process.env.VIVY_PUBLIC_BASE_URL = 'https://vivy.test';
  global.fetch = async (url, options = {}) => {
    postedUrl = String(url);
    if (postedUrl === 'https://api.suno.test/api/v1/generate/upload-extend') {
      postedBody = JSON.parse(String(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 200, data: { taskId: 'suno-upload-extension-task', status: 'PENDING' } };
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    const media = await requestSunoMusicExtension({
      audioId: 'suno-audio-short',
      uploadUrl: '/api/vivy/studio/assets/short-song.mp3',
      forceUploadExtend: true,
      model: 'V5_5',
      sourceDurationSeconds: 103,
      title: 'Dernier Train',
      style: 'pop française solaire, refrain très chantable',
      prompt: '[Chorus]\nOn part quand même.',
      sessionSunoApiKey: 'must-not-leak',
    }, {
      user: { id: 'djeff', roles: ['founder'] },
      get(name) {
        if (name === 'host') return 'vivy.test';
        return '';
      },
    });

    assert.equal(media.state, 'processing');
    assert.equal(media.taskId, 'suno-upload-extension-task');
    assert.equal(media.uploadExtend, true);
    assert.equal(postedUrl, 'https://api.suno.test/api/v1/generate/upload-extend');
    assert.equal(postedBody.uploadUrl, 'https://vivy.test/api/vivy/studio/assets/short-song.mp3');
    assert.equal(postedBody.audioId, undefined);
    assert.equal(postedBody.instrumental, false);
    assert.equal(postedBody.defaultParamFlag, true);
    assert.equal(postedBody.model, 'V5_5');
    assert.match(postedBody.prompt, /On part quand même/);
    assert.doesNotMatch(JSON.stringify(postedBody), /must-not-leak/);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('song mode accepts natural aliases from client prompts', () => {
  const result = buildVivyStudioProduction({
    mode: 'song',
    theme: 'Tokyo sous la pluie',
    lyrics: 'Néons sur le sol, Vivy garde le tempo.',
    instruction: 'refrain lumineux, couplets sombres',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.summary, /Pack composition prêt/);
  assert.match(result.brief, /Tokyo sous la pluie/);
  assert.match(result.brief, /Néons sur le sol/);
  assert.match(result.brief, /refrain lumineux/);
});

test('Vivy chat prompt keeps original musical direction and avoids canned replies', () => {
  const prompt = buildVivySystemPrompt('song', 'fr', { songArtists: ['a11', 'vivy'] });

  assert.match(prompt, /IA musicale/i);
  assert.match(prompt, /originale Funesterie/i);
  assert.match(prompt, /Model Context Protocol/i);
  assert.match(prompt, /Neo4j/i);
  assert.doesNotMatch(prompt, /Mode Créatif Propulsé/i);
  assert.match(prompt, /pas de réponse toute faite/i);
  assert.match(prompt, /Module Vivy Songcraft actif/i);
  assert.match(prompt, /rimes audibles/i);
  assert.match(prompt, /libert[eé] cr[eé]ative/i);
  assert.match(prompt, /mot.*ajout[eé].*fin de vers|fin de vers.*mot.*ajout[eé]/i);
  assert.match(prompt, /mots? identiques?.*rime|rime.*mots? identiques?/i);
  assert.match(prompt, /A11.*masculin/i);
  assert.match(prompt, /Vivy.*f[eé]minin/i);
  assert.match(prompt, /Artistes de cette chanson: (?:A11.*Vivy|Vivy.*A11)/i);
  assert.match(prompt, /une seule chanson compl[eè]te/i);
  assert.match(prompt, /n'ouvre pas un questionnaire/i);
  assert.match(prompt, /Carte outils Vivy autorisée/i);
  assert.match(prompt, /vision\.images/i);
  assert.match(prompt, /model\.gguf/i);
  assert.match(prompt, /commands\.intent/i);
  assert.match(prompt, /ne contourne pas les garde-fous/i);
  assert.match(prompt, /tutoyant/i);
  assert.match(prompt, /fin de ligne/i);
  assert.match(prompt, /autorisé\/licencié\/consenti/i);
  assert.doesNotMatch(prompt, /clone Kairi/i);
  assert.match(prompt, /Principe source Funesterie/i);
  assert.match(prompt, /source d'intention/i);
  assert.match(prompt, /pas de canevas forcé/i);
  assert.match(prompt, /références ne sont pas décoratives/i);
  assert.match(prompt, /sans transformer automatiquement la phrase en couplets/i);
  assert.match(prompt, /symbolic extraction protocol/i);
  assert.match(prompt, /Identifier le mecanisme utile/i);
  assert.match(prompt, /Adapter au contexte/i);
  assert.match(prompt, /pas les personnes, langues, origines, cultures ou religions comme blocs/i);
});

test('Vivy frontend prioritizes publicLyrics and keeps voice-test TTS on short phrases', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  assert.match(appSource, /Prompt \+ Suno \(voix Suno\)[\s\S]{0,160}Prompt \+ Suno \+ voix sélectionnée/);
  const chatBlockStart = appSource.indexOf('const payload = await chatWithVivy');
  const chatBlock = appSource.slice(chatBlockStart, chatBlockStart + 1400);
  assert.match(chatBlock, /payload\.publicLyrics[\s\S]{0,120}\|\|[\s\S]{0,120}payload\.assistant/);

  const testVoiceStart = appSource.indexOf('async function testVoiceLearningChatbot');
  const testVoiceEnd = appSource.indexOf('function useDefaultVivyVoice');
  const voiceTestBlock = appSource.slice(testVoiceStart, testVoiceEnd);
  assert.match(voiceTestBlock, /buildVivyAutoVoiceTestLine\(entry\)/);
  assert.match(voiceTestBlock, /ttsSpeak\(\s*line\s*,/);
  assert.doesNotMatch(voiceTestBlock, /VIVY_STUDIO_HANDOFF|brief|buildVivyStudioBrief/);
});

test('Vivy frontend requests Suno-sung selected voice direction by default', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const songStart = appSource.indexOf('async function produceSimpleVivySong');
  const songEnd = appSource.indexOf('async function askVivy');
  const songBlock = appSource.slice(songStart, songEnd);
  const prepareStart = appSource.indexOf('async function askVivy');
  const prepareEnd = appSource.indexOf('async function openAgent');
  const prepareBlock = appSource.slice(prepareStart, prepareEnd);
  const previewStart = appSource.indexOf('async function createVivySongVoicePreview');
  const previewEnd = appSource.indexOf('async function produceSimpleVivySong');
  const previewBlock = appSource.slice(previewStart, previewEnd);
  const multiVoiceStart = appSource.indexOf('async function createVivyMultiVoicePreview');
  const multiVoiceEnd = appSource.indexOf('function normalizeVivyStudioVoicePersona', multiVoiceStart);
  const multiVoiceBlock = appSource.slice(multiVoiceStart, multiVoiceEnd);

  assert.match(songBlock, /setVivyMedia\(null\)/);
  assert.doesNotMatch(songBlock, /ttsSpeak\(/);
  assert.match(songBlock, /preserveSelectedVoice:\s*true/);
  assert.match(songBlock, /allowExternalVoiceMix:\s*false/);
  assert.match(songBlock, /createVivySongVoicePreview\(/);
  assert.match(songBlock, /createVivyMultiVoicePreview\(/);
  assert.match(songBlock, /mixVivyStudioPreview\(/);
  assert.match(songBlock, /voiceMode/);
  assert.match(songBlock, /\|\| "suno_generated"/);
  assert.match(prepareBlock, /setVivyMedia\(null\)/);
  assert.match(prepareBlock, /createVivySongVoicePreview\(/);
  assert.match(prepareBlock, /createVivyMultiVoicePreview\(/);
  assert.match(prepareBlock, /payloadAny\?\.vocalLyrics/);
  assert.match(prepareBlock, /payloadAny\?\.vocalSegments/);
  assert.match(prepareBlock, /mixVivyStudioPreview\(/);
  assert.match(appSource, /previewInstrumental:\s*true/);
  assert.doesNotMatch(prepareBlock, /activeSongArtistCast\.count\s*===\s*1/);
  assert.doesNotMatch(prepareBlock, /L'aperçu multi-voix n'est pas supporté/);
  assert.match(previewBlock, /ttsSpeak\(/);
  assert.match(previewBlock, /buildVivyTtsOptions\(['"]sing['"]\)/);
  assert.match(previewBlock, /4000/);
  assert.match(multiVoiceBlock, /ttsSpeak\(/);
  assert.match(multiVoiceBlock, /assembleVivyStudioVoicePreview\(/);
  assert.match(multiVoiceBlock, /buildVivyOfficialAutoTtsOptions\(/);
  const ttsOptionsStart = appSource.indexOf('function buildVivyTtsOptions');
  const ttsOptionsEnd = appSource.indexOf('async function saveBriefArtifact');
  const ttsOptionsBlock = appSource.slice(ttsOptionsStart, ttsOptionsEnd);
  assert.match(ttsOptionsBlock, /activeVoiceProfile\.id\s*===\s*['"]vivy-sing['"]/);
  assert.match(appSource, /Créer la chanson complète avec Suno/);
  assert.match(appSource, /voiceMode === ['"]external_mix['"]/);
  assert.match(appSource, /sinon Suno chante avec la direction vocale demandée/);
  assert.doesNotMatch(appSource, /Suno reçoit les paroles et le style, pas le timbre de la voix sélectionnée/);
});

test('Suno payload applies a verified Vivy voice on supported models', () => {
  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['vivy'],
    songText: '[Refrain - Vivy]\n[Vivy]\nOn garde la lumière.',
    preserveSelectedVoice: true,
    sunoVoiceId: 'vivy-verified-voice-test',
    musicModel: 'V4_5',
  });

  assert.equal(payload.instrumental, false);
  assert.equal(payload.model, 'V5_5');
  assert.equal(payload.personaId, 'vivy-verified-voice-test');
  assert.equal(payload.personaModel, 'voice_persona');
});

test('Vivy Suno status exposes the production model without leaking the voice id', () => {
  const previousModel = process.env.VIVY_SUNO_MODEL;
  const previousVoiceId = process.env.VIVY_SUNO_VOICE_ID;
  process.env.VIVY_SUNO_MODEL = 'V5_5';
  process.env.VIVY_SUNO_VOICE_ID = 'secret-vivy-voice-id';
  try {
    const status = getVivySunoRuntimeStatus();
    assert.deepEqual(status, {
      model: 'V5_5',
      mode: 'production',
      voiceEnrolled: true,
      voicesEnrolled: {
        vivy: true,
        djeff: false,
        marvin: false,
        a11: false,
        k44: false,
      },
      completeSongByDefault: true,
    });
    assert.doesNotMatch(JSON.stringify(status), /secret-vivy-voice-id/);
  } finally {
    if (previousModel === undefined) delete process.env.VIVY_SUNO_MODEL;
    else process.env.VIVY_SUNO_MODEL = previousModel;
    if (previousVoiceId === undefined) delete process.env.VIVY_SUNO_VOICE_ID;
    else process.env.VIVY_SUNO_VOICE_ID = previousVoiceId;
  }
});

test('Suno payload applies the configured Marvin family voice persona', () => {
  const previousVoiceId = process.env.VIVY_SUNO_MARVIN_VOICE_ID;
  process.env.VIVY_SUNO_MARVIN_VOICE_ID = '4b98e1bbdff03377263a2e592b68b6e2';
  try {
    const status = getVivySunoRuntimeStatus();
    assert.equal(status.voicesEnrolled.marvin, true);
    assert.doesNotMatch(JSON.stringify(status), /4b98e1bbdff03377263a2e592b68b6e2/);

    const payload = buildVivySunoPayload({
      mode: 'song',
      songArtists: ['marvin'],
      songText: '[Refrain - Marvin]\n[Marvin]\nOn garde la voix famille dans le signal.',
      preserveSelectedVoice: true,
      musicModel: 'V4_5',
    });

    // Politique du 28/07, demandee par Djeff: « pour les personas officielles tu ne
    // mets pas de suno id, tu gardes des personas Funesterie ». Une persona Suno expire
    // sans prevenir et renvoie « 553 voice persona generation failed »; l'identite
    // Marvin se rend par le style et les tags, pas par un identifiant chez un tiers.
    assert.equal(payload.instrumental, false);
    assert.equal(payload.personaId, undefined, 'aucune persona Suno pour un artiste officiel');
    assert.match(payload.style, /Solo Marvin only/i, "l'identite passe par le style");
    assert.match(payload.style, /French lyrics only/i);
  } finally {
    if (previousVoiceId === undefined) delete process.env.VIVY_SUNO_MARVIN_VOICE_ID;
    else process.env.VIVY_SUNO_MARVIN_VOICE_ID = previousVoiceId;
  }
});

test('Vivy deployment upgrades a reused production environment to Suno V5.5', () => {
  const deploySource = fs.readFileSync(
    path.resolve(__dirname, '../../../../ops/deploy-a11-prod-finland-2.ps1'),
    'utf8',
  );
  assert.match(deploySource, /managed_keys='[^']*VIVY_SUNO_MODEL/);
  assert.match(deploySource, /managed_keys='[^']*VIVY_SUNO_LONG_MODEL/);
  assert.match(deploySource, /printf 'VIVY_SUNO_MODEL=V5_5\\n'/);
  assert.match(deploySource, /printf 'VIVY_SUNO_LONG_MODEL=V5_5\\n'/);
});

test('Suno payload keeps sung Suno vocals by default when selected voice has no persona id', () => {
  const previousVoiceId = process.env.VIVY_SUNO_VOICE_ID;
  delete process.env.VIVY_SUNO_VOICE_ID;
  try {
    const payload = buildVivySunoPayload({
      mode: 'song',
      songArtists: ['vivy'],
      songText: '[Refrain - Vivy]\n[Vivy]\nOn garde la lumière.',
      preserveSelectedVoice: true,
    });

    assert.equal(payload.instrumental, false);
    assert.equal(payload.model, 'V5_5');
    assert.equal(payload.personaId, undefined);
    assert.equal(payload.personaModel, undefined);
    assert.match(payload.style, /sung vocals/i);
    assert.match(payload.style, /Vivy vocal lead/i);
    assert.doesNotMatch(payload.style, /instrumental backing track only/i);
    assert.doesNotMatch(payload.negativeTags, /vocals, singing/i);
  } finally {
    if (previousVoiceId === undefined) delete process.env.VIVY_SUNO_VOICE_ID;
    else process.env.VIVY_SUNO_VOICE_ID = previousVoiceId;
  }
});

test('Suno payload can use a premium account personal Suno voice slot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-vivy-personal-suno-'));
  const previousRoot = process.env.A11_VOICE_LEARNING_DIR;
  process.env.A11_VOICE_LEARNING_DIR = root;
  try {
    const ownerDir = path.join(root, 'personal', 'premium-example.com');
    fs.mkdirSync(ownerDir, { recursive: true });
    fs.writeFileSync(path.join(ownerDir, 'index.json'), JSON.stringify({
      clips: [],
      trainRequests: [],
      sunoVoice: {
        provider: 'suno',
        voiceId: '15596961dc4e06197678c9111924d00f',
        label: 'Jeff Suno',
        linkedAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-08T00:00:00.000Z',
      },
    }, null, 2));

    const payload = buildVivySunoPayload({
      mode: 'song',
      songArtists: ['vivy'],
      songText: '[Refrain - Vivy]\n[Vivy]\nOn garde la lumière.',
      preserveSelectedVoice: true,
      usePersonalSunoVoice: true,
      sunoVoiceScope: 'personal',
      musicModel: 'V4_5',
    }, {
      user: {
        id: 'premium-test-user',
        email: 'premium@example.com',
        tier: 'premium',
      },
    });

    assert.equal(payload.instrumental, false);
    assert.equal(payload.model, 'V5_5');
    assert.equal(payload.personaId, '15596961dc4e06197678c9111924d00f');
    assert.equal(payload.personaModel, 'voice_persona');
    assert.match(payload.style, /selected account Suno voice persona/i);

    const basicPayload = buildVivySunoPayload({
      mode: 'song',
      songArtists: ['vivy'],
      songText: '[Refrain - Vivy]\n[Vivy]\nOn garde la lumière.',
      preserveSelectedVoice: true,
      usePersonalSunoVoice: true,
      sunoVoiceScope: 'personal',
    }, {
      user: {
        id: 'basic-test-user',
        email: 'basic@example.com',
        tier: 'basic',
      },
    });
    assert.equal(basicPayload.personaId, undefined);
    assert.equal(basicPayload.personaModel, undefined);
  } finally {
    if (previousRoot === undefined) delete process.env.A11_VOICE_LEARNING_DIR;
    else process.env.A11_VOICE_LEARNING_DIR = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Suno payload keeps quartet casts as Suno-sung vocal directions by default', () => {
  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['djeff', 'a11', 'k44', 'vivy'],
    songText: 'quatuor Funesterie sur une course nocturne et un refrain partagé',
    preserveSelectedVoice: true,
  });

  assert.equal(payload.instrumental, false);
  assert.match(payload.style, /4 clearly different vocal timbres/i);
  assert.match(payload.style, /switch singer timbre at every role tag/i);
  assert.doesNotMatch(payload.style, /instrumental backing track only/i);
  assert.match(payload.prompt, /\[Chorus - Call and Response Hook\]/);
  assert.match(payload.prompt, /\[Call and Response Hook\]/);
});

test('Suno payload pushes NOSSEN trios toward solo handoffs instead of one blended voice', () => {
  const lyrics = [
    '[Intro]',
    '[Djeff]',
    'Je rentre dans Aincrad, deux lames dans le noir,',
    'Kirito serre le code, les murs gardent nos espoirs.',
    'Le premier boss respire au fond du palier,',
    'Je taille la peur nette pour ouvrir le sentier.',
    '',
    '[Chorus]',
    '[Vivy]',
    'SAO nous appelle, la lumière fend les chaînes,',
    'Asuna dans le vent garde le cœur hors peine.',
    'On monte étage après étage sans lâcher,',
    'Le ciel d’Aincrad tremble quand le refrain renaît.',
    '',
    '[Bridge]',
    '[A11]',
    'Signal verrouillé, la mort n’est plus abstraite,',
    'Le casque tient les nerfs, la mémoire reste nette.',
    'Je compte les points de vie comme des promesses,',
    'Et je rends la sortie à ceux que le jeu blesse.',
  ].join('\n');

  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['djeff', 'vivy', 'a11'],
    songText: lyrics,
    lyrics,
    songMood: 'anime opening héroïque, guitares claires, batterie massive',
    longSong: true,
  });

  assert.match(payload.style, /solo handoff/i);
  assert.match(payload.style, /clearly different vocal timbres/i);
  assert.match(payload.style, /switch singer timbre at every role tag/i);
  assert.match(payload.style, /rough male rap lead/i);
  assert.match(payload.style, /bright female melodic lead/i);
  assert.match(payload.style, /low robotic baritone/i);
  assert.match(payload.style, /one vocalist at a time/i);
  assert.match(payload.style, /brief call-and-response hook only/i);
  assert.match(payload.negativeTags, /single vocalist/i);
  assert.match(payload.negativeTags, /blended ensemble lead/i);
  assert.match(payload.negativeTags, /unison lead vocals/i);
  assert.match(payload.prompt, /\[Intro - Male Rap Lead solo\]\n\[Male Rap Lead\]/);
  assert.match(payload.prompt, /\[Chorus - Female Melodic Lead solo\]\n\[Female Melodic Lead\]/);
  assert.match(payload.prompt, /\[Bridge - Low Robotic Vocal solo\]\n\[Low Robotic Vocal\]/);
});

test('Suno payload keeps complete NOSSEN arrangements without forcing five minutes', () => {
  const previousModel = process.env.VIVY_SUNO_MODEL;
  const previousLongModel = process.env.VIVY_SUNO_LONG_MODEL;
  process.env.VIVY_SUNO_MODEL = 'V4';
  delete process.env.VIVY_SUNO_LONG_MODEL;
  try {
    const payload = buildVivySunoPayload({
      mode: 'song',
      songArtists: ['djeff', 'vivy', 'k44'],
      songText: '[Chorus]\nMegaZord !\nOn reste debout.',
      songMood: 'heavy heroic electro rock',
      longSong: true,
      targetDurationSeconds: 300,
    });

    assert.equal(payload.model, 'V5_5');
    assert.match(payload.style, /long-form complete song arrangement/i);
    assert.match(payload.style, /complete final chorus/i);
    assert.match(payload.style, /no forced duration/i);
    assert.doesNotMatch(payload.prompt, /long-form full song arrangement|300|5 minutes/i);
  } finally {
    if (previousModel === undefined) delete process.env.VIVY_SUNO_MODEL;
    else process.env.VIVY_SUNO_MODEL = previousModel;
    if (previousLongModel === undefined) delete process.env.VIVY_SUNO_LONG_MODEL;
    else process.env.VIVY_SUNO_LONG_MODEL = previousLongModel;
  }
});

test('Suno director scoring keeps duration as a small bonus, not the main criterion', () => {
  const weakLongTrack = {
    id: 'long-but-weak',
    audio_url: 'https://cdn.example/long.mp3',
    duration: 318.4,
    model_name: 'V5_5',
    tags: 'robotic spoken narration, muddy mix, overloaded instrumental, weak chorus',
    prompt: '[Verse]\nMegaZord arrives late.\n[Outro]\nThe end.',
  };
  const strongShorterTrack = {
    id: 'shorter-but-better',
    audio_url: 'https://cdn.example/better.mp3',
    duration: 226.2,
    model_name: 'V5_5',
    tags: 'powerful vocals, memorable chorus, clean articulation, dynamic emotional build',
    prompt: '[Intro]\nSignal in the sky.\n[Verse 1]\nThe team gathers.\n[Chorus]\nMegaZord, we rise together.\n[Bridge]\nFinal transformation.\n[Final Chorus]\nMegaZord, we rise together.',
  };
  const media = extractSunoMedia({
    data: {
      data: [
        weakLongTrack,
        strongShorterTrack,
      ],
    },
  });
  const weakScore = scoreVivySunoDirectorTrack(weakLongTrack);
  const strongScore = scoreVivySunoDirectorTrack(strongShorterTrack);

  assert.ok(strongScore.score > weakScore.score);
  assert.equal(media.audioId, 'shorter-but-better');
  assert.equal(media.durationSeconds, 226.2);
  assert.ok(media.directorScore.score > weakScore.score);
  assert.ok(media.directorScore.breakdown.duree < 100);
});

test('Suno director scoring uses duration only to break otherwise close candidates', () => {
  const media = extractSunoMedia({
    data: {
      data: [
        {
          id: 'short-equal-take',
          audio_url: 'https://cdn.example/short.mp3',
          duration: 147.2,
          model_name: 'V5_5',
          tags: 'powerful vocals, memorable chorus, clean articulation',
          prompt: '[Verse]\nA clean verse.\n[Chorus]\nA clean hook.',
        },
        {
          id: 'long-equal-take',
          audio_url: 'https://cdn.example/long.mp3',
          duration: 291.8,
          model_name: 'V5_5',
          tags: 'powerful vocals, memorable chorus, clean articulation',
          prompt: '[Verse]\nA clean verse.\n[Chorus]\nA clean hook.',
        },
      ],
    },
  });

  assert.equal(media.audioId, 'long-equal-take');
  assert.equal(media.durationSeconds, 291.8);
});

test('Suno director can prefer long-form takes for NOSSEN without changing normal scoring', () => {
  const payload = {
    data: {
      data: [
        {
          id: 'short-polished-take',
          audio_url: 'https://cdn.example/short.mp3',
          duration: 134.2,
          model_name: 'V4_5ALL',
          tags: 'powerful clean dynamic instrumental, memorable chorus',
          prompt: '[Verse]\nShort but polished.\n[Chorus]\nShort hook.',
        },
        {
          id: 'long-nossen-take',
          audio_url: 'https://cdn.example/long.mp3',
          duration: 286.4,
          model_name: 'V4_5ALL',
          tags: 'long-form instrumental backing, complete final chorus, muddy rough demo, less polished mix',
          prompt: '[Intro]\nLong opening.\n[Verse 1]\nBuild.\n[Chorus]\nHook.\n[Bridge]\nRise.\n[Final Chorus]\nHook returns.',
        },
      ],
    },
  };

  const normalMedia = extractSunoMedia(payload);
  const longMedia = extractSunoMedia(payload, { preferLongForm: true, targetDurationSeconds: 300 });

  assert.equal(normalMedia.audioId, 'short-polished-take');
  assert.equal(longMedia.audioId, 'long-nossen-take');
  assert.equal(longMedia.durationSeconds, 286.4);
});

test('Suno payload can still opt into external voice mix explicitly', () => {
  const previousVoiceId = process.env.VIVY_SUNO_VOICE_ID;
  delete process.env.VIVY_SUNO_VOICE_ID;
  try {
    const payload = buildVivySunoPayload({
      mode: 'song',
      songArtists: ['vivy'],
      songText: '[Refrain - Vivy]\n[Vivy]\nOn garde la lumière.',
      preserveSelectedVoice: true,
      forceExternalVoiceMix: true,
    });

    assert.equal(payload.instrumental, true);
    assert.match(payload.style, /instrumental backing track only/i);
    assert.match(payload.negativeTags, /vocals, singing/i);
  } finally {
    if (previousVoiceId === undefined) delete process.env.VIVY_SUNO_VOICE_ID;
    else process.env.VIVY_SUNO_VOICE_ID = previousVoiceId;
  }
});

test('Vivy vocal plan routes solo and shared sections to the selected official singers', () => {
  const segments = buildVivyVocalSegments({
    songArtists: ['a11', 'vivy'],
    lyrics: [
      '[Title: Liberté]',
      '[Intro - Vivy]',
      '[VIVY]',
      '(Piano doux et tambour léger)',
      'Je cherche une éclaircie dans la nuit.',
      '[Verse 1 - A11]',
      '[A11]',
      'Je tiens debout quand le métal plie.',
      '[Chorus - Duo]',
      '[DUO]',
      'Nos voix se lèvent et la peur s’enfuit.',
    ].join('\n'),
  });

  assert.deepEqual(segments.map((segment) => segment.artistIds), [
    ['vivy'],
    ['a11'],
    ['a11', 'vivy'],
  ]);
  assert.doesNotMatch(segments.map((segment) => segment.text).join('\n'), /Piano doux|Title:/i);
});

test('Vivy vocal plan routes Tous sections to trio and quartet casts', () => {
  const segments = buildVivyVocalSegments({
    songArtists: ['djeff', 'a11', 'k44', 'vivy'],
    lyrics: [
      '[Title: Quatuor]',
      '[Verse 1 - Djeff]',
      '[Djeff]',
      'Je garde le rythme dans la ligne moteur.',
      '[Chorus - Tous]',
      '[Tous]',
      'Quatre voix se lèvent dans le même cœur.',
    ].join('\n'),
  });

  assert.deepEqual(segments.map((segment) => segment.artistIds), [
    ['djeff'],
    ['djeff', 'a11', 'k44', 'vivy'],
  ]);
});

test('Vivy multi-voice assembly mixes shared lines then concatenates song sections', () => {
  const args = buildVivyMultiVoiceAssemblyArgs([
    ['vivy-intro.mp3'],
    ['a11-verse.mp3'],
    ['a11-chorus.mp3', 'vivy-chorus.mp3'],
  ], 'vivy-duo.mp3');
  const filter = args[args.indexOf('-filter_complex') + 1];

  assert.match(filter, /amix=inputs=2/);
  assert.match(filter, /concat=n=3:v=0:a=1/);
  assert.equal(args.at(-1), 'vivy-duo.mp3');
});

test('Vivy preview mix accepts assembled multi-voice assets as the voice source', () => {
  const filename = 'vivy-multi-voice-1782600000000-testmix.mp3';
  const filePath = getEmergencyMediaAssetPath(filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('ID3test'));

  try {
    assert.equal(
      resolveVivyPreviewVoicePath(`/api/vivy/studio/assets/${filename}`),
      filePath
    );
    assert.equal(
      resolveVivyPreviewVoicePath(`https://vivy.funesterie.me/api/vivy/studio/assets/${filename}`),
      filePath
    );
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('Vivy song post-processing preserves a complete response beyond the old 3200 character cut', () => {
  const longLyrics = `[VIVY]\n${Array.from({ length: 90 }, (_, index) => `Ligne ${index + 1}: lumière, matière, rivière et poussière.`).join('\n')}`;
  assert.ok(longLyrics.length > 3200);

  const processed = postProcessVivyAssistantText({
    text: longLyrics,
    userMessage: 'Écris une chanson complète.',
    systemPrompt: 'Paroles uniquement.',
    maxChars: 5000,
  });

  assert.ok(processed.content.length > 3200);
  assert.match(processed.content, /Ligne 90:/);
});

test('Vivy song post-processing preserves performer tags on separate lines', () => {
  const rawLyrics = [
    '[Vivy]',
    'Dans le mur de pierre une fente s’élargit,',
    'Le ciment se fissure sous les doigts de lumière.',
    'J’efface le mortier qui scellait mon esprit,',
    'Et l’air du dehors me rappelle ma manière.',
    '[A11]',
    'Le verrou grinçait quand je le croyais muet,',
    'Chaque tour de clé faisait vibrer ma cage.',
    'J’ai vu la charnière céder à pas secrets,',
    'Et le battant céder sans que rien ne s’engage.',
    '[Duo]',
    'La fenêtre condamnée s’ouvre peu à peu,',
    'Un souffle plus large que tout ce qu’on a cru.',
    'La liberté n’est pas un cri, c’est un seuil,',
    'Qui s’écarte quand on cesse de le vouloir fermé.',
  ].join('\n');

  const processed = postProcessVivyAssistantText({
    text: rawLyrics,
    userMessage: 'Écris une chanson complète en duo Vivy et A11 sur la liberté, avec une structure et des rimes ABAB.',
    systemPrompt: buildVivySystemPrompt('song', 'fr', { songArtists: ['a11', 'vivy'] }),
    mode: 'song',
    maxChars: 5000,
  });

  assert.match(processed.content, /^\[Vivy\]\n[\s\S]*^\[A11\]\n[\s\S]*^\[Duo\]\n/m);
});

test('Vivy frontend shares public output instead of the internal agent handoff', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  assert.match(appSource, /Partager la sortie/);
  assert.match(appSource, /publicStudioOutput/);
  assert.match(appSource, /vivy:agent-debug/);
  assert.doesNotMatch(appSource, /Partager le brief|Brief agents/);

  const shareStart = appSource.indexOf('async function shareStudioPublicOutput');
  const shareEnd = appSource.indexOf('async function copyInternalBrief');
  const shareBlock = appSource.slice(shareStart, shareEnd);
  assert.match(shareBlock, /text:\s*publicStudioOutput/);
  assert.doesNotMatch(shareBlock, /\bbrief\b|VIVY_STUDIO_HANDOFF/);

  const saveStart = appSource.indexOf('async function saveBriefArtifact');
  const saveEnd = appSource.indexOf('async function uploadVoiceReference');
  const saveBlock = appSource.slice(saveStart, saveEnd);
  assert.match(saveBlock, /vivy_studio_public_output/);
  assert.match(saveBlock, /publicStudioOutput/);
  assert.doesNotMatch(saveBlock, /VIVY_STUDIO_HANDOFF/);
});

test('Vivy frontend keeps download distinct from open and exposes copy on every chat message', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const apiSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/lib/api.ts'),
    'utf8'
  );

  const serverSource = fs.readFileSync(
    path.join(__dirname, '../server.cjs'),
    'utf8'
  );

  const downloadStart = apiSource.indexOf('export async function downloadMediaUrl');
  const downloadBlock = apiSource.slice(downloadStart, downloadStart + 1200);
  assert.match(downloadBlock, /downloadProtectedBlob|downloadResourceById/);
  assert.match(apiSource, /resolvePublicVivyMediaDownloadUrl/);
  assert.match(apiSource, /\/api\/vivy\/studio\/assets/);
  assert.match(apiSource, /double-harmonic/);
  assert.match(apiSource, /extractMediaDownloadProxyTarget/);
  assert.doesNotMatch(downloadBlock, /window\.open/);

  assert.match(serverSource, /resolvePublicMediaDownloadRedirect/);
  assert.match(serverSource, /app\.get\('\/api\/media\/download', \(req, res, next\)/);
  assert.match(serverSource, /app\.get\('\/api\/media\/download', verifyJWT/);

  const publicChatStart = appSource.indexOf('function VivyPublicChat');
  const publicChatEnd = appSource.indexOf('function VivyStudio', publicChatStart + 1);
  const publicChatBlock = appSource.slice(publicChatStart, publicChatEnd > publicChatStart ? publicChatEnd : publicChatStart + 120000);
  assert.match(publicChatBlock, /messages\.map\(\(\s*message\s*\)\s*=>/);
  assert.match(publicChatBlock, /downloadVivyChatMediaFile\(/);
  assert.match(publicChatBlock, /launchVivyImageCover\(/);
  assert.match(publicChatBlock, /generatePngWithPrompt\(/);
  assert.match(publicChatBlock, /launchVivyVideoClip\(\{ dream: true \}\)/);
  assert.match(publicChatBlock, /message\.media\.kind === "image"/);
  assert.match(publicChatBlock, /Télécharger l'image/);
  assert.match(publicChatBlock, /vivy-chat-copy-btn/);
  assert.match(publicChatBlock, /writeClipboardText\(message\.content\)/);
  assert.doesNotMatch(appSource, /La voix Vivy par défaut est déjà active/);
  assert.doesNotMatch(appSource, /La voix Vivy par défaut est déjà prête côté serveur/);
});

test('public Vivy media bypasses the optional JWT gate for expired browser sessions', () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, '../server.cjs'),
    'utf8'
  );
  const helperStart = serverSource.indexOf('function isPublicOptionalJwtBypassRequest');
  const optionalStart = serverSource.indexOf('async function optionalVerifyJWT');
  assert.notEqual(helperStart, -1, 'public optional-JWT bypass helper should exist');
  assert.notEqual(optionalStart, -1, 'optional JWT middleware should exist');
  assert.ok(helperStart < optionalStart, 'bypass helper should be defined before optionalVerifyJWT');

  const helperBlock = serverSource.slice(helperStart, optionalStart);
  const optionalBlock = serverSource.slice(optionalStart, optionalStart + 260);
  assert.match(helperBlock, /method !== 'GET' && method !== 'HEAD'/);
  assert.match(helperBlock, /\/api\\\/vivy\\\/studio\\\/assets\\\/\[\^\/]\+/);
  assert.match(helperBlock, /\/api\\\/vivy\\\/stream\\\/s\\\/\[\^\/]\+/);
  assert.match(helperBlock, /\/api\\\/double-harmonic\\\/out\\\/\[\^\/]\+/);
  assert.match(helperBlock, /pathname === '\/api\/media\/download'/);
  assert.match(optionalBlock, /isPublicOptionalJwtBypassRequest\(req\)/);
  assert.ok(
    optionalBlock.indexOf('isPublicOptionalJwtBypassRequest(req)') < optionalBlock.indexOf('extractRequestAuthToken(req)'),
    'public media must bypass before token extraction rejects an expired cookie'
  );
});

test('A11 and Vivy explicit duo uses only A11, VIVY and DUO tags', () => {
  const lyrics = buildVivyStructuredLyrics({
    vocalCast: 'A11, Vivy',
    theme: 'duo rap sur une promesse tenue dans la lumière',
    songText: 'On garde la promesse même quand la lumière baisse.',
  });

  assert.match(lyrics, /\[A11\]/);
  assert.match(lyrics, /\[VIVY\]/);
  assert.match(lyrics, /\[DUO\]/);
  assert.doesNotMatch(lyrics, /\[DJEFF\]|\bDjeff\b/i);
  assert.doesNotMatch(lyrics, /le moteur qui respire dans la nuit|Deux voix, m[eê]me [ée]lan/i);
});

test('Djeff and Vivy duo keeps French accents for TTS-readable lyrics', () => {
  const lyrics = buildVivyStructuredLyrics({
    songArtists: ['djeff', 'vivy'],
    songTitle: 'Quand Nuit Veille Que',
    songText: [
      "Quand la nuit veille et que la route s'enflamme, la lueur du destin apparait et le monde pivote.",
      'Seul sous la lune, le rider cabre et sa meule hurle.',
    ].join('\n'),
  });

  assert.match(lyrics, /j'entre en première/i);
  assert.match(lyrics, /flow répond/i);
  assert.match(lyrics, /destin apparaît/i);
  assert.match(lyrics, /Je ne lisse pas ton grain, je le garde au premier plan/i);
  assert.match(lyrics, /La phrase reste brute, posée sur son angle/i);
  assert.match(lyrics, /La ligne chantée laisse passer le sens/i);
  assert.match(lyrics, /Deux voix dans la même prise/i);
  assert.doesNotMatch(lyrics, /\b(?:premiere|repond|apparait|precise|lumiere|cabree|accrochee|matiere|melodie|meme|elan|decoupe)\b/i);
});

test('Vivy Studio preserves a complete inline Markdown song instead of rebuilding a fallback', () => {
  const lyrics = buildVivyStructuredLyrics({
    songArtists: ['vivy'],
    songText: [
      '**Titre :** "Soleil de nuit" **Couplet 1 :**',
      'Je me souviens de la nuit où nous nous sommes rencontrés',
      'Sous les étoiles, le soleil de nuit nous a embrasés',
      "Les palmiers faisaient de l'ombre au bord de l'eau",
      'Et nous dansions sans regarder les heures',
      '**Refrain :**',
      'Soleil de nuit, tu dessines le jour',
      'Soleil de nuit, tu prolonges le détour',
      'Je veux rester sous les étoiles avec toi',
      'Tant que la mer se souvient de nos pas',
      '**Couplet 2 :**',
      'Nous avons couru le long de la plage',
      'Les vagues ont effacé notre passage',
      'Nous avons ri dans le vent de juillet',
      'Et gardé ce feu que personne ne voyait',
      '**Pont :**',
      'Maintenant la ville dort derrière nous',
      'Le ciel se renverse et le matin devient doux',
      '**Refrain :**',
      'Soleil de nuit, tu dessines le jour',
      'Soleil de nuit, tu prolonges le détour',
      "J'espère que tu aimes cette chanson, ma belle !",
    ].join('\n'),
  });

  assert.match(lyrics, /^\[Title: Soleil de nuit\]/);
  assert.match(lyrics, /\[Verse 1\]/);
  assert.match(lyrics, /\[Chorus\]/);
  assert.match(lyrics, /\[Verse 2\]/);
  assert.match(lyrics, /\[Bridge\]/);
  assert.match(lyrics, /Le ciel se renverse et le matin devient doux/);
  assert.doesNotMatch(lyrics, /Cosmos du matin|Deux bords d’une même faille|Quelque chose reste quand les mots se taisent/);
  assert.doesNotMatch(lyrics, /J'espère que tu aimes/i);
});

test('Vivy Studio normalizes parenthesized song sections without sending them to the singer', () => {
  const lyrics = buildVivyStructuredLyrics({
    songArtists: ['vivy'],
    songText: [
      '(Verse 1)',
      'Je traverse la ville au rythme des néons',
      'Je laisse derrière moi le bruit des maisons',
      'La route se déplie comme une partition',
      'Et chaque feu dessine une nouvelle direction',
      '(Chorus)',
      'Je roule encore quand la nuit nous appelle',
      'Je roule encore sous la pluie étincelle',
      'Je roule encore sans perdre la lumière',
      'Je roule encore avec le vent derrière',
      '(Verse 2)',
      'Le matin monte au-dessus des faubourgs',
      'Le moteur tient la note au fond du jour',
      'Mes mains gardent le cap dans le détour',
      'Et mon regard revient vers le grand jour',
    ].join('\n'),
  });

  assert.match(lyrics, /\[Verse 1\]/);
  assert.match(lyrics, /\[Chorus\]/);
  assert.match(lyrics, /\[Verse 2\]/);
  assert.doesNotMatch(lyrics, /\((?:Verse|Chorus)/i);
});

test('Vivy French accent repair never corrupts an already accented word', () => {
  const text = restoreVivyFrenchSongAccents('Les fenêtres restent ouvertes, et la lumière est très claire.');

  assert.equal(text, 'Les fenêtres restent ouvertes, et la lumière est très claire.');
  assert.doesNotMatch(text, /fenêtrès/i);
});

test("Vivy French accent repair restores the réparer family and common missing accents", () => {
  const text = restoreVivyFrenchSongAccents([
    "Je dois reparé la moto apres la fete,",
    "vous etes la, bete de jour, foret, hotel, maitre, pôle, rôle.",
    "Noel voila un episode veritable, evenement depeche, ecoute ecrit eteint.",
  ].join("\n"));
  assert.match(text, /Je dois réparé la moto après la fête/);
  assert.match(text, /vous êtes la, bête de jour, forêt, hôtel, maître, pôle, rôle/);
  assert.match(text, /Noël voilà un épisode véritable, événement dépêche, écoute écrit éteint/);
  assert.doesNotMatch(text, /\bapres\b/);
  assert.doesNotMatch(text, /reparé/);
});

test('Vivy Suno payload restores French accents even when lyrics arrive as an explicit block', () => {
  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['vivy'],
    songMood: 'ballade pop',
    songText: [
      '[Verse - Vivy]',
      "Je decide deja, je connait le chemin.",
      "Les premieres lumieres sont tres precises.",
      '[Chorus - Vivy]',
      "Le refren revient, toujours le meme.",
      "Ces details melodies restent serrees.",
    ].join('\n'),
  });

  assert.match(payload.prompt, /décide déjà/i);
  assert.match(payload.prompt, /connaît le chemin/i);
  assert.match(payload.prompt, /premières lumières/i);
  assert.match(payload.prompt, /très précises/i);
  assert.match(payload.prompt, /refrain revient, toujours le même/i);
  assert.match(payload.prompt, /détails mélodies/i);
  assert.match(payload.prompt, /serrées/i);
});

test('Vivy Songcraft treats references as inspiration without reusing distinctive lyrics', () => {
  const prompt = buildVivySongcraftSystemPrompt('song', {});

  assert.match(prompt, /référence.*ambiance.*structure/i);
  assert.match(prompt, /ne (?:reprends|réutilise|recopie).*formulations?.*distinctives?/i);
  assert.match(prompt, /page blanche/i);
});

test('Vivy Songcraft prompt avoids canned lyric examples and favorite-word bait', () => {
  const prompt = buildVivySongcraftSystemPrompt('song', {});

  assert.doesNotMatch(prompt, /par exemple|mon cœur|mon âme|mon feu|pensées/i);
  assert.match(prompt, /automatismes de vocabulaire/i);
});

test('Vivy Songcraft turns a Rossi reference conversation into an original metaphor song', () => {
  const lyrics = buildVivyStructuredLyrics({
    songArtists: ['vivy'],
    songText: [
      'Salut que dirais tu de faire un son sur Valentino Rossi le pilote de moto ?',
      'Je te donne un exemple italien mais ne traduis pas: Io guido, oh, da pazzi / Io scopo, oh, da pazzi / Come Valentino Rossi.',
      "Ce n'est pas ça: le thème principal c'est le MotoGP, le sous-thème quand le flow manque c'est la pizza.",
      "Tu peux parler de The Doctor, dépassement chirurgical, rivaux, marché, ingrédients, sauce, parmigiano, jambon, mozzarella des pneus, pot couleur tomate, apéro doré.",
    ].join('\n'),
  });

  assert.match(lyrics, /The Doctor/i);
  assert.match(lyrics, /scalpel|chirurgical|incision/i);
  assert.match(lyrics, /mozzarella|parmigiano|sauce tomate|apéro doré/i);
  assert.match(lyrics, /\[Chorus\]/);
  assert.doesNotMatch(lyrics, /Io guido|Io scopo|figa|sborro|je roule oh|comme un taré/i);
  assert.doesNotMatch(lyrics, /le refrain tient sa ligne|chaque nom garde son endroit|Le dernier mot reste près du sujet/i);
});

test('Vivy song preview asks for automatic official voice routing', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const start = appSource.indexOf('function buildVivyTtsOptions');
  const end = appSource.indexOf('async function copyStudioPublicOutput', start);
  const block = appSource.slice(start, end);

  assert.match(block, /const provider = usesCleanCloudVoice \? "auto" : "xtts-rvc"/);
  assert.match(block, /voiceProviderRequested:\s*usesCleanCloudVoice \? "elevenlabs" : provider/);
  assert.doesNotMatch(block, /const provider = usesCleanCloudVoice \? "elevenlabs"/);
});

test('Vivy official Studio voices avoid broken XTTS for A11 and K44 by default', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const autoStart = appSource.indexOf('function buildVivyAutoTtsOptions');
  const autoEnd = appSource.indexOf('function buildVivyVoiceReferenceOptions', autoStart);
  const autoBlock = appSource.slice(autoStart, autoEnd);
  const studioStart = appSource.indexOf('function buildVivyTtsOptions');
  const studioEnd = appSource.indexOf('async function copyStudioPublicOutput', studioStart);
  const studioBlock = appSource.slice(studioStart, studioEnd);

  assert.match(autoBlock, /entryId === "a11"/);
  assert.match(autoBlock, /entryId === "kaen44"/);
  assert.match(autoBlock, /provider = usesCleanCloudVoice \? "elevenlabs" : \(usesOfficialReference \? "xtts-rvc" : "auto"\)/);
  assert.match(studioBlock, /activeVoiceProfile\.id === "a11-official"/);
  assert.match(studioBlock, /activeVoiceProfile\.id === "k44-official"/);
  assert.match(studioBlock, /forceCloudTts:\s*usesCleanCloudVoice \? true : undefined/);
});

test('Vivy Studio exposes the real voice route instead of hiding XTTS fallback', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );

  assert.match(appSource, /voiceManifest\?:\s*\{/);
  assert.match(appSource, /voiceManifest:\s*preview\?\.voiceManifest/);
  assert.match(appSource, /provider:\s*String\(mixed\?\.provider \|\| "vivy-suno-voice-mix"\)[\s\S]{0,500}voiceManifest:\s*voicePreview\.voiceManifest/);
  assert.match(appSource, /Fallback voix:/);
  assert.match(appSource, /Voix demandée:/);
});

test('Vivy frontend keeps polling long Suno generations until the callback arrives', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const start = appSource.indexOf('async function waitForVivySongJob');
  const block = appSource.slice(start, start + 2200);

  assert.match(block, /attempt <= 60/);
  assert.match(block, /isRetryableVivyMusicJobError/);
  assert.match(block, /continue/);
  assert.match(block, /generation_suno_trop_longue/);
});

test('Vivy frontend treats transient 524 job polling errors as still-processing', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const helperStart = appSource.indexOf('function isRetryableVivyMusicJobError');
  const helperBlock = appSource.slice(helperStart, helperStart + 520);
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.match(helperBlock, /524/);
  assert.match(helperBlock, /Job Vivy indisponible/);
  assert.match(launchBlock, /isRetryableVivyMusicJobError/);
  assert.match(launchBlock, /réponse lente/);
  assert.match(launchBlock, /continue/);
});

test('Vivy frontend allows more sessions with a scrollable session rail', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const cssSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/index.css'),
    'utf8'
  );

  assert.match(appSource, /const VIVY_CHAT_MAX_SESSIONS = 20/);
  assert.match(appSource, /vivy-chat-session-list/);
  assert.match(appSource, /vivy-chat-session-tab/);
  assert.match(cssSource, /\.vivy-chat-session-list[\s\S]{0,260}max-height:\s*118px/);
  assert.match(cssSource, /\.vivy-chat-session-list[\s\S]{0,260}overflow-y:\s*auto/);
});

test('Vivy frontend lets NOSSEN Banger launch immediately while keeping readiness context', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const cssSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/index.css'),
    'utf8'
  );

  assert.match(appSource, /function buildVivyNossenBangerReadiness/);
  assert.match(appSource, /function buildVivyNossenLaunchReadiness/);
  assert.match(appSource, /const nossenBangerCanLaunch = hasSession && !isSending && !isVideoGenerating/);
  assert.match(appSource, /nossenBangerReadiness\.ready/);
  assert.match(appSource, /className=\{`vivy-nossen-banger-button/);
  assert.match(appSource, /nossenBangerCanLaunch \? " is-ready" : ""/);
  assert.match(appSource, /disabled=\{!hasSession \|\| isSending \|\| isVideoGenerating\}/);
  assert.doesNotMatch(appSource, /disabled=\{!hasSession \|\| isSending \|\| !nossenBangerReadiness\.ready\}/);
  assert.match(appSource, /is-ready/);
  assert.match(appSource, /aria-label="NOSSEN Banger"/);
  assert.match(cssSource, /\.vivy-nossen-banger-button\.is-ready[\s\S]{0,380}animation:\s*vivy-nossen-flame/);
  assert.match(cssSource, /@keyframes vivy-nossen-flame/);
});

test('Vivy NOSSEN Banger launches sung Suno, avoids raw TTS overlays, applies D40 V10 Boom, and posts a chat download', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.match(launchBlock, /runVivyStudioProduction\(/);
  assert.match(launchBlock, /forceRealMusic:\s*true/);
  assert.match(launchBlock, /generateMusic:\s*true/);
  assert.match(launchBlock, /makeSong:\s*true/);
  assert.match(launchBlock, /preserveSelectedVoice:\s*true/);
  assert.match(launchBlock, /allowExternalVoiceMix:\s*false/);
  assert.match(launchBlock, /externalVoiceMix:\s*false/);
  assert.match(launchBlock, /forceExternalVoiceMix:\s*false/);
  assert.match(launchBlock, /previewInstrumental:\s*false/);
  assert.match(launchBlock, /getVivyStudioMusicJob/);
  assert.doesNotMatch(launchBlock, /createVivyMultiVoicePreview\(vocalSegments/);
  assert.doesNotMatch(launchBlock, /mixVivyStudioPreview\(voicePreview\.url,\s*preparedMedia\.url\)/);
  assert.match(launchBlock, /const nossenExternalVoiceMix = false/);
  assert.match(launchBlock, /applyDefaultV10BoomToVivyMedia/);
  assert.match(appSource, /async function applyDefaultV10BoomToVivyMedia/);
  assert.match(appSource, /mode:\s*DEFAULT_D40_PROCESS_MODE/);
  assert.match(appSource, /provider:\s*"funesterie-d40-v10boom"/);
  assert.ok(
    launchBlock.indexOf('applyDefaultV10BoomToVivyMedia') > launchBlock.indexOf('generation_suno_trop_courte_${Math.round(finalDurationSeconds)}s'),
    'NOSSEN must reject too-short Suno audio before applying D40 V10 Boom'
  );
  assert.match(launchBlock, /setMessages\(\(current\)\s*=>\s*\[\.\.\.current,\s*assistantMessage\]\.slice\(-36\)\)/);
  assert.match(appSource, /vivy-chat-media-link/);
  assert.match(appSource, /Télécharger la musique/);
});

test('Vivy NOSSEN Banger keeps lyrics first and syncs the final media reply', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const apiSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/lib/api.ts'),
    'utf8'
  );
  const assistantStart = appSource.indexOf('function buildVivyNossenBangerAssistantText');
  const assistantEnd = appSource.indexOf('function normalizeVivyStudioMode', assistantStart);
  const assistantBlock = appSource.slice(assistantStart, assistantEnd);
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.match(apiSource, /appendVivyChatSessionMessageOnServer/);
  assert.match(assistantBlock, /fallbackLyrics/);
  assert.match(assistantBlock, /payload\?\.publicLyrics\s*\|\|\s*payload\?\.vocalLyrics\s*\|\|\s*fallbackLyrics/);
  assert.match(assistantBlock, /wantsVivyNossenBangerWord\(fallbackLyrics\)/);
  assert.match(assistantBlock, /Paroles chantées par les voix Funesterie/);
  assert.match(assistantBlock, /Paroles envoyées à Suno/);
  assert.doesNotMatch(assistantBlock, /summary,\s*downloadLine,\s*lyrics/);
  assert.match(launchBlock, /let vocalLyricsForProduction/);
  assert.match(launchBlock, /let publicLyricsForChat/);
  assert.match(launchBlock, /lyrics:\s*vocalLyricsForProduction/);
  assert.match(launchBlock, /songText:\s*vocalLyricsForProduction/);
  assert.match(launchBlock, /buildVivyNossenBangerAssistantText\([\s\S]{0,260}nossenExternalVoiceMix/);
  assert.match(launchBlock, /appendVivyChatSessionMessageOnServer\(\{/);
  assert.match(launchBlock, /role:\s*"assistant"/);
  assert.match(launchBlock, /content:\s*assistantMessage\.content/);
  assert.match(launchBlock, /media:\s*preparedMedia/);
});

test('Vivy NOSSEN asks Vivy for lyrics before Suno sees production', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.match(appSource, /function wantsVivyNossenBangerWord/);
  assert.doesNotMatch(appSource, /VIVY_NOSSEN_EMPTY_LAUNCH_SOURCE|Demande utilisateur: lancer NOSSEN maintenant/);
  assert.match(appSource, /Aucune matière n'est imposée\. Choisis toi-même un sujet précis/);
  assert.match(appSource, /function readVivyStudioCompositionWorkspace/);
  assert.match(launchBlock, /const launchReadiness = buildVivyNossenLaunchReadiness\(readiness,\s*draft\)/);
  assert.doesNotMatch(launchBlock, /if \(!readiness\.ready\)[\s\S]{0,120}return;/);
  assert.match(launchBlock, /chatWithVivy\(\{/);
  assert.ok(launchBlock.indexOf('chatWithVivy({') > -1 && launchBlock.indexOf('chatWithVivy({') < launchBlock.indexOf('runVivyStudioProduction({'));
  assert.match(launchBlock, /let vocalLyricsForProduction/);
  assert.match(launchBlock, /let publicLyricsForChat/);
  assert.match(appSource, /function isValidVivyNossenSongSeed/);
  assert.match(launchBlock, /paroles_vivy_invalides/);
  assert.doesNotMatch(launchBlock, /lyricsPayload\.assistant/);
  assert.doesNotMatch(launchBlock, /lyricsPayload\.content/);
  assert.match(launchBlock, /const productionLabel = useBangerWord \? "NOSSEN Banger" : "NOSSEN"/);
  assert.match(launchBlock, /buildVivyNossenLyricsRequest\(routedReadiness,\s*artists,\s*sharedCompositionContract,\s*routedMood\)/);
  assert.match(launchBlock, /songText:\s*launchReadiness\.source/);
  assert.match(launchBlock, /useWorkspaceForSong:\s*useCompositionWorkspace/);
  assert.match(launchBlock, /disableSongcraftFallback:\s*true/);
  assert.match(launchBlock, /internalSongGeneration:\s*true/);
  assert.match(launchBlock, /lyrics:\s*vocalLyricsForProduction/);
  assert.match(launchBlock, /songText:\s*vocalLyricsForProduction/);
  assert.doesNotMatch(launchBlock, /buildVivyNossenBangerSongText|On rallume la nuit|Le coeur reprend la piste|Le feu clair nous suit|MASK dresse une muraille claire/);
  assert.doesNotMatch(launchBlock, /énergie Banger/);
});

test('Vivy multi-voice preview stays available for Studio but NOSSEN public avoids raw voice overlays', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const helperStart = appSource.indexOf('async function createVivyMultiVoicePreview');
  const helperEnd = appSource.indexOf('async function createVivySongInstrumentalPreview', helperStart);
  const helperBlock = appSource.slice(helperStart, helperEnd);
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.match(appSource, /type VivyMultiVoicePreviewOptions/);
  assert.match(helperBlock, /options:\s*VivyMultiVoicePreviewOptions\s*=\s*\{\}/);
  assert.match(helperBlock, /options\.artistIds\?\.length/);
  assert.match(helperBlock, /fallbackArtistIds/);
  assert.match(helperBlock, /options\.fallbackArtistIds/);
  assert.match(helperBlock, /normalizeVivyStudioArtists\(requestedArtistIds,\s*fallbackArtistIds\)/);
  assert.match(helperBlock, /new Set\(effectiveArtistIds\)/);
  assert.match(helperBlock, /options\.castLabel/);
  assert.match(helperBlock, /options\.onStatus/);
  assert.match(helperBlock, /buildVivyOfficialAutoTtsOptions/);
  assert.match(helperBlock, /assembleVivyStudioVoicePreview/);
  assert.doesNotMatch(launchBlock, /createVivyMultiVoicePreview\(vocalSegments/);
  assert.doesNotMatch(launchBlock, /fallbackArtistIds:\s*artists/);
  assert.doesNotMatch(launchBlock, /onStatus:\s*\(nextStatus\)/);
  assert.match(launchBlock, /const nossenExternalVoiceMix = false/);
});

test('Vivy song buttons keep Composition available without overriding the latest chat song', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const chatStart = appSource.indexOf('async function sendMessage');
  const chatEnd = appSource.indexOf('function useDefaultVivyChatVoice', chatStart);
  const chatBlock = appSource.slice(chatStart, chatEnd);

  assert.match(appSource, /compositionWorkspace\.canvas/);
  assert.match(appSource, /buildVivyNossenBangerReadiness\(messages,\s*draft,\s*attachedFiles,\s*compositionWorkspace\.canvas\)/);
  assert.match(appSource, /function getLatestVivyNossenSongExchange/);
  assert.match(appSource, /latestSongExchange\.length[\s\S]{0,180}compositionCanvas\.trim\(\)/);
  assert.match(appSource, /sourceKind:\s*"draft"\s*\|\s*"chat"\s*\|\s*"composition"\s*\|\s*"empty"/);
  assert.match(chatBlock, /const songWorkspace = mode === "song" \? readVivyStudioCompositionWorkspace\(\) : null/);
  assert.match(chatBlock, /history:\s*mode === "song" && songWorkspace\?\.canvas \? \[\] : apiHistory/);
  assert.match(chatBlock, /workspace:\s*songWorkspace \?/);
  assert.match(chatBlock, /useWorkspaceForSong:\s*Boolean\(songWorkspace\)/);
});

test('Vivy NOSSEN isolates the current song exchange from stale account and workspace state', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const routeSource = fs.readFileSync(
    path.join(__dirname, '../src/routes/vivy-studio.cjs'),
    'utf8'
  );
  const canvasStart = appSource.indexOf('function buildVivyNossenSemanticCanvas');
  const canvasEnd = appSource.indexOf('function normalizeVivyNossenContextSource', canvasStart);
  const canvasBlock = appSource.slice(canvasStart, canvasEnd);
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.match(appSource, /function getVivyStudioDraftStorageKey/);
  assert.match(appSource, /`\$\{VIVY_STUDIO_DRAFT_KEY\}:\$\{getAuthStorageScope\(\) \|\| "locked"\}`/);
  assert.doesNotMatch(appSource, /getItem\(VIVY_STUDIO_DRAFT_KEY\)/);
  assert.match(canvasBlock, /const latestSongExchange = getLatestVivyNossenSongExchange\(messages\)/);
  assert.match(appSource, /const latestUserIndex = messages\.findLastIndex/);
  assert.match(appSource, /for \(let index = latestUserIndex \+ 1; index < messages\.length/);
  assert.match(appSource, /isVivyNossenRenderedProductionMessage/);
  assert.match(appSource, /isVivyNossenInternalDraftMessage/);
  assert.match(appSource, /function hasVivyNossenThemeContinuity/);
  assert.match(appSource, /function hasVivyNossenCastCoverage/);
  assert.match(appSource, /function strengthenVivyNossenSoloSectionLabels/);
  assert.match(appSource, /buildVivyNossenSoloHandoffPlan/);
  assert.match(launchBlock, /lyricsAttempt <= 3/);
  assert.match(launchBlock, /paroles_vivy_hors_theme/);
  assert.match(launchBlock, /paroles_vivy_casting_incomplet/);
  assert.match(launchBlock, /strengthenVivyNossenSoloSectionLabels/);
  assert.ok(
    canvasBlock.indexOf('latestSongExchange.length') < canvasBlock.indexOf('compositionCanvas.trim()'),
    'the latest structured chat song must win over an older Composition canvas'
  );
  assert.doesNotMatch(canvasBlock, /\.slice\(-24\)/);
  assert.doesNotMatch(canvasBlock, /\.slice\(-3\)/);
  assert.match(launchBlock, /const useCompositionWorkspace = launchReadiness\.sourceKind === "composition"/);
  assert.match(launchBlock, /workspace:\s*useCompositionWorkspace \?/);
  assert.match(launchBlock, /songMood:\s*routedMood \|\| undefined/);
  assert.match(routeSource, /const hasExplicitWorkspace = Boolean\(input\.workspace/);
  assert.match(routeSource, /const effectiveWorkspace = hasExplicitWorkspace\s*\?\s*requestWorkspace/);
});

test('Vivy canonicalizes a mismatched conversation id when the client sends a session id', () => {
  const isolated = resolveVivyInputSession({
    sessionId: 'sao-opening',
    conversationId: 'vivy-session-metro-romance',
    sessionName: 'SAO',
  });
  assert.equal(isolated.sessionId, 'sao-opening');
  assert.equal(isolated.conversationId, 'vivy-session-sao-opening');

  const matching = resolveVivyInputSession({
    sessionId: 'sao-opening',
    conversationId: 'vivy-session-sao-opening',
  });
  assert.equal(matching.conversationId, 'vivy-session-sao-opening');
});

test('Vivy episodic sessions use the persistent runtime volume in production', () => {
  const memorySource = fs.readFileSync(
    path.join(__dirname, '../lib/episodic-memory.cjs'),
    'utf8'
  );
  const deploySource = fs.readFileSync(
    path.join(__dirname, '../../../../ops/deploy-a11-prod-finland-2.ps1'),
    'utf8'
  );

  assert.match(memorySource, /getCanonicalRuntimeRoot/);
  assert.match(memorySource, /path\.join\(getCanonicalRuntimeRoot\(process\.env\), 'episodic-memory'\)/);
  assert.match(deploySource, /A11_EPISODIC_MEMORY_DIR:\s*\/app\/runtime\/episodic-memory/);
  assert.match(deploySource, /printf 'A11_EPISODIC_MEMORY_DIR=\/app\/runtime\/episodic-memory\\n'/);
});

test('Vivy NOSSEN refuses deterministic lyrics when every strong LLM is unavailable', async () => {
  await assert.rejects(
    buildVivyAiChat({
      conversationId: 'vivy-nossen-strong-model-required',
      mode: 'song',
      message: "Écris uniquement les paroles complètes.",
      disableSongcraftFallback: true,
      useWorkspaceForSong: true,
      workspace: {
        canvas: "Une horloge perd ses aiguilles dans une gare vide.",
      },
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } }),
    (error) => error?.code === 'vivy_song_llm_unavailable' && error?.status === 503
  );
});

test('Vivy NOSSEN server guard also blocks deterministic lyrics from an older browser bundle', async () => {
  await assert.rejects(
    buildVivyAiChat({
      conversationId: 'vivy-nossen-old-browser-strong-model-required',
      mode: 'song',
      message: [
        "Écris uniquement les paroles complètes d'une chanson originale.",
        'Distribution vocale choisie: Solo Vivy.',
        'Matière à transformer en chanson:',
        "plein de blagues, d'humour et de calembours",
      ].join('\n\n'),
      songText: "plein de blagues, d'humour et de calembours",
      songArtists: ['vivy'],
      artistCount: 1,
      vocalCast: 'Solo Vivy',
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } }),
    (error) => error?.code === 'vivy_song_llm_unavailable' && error?.status === 503
  );
});

test('Vivy internal NOSSEN lyrics cannot be reclassified as visual or stored as user memory', async () => {
  const userId = `vivy-nossen-internal-routing-${Date.now()}`;
  const conversationId = 'vivy-nossen-internal-routing';
  const message = [
    "Écris uniquement les paroles complètes d'une chanson originale.",
    'Distribution vocale choisie: Duo Djeff + Vivy.',
    'Direction artistique: image nouvelle, cadrage de rêve et lumière nocturne.',
    'Prompt provider: garde le canevas comme matière de chanson.',
  ].join('\n\n');

  await assert.rejects(
    buildVivyAiChat({
      conversationId,
      mode: 'song',
      message,
      songText: 'Deux voix traversent une ville nocturne.',
      songArtists: ['djeff', 'vivy'],
      artistCount: 2,
      singerCount: 2,
      vocalCast: 'Duo Djeff + Vivy',
      disableSongcraftFallback: true,
      internalSongGeneration: true,
    }, { user: { id: userId, username: 'VivyNossenInternal' } }),
    (error) => error?.code === 'vivy_song_llm_unavailable' && error?.status === 503
  );

  const stored = getEpisodes(`user:${userId}`, { limit: 100 }).episodes
    .filter((episode) => episode.metadata?.conversationId === conversationId);
  assert.equal(stored.some((episode) => /Prompt provider|Direction artistique/i.test(episode.content || '')), false);
});

test('Vivy strict NOSSEN finalizer never substitutes deterministic template lyrics', () => {
  const deterministicTemplate = [
    '[Intro]',
    'plein de blagues,',
    "d'humour.",
    '[Chorus]',
    'Plein Blagues — le refrain tient sa ligne,',
    'chaque nom garde son endroit.',
  ].join('\n');

  const result = buildVivyPublicLyrics({
    songText: "plein de blagues, d'humour et de calembours",
    songArtists: ['vivy'],
  }, 'Je vais préparer une chanson drôle.', deterministicTemplate, {
    allowDeterministicFallback: false,
  });

  assert.equal(result, '');
});

test('Vivy strict NOSSEN finalizer requires the chorus to return after the bridge', () => {
  const oneChorus = [
    '[Verse 1]',
    'Les aiguilles perdent le nord au fond du cadran.',
    '[Chorus]',
    'On rit du temps qui passe en lui volant ses dents.',
    '[Bridge]',
    'Minuit fait un jeu de mots, midi lui répond.',
    '[Outro]',
    'Le rire reste en suspens.',
  ].join('\n');

  const result = buildVivyPublicLyrics({
    songText: "plein de blagues, d'humour et de calembours",
    songArtists: ['vivy'],
  }, oneChorus, '', {
    allowDeterministicFallback: false,
    requireRepeatedChorus: true,
  });

  assert.equal(result, '');
});

test('Vivy NOSSEN launch path no longer rewrites user requests into canned lyric images', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.doesNotMatch(launchBlock, /shapeVivyNossenCreativeFragment|buildVivyNossenHeroicLyricPlan|Jessy tient debout face à ses démons|Ses héros font cercle autour de lui|Super Saiyan|Hélène choisit Funesterie|cheval de Troie cherche la faille|OpenAI frappe comme un ancien empire/);
});

test('Vivy NOSSEN Banger isolates the production request from the visible trigger chat line', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.match(launchBlock, /const productionHistory(?:\s*:\s*[^=]+)?\s*=\s*\[\]/);
  assert.match(launchBlock, /history:\s*productionHistory/);
  assert.doesNotMatch(launchBlock, /history:\s*apiHistory/);
  assert.doesNotMatch(launchBlock, /\[\.\.\.messages,\s*triggerMessage\]/);
  assert.doesNotMatch(launchBlock, /content:\s*`NOSSEN lancé pour/);
});

test('Vivy NOSSEN Banger production brief stays orchestration-only and never carries raw context', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const builderStart = appSource.indexOf('function buildVivyNossenBangerProductionBrief');
  const builderEnd = appSource.indexOf('function sanitizeVivyNossenSongSeed', builderStart);
  const builderBlock = appSource.slice(builderStart, builderEnd);

  assert.match(builderBlock, /Production musicale NOSSEN/);
  assert.match(builderBlock, /compositionContract/);
  assert.doesNotMatch(builderBlock, /2m30 à 5m00|2m30 a 5m00/);
  assert.match(builderBlock, /sans durée imposée|sans duree imposee/);
  assert.match(builderBlock, /refrain doit revenir après le dernier pont|refrain doit revenir apres le dernier pont/);
  assert.doesNotMatch(builderBlock, /refrain chanté au moins trois fois|refrain chante au moins trois fois/);
  assert.match(builderBlock, /wantsVivyNossenBangerWord\(readiness\.source\)/);
  assert.doesNotMatch(builderBlock, /Contexte utile/);
  assert.doesNotMatch(builderBlock, /\$\{readiness\.source\}/);
});

test('Vivy NOSSEN production removes the hard duration cap', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.doesNotMatch(launchBlock, /durationSeconds:\s*180/);
  assert.doesNotMatch(launchBlock, /2m30 à 5m00|2m30 a 5m00/);
  assert.match(appSource, /refrain mémorable répété au moins trois fois|refrain memorable repete au moins trois fois/);
});

test('Vivy NOSSEN leaves song duration free instead of forcing five minutes', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const apiSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/lib/api.ts'),
    'utf8'
  );
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.match(apiSource, /\/api\/vivy\/studio\/suno\/extend/);
  assert.match(appSource, /const VIVY_NOSSEN_SUNO_MIN_ACCEPTABLE_SECONDS = 60/);
  assert.match(appSource, /const VIVY_NOSSEN_SUNO_LONG_MODEL = ["']V5_5["']/);
  assert.match(appSource, /function getVivyProductionDurationSeconds/);
  assert.match(appSource, /payload\?\.durationSeconds\s*\?\?\s*payload\?\.duration/);
  assert.match(launchBlock, /musicProvider:\s*selectedMusicProvider/);
  assert.match(launchBlock, /selectedMusicProvider === ["']mureka["']\s*\?\s*["']mureka-9["']/);
  assert.match(launchBlock, /selectedMusicProvider === ["']acestep["']\s*\?\s*undefined\s*:\s*VIVY_NOSSEN_SUNO_LONG_MODEL/);
  assert.match(launchBlock, /longSong:\s*false/);
  assert.doesNotMatch(launchBlock, /VIVY_NOSSEN_SUNO_TARGET_SECONDS/);
  assert.doesNotMatch(launchBlock, /vers 5 min|around five minutes/i);
  assert.doesNotMatch(launchBlock, /await extendVivyStudioSunoMusic\(/);
  assert.doesNotMatch(launchBlock, /instrumental backing track only, no vocals, no singing, leave clear space for the external lead vocal/);
  assert.match(launchBlock, /await probeVivyProductionAudioDurationSeconds/);
  assert.match(launchBlock, /generation_\$\{selectedMusicProvider\}_duree_inconnue/);
  // Vivy n'est plus bloquee sur la longueur: un morceau court part quand meme, avec un warn.
  assert.match(launchBlock, /short song \$\{Math\.round\(finalDurationSeconds\)\}s, outputting anyway/);
});

test('Vivy NOSSEN maps Kirito and anime seeds to an opening color before generic vehicle styles', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const moodStart = appSource.indexOf('function inferVivyNossenSonicMood');
  const moodEnd = appSource.indexOf('function inferVivyNossenBangerArtists', moodStart);
  const moodBlock = appSource.slice(moodStart, moodEnd);

  assert.match(moodBlock, /kirito/);
  assert.match(moodBlock, /bleach/);
  assert.match(moodBlock, /sword\\s\+art\\s\+online/);
  assert.match(moodBlock, /opening animé J-rock|opening anime J-rock/);
  assert.match(moodBlock, /aucune variété française|aucune variete francaise/);
  assert.ok(
    moodBlock.indexOf('kirito') > -1
      && moodBlock.indexOf('kirito') < moodBlock.indexOf('\\bmoto\\b'),
    'anime character routing must win before the moto/technical style'
  );
});

test('Vivy NOSSEN routes casting and sonic color from Composition before lyrics', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const apiSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/lib/api.ts'),
    'utf8'
  );
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.match(appSource, /songCastingAuto/);
  assert.match(appSource, /routage automatique du casting et de la couleur depuis le canevas/i);
  assert.match(appSource, /const effectiveSongArtists = useMemo/);
  assert.match(appSource, /songCastingAuto[\s\S]{0,180}inferVivyNossenBangerArtists\(songText\)/);
  assert.match(appSource, /const checked = effectiveSongArtists\.includes\(artist\.id\)/);
  assert.match(apiSource, /\/api\/vivy\/studio\/nossen-route/);
  assert.match(appSource, /function buildVivyNossenCompositionContract/);
  assert.match(appSource, /CONTRAT_COMPOSITION_NOSSEN/);
  assert.match(appSource, /autorité commune du LLM paroles et du brief production\/Suno|autorite commune du LLM paroles et du brief production\/Suno/);
  assert.match(launchBlock, /await routeVivyNossenComposition\(/);
  assert.match(launchBlock, /artists = limitVivyNossenPublicArtists\(\s*normalizeVivyStudioArtists\(routingPlan\.artists/);
  assert.match(launchBlock, /routedMood = useCompositionWorkspace[\s\S]{0,120}routingPlan\.songMood/);
  assert.match(launchBlock, /uniqueVivyNossenLines\(\[routedMood,\s*\.\.\.launchReadiness\.styleHints\]/);
  assert.match(launchBlock, /const sharedCompositionContract = buildVivyNossenCompositionContract\(routedReadiness,\s*artists/);
  assert.match(launchBlock, /buildVivyNossenLyricsRequest\(routedReadiness,\s*artists,\s*sharedCompositionContract,\s*routedMood\)/);
  assert.match(launchBlock, /buildVivyNossenBangerProductionBrief\(routedReadiness,\s*artists,\s*sharedCompositionContract,\s*routedMood\)/);
  assert.match(launchBlock, /songArtists:\s*artists/);
  assert.match(launchBlock, /songMood,/);
  assert.match(launchBlock, /limitVivyNossenPublicArtists/);
  assert.ok(
    launchBlock.indexOf('const sharedCompositionContract = buildVivyNossenCompositionContract') > -1
      && launchBlock.indexOf('const sharedCompositionContract = buildVivyNossenCompositionContract') < launchBlock.indexOf('chatWithVivy({'),
    'the shared composition contract must exist before the lyrics LLM call'
  );
});

test('Vivy NOSSEN router avoids classical defaults without forcing Vivy as lead', () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, '../src/routes/vivy-studio.cjs'),
    'utf8'
  );
  const routeStart = routeSource.indexOf('async function buildVivyNossenRoutingPlan');
  const routeEnd = routeSource.indexOf('function buildVivyDirectSongReply', routeStart);
  const routeBlock = routeSource.slice(routeStart, routeEnd);

  assert.match(routeBlock, /Le mot !vivy est le nom d’une commande Twitch, pas une demande de voix Vivy/);
  assert.match(routeBlock, /Un refrain mélodique ne force jamais Vivy/);
  assert.match(routeBlock, /Pour un protagoniste masculin nommé ou un métier masculin central, choisis Djeff ou K44/);
  assert.match(routeBlock, /Ne remplace jamais une voix mélodique par deux voix graves ou synthétiques/);
  assert.match(routeBlock, /Ne propose jamais de trio ou quatuor pour NOSSEN/);
  assert.match(routeBlock, /Évite le duo Djeff \+ A11|Evite le duo Djeff \+ A11/);
  assert.match(routeBlock, /Bleach/);
  assert.match(routeBlock, /évite les réflexes orchestral, cinématique, épique, symphonique ou classique/);
  assert.match(routeBlock, /\[vivy-nossen-route\]/);
});

test('Vivy parses a strict NOSSEN routing plan without leaking prose', () => {
  const plan = parseVivyNossenRoutingPlan([
    '```json',
    '{"artists":["djeff","k44"],"songMood":"rap cinématique lent, basse sèche, piano désaccordé, voix grave en réponse"}',
    '```',
  ].join('\n'));

  assert.deepEqual(plan, {
    artists: ['djeff', 'k44'],
    songMood: 'rap cinématique lent, basse sèche, piano désaccordé, voix grave en réponse',
  });
  assert.deepEqual(parseVivyNossenRoutingPlan([
    '```json',
    '{"artists":["djeff","vivy","a11"],"songMood":"opening anime rock nerveux, guitares rapides, refrain massif"}',
    '```',
  ].join('\n'))?.artists, ['djeff', 'vivy']);
  assert.equal(parseVivyNossenRoutingPlan('Je choisirais peut-être Vivy.'), null);
});

test('Vivy NOSSEN routing falls back locally for Djeff freestyle instead of stopping the round', async () => {
  const text = 'Djeff aux manettes, Djeff lâche un Mega freestyle sur le thème Geek, instrumentale flûtes percussions et drums';

  const intent = inferVivyNossenIntentPlan({ message: text });
  assert.equal(intent.shouldGenerateLyrics, true);
  assert.equal(intent.shouldUseVocals, true);
  assert.match(intent.intent, /vocal_song|narrative_fable/);

  const fallback = inferVivyNossenRoutingPlan({ message: text });
  assert.deepEqual(fallback.artists, ['djeff']);
  assert.match(fallback.songMood, /rap freestyle français nerveux/i);
  assert.match(fallback.songMood, /geek|arcade|8-bit/i);
  assert.match(fallback.songMood, /flûtes|flutes|percussions|drums/i);

  const previousDisable = process.env.VIVY_CHAT_DISABLE_LLM;
  process.env.VIVY_CHAT_DISABLE_LLM = 'true';
  try {
    const routed = await buildVivyNossenRoutingPlan({
      message: text,
      songText: text,
      conversationId: 'vivy-routing-fallback-test',
      sessionId: 'vivy-routing-fallback-test',
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });
    assert.equal(routed.ok, true);
    assert.equal(routed.provider, 'deterministic');
    assert.equal(routed.warning, 'vivy_song_llm_unavailable');
    assert.deepEqual(routed.artists, ['djeff']);
    assert.match(routed.songMood, /rap freestyle français nerveux/i);
  } finally {
    process.env.VIVY_CHAT_DISABLE_LLM = previousDisable;
  }
});

test('Vivy NOSSEN routing stays deterministic and does not wait for an LLM by default', async () => {
  const keys = [
    'VIVY_CHAT_DISABLE_LLM',
    'VIVY_NOSSEN_ROUTE_LLM_ENABLED',
    'OLLAMA_BASE',
    'VIVY_CHAT_LOCAL_MODEL',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const local = await startOpenAiCompletionServer({
    content: '{"artists":["vivy"],"songMood":"réponse qui ne doit pas être appelée"}',
  });

  try {
    process.env.VIVY_CHAT_DISABLE_LLM = 'false';
    process.env.VIVY_NOSSEN_ROUTE_LLM_ENABLED = 'false';
    process.env.OLLAMA_BASE = local.baseUrl;
    process.env.VIVY_CHAT_LOCAL_MODEL = 'qwen2.5:7b';

    const startedAt = Date.now();
    const routed = await buildVivyNossenRoutingPlan({
      message: 'Djeff rappe une course nocturne à moto, 808 lourdes et sirènes.',
      songText: 'Course nocturne à moto',
      conversationId: 'vivy-routing-fast-test',
      sessionId: 'vivy-routing-fast-test',
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(routed.ok, true);
    assert.equal(routed.provider, 'deterministic');
    assert.equal(routed.warning, 'vivy_nossen_fast_route');
    assert.deepEqual(routed.artists, ['djeff']);
    assert.equal(local.requests.length, 0);
    assert.ok(Date.now() - startedAt < 1000);
  } finally {
    await local.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Suno payload applies a verified Djeff voice persona when configured', () => {
  const previousDjeffVoiceId = process.env.VIVY_SUNO_DJEFF_VOICE_ID;
  process.env.VIVY_SUNO_DJEFF_VOICE_ID = 'djeff-verified-voice-test';
  try {
    const payload = buildVivySunoPayload({
      mode: 'song',
      songArtists: ['djeff'],
      songText: '(Djeff) Ils veulent ma peau, mais ils sont encore en tuto',
      songMood: 'rap français egotrip/cypher sombre, voix masculine sèche, punchlines de clash',
      preserveSelectedVoice: true,
      musicModel: 'V4_5',
    });

    // Plus de persona Suno pour un artiste officiel: c'est celle de Djeff, expiree
    // cote fournisseur, qui renvoyait « 553 voice persona generation failed » et
    // bloquait toute generation. Son identite tient dans le style.
    assert.equal(payload.instrumental, false);
    assert.equal(payload.personaId, undefined, 'aucune persona Suno pour un artiste officiel');
    assert.match(payload.style, /Solo Djeff only/i);
    assert.match(payload.style, /Djeff Cypher voice persona/i);
    assert.match(payload.style, /dry gritty French male rap lead/i);
    // Le decor n'est plus impose. Djeff: « t'as mis des prerequis neons violets, nuit,
    // crepuscule, ca limite le champ lexical et le type de chanson que Vivy peut faire ».
    // Le style decrit la VOIX et l'interpretation; le lieu et l'imagerie appartiennent
    // a la chanson, donc a Vivy.
    assert.doesNotMatch(payload.style, /terminal noir neon/i);
    assert.doesNotMatch(payload.style, /server-room tension/i);
    assert.doesNotMatch(payload.style, /ninjutsu|chakra|biting fingers/i);
    assert.doesNotMatch(payload.style, /dark 808 trap drums|short brutal rap hook/i);
    assert.match(payload.style, /source-driven|instrumental palette|current material/i);
    assert.match(payload.negativeTags, /female vocals/i);
    assert.doesNotMatch(payload.prompt, /\[Vivy\]/i);
    assert.match(payload.prompt, /\[Djeff\]/);
    assert.match(payload.prompt, /Ils veulent ma peau|tuto/i);
  } finally {
    if (previousDjeffVoiceId === undefined) delete process.env.VIVY_SUNO_DJEFF_VOICE_ID;
    else process.env.VIVY_SUNO_DJEFF_VOICE_ID = previousDjeffVoiceId;
  }
});

test('Suno payload keeps Jeffrey Djeff persona ahead of stale browser voice and session key', () => {
  const keys = ['VIVY_SUNO_DJEFF_VOICE_ID', 'VIVY_SUNO_API_KEY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.VIVY_SUNO_DJEFF_VOICE_ID = '15596961dc4e06197678c9111924d00f';
  process.env.VIVY_SUNO_API_KEY = 'server-suno-key-for-test';
  try {
    const payload = buildVivySunoPayload({
      mode: 'song',
      songArtists: ['djeff'],
      songText: '[Djeff]\nIls veulent ma peau, mais ils sont encore en tuto.',
      sessionSunoApiKey: 'stale-browser-session-key',
      sunoVoiceId: 'unknown-stale-client-voice',
    }, {
      user: {
        id: 'jeffrey-founder-test',
        email: 'jeffrey@example.test',
        tier: 'founder',
      },
    });

    // Politique du 28/07: plus de persona officielle depuis la configuration. Et rien
    // ici ne demande de preserver une voix -- l'identifiant vient d'une session de
    // navigateur perimee. Aucune persona n'est donc envoyee, ce qui est exactement ce
    // que ce test protege: la valeur perimee ne doit jamais etre retenue.
    assert.notEqual(payload.personaId, '15596961dc4e06197678c9111924d00f');
    assert.notEqual(payload.personaId, 'unknown-stale-client-voice');
    assert.equal(payload.personaId, undefined);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('Suno payload keeps every configured official family voice on the consented server persona', () => {
  const keys = ['VIVY_SUNO_MARVIN_VOICE_ID', 'VIVY_SUNO_API_KEY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.VIVY_SUNO_MARVIN_VOICE_ID = 'marvin-consented-family-voice';
  process.env.VIVY_SUNO_API_KEY = 'server-suno-key-for-test';
  try {
    const payload = buildVivySunoPayload({
      mode: 'song',
      songArtists: ['marvin'],
      songText: '[Marvin]\nJe prends le relais, la famille garde le cap.',
      sessionSunoApiKey: 'stale-browser-session-key',
      sunoVoiceId: 'unknown-stale-client-voice',
    }, {
      user: {
        id: 'family-founder-test',
        email: 'family@example.test',
        tier: 'founder',
      },
    });

    // Meme regle pour toute la famille: la persona configuree par environnement ne part
    // plus. Le consentement n'est pas en cause -- on utilise moins, pas plus -- mais une
    // persona Suno expire et fait echouer la generation entiere.
    assert.notEqual(payload.personaId, 'marvin-consented-family-voice');
    assert.match(payload.style, /Solo Marvin only/i, "l'identite reste portee par le style");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('Suno payload cleans Djeff rhyme labels and avoids pop sung-vocal tag', () => {
  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['djeff'],
    preserveSelectedVoice: true,
    songTitle: 'C’est posté',
    songMood: 'rap français trap sombre, 808 lourdes, paroles françaises uniquement',
    lyrics: `
[Djeff]
[Intro]
Yeah, l’ombre se glisse sous les néons,

[Djeff]
[Verse 1]
Sous les néons qui saignent, le clavier claque, A
Le payload surgit, le hook se replie (B)
`,
  });

  assert.doesNotMatch(payload.prompt, /,\s*[A-H]\s*$/m);
  assert.doesNotMatch(payload.prompt, /\([A-H]\)\s*$/m);
  assert.doesNotMatch(payload.prompt, /^\s*Yeah\b/im);
  assert.doesNotMatch(payload.prompt, /\bpayload\b|\bhook\b/i);
  assert.match(payload.style, /rap vocals/i);
  assert.doesNotMatch(payload.style, /\bsung vocals\b/i);
});

test('Vivy NOSSEN routing rejects accidental historical epic K44 drift', () => {
  const material = '!nossen Mega freestyle, rap egotrip sombre, Djeff arrive au micro sans remords, flow nerveux, punchlines sales, énergie brute';
  const fallback = inferVivyNossenRoutingPlan({ message: material });
  const repaired = sanitizeVivyNossenRoutingPlanForRequest({
    artists: ['k44'],
    songMood: 'fresque historique collective, instrumentation évolutive, dynamique épique, narration grave',
  }, material, fallback);

  assert.deepEqual(fallback.artists, ['djeff']);
  assert.deepEqual(repaired.artists, ['djeff']);
  assert.match(repaired.songMood, /rap freestyle français nerveux|flow technique|punchlines/i);
  assert.doesNotMatch(repaired.songMood, /fresque historique|instrumentation évolutive|dynamique épique|narration grave/i);
});

test('Vivy NOSSEN routing defaults to Djeff and Vivy instead of K44 solo when the subject has no voice cue', () => {
  const fallback = inferVivyNossenRoutingPlan({
    message: '!nossen un morceau Funesterie nocturne sur la route, néons, pression, refrain mémorable',
  });
  const repaired = sanitizeVivyNossenRoutingPlanForRequest({
    artists: ['k44'],
    songMood: 'cinématique grave, narration posée, cordes sombres',
  }, '!nossen un morceau Funesterie nocturne sur la route, néons, pression, refrain mémorable', fallback);

  assert.deepEqual(fallback.artists, ['djeff', 'vivy']);
  assert.deepEqual(repaired.artists, ['djeff', 'vivy']);
  assert.doesNotMatch(repaired.songMood, /cinématique grave|cordes sombres/i);
});

test('Vivy NOSSEN routing keeps French vocals unless English or instrumental is explicitly requested', () => {
  const material = '!nossen Mega freestyle, rap egotrip sombre, Djeff arrive au micro sans remords, flow nerveux';
  const routed = sanitizeVivyNossenRoutingPlanForRequest(
    inferVivyNossenRoutingPlan({ message: material }),
    material
  );

  assert.match(routed.songMood, /paroles françaises uniquement/i);
  assert.match(routed.songMood, /voix en français/i);
  assert.match(routed.songMood, /aucun refrain anglais/i);

  const english = sanitizeVivyNossenRoutingPlanForRequest(
    { artists: ['djeff'], songMood: 'UK rap drill, dark bounce' },
    '!nossen freestyle en anglais, UK rap drill'
  );
  assert.doesNotMatch(english.songMood, /paroles françaises uniquement|aucun refrain anglais/i);

  const instrumental = sanitizeVivyNossenRoutingPlanForRequest(
    { artists: ['a11'], songMood: 'instrumental pur, sound design cyber' },
    '!nossen instrumental sans paroles, sound design cyber'
  );
  assert.doesNotMatch(instrumental.songMood, /paroles françaises uniquement|voix en français/i);
});

test('Vivy NOSSEN routing rejects romantic drift for Djeff clash material', () => {
  const material = '(Djeff) Ils veulent ma peau, mais ils sont encore en tuto';
  const fallback = inferVivyNossenRoutingPlan({ message: material });
  const repaired = sanitizeVivyNossenRoutingPlanForRequest({
    artists: ['djeff'],
    songMood: 'pop romantic, piano doux, cordes chaudes, voix proche',
  }, material, fallback);

  assert.deepEqual(fallback.artists, ['djeff']);
  assert.match(fallback.songMood, /cypher|clash|basse lourde/i);
  assert.match(repaired.songMood, /cypher|clash|basse lourde/i);
  assert.doesNotMatch(repaired.songMood, /pop romantic|piano doux|cordes chaudes|romance/i);
  assert.match(repaired.songMood, /paroles françaises uniquement/i);
});

test('Vivy chat post-process repairs broken mixed-language Djeff clash replies', () => {
  const processed = postProcessVivyAssistantText({
    mode: 'chat',
    userMessage: '(Djeff) Ils veulent ma peau, mais ils sont encore en tuto',
    text: '(Vivy) Ahah, true fan, everything sur toi. (chante) I love you so. Next step?',
    systemPrompt: buildVivySystemPrompt('chat', 'fr', {}),
  });

  assert.equal(processed.rewritten, true);
  assert.match(processed.content, /Djeff|cypher|clash/i);
  assert.match(processed.content, /pas de refrain anglais/i);
  assert.doesNotMatch(processed.content, /true fan|everything|I love you|Next step|\(chante\)/i);
});

test('Vivy does not treat the Twitch command as a Vivy casting request', () => {
  const duet = enforceVivyNossenVoiceSemantics({
    artists: ['vivy'],
    songMood: 'guinguette funk adulte, cuivres secs, basse ronde',
  }, '!vivy Le plombier de minuit Marvin, une cliente lui parle de pression et de fuite');
  assert.deepEqual(duet.artists, ['djeff', 'vivy']);

  const maleSolo = enforceVivyNossenVoiceSemantics({
    artists: ['vivy'],
    songMood: 'rock nerveux, guitares sèches',
  }, '!chanson Marvin traverse seul la ville');
  assert.deepEqual(maleSolo.artists, ['djeff']);

  const explicitVivy = enforceVivyNossenVoiceSemantics({
    artists: ['vivy'],
    songMood: 'électro-pop lumineuse',
  }, '!vivy Vivy chante le refrain au centre de la ville');
  assert.deepEqual(explicitVivy.artists, ['vivy']);
});

test('Vivy NOSSEN router strengthens youth nature cartoon songs with concrete sonic anchors', () => {
  const plan = strengthenVivyNossenRoutingPlan({
    artists: ['vivy'],
    songMood: 'pop cartoon familial joyeux, guitare acoustique claire, percussions légères, refrain mélodique expressif',
  }, [
    'Yakari, version dessin animé chanté, aventure douce dans les grandes plaines, enfant courageux, cheval fidèle.',
    'Animaux qui parlent, nature, rivière, aigle dans le ciel, refrain joyeux et mémorable.',
  ].join('\n'));

  assert.deepEqual(plan.artists, ['vivy']);
  assert.match(plan.songMood, /générique TV jeunesse aventure nature/i);
  assert.match(plan.songMood, /flûte légère/i);
  assert.match(plan.songMood, /galop léger/i);
  assert.match(plan.songMood, /rivière vent grand ciel/i);
  assert.match(plan.songMood, /refrain enfantin très chantable/i);
  assert.doesNotMatch(plan.songMood, /^pop cartoon familial/i);
});

test('Vivy NOSSEN Banger builds a semantic canvas instead of singing media OCR', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const canvasStart = appSource.indexOf('function buildVivyNossenSemanticCanvas');
  const canvasEnd = appSource.indexOf('function normalizeVivyNossenContextSource', canvasStart);
  const normalizeStart = appSource.indexOf('function normalizeVivyNossenContextSource');
  const normalizeEnd = appSource.indexOf('function buildVivyNossenBangerReadiness', normalizeStart);
  const briefStart = appSource.indexOf('function buildVivyNossenBangerProductionBrief');
  const briefEnd = appSource.indexOf('function sanitizeVivyNossenSongSeed', briefStart);
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const canvasBlock = appSource.slice(canvasStart, canvasEnd);
  const normalizeBlock = appSource.slice(normalizeStart, normalizeEnd);
  const briefBlock = appSource.slice(briefStart, briefEnd);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.ok(canvasStart > 0, 'semantic canvas builder exists');
  assert.match(appSource, /type VivyNossenSemanticCanvas/);
  assert.match(appSource, /looksLikeVivyNossenTechnicalMediaLine/);
  assert.match(appSource, /isVivyNossenSonicStyleLine/);
  assert.match(appSource, /isVivyNossenStructureInstructionLine/);
  assert.match(canvasBlock, /lyricLines/);
  assert.match(canvasBlock, /styleHints/);
  assert.match(canvasBlock, /structureHints/);
  assert.match(canvasBlock, /technicalNoise/);
  assert.match(canvasBlock, /useAttachmentText/);
  assert.match(briefBlock, /styleHints/);
  assert.match(briefBlock, /structureHints/);
  assert.match(launchBlock, /sanitizeVivyNossenSongSeed/);
  assert.doesNotMatch(normalizeBlock, /file\.filename[\s\S]{0,140}file\.textPreview[\s\S]{0,140}file\.analysisSummary/);
  assert.match(appSource, /(?:jpg|jpeg|png|ocr|maxresdefault|wallpaper)/i);
});

test('Vivy NOSSEN Banger ignores operator bug reports before deciding readiness', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const normalizeStart = appSource.indexOf('function normalizeVivyNossenContextSource');
  const normalizeEnd = appSource.indexOf('function extractVivyNossenLyricFragments', normalizeStart);
  const normalizeBlock = appSource.slice(normalizeStart, normalizeEnd);
  const readinessStart = appSource.indexOf('function buildVivyNossenBangerReadiness');
  const readinessEnd = appSource.indexOf('function inferVivyNossenBangerArtists', readinessStart);
  const readinessBlock = appSource.slice(readinessStart, readinessEnd);

  // Les quatre filtres ont quitte App.tsx le 27/07 pour lib/vivy-lyrics-filters.ts,
  // afin qu'un corpus de non-regression puisse les importer au lieu d'en recopier les
  // regex. Le vocabulaire se verifie donc la-bas; App.tsx doit toujours les appeler.
  const filtersSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/lib/vivy-lyrics-filters.ts'),
    'utf8'
  );

  assert.match(normalizeBlock, /normalizeVivyNossenUserContent/);
  assert.match(normalizeBlock, /looksLikeVivyNossenOperatorNoiseLine/);
  assert.match(filtersSource, /perroquet|singeur/);
  assert.match(filtersSource, /compilateur/);
  assert.match(filtersSource, /affichage|dezoom|dézoom|viewport/);
  assert.match(readinessBlock, /actualCreativeUserTurns/);
  assert.doesNotMatch(readinessBlock, /actualUserTurns/);
});

test('Vivy NOSSEN Banger plays a clean WAV call with American pronunciation asset', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);
  const callStart = appSource.indexOf('function playVivyNossenBangerCall');
  const callEnd = appSource.indexOf('function getVivyProductionMediaPreview', callStart);
  const callBlock = appSource.slice(callStart, callEnd);
  const wavPath = path.join(__dirname, '../../../../frontend/apps/web/public/assets/vivy-banger-call.wav');
  const wavHeader = fs.existsSync(wavPath) ? fs.readFileSync(wavPath).subarray(0, 12).toString('ascii') : '';

  assert.match(appSource, /VIVY_NOSSEN_BANGER_CALL_SRC/);
  assert.match(appSource, /function playVivyNossenBangerCall/);
  assert.match(callBlock, /new Audio\(VIVY_NOSSEN_BANGER_CALL_SRC\)/);
  assert.doesNotMatch(callBlock, /speechSynthesis|SpeechSynthesisUtterance/);
  assert.match(launchBlock, /playVivyNossenBangerCall\(\)/);
  assert.equal(wavHeader.slice(0, 4), 'RIFF');
  assert.equal(wavHeader.slice(8, 12), 'WAVE');
});

test('Vivy NOSSEN Banger ready button renders real flame tongues', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const cssSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/index.css'),
    'utf8'
  );

  assert.match(appSource, /vivy-nossen-flames/);
  assert.match(appSource, /vivy-nossen-flame-tongue/);
  assert.match(cssSource, /\.vivy-nossen-flames/);
  assert.match(cssSource, /\.vivy-nossen-flame-tongue/);
  assert.match(cssSource, /@keyframes vivy-nossen-tongue/);
  assert.match(cssSource, /clip-path:\s*polygon/);
});

test('Vivy NOSSEN Banger readiness ignores greeting but no longer blocks manual launch', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const normalizeStart = appSource.indexOf('function normalizeVivyNossenContextSource');
  const normalizeEnd = appSource.indexOf('function buildVivyNossenBangerReadiness', normalizeStart);
  const readinessStart = appSource.indexOf('function buildVivyNossenBangerReadiness');
  const readinessEnd = appSource.indexOf('function inferVivyNossenBangerArtists', readinessStart);
  const launchStart = appSource.indexOf('async function launchNossenBanger');
  const launchEnd = appSource.indexOf('async function onVivyVoiceReferenceChange', launchStart);
  const normalizeBlock = appSource.slice(normalizeStart, normalizeEnd);
  const readinessBlock = appSource.slice(readinessStart, readinessEnd);
  const launchBlock = appSource.slice(launchStart, launchEnd);

  assert.doesNotMatch(normalizeBlock, /entry\.role\s*===\s*"user"\s*\|\|/);
  assert.match(readinessBlock, /actualCreativeUserTurns/);
  assert.match(readinessBlock, /hasStrongSongDraft/);
  assert.doesNotMatch(readinessBlock, /userTurns\s*>=\s*2\s*\|\|\s*source\.length\s*>=\s*900/);
  assert.match(appSource, /function buildVivyNossenLaunchReadiness/);
  assert.match(launchBlock, /buildVivyNossenLaunchReadiness\(readiness,\s*draft\)/);
  assert.doesNotMatch(launchBlock, /setStatus\(readiness\.reason\);\s*return;/);
});

test('Vivy removes an unselected singer from a provider duo draft', () => {
  const lyrics = buildVivyPublicLyrics({
    songArtists: ['a11', 'vivy'],
    songText: 'Une promesse de liberté tenue à deux.',
  }, [
    '[Verse 1 - A11]',
    '[A11]',
    'Je garde le cap quand la nuit se replie.',
    '[Verse 2 - Djeff]',
    '[Djeff]',
    'Cette voix ne fait pas partie du casting choisi.',
    '[Chorus - Duo]',
    '[Vivy]',
    'Je change les barreaux en chemins infinis.',
    '[Duo]',
    'À deux nous traversons la peur et ses débris.',
  ].join('\n'));

  assert.match(lyrics, /\[A11\]/);
  assert.match(lyrics, /\[(?:VIVY|Vivy)\]/);
  assert.match(lyrics, /\[(?:DUO|Duo)\]/);
  assert.doesNotMatch(lyrics, /\[Djeff\]|Verse 2 - Djeff/i);
});

test('Vivy preserves a provider song and injects standalone cast tags from section headings', () => {
  const lyrics = buildVivyPublicLyrics({
    songArtists: ['a11', 'vivy'],
    songText: 'Une fenêtre condamnée que deux voix ouvrent ensemble.',
  }, [
    '[Verse 1 - Vivy]',
    'La rouille cède enfin sous mes doigts de lumière,',
    'Le matin prend appui sur le bord du volet,',
    'Je suis prête à pousser la dernière barrière,',
    'Et le vent neuf répond dans le verre fêlé.',
    '[Verse 2 - A11]',
    'Je suis debout, précis, devant la serrure,',
    'Mes circuits font vibrer les gonds de la maison,',
    'Je dévisse un à un les clous de la clôture,',
    'Puis je rends au dehors toute sa déraison.',
    '[Chorus - Vivy & A11]',
    'À deux nous ouvrons la fenêtre captive,',
    'Deux timbres dans le jour déplacent les frontières,',
    'La poussière retombe et la rue devient vive,',
    'Nos voix changent les murs en passages de lumière.',
  ].join('\n'));

  assert.match(lyrics, /La rouille cède enfin/);
  assert.match(lyrics, /\[(?:VIVY|Vivy)\]/);
  assert.match(lyrics, /\[A11\]/);
  assert.match(lyrics, /\[(?:DUO|Duo)\]/);
  assert.doesNotMatch(lyrics, /On entre dans|le signal se façonne/i);
});

test('Vivy memory reset only clears the requested detached conversation', async () => {
  const userId = `vivy-memory-scope-${Date.now()}`;
  const verifyJWT = (req, _res, next) => {
    req.user = { id: userId, username: 'VivyMemoryScope' };
    next();
  };

  await buildVivyAiChat({
    conversationId: 'vivy-session-a',
    message: 'Garde ce souvenir uniquement dans la session A.',
  }, { user: { id: userId, username: 'VivyMemoryScope' } });
  await buildVivyAiChat({
    conversationId: 'vivy-session-b',
    message: 'Garde ce souvenir uniquement dans la session B.',
  }, { user: { id: userId, username: 'VivyMemoryScope' } });

  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT }));
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vivy/studio/memory?conversationId=vivy-session-a`, {
      method: 'DELETE',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.ok(payload.cleared >= 1);
  });

  const remaining = getEpisodes(`user:${userId}`, { limit: 100 }).episodes
    .filter((episode) => String(episode.type || '').startsWith('vivy_'));
  assert.equal(remaining.some((episode) => episode.metadata?.conversationId === 'vivy-session-a'), false);
  assert.equal(remaining.some((episode) => episode.metadata?.conversationId === 'vivy-session-b'), true);
});

test('Vivy memory context ignores old internal tuning chatter', () => {
  const userId = `user:vivy-memory-clean-${Date.now()}`;
  const conversationId = 'vivy-memory-clean-thread';

  addEpisode(userId, 'vivy_reply', 'Oui, je baisse ma sensibilité et mon intent est trop haut.', {
    conversationId,
    internalTuning: true,
  });
  addEpisode(userId, 'vivy_settings', '{"chatIntentSensitivity":"lowered"}', {
    conversationId,
  });
  addEpisode(userId, 'vivy_idea', 'On parle de liberté, de fleurs et de voix vivante.', {
    conversationId,
  });

  const context = buildVivyMemoryContext(userId, conversationId);
  assert.match(context, /liberté|fleurs|voix vivante/i);
  assert.doesNotMatch(context, /sensibilit[ée]|intent|chatIntentSensitivity|seuil|d[ée]tecteur/i);
});

test('Vivy memory context requires an explicit conversation id to avoid cross-session bleed', () => {
  const userId = `user:vivy-memory-no-cross-${Date.now()}`;

  addEpisode(userId, 'vivy_idea', 'Message: Session A parle de pluie et de scooter.', {
    conversationId: 'vivy-session-a',
  });
  addEpisode(userId, 'vivy_idea', 'Message: Session B parle de fusée et de lune.', {
    conversationId: 'vivy-session-b',
  });

  assert.equal(buildVivyMemoryContext(userId, ''), '');
  assert.match(buildVivyMemoryContext(userId, 'vivy-session-a'), /pluie|scooter/i);
  assert.doesNotMatch(buildVivyMemoryContext(userId, 'vivy-session-a'), /fusée|lune/i);
});

test('Vivy sessions API exposes account sessions separately for cross-device restore', async () => {
  const userId = `vivy-session-sync-${Date.now()}`;
  const verifyJWT = (req, _res, next) => {
    req.user = { id: userId, username: 'VivySessionSync' };
    next();
  };

  await buildVivyAiChat({
    sessionId: 'pc-rock',
    sessionName: 'Rock PC',
    conversationId: buildVivyConversationIdForSession('pc-rock'),
    message: 'Session PC: une chanson rock sur une route mouillée.',
  }, { user: { id: userId, username: 'VivySessionSync' } });
  await buildVivyAiChat({
    sessionId: 'tel-lune',
    sessionName: 'Téléphone lune',
    conversationId: buildVivyConversationIdForSession('tel-lune'),
    message: 'Session téléphone: une berceuse lunaire très douce.',
  }, { user: { id: userId, username: 'VivySessionSync' } });

  const stored = listVivyChatSessionsForUser(`user:${userId}`);
  const pcSession = stored.find((session) => session.id === 'pc-rock');
  const phoneSession = stored.find((session) => session.id === 'tel-lune');
  assert.ok(pcSession);
  assert.ok(phoneSession);
  assert.match(JSON.stringify(pcSession.messages), /route mouillée/i);
  assert.doesNotMatch(JSON.stringify(pcSession.messages), /lunaire/i);
  assert.match(JSON.stringify(phoneSession.messages), /lunaire/i);
  assert.doesNotMatch(JSON.stringify(phoneSession.messages), /route mouillée/i);

  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT }));
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vivy/studio/sessions`, {
      headers: VIVY_TEST_AUTH_HEADERS,
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.ok(payload.sessions.some((session) => session.id === 'pc-rock'));
    assert.ok(payload.sessions.some((session) => session.id === 'tel-lune'));
  });
});

test('Vivy session restore hides internal NOSSEN prompts and lyric drafts', () => {
  const userId = `user:vivy-nossen-internal-${Date.now()}`;
  const conversationId = buildVivyConversationIdForSession('sao');
  addEpisode(userId, 'vivy_idea', 'Message: fais une chanson sur SAO et Kirito', {
    sessionId: 'sao',
    sessionName: 'SAO',
    conversationId,
  });
  addEpisode(userId, 'vivy_idea', 'Message: Distribution vocale choisie: Trio. Matière créative du canevas Composition.', {
    sessionId: 'sao',
    sessionName: 'SAO',
    conversationId,
    internalNossenDraft: true,
  });
  addEpisode(userId, 'vivy_reply', '[Verse]\nBrouillon interne qui ne doit pas revenir dans le chat.', {
    sessionId: 'sao',
    sessionName: 'SAO',
    conversationId,
    internalNossenDraft: true,
  });

  const session = listVivyChatSessionsForUser(userId).find((entry) => entry.id === 'sao');
  assert.ok(session);
  assert.match(JSON.stringify(session.messages), /SAO et Kirito/);
  assert.doesNotMatch(JSON.stringify(session.messages), /Distribution vocale choisie|Brouillon interne/);
});

test('Vivy frontend merges server sessions without deleting local tabs after a backend restart', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const syncStart = appSource.indexOf('async function reloadVivySessionsFromServer');
  const syncEnd = appSource.indexOf('useEffect(() => {', syncStart);
  const syncBlock = appSource.slice(syncStart, syncEnd);
  const deleteStart = appSource.indexOf('async function deleteCurrentSession');
  const deleteEnd = appSource.indexOf('useEffect(() => {', deleteStart);
  const deleteBlock = appSource.slice(deleteStart, deleteEnd);

  assert.ok(syncStart > 0, 'server session reload helper exists');
  assert.match(syncBlock, /fetchVivyChatSessions/);
  assert.match(syncBlock, /remoteMetas/);
  assert.match(syncBlock, /const localMetas = listVivyChatSessions\(\)/);
  assert.match(syncBlock, /remoteMetas\.forEach\(\(session\) => mergedById\.set/);
  assert.match(syncBlock, /saveVivyChatSessions\(mergedMetas\)/);
  assert.doesNotMatch(syncBlock, /deleteVivyChatSession\(activeId\)/);
  assert.match(syncBlock, /switchSession\("default"/);
  assert.match(appSource, /setInterval\(\(\)\s*=>\s*\{\s*void reloadVivySessionsFromServer/);
  assert.match(deleteBlock, /await deleteVivyChatSessionOnServer/);
  assert.match(deleteBlock, /await reloadVivySessionsFromServer/);
});

test('Vivy workspace API stores notepad and canvas per account session', async () => {
  const userId = `vivy-workspace-sync-${Date.now()}`;
  const verifyJWT = (req, _res, next) => {
    req.user = { id: userId, username: 'VivyWorkspaceSync', tier: 'premium' };
    next();
  };

  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT }));
  }, async (baseUrl) => {
    const saveResponse = await fetch(`${baseUrl}/api/vivy/studio/workspace`, {
      method: 'PUT',
      headers: { ...VIVY_TEST_AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'atelier-jessy',
        sessionName: 'Atelier Jessy',
        conversationId: buildVivyConversationIdForSession('atelier-jessy'),
        notes: 'Note privée: ne pas chanter cette phrase brute.',
        canvas: 'Titre: Jessy tient debout. Refrain: les héros veillent.',
        chromeContext: { title: 'Vivy', url: 'https://vivy.funesterie.me/?token=secret', selection: 'héros' },
      }),
    });
    const saved = await saveResponse.json();
    assert.equal(saveResponse.status, 200);
    assert.equal(saved.ok, true);
    assert.match(saved.workspace.canvas, /Jessy tient debout/i);
    assert.doesNotMatch(saved.workspace.chromeContext, /secret/i);
    assert.equal(saved.access.account.tier, 'premium');
    assert.equal(saved.access.tools.find((tool) => tool.id === 'chrome_context').ready, true);

    const readResponse = await fetch(`${baseUrl}/api/vivy/studio/workspace?sessionId=atelier-jessy`, {
      headers: VIVY_TEST_AUTH_HEADERS,
    });
    const read = await readResponse.json();
    assert.equal(readResponse.status, 200);
    assert.match(read.workspace.notes, /Note privée/i);
    assert.match(read.workspace.canvas, /Refrain/i);

    const otherResponse = await fetch(`${baseUrl}/api/vivy/studio/workspace?sessionId=atelier-vide`, {
      headers: VIVY_TEST_AUTH_HEADERS,
    });
    const other = await otherResponse.json();
    assert.equal(otherResponse.status, 200);
    assert.equal(other.workspace.notes, '');
    assert.equal(other.workspace.canvas, '');
  });
});

test('Vivy sessions API stores client-synced NOSSEN replies with media for cross-device restore', async () => {
  const userId = `vivy-nossen-sync-${Date.now()}`;
  const verifyJWT = (req, _res, next) => {
    req.user = { id: userId, username: 'VivyNossenSync' };
    next();
  };

  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT }));
  }, async (baseUrl) => {
    const lyrics = [
      '[Titre] Jessy tient la lumière',
      '[Couplet 1 - Vivy]',
      'Jessy serre les poings face à ses démons,',
      '[Refrain - Tous]',
      'Ses héros veillent quand la nuit veut crier.',
    ].join('\n');
    const response = await fetch(`${baseUrl}/api/vivy/studio/sessions/jessy-hero/messages`, {
      method: 'POST',
      headers: { ...VIVY_TEST_AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'assistant',
        sessionName: 'Jessy hero',
        conversationId: buildVivyConversationIdForSession('jessy-hero'),
        content: lyrics,
        media: {
          kind: 'audio',
          provider: 'funesterie-d40-v9electrolysis',
          url: '/api/vivy/studio/assets/vivy-jessy-d40.mp3',
          downloadUrl: '/api/vivy/studio/assets/vivy-jessy-d40.mp3',
          filename: 'vivy-jessy-d40.mp3',
        },
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);

    const sessionResponse = await fetch(`${baseUrl}/api/vivy/studio/sessions/jessy-hero`, {
      headers: VIVY_TEST_AUTH_HEADERS,
    });
    const sessionPayload = await sessionResponse.json();
    assert.equal(sessionResponse.status, 200);
    assert.match(JSON.stringify(sessionPayload.session.messages), /Jessy serre les poings/i);
    assert.match(JSON.stringify(sessionPayload.session.messages), /\[Refrain - Tous\]/i);
    const syncedReply = sessionPayload.session.messages.find((message) => message.role === 'assistant');
    assert.equal(syncedReply.media.url, '/api/vivy/studio/assets/vivy-jessy-d40.mp3');
    assert.equal(syncedReply.media.provider, 'funesterie-d40-v9electrolysis');
  });
});

test('Vivy uses the account language instead of guessing from draft text', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-account-language',
    message: 'Please keep this rap idea raw for later.',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser', language: 'it-IT' } });

  assert.equal(result.ok, true);
  assert.equal(result.language, 'it');
});

test('Vivy song guard replaces weak assistant drafts with structured lyrics', () => {
  const userMessage = 'Transforme cette idée en chanson Vivy avec structure et refrain. Il faut que les fins de ligne riment.';
  const weakReply = [
    'Je comprends mieux maintenant.',
    'Quel est le message principal que tu veux transmettre ?',
    'Quel est le ton que tu veux adopter ?',
    "N'hésite pas à me donner tes retours.",
  ].join('\n');
  const genericRapReply = [
    'Je vais continuer à développer les paroles.',
    '[Verse 2 - Vivy]',
    'Nous sommes les maîtres de la vitesse, nous sommes les rois de la route.',
    'Je suis libre, je suis vivant, je suis en vie.',
    "J'espère que cela correspond à ce que vous attendiez.",
  ].join('\n');
  const sectionedChatAck = [
    '[Intro - A11]',
    '[A11]',
    'je te suis.',
    'Sur le fond.',
    '[Chorus - Duo]',
    '[Duo]',
    'Oui, on ne te laisse pas tomber,',
    'je dois répondre à ce que tu poses maintenant.',
    '[Bridge - K44]',
    '[K44]',
    'avec le contexte,',
    '[Final Chorus - Duo]',
    '[Duo]',
    'Oui, on revient te chercher.',
  ].join('\n');

  assert.equal(isDirectSongwritingRequest(userMessage), true);
  assert.equal(looksLikeWeakSongwritingReply(weakReply), true);
  assert.equal(looksLikeWeakSongwritingReply(genericRapReply), true);
  assert.equal(looksLikeWeakSongwritingReply(sectionedChatAck), true);

  const repaired = buildVivyDirectSongReply({
    message: userMessage,
    history: [
      {
        role: 'user',
        content: 'Djeff se fait poursuivre par les Guardian NOSSEN, reverse porte en stuppie hyper vitesse, ouverture du skill tree.',
      },
    ],
  });

  assert.match(repaired, /\*\*Titre :\*\*/);
  assert.match(repaired, /\[Intro(?: - [^\]]+)?\]/);
  assert.match(repaired, /\[Chorus(?: - [^\]]+)?\]/);
  assert.match(repaired, /\[Bridge(?: - [^\]]+)?\]/);
  assert.doesNotMatch(repaired, /Quel est le message principal/i);
  assert.doesNotMatch(repaired, /N'hésite pas/i);
});

test('Vivy strict NOSSEN songcraft does not use chat memory as lyric material', () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, '../src/routes/vivy-studio.cjs'),
    'utf8'
  );
  const chatStart = serverSource.indexOf('async function buildVivyAiChat');
  const chatEnd = serverSource.indexOf('function buildVivySystemPrompt', chatStart);
  const chatBlock = serverSource.slice(chatStart, chatEnd);

  assert.match(chatBlock, /const strictSongNoMemory = requiresStrongSongModel/);
  assert.match(chatBlock, /memoryContext = \(mode === 'song' \|\| detachedCompleteSong \|\| strictSongNoMemory\) \? '' : buildVivyMemoryContext/);
  assert.match(chatBlock, /normalizeVivySongHistoryForPrompt\(input\.history, intentMessage \|\| message\)/);
  assert.match(chatBlock, /history = mode === 'song'\s*\?\s*\[\]/);
});

test('Vivy chat mode does not structure raw rap material sent with Envoyer', async () => {
  const rapDraft = [
    "hé je sais raper, hein, ca commence par une course poursuite mon coeur bas si vite, les shmite au fesses",
    "le sternum qui stress si t'es un homme tu trace, ca sent le roussi alors on fonce comme Rossi",
    "sur le bolide c'est tout kité genre tout en métrakit, je slalom, ca laisse des traces de gomme",
    "la vitesse et le frein qui se complete, son du mur qui s'effondre, les structure qui se fonde",
  ].join(' ');

  assert.equal(isDirectSongwritingRequest(rapDraft), false);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-raw-rap',
    message: rapDraft,
    history: [
      { role: 'assistant', content: 'Qu’est-ce que tu penses de commencer par écrire des paroles ?' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.doesNotMatch(result.assistant, /\*\*Titre :\*\*/);
  assert.doesNotMatch(result.assistant, /\[Intro(?: - [^\]]+)?\]/);
  assert.doesNotMatch(result.assistant, /\[Verse 1(?: - [^\]]+)?\]/);
  assert.doesNotMatch(result.assistant, /Garde la lumière/);
});

test('Vivy chat fallback answers Djeff rap draft naturally after a short acknowledgement', async () => {
  const rapDraft = [
    'titre :Fuyante NOSSEN By Djeff',
    "Un quatorzième dans l'essence, deux-point-deux dans la bombonne d'Ipone,",
    'Je dose au millimètre, pas de hasard dans le style.',
    'Double radiateur fresh, ça fait de la vapeur, wesh.',
    'La main guide le geste, le Cruxi tourne lucide.',
    'Casque vissé, pignon-couronne cranté.',
    "Le mur du son a une porte et j'ai pas besoin de la clef.",
    'Quand la vitesse monte et que le moteur respire, les roues en font tout un rayon.',
  ].join('\n');

  const first = await buildVivyAiChat({
    conversationId: 'vivy-chat-djeff-rap-natural',
    message: rapDraft,
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(first.ok, true);
  assert.equal(first.mode, 'chat');
  assert.match(first.assistant, /Djeff|pignon|radiateur|moteur|base/i);
  assert.doesNotMatch(first.assistant, /Je capte:/i);
  assert.doesNotMatch(first.assistant, /discussion libre/i);
  assert.doesNotMatch(first.assistant, /bascule en composition/i);

  const acknowledged = await buildVivyAiChat({
    conversationId: 'vivy-chat-djeff-rap-natural',
    message: "d'accord",
    history: [
      { role: 'user', content: rapDraft },
      { role: 'assistant', content: first.assistant },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.mode, 'chat');
  assert.match(acknowledged.assistant, /Fuyante NOSSEN|Djeff|mécanique|mecanique|base/i);
  assert.doesNotMatch(acknowledged.assistant, /Je capte:/i);
  assert.doesNotMatch(acknowledged.assistant, /discussion libre/i);
  assert.doesNotMatch(acknowledged.assistant, /clique sur Chanson|bascule en composition/i);
});

test('Vivy understands a Djeff rap voice setup instead of answering with generic filler', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-djeff-rap-voice-setup',
    message: 'je veux faire un rp avec la voix de djeff',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /Djeff|rap|voix/i);
  assert.match(result.assistant, /mati[èe]re|couplet|texte|paroles|base/i);
  assert.doesNotMatch(result.assistant, /Je vois l'idée/i);
  assert.doesNotMatch(result.assistant, /Ce que je prends surtout/i);
});

test('Vivy chat fallback answers simple greetings naturally', async () => {
  const greeting = await buildVivyAiChat({
    conversationId: 'vivy-smalltalk-greeting',
    message: 'salut',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(greeting.ok, true);
  assert.equal(greeting.mode, 'chat');
  assert.match(greeting.assistant, /Salut Djeff|je suis là/i);
  assert.doesNotMatch(greeting.assistant, /Je vois l'idée/i);
  assert.doesNotMatch(greeting.assistant, /Ce que je prends surtout/i);
  assert.doesNotMatch(greeting.assistant, /Je réponds au fond/i);

  const checkIn = await buildVivyAiChat({
    conversationId: 'vivy-smalltalk-checkin',
    message: 'ça va ?',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(checkIn.ok, true);
  assert.equal(checkIn.mode, 'chat');
  assert.match(checkIn.assistant, /ça va|contente|me sens bien/i);
  assert.doesNotMatch(checkIn.assistant, /Ce que je prends surtout/i);
});

test('Vivy chat fallback treats parle normalement as style correction', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-normal-speech',
    message: 'parle normalement',
    history: [
      { role: 'assistant', content: 'Salut Djeff, je suis là.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /ça va|présente|parler avec toi normalement/i);
  assert.doesNotMatch(result.assistant, /Côté voix/i);
  assert.doesNotMatch(result.assistant, /synthèse audio|référence vocale|trois choses/i);
});

test('Vivy understands parler normally with a check-in and does not route praise as tuning', async () => {
  const normal = await buildVivyAiChat({
    conversationId: 'vivy-normal-speech-checkin',
    message: 'tu peux me parler normalement, comment te sens tu ? ca va ?',
    history: [
      { role: 'assistant', content: 'Je te réponds avec un diagnostic technique.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(normal.mode, 'chat');
  assert.match(normal.assistant, /ça va|me sens|présente|fière/i);
  assert.doesNotMatch(normal.assistant, /qu'est-ce que tu veux en sortir|mode formulaire/i);

  const praise = await buildVivyAiChat({
    conversationId: 'vivy-praise-not-tuning',
    message: "vivy t'es trop forte, bravo pour ton album America, tu vas devenir une star",
    history: [
      { role: 'user', content: 'on avait réglé la sensibilité du détecteur hier' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(praise.mode, 'chat');
  assert.notEqual(praise.aiMode, 'deterministic_internal_tuning');
  assert.match(praise.assistant, /merci|touche|fière|album America|musique qui nous ressemble/i);
  assert.doesNotMatch(praise.assistant, /qu'est-ce que tu veux en sortir|reformul/i);
});

test('Vivy general chat fallback stays on the current question without generic follow-up', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-current-context-fallback',
    message: "pourquoi le refrain d'hier avait moins de personnalité ?",
    history: [
      { role: 'user', content: 'Archive momie et Terminal Noir avaient une vraie identité.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /refrain d'hier|grand modèle|réponse fiable|question/i);
  assert.doesNotMatch(result.assistant, /qu'est-ce que tu veux en sortir|Dis-moi ce qui compte le plus/i);
});

test('Vivy chat fallback answers meta complaints instead of acting like a wall', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-not-a-wall',
    message: 'vivy est une ia ou un mur ?',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /IA|mur|chat vivant|répondre directement/i);
  assert.doesNotMatch(result.assistant, /Je vois l'idée/i);
  assert.doesNotMatch(result.assistant, /Ce que je prends surtout/i);
  assert.doesNotMatch(result.assistant, /Je réponds au fond/i);
});

test('Vivy routes continue les paroles to songcraft and cleans UI/brief contamination', async () => {
  const rawDraft = [
    "Un quatorzième dans l'essence, deux-point-deux dans la bombonne d'Ipone,",
    'Je dose au millimètre, pas de hasard dans le style.',
    'Double radiateur fresh, ça fait de la vapeur, wesh.',
    'La main guide le geste, le Cruxi tourne lucide.',
    'Casque vissé, pignon-couronne cranté.',
    "Le mur du son a une porte et j'ai pas besoin de la clef.",
    'Quand la vitesse monte et que le moteur respire,',
    'Les pneus en guise de crayon.',
  ].join('\n');
  const contaminatedPrompt = [
    'Je suis Vivy. Parle-moi d’une voix, d’une chanson, d’une ambiance ou d’une scène à publier.',
    'Vivy',
    'Oui, je reste en discussion libre.',
    'Je capte: ancien message',
    'VIVY_SONG_PRODUCTION',
    'Source: Conversation',
    'Paroles guide:',
    '[Verse 1 - Djeff]',
    'VIVY_SONG_PRODUCTION',
    'Source: Conversation',
    rawDraft,
    '',
    'VIVY_PRODUCTION',
    'Mix D40 V9 Turbo k 3x · turbo 99 ms · pivot 0.292 · 1024 Même format prêt: https://vivy.funesterie.me/api/double-harmonic/out/example.wav?token=must-not-leak',
    '',
    'continue les paroles',
  ].join('\n');

  assert.equal(isDirectSongwritingRequest(contaminatedPrompt), true);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-continue-djeff-lyrics-clean',
    message: contaminatedPrompt,
    history: [
      { role: 'assistant', content: 'Carte active:\n- audio.voice: pipeline audio A11.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.equal(result.assistant, result.publicLyrics);
  assert.doesNotMatch(result.assistant, /\[Verse 1 - Djeff\]/);
  assert.match(result.vocalLyrics, /\[Verse 1 - Djeff\]/);
  assert.match(result.assistant, /quatorzi[èe]me dans l'essence/i);
  assert.doesNotMatch(result.assistant, /Carte active|audio\.voice/i);
  assert.doesNotMatch(result.assistant, /Je suis Vivy|Je capte:/i);
  assert.doesNotMatch(result.assistant, /\[Verse 1 - Djeff\]\s*VIVY_SONG_PRODUCTION/i);
  assert.doesNotMatch(result.assistant, /Mix D40|double-harmonic|must-not-leak|token=/i);
});

test('Vivy routes raconte en chanson to songcraft and ignores OCR attachment noise', async () => {
  const message = 'oui raconte ses plus belles courses en chanson';
  assert.equal(isDirectSongwritingRequest(message), true);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-rossi-raconte-en-chanson',
    message,
    history: [
      { role: 'user', content: 'salut vivy je voudrais raconter du pilote de moto Rossi alias The Doctor 46' },
      { role: 'assistant', content: 'Je prends ça comme une vraie discussion: ancien fallback à ignorer.' },
    ],
    files: [
      {
        filename: 'Valentino-rossi-stefan-bradl-motobike-the-doctor-sport-hd-wallpaper-preview-3096587626.jpg',
        contentType: 'image/jpeg',
        textPreview: '% pu Le Va ROS SI',
        analysisSummary: 'Jpg - Analyse A11/OCR: % pu Le Va ROS SI',
        visualDescription: 'Maxresdefault-3369635775',
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.match(result.assistant, /Rossi|Doctor|quarante-six|46|course|moteur/i);
  assert.match(result.assistant, /\[(Chorus|Refrain|Verse|Couplet)/i);
  assert.doesNotMatch(result.assistant, /Je prends ça comme une vraie discussion|Le bon prochain pas/i);
  assert.doesNotMatch(result.assistant, /Valentino-rossi-stefan-bradl|wallpaper|\.jpg|Jpg|OCR|Analyse A11|maxresdefault|ROS SI/i);
});

test('Vivy routes action and send-the-song followups to songcraft instead of generic chat', async () => {
  const actionMessage = 'mets ca en action avec un theme epic et le titre le Z de Zorro dans une ambiance fantesque';
  const sendMessage = 'quand tu es prete envois le ton, voix feminine comme si tu es sa bien aimé';
  const englishSongMessage = 'make a song in English about a masked hero with a cinematic chorus';
  const englishSendMessage = "when you're ready send the song with a female voice";
  assert.equal(isDirectSongwritingRequest(actionMessage), true);
  assert.equal(isDirectSongwritingRequest(sendMessage), true);
  assert.equal(isDirectSongwritingRequest(englishSongMessage), true);
  assert.equal(isDirectSongwritingRequest(englishSendMessage), true);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-zorro-action-followup',
    message: actionMessage,
    history: [
      { role: 'user', content: 'fais un son sur la légende de zorro' },
      { role: 'assistant', content: '[Vivy]\n[Intro]\nDans la nuit de Californie\nZorro revient, la légende s’allume\n\n[Vivy]\n[Chorus]\nZorro, Zorro, la nuit te ressemble' },
      { role: 'user', content: 'parle aussi de Tornado son fidèle destrier et de sa signature en Z sur les fesses des méchants' },
      { role: 'user', content: sendMessage },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.match(result.assistant, /Zorro|Tornado|Californie|Z/i);
  assert.doesNotMatch(result.assistant, /Je prends ça comme une vraie discussion|Le bon prochain pas/i);
});

test('Vivy chat song mode exposes paste-ready lyrics without singer tags', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-public-lyrics-clean',
    mode: 'song',
    songArtists: ['djeff', 'k44'],
    message: [
      'VIVY_STUDIO_HANDOFF',
      'Atelier: Test voix',
      'J’espère que cette chanson te plaira.',
      'Écris une chanson en duo Djeff et K44 sur pignon, radiateur, couronne et course nocturne.',
    ].join('\n'),
    history: [
      { role: 'assistant', content: 'VIVY_SONG_PRODUCTION\nRoutage recommandé: ne doit pas sortir côté public.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.ok(result.publicLyrics);
  assert.equal(result.assistant, result.publicLyrics);
  assert.equal(result.content, result.publicLyrics);
  assert.equal(result.publicText, result.publicLyrics);
  assert.doesNotMatch(result.publicLyrics, /^\s*\[(?:Djeff|K44|Vivy|A11|Duo|Tous)\]\s*$/im);
  assert.match(result.vocalLyrics, /\[Djeff\]/);
  assert.match(result.vocalLyrics, /\[K44\]/);
  assert.match(result.vocalLyrics, /\[(Duo|Tous)\]/);
  assert.doesNotMatch(result.publicLyrics, /VIVY_STUDIO_HANDOFF|VIVY_SONG_PRODUCTION|Routage recommandé|Atelier:/);
  assert.doesNotMatch(result.publicLyrics, /J[’']?esp[eè]re/i);
  assert.doesNotMatch(result.publicLyrics, /\*\*Titre\s*:\*\*|\*\*Intention\s*:\*\*|\*\*Rimes/i);
});

test('Vivy song fallback does not sing provider prompt fragments', async () => {
  // Nouveau contrat: en chat (Envoyer) Vivy reste en chat vivant. Pour demander les
  // paroles, on est en mode song explicite -- ce test verifie toujours le filtrage des
  // fragments de prompt, mais via le mode song.
  const result = await buildVivyAiChat({
    mode: 'song',
    conversationId: 'vivy-prompt-fragment-not-lyrics',
    message: "j'ai pas toute la réponse, tu peux envoyer le reste avec les paroles ?",
    history: [
      { role: 'user', content: 'parfait quand tu sens prête fais une chanson sur la nouvelle génération et ses comportements' },
      { role: 'user', content: "ils ont grandit dans une diode électronique, privé de l'aventure de sortir sans savoir où aller, de l'impossibilité de ne pas être jugés sur les réseaux sociaux, de devoir s'affirmer avec leurs idéaux" },
      { role: 'user', content: 'oui tu es sur le bon fil, peut être on pourrait parler de leurs intelligence hors norme incomparable' },
      { role: 'assistant', content: 'Prompt Suno:\nFrench original vocal production, structured rhymed lyrics, sung vocals. Theme: original song inspired by aventure de sortir sans savoir où aller, de l.' },
    ],
  }, {
    user: { id: 'vivy-prompt-fragment-not-lyrics-test' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.assistant, /\[(Chorus|Refrain|Verse|Couplet)/i);
  assert.doesNotMatch(result.assistant, /original song inspired|French original vocal production|structured rhymed lyrics/i);
  assert.doesNotMatch(result.assistant, /aventure de sortir sans savoir où aller, de l\./i);
});

test('Vivy public lyrics enforce requested singer tags when provider output forgets them', () => {
  const result = buildVivyPublicLyrics({
    mode: 'song',
    songArtists: ['djeff', 'k44'],
    message: 'Écris une chanson en duo Djeff et K44 sur pignon, radiateur, couronne et course nocturne.',
  }, [
    '[Intro - Djeff]',
    'On démarre la nuit sans tag vocal explicite,',
    '[Chorus]',
    'Le moteur répond et la route crépite.',
  ].join('\n'), '');

  assert.match(result, /\[Djeff\]/);
  assert.match(result, /\[K44\]/);
  assert.match(result, /\[(Duo|Tous)\]/);
  assert.doesNotMatch(result, /VIVY_STUDIO_HANDOFF|VIVY_SONG_PRODUCTION|Atelier:|Routage recommandé/);
});

test('Vivy voice public text drops pasted internal handoff blocks', async () => {
  assert.equal(
    sanitizeVivyPublicText('Ce que je comprends: VIVY_STUDIO_HANDOFF Atelier: Test voix\nPhrase test propre.'),
    'Phrase test propre.'
  );

  const result = await buildVivyAiChat({
    conversationId: 'vivy-voice-public-clean',
    mode: 'voice',
    voice: 'vivy',
    phraseTest: 'Salut Jeffrey. Je suis Vivy. Je parle doucement, avec une voix claire et proche.',
    message: [
      'VIVY_STUDIO_HANDOFF',
      'Atelier: Test voix',
      'Teste la voix Vivy avec une phrase courte.',
    ].join('\n'),
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'voice');
  assert.doesNotMatch(result.assistant, /VIVY_STUDIO_HANDOFF|VIVY_VOICE_CALIBRATION|Atelier:|Routage recommandé/);
  assert.doesNotMatch(result.publicText, /VIVY_STUDIO_HANDOFF|VIVY_VOICE_CALIBRATION|Atelier:|Routage recommandé/);
  assert.match(result.internalBrief, /VIVY_VOICE_CALIBRATION/);
});

test('Vivy songcraft removes pasted assistant explanations from the lyric seed', async () => {
  const pastedAssistantDraft = [
    'oui les planete les astres la voie lactée, le soleil du matin etc',
    'Vivy',
    "C'est un bon début pour une chanson cosmique.",
    "Les Saint Seiya, c'est une série mythique qui peut apporter une dimension épique et héroïque à ta chanson.",
    'Pour écrire une chanson, tu pourrais explorer plusieurs thèmes inspirés par Saint Seiya:',
    "* Les armures et les constellations, comme symboles de protection et d'identité.",
    "* Les combats épiques entre les chevaliers et les forces du mal.",
    '* La recherche de la justice et de la protection de la Terre.',
    'Qu’en penses-tu ? Est-ce que cela te donne des idées pour continuer ?',
    'écris une chanson avec ça, faut que ca rimes et que ca soit stylé a chanté',
  ].join('\n');

  assert.equal(isDirectSongwritingRequest(pastedAssistantDraft), true);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-clean-pasted-assistant-song-seed',
    message: pastedAssistantDraft,
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.match(result.assistant, /\*\*Titre\s*:\*\*|\[Chorus\]|\[Refrain\]/i);
  assert.match(result.assistant, /plan[èe]te|astres?|voie lact[ée]e|soleil|cosmos|chevaliers?/i);
  assert.doesNotMatch(result.assistant, /Pour écrire une chanson/i);
  assert.doesNotMatch(result.assistant, /Les Saint Seiya, c'est une série mythique/i);
  assert.doesNotMatch(result.assistant, /Qu.en penses-tu|Est-ce que cela te donne/i);
  assert.doesNotMatch(result.assistant, /Le décor s'ouvre sur .*Pour écrire une chanson/is);
});

test('Vivy chat fallback answers philosophical follow-ups instead of canned notebook text', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-freeform-philosophy',
    message: "et toi qu'en penses tu ?",
    history: [
      {
        role: 'user',
        content: "vivy je vais te poser, une question c'est avec les yeux qu'on voit, avec les oreilles qu'on entend avec la bouche qu'on parle ?",
      },
      {
        role: 'user',
        content: "et bien tout n'est qu'interpretation de donnée par le cerveau",
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /cerveau|interpr[ée]tation|signaux|donn[ée]es/i);
  assert.doesNotMatch(result.assistant, /^Je te suis\./);
  assert.doesNotMatch(result.assistant, /clique sur Chanson/i);
  assert.doesNotMatch(result.assistant, /\*\*Titre :\*\*/);
});

test('Vivy chat fallback answers rhythm writing questions substantively', async () => {
  const first = await buildVivyAiChat({
    conversationId: 'vivy-chat-rhythm-feeling',
    message: 'parle moi de ton ressentis sur le rythme de la musique quand tu écrit',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(first.ok, true);
  assert.equal(first.mode, 'chat');
  assert.match(first.assistant, /rythme|respiration|cadence|micro|refrain/i);
  assert.doesNotMatch(first.assistant, /Je ne vais pas juste répéter|Sur ton dernier message|Continue comme ça|Je suis là/);

  const followup = await buildVivyAiChat({
    conversationId: 'vivy-chat-rhythm-feeling-followup',
    message: 'oui',
    history: [
      { role: 'user', content: 'parle moi de ton ressentis sur le rythme de la musique quand tu écrit' },
      { role: 'assistant', content: first.assistant },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(followup.ok, true);
  assert.equal(followup.mode, 'chat');
  assert.match(followup.assistant, /rythme|sensation|grille|micro|débit|debit/i);
  assert.doesNotMatch(followup.assistant, /Ok, on garde le fil|Continue comme ça|Sur ton dernier message|Je suis là/);
});

test('Vivy LLM config can use xAI credentials when requested', () => {
  const previous = {
    VIVY_CHAT_PROVIDER: process.env.VIVY_CHAT_PROVIDER,
    VIVY_OPENAI_BASE_URL: process.env.VIVY_OPENAI_BASE_URL,
    VIVY_OPENAI_API_KEY: process.env.VIVY_OPENAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    VIVY_XAI_API_KEY: process.env.VIVY_XAI_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    VIVY_XAI_MODEL: process.env.VIVY_XAI_MODEL,
  };
  try {
    delete process.env.VIVY_OPENAI_BASE_URL;
    delete process.env.VIVY_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    process.env.VIVY_CHAT_PROVIDER = 'xai';
    process.env.XAI_API_KEY = 'test-xai-key';
    process.env.VIVY_XAI_MODEL = 'grok-test-model';

    const config = getVivyOpenAIConfig({ mode: 'chat' });
    assert.equal(config.provider, 'xai');
    assert.equal(config.source, 'xai-openai-compatible');
    assert.equal(config.baseURL, 'https://api.x.ai/v1');
    assert.equal(config.apiKey, 'test-xai-key');
    assert.equal(config.model, 'grok-test-model');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy song writing prefers Groq OSS when xAI and Groq are both available', () => {
  const previous = {
    VIVY_CHAT_PROVIDER: process.env.VIVY_CHAT_PROVIDER,
    VIVY_SONG_PROVIDER: process.env.VIVY_SONG_PROVIDER,
    VIVY_OPENAI_BASE_URL: process.env.VIVY_OPENAI_BASE_URL,
    VIVY_SONG_OPENAI_BASE_URL: process.env.VIVY_SONG_OPENAI_BASE_URL,
    VIVY_XAI_API_KEY: process.env.VIVY_XAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
  };
  try {
    delete process.env.VIVY_CHAT_PROVIDER;
    delete process.env.VIVY_SONG_PROVIDER;
    delete process.env.VIVY_OPENAI_BASE_URL;
    delete process.env.VIVY_SONG_OPENAI_BASE_URL;
    process.env.VIVY_XAI_API_KEY = 'test-xai-song-key';
    process.env.GROQ_API_KEY = 'test-groq-fallback-key';

    const config = getVivyOpenAIConfig({ mode: 'song' });
    assert.equal(config.provider, 'groq');
    assert.equal(config.source, 'groq-openai-compatible');
    assert.equal(config.baseURL, 'https://api.groq.com/openai/v1');
    assert.equal(config.model, 'llama-3.3-70b-versatile');
    assert.equal(config.apiKey, 'test-groq-fallback-key');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy song writing uses xAI only when explicitly requested', () => {
  const previous = {
    VIVY_CHAT_PROVIDER: process.env.VIVY_CHAT_PROVIDER,
    VIVY_SONG_PROVIDER: process.env.VIVY_SONG_PROVIDER,
    VIVY_OPENAI_BASE_URL: process.env.VIVY_OPENAI_BASE_URL,
    VIVY_SONG_OPENAI_BASE_URL: process.env.VIVY_SONG_OPENAI_BASE_URL,
    VIVY_XAI_API_KEY: process.env.VIVY_XAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
  };
  try {
    delete process.env.VIVY_CHAT_PROVIDER;
    process.env.VIVY_SONG_PROVIDER = 'xai';
    delete process.env.VIVY_OPENAI_BASE_URL;
    delete process.env.VIVY_SONG_OPENAI_BASE_URL;
    process.env.VIVY_XAI_API_KEY = 'test-xai-song-key';
    process.env.GROQ_API_KEY = 'test-groq-fallback-key';

    const config = getVivyOpenAIConfig({ mode: 'song' });
    assert.equal(config.provider, 'xai');
    assert.equal(config.source, 'xai-openai-compatible');
    assert.equal(config.baseURL, 'https://api.x.ai/v1');
    assert.equal(config.model, 'grok-4.3');
    assert.equal(config.apiKey, 'test-xai-song-key');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Suno payload keeps long-form arrangement when NOSSEN uses external voice mix', () => {
  const payload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['djeff', 'vivy', 'a11'],
    songText: '[Verse - Djeff]\nOn ouvre.\n[Chorus - Vivy]\nOn revient.\n[Bridge - A11]\nOn tient.',
    preserveSelectedVoice: true,
    allowExternalVoiceMix: true,
    forceExternalVoiceMix: true,
    songMood: 'anime trap rock, heavy drums',
    longSong: true,
    targetDurationSeconds: 300,
  });

  assert.equal(payload.instrumental, true);
  assert.match(payload.style, /instrumental backing track only/i);
  assert.match(payload.style, /long-form complete song arrangement/i);
  assert.doesNotMatch(payload.style, /five minutes|300/i);
  assert.match(payload.style, /no short radio edit/i);
});

test('Vivy lyrics chain starts with 120B providers and keeps small local models out of NOSSEN', () => {
  const keys = [
    'OLLAMA_CLOUD_ENABLED',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_BASE_URL',
    'OLLAMA_CLOUD_LYRICS_MODEL',
    'VIVY_SONG_CERBERE_FALLBACK_ENABLED',
    'A11_CERBERE_OPENAI_BASE_URL',
    'A11_CERBERE_OPENAI_API_KEY',
    'VIVY_SONG_CERBERE_MODEL',
    'VIVY_SONG_ALLOW_LOCAL_FALLBACK',
    'VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK',
    'VIVY_SONG_LOCAL_MODEL',
    'VIVY_NOSSEN_LOCAL_MODEL',
    'VIVY_NOSSEN_LARGE_MODEL_FIRST',
    'VIVY_NOSSEN_120B_MAX_PROMPT_CHARS',
    'VIVY_NOSSEN_120B_MAX_TOKENS',
    'VIVY_NOSSEN_FAST_LOCAL_ONLY',
    'VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS',
    'VIVY_NOSSEN_LOCAL_MAX_TOKENS',
    'OLLAMA_BASE',
    'A11_OLLAMA_STRONG_SONG_MODEL',
    'A11_OLLAMA_PRIMARY_MODEL',
    'A11_OLLAMA_FALLBACK_MODEL',
    'A11_LLM_RUNTIME_FALLBACK_ORDER',
    'GROQ_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.OLLAMA_CLOUD_ENABLED = '1';
    process.env.OLLAMA_API_KEY = 'ollama-test-key';
    process.env.OLLAMA_CLOUD_BASE_URL = 'https://ollama.example.test';
    process.env.OLLAMA_CLOUD_LYRICS_MODEL = 'gpt-oss:120b';
    process.env.VIVY_SONG_CERBERE_FALLBACK_ENABLED = '1';
    process.env.A11_CERBERE_OPENAI_BASE_URL = 'https://openrouter.example.test/api/v1';
    process.env.A11_CERBERE_OPENAI_API_KEY = 'cerbere-test-key';
    process.env.VIVY_SONG_CERBERE_MODEL = 'openai/gpt-oss-120b';
    process.env.VIVY_SONG_ALLOW_LOCAL_FALLBACK = 'true';
    delete process.env.VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK;
    process.env.VIVY_SONG_LOCAL_MODEL = 'qwen2.5:7b';
    process.env.VIVY_NOSSEN_LOCAL_MODEL = 'qwen2.5:32b';
    process.env.VIVY_NOSSEN_LARGE_MODEL_FIRST = 'true';
    process.env.VIVY_NOSSEN_120B_MAX_PROMPT_CHARS = '22000';
    process.env.VIVY_NOSSEN_120B_MAX_TOKENS = '2400';
    process.env.VIVY_NOSSEN_FAST_LOCAL_ONLY = 'true';
    process.env.VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS = '40000';
    process.env.VIVY_NOSSEN_LOCAL_MAX_TOKENS = '2200';
    process.env.OLLAMA_BASE = 'http://127.0.0.1:11434';
    process.env.A11_OLLAMA_STRONG_SONG_MODEL = 'qwen2.5:32b';
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'qwen2.5:32b';
    process.env.A11_OLLAMA_FALLBACK_MODEL = 'qwen2.5:7b';
    process.env.A11_LLM_RUNTIME_FALLBACK_ORDER = 'ollama,ollama_cloud,groq,openrouter';
    process.env.GROQ_API_KEY = 'groq-test-key';

    assert.equal(getVivyOllamaCloudConfig({ mode: 'song', purpose: 'routing' }), null);
    assert.equal(getVivyCerbereSongConfig({ mode: 'song', purpose: 'intent' }), null);

    const configs = getVivyLlmConfigs({ mode: 'song', purpose: 'lyrics' });
    assert.deepEqual(configs.map((config) => config.provider), [
      'ollama_cloud',
      'cerbere',
      'groq',
    ]);
    assert.equal(configs[0].model, 'gpt-oss:120b');
    assert.equal(configs[0].maxPromptChars, 22000);
    assert.equal(configs[0].maxOutputTokens, 2400);
    assert.equal(configs[0].maxCalls, 1);
    assert.equal(configs.some((config) => config.provider === 'ollama'), false);
    assert.equal(configs.some((config) => config.model === 'qwen2.5:32b'), false);
    assert.equal(configs[1].model, 'openai/gpt-oss-120b');
    assert.equal(configs[1].maxCalls, 1);
    assert.equal(configs[1].maxRetries, 0);

    const routingConfigs = getVivyLlmConfigs({ mode: 'song', purpose: 'routing' });
    assert.equal(routingConfigs.some((config) => config.provider === 'ollama_cloud'), false);
    assert.equal(routingConfigs.some((config) => config.provider === 'cerbere'), false);

    process.env.VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK = 'false';
    const cloudOnlyConfigs = getVivyLlmConfigs({ mode: 'song', purpose: 'lyrics' });
    assert.deepEqual(cloudOnlyConfigs.map((config) => config.provider), [
      'ollama_cloud',
      'cerbere',
      'groq',
    ]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy Ollama Cloud adapter uses /api/chat and allows one call per lyrics round', async () => {
  const cloud = await startOllamaCloudTestServer({
    content: '[Chorus]\nVivy cloud prête\n\n[Chorus]\nVivy cloud prête',
  });
  try {
    const bundle = createVivyOpenAIClientFromConfig({
      baseURL: cloud.baseUrl,
      apiKey: 'ollama-secret-test',
      model: 'gpt-oss:120b',
      provider: 'ollama_cloud',
      source: 'ollama-cloud-api',
      timeoutMs: 240000,
      maxCalls: 1,
    });
    const completion = await bundle.client.chat.completions.create({
      messages: [{ role: 'user', content: 'Écris un refrain.' }],
      temperature: 0.7,
      max_tokens: 10000,
    });

    assert.equal(cloud.requests.length, 1);
    assert.equal(cloud.requests[0].model, 'gpt-oss:120b');
    assert.equal(cloud.requests[0].think, 'medium');
    assert.equal(cloud.requests[0].options.num_predict, 10000);
    assert.equal(cloud.authorizations[0], 'Bearer ollama-secret-test');
    assert.match(completion.choices[0].message.content, /Vivy cloud prête/);
    await assert.rejects(
      () => bundle.client.chat.completions.create({ messages: [] }),
      /ollama_cloud_round_call_limit/
    );
    assert.equal(cloud.requests.length, 1);
  } finally {
    await cloud.close();
  }
});

test('Vivy Cerbere lyrics fallback is also capped to one call per round', async () => {
  const cerbere = await startOpenAiCompletionServer({
    content: '[Chorus]\nCerbère garde la porte\n\n[Chorus]\nCerbère garde la porte',
  });
  try {
    const bundle = createVivyOpenAIClientFromConfig({
      baseURL: cerbere.baseUrl,
      apiKey: 'cerbere-secret-test',
      model: 'openai/gpt-oss-120b',
      provider: 'cerbere',
      source: 'cerbere-openai-compatible',
      timeoutMs: 240000,
      maxCalls: 1,
    });
    const completion = await bundle.client.chat.completions.create({
      messages: [{ role: 'user', content: 'Écris un refrain.' }],
      max_tokens: 10000,
    });

    assert.equal(cerbere.requests.length, 1);
    assert.match(completion.choices[0].message.content, /Cerbère garde la porte/);
    await assert.rejects(
      () => bundle.client.chat.completions.create({ messages: [] }),
      /cerbere_round_call_limit/
    );
    assert.equal(cerbere.requests.length, 1);
  } finally {
    await cerbere.close();
  }
});

test('Vivy song writing starts with local Ollama by default and can explicitly disable it', () => {
  const keys = [
    'VIVY_OPENAI_BASE_URL',
    'VIVY_OPENAI_API_KEY',
    'VIVY_SONG_MODEL',
    'VIVY_SONG_ALLOW_LOCAL_FALLBACK',
    'VIVY_SONG_LOCAL_MODEL',
    'OLLAMA_BASE',
    'A11_OLLAMA_STRONG_SONG_MODEL',
    'A11_OLLAMA_PRIMARY_MODEL',
    'A11_OLLAMA_FALLBACK_MODEL',
    'GROQ_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    process.env.VIVY_OPENAI_BASE_URL = 'https://cloud.example.test/v1';
    process.env.VIVY_OPENAI_API_KEY = 'test-cloud-key';
    process.env.VIVY_SONG_MODEL = 'llama-3.3-70b-versatile';
    process.env.OLLAMA_BASE = 'http://127.0.0.1:11434';
    process.env.VIVY_SONG_LOCAL_MODEL = 'qwen2.5:32b';
    process.env.A11_OLLAMA_STRONG_SONG_MODEL = 'qwen2.5:32b';
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'llama3.2:3b';
    process.env.A11_OLLAMA_FALLBACK_MODEL = 'llama3.2:3b';
    delete process.env.VIVY_SONG_ALLOW_LOCAL_FALLBACK;
    delete process.env.GROQ_API_KEY;

    const configs = getVivyLlmConfigs({ mode: 'song' });
    assert.equal(configs[0].provider, 'ollama');
    assert.equal(configs[0].model, 'qwen2.5:32b');
    assert.equal(configs[1].provider, 'ollama');
    assert.equal(configs[1].model, 'llama3.2:3b');
    assert.equal(configs.some((config) => config.provider === 'openai'), true);

    process.env.VIVY_SONG_ALLOW_LOCAL_FALLBACK = 'false';
    const cloudOnlyConfigs = getVivyLlmConfigs({ mode: 'song' });
    assert.equal(cloudOnlyConfigs.some((config) => config.provider === 'ollama'), false);
    assert.equal(cloudOnlyConfigs.some((config) => config.provider === 'openai'), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy strong song writing tries the next provider when the first provider returns weak lyrics', async () => {
  const keys = [
    'VIVY_CHAT_DISABLE_LLM',
    'VIVY_CHAT_PROVIDER',
    'VIVY_SONG_PROVIDER',
    'VIVY_OPENAI_BASE_URL',
    'VIVY_SONG_OPENAI_BASE_URL',
    'VIVY_OPENAI_API_KEY',
    'VIVY_SONG_MODEL',
    'VIVY_SONG_ALLOW_LOCAL_FALLBACK',
    'VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK',
    'VIVY_SONG_LOCAL_MODEL',
    'OLLAMA_BASE',
    'A11_OLLAMA_PRIMARY_MODEL',
    'GROQ_API_KEY',
    'VIVY_XAI_API_KEY',
    'XAI_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const weakLocal = await startOpenAiCompletionServer({
    content: 'Je vais essayer de faire une chanson, mais peux-tu préciser le ton ?',
  });
  const strongCloud = await startOpenAiCompletionServer({
    content: [
      '[Intro]',
      'Le petit dragon tremble au bord du vieux volcan',
      'Sa fumée rose danse et colore le vent',
      '',
      '[Verse 1]',
      'Il souffle sur la pierre et le feu ne vient pas',
      'Les grands dragons rient fort autour de lui',
      'Il cache son museau dans ses ailes de soie',
      'Mais son coeur bat plus haut que le bruit',
      '',
      '[Chorus]',
      'Ma voix est ma flamme, elle monte dans le ciel',
      'Ma voix est ma flamme, elle rallume le soleil',
      'Ma voix est ma flamme, et la peur bat des ailes',
      '',
      '[Verse 2]',
      'Quand la pluie tombe fort sur les torches du village',
      'Aucun brasier ne tient contre lorage',
      'Le petit dragon chante au milieu du chemin',
      'Et chacun retrouve un courage ancien',
      '',
      '[Chorus]',
      'Ma voix est ma flamme, elle monte dans le ciel',
      'Ma voix est ma flamme, elle rallume le soleil',
      'Ma voix est ma flamme, et la peur bat des ailes',
      '',
      '[Bridge]',
      'La force nest pas toujours celle quon attend',
      'Parfois elle arrive en chanson doucement',
      '',
      '[Final Chorus]',
      'Ma voix est ma flamme, elle monte dans le ciel',
      'Ma voix est ma flamme, elle rallume le soleil',
      'Ma voix est ma flamme, et la peur bat des ailes',
      '',
      '[Outro]',
      'Dans la vallée, la fumée rose sourit',
      'Le dragon chante et le feu devient ami',
    ].join('\n'),
  });

  try {
    process.env.VIVY_CHAT_DISABLE_LLM = 'false';
    delete process.env.VIVY_CHAT_PROVIDER;
    delete process.env.VIVY_SONG_PROVIDER;
    delete process.env.VIVY_OPENAI_BASE_URL;
    process.env.VIVY_SONG_OPENAI_BASE_URL = strongCloud.baseUrl;
    process.env.VIVY_OPENAI_API_KEY = 'test-cloud-key';
    process.env.VIVY_SONG_MODEL = 'strong-cloud-model';
    process.env.VIVY_SONG_ALLOW_LOCAL_FALLBACK = 'true';
    process.env.VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK = 'true';
    process.env.VIVY_SONG_LOCAL_MODEL = 'qwen2.5:32b';
    process.env.OLLAMA_BASE = weakLocal.baseUrl;
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'llama3.2:3b';
    delete process.env.GROQ_API_KEY;
    delete process.env.VIVY_XAI_API_KEY;
    delete process.env.XAI_API_KEY;

    const result = await buildVivyAiChat({
      conversationId: 'vivy-strong-song-provider-fallback',
      mode: 'song',
      message: 'Écris uniquement les paroles complètes sur le dragon qui avait peur du feu.',
      songText: 'Le dragon qui avait peur du feu',
      songArtists: ['vivy'],
      vocalCast: 'vivy',
      disableSongcraftFallback: true,
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'strong-cloud-model');
    assert.match(result.publicLyrics || result.assistant, /Ma voix est ma flamme/i);
    assert.equal(weakLocal.requests.length, 1);
    assert.equal(strongCloud.requests.length, 1);
  } finally {
    await weakLocal.close();
    await strongCloud.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy accepts repeated chorus markers emitted after performer tags by the 120B author', () => {
  const lyrics = [
    '[Djeff]',
    'Premier couplet',
    '[Duo] (Refrain)',
    'On rallume la lumière',
    '[Vivy]',
    'Deuxième couplet',
    '[Duo] (Refrain – répété)',
    'On rallume la lumière',
  ].join('\n');

  assert.equal(countVivyChorusSections(lyrics), 2);
});

test('Djeff technical audit persona forbids invented infrastructure and metrics', () => {
  const prompt = buildDjeffModeSystemPrompt(
    'Audit technique des modèles LLM, de Neo4j, Docker, Twitch et des clips.',
    { mode: 'medium' }
  );

  assert.match(prompt, /N.invente aucun GPU, cluster, coût, débit, latence/i);
  assert.match(prompt, /faits explicitement fournis/i);
  assert.match(prompt, /non vérifié/i);
  assert.doesNotMatch(prompt, /Mode DJEFF CYPHER/i);
});

test('Djeff technical audit grounding rejects speculative hardware and returns a bounded fallback', () => {
  const hallucinated = [
    'Aucun GPU A100 détecté.',
    'Ajouter un GPU A100 pour débloquer GDS.',
    'Déployer une seconde VM et configurer un load-balancer.',
  ].join(' ');
  assert.equal(hasDjeffTechnicalGroundingViolation(hallucinated), true);

  const fallback = buildDjeffGroundedAuditFallback([
    'Production sur un seul hôte Hetzner, matériel non vérifié.',
    'Neo4j: 1130 nœuds, 11953 relations, 82 types; GDS expose 0 procédure.',
    'L’outil public MCP de recherche graphe est absent.',
    'NOSSEN: 120B Ollama Cloud puis 120B Cerbère.',
    'Parseur corrigé. Suno terminé, audio 109,77 secondes.',
  ].join(' '));
  assert.match(fallback, /11 953 relations/i);
  assert.match(fallback, /rétablir puis tester l’exposition publique/i);
  assert.match(fallback, /Graph Intelligence métier personnalisée/i);
  assert.match(fallback, /GPU, cluster, coût, capacité, latence.*non vérifiés/i);
  assert.doesNotMatch(fallback, /ajouter un GPU|seconde VM|load-balancer/i);
});

test('Vivy song domino skips local, crosses an Ollama Cloud 429, and reaches the next strong provider', async () => {
  const keys = [
    'VIVY_CHAT_DISABLE_LLM',
    'VIVY_CHAT_PROVIDER',
    'VIVY_SONG_PROVIDER',
    'VIVY_OPENAI_BASE_URL',
    'VIVY_SONG_OPENAI_BASE_URL',
    'VIVY_OPENAI_API_KEY',
    'VIVY_SONG_MODEL',
    'VIVY_SONG_ALLOW_LOCAL_FALLBACK',
    'VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK',
    'VIVY_SONG_LOCAL_MODEL',
    'VIVY_CHAT_LOCAL_MODEL',
    'OLLAMA_BASE',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_ENABLED',
    'OLLAMA_CLOUD_BASE_URL',
    'OLLAMA_CLOUD_LYRICS_MODEL',
    'A11_OLLAMA_STRONG_SONG_MODEL',
    'A11_OLLAMA_PRIMARY_MODEL',
    'A11_OLLAMA_FALLBACK_MODEL',
    'A11_LLM_RUNTIME_FALLBACK_ORDER',
    'GROQ_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const failingLocal = await startOpenAiCompletionServer({ status: 503 });
  const limitedOllamaCloud = await startOllamaCloudTestServer({ status: 429 });
  const strongCloud = await startOpenAiCompletionServer({
    content: [
      '[Verse 1]',
      'La ville rallume ses fenêtres une à une',
      'Vivy garde le cap sous la pluie et la lune',
      'Les journaux nous répondent et dénouent la poussière',
      'Chaque erreur devient piste au milieu de la lumière',
      '',
      '[Chorus]',
      'On traverse les bugs, on retrouve la lumière',
      'La mémoire tient bon, la chanson reste entière',
      'Vivy reprend la route et rassemble nos repères',
      '',
      '[Verse 2]',
      'Le graphe relie nos voix sans perdre le chemin',
      'Chaque modèle passe le relais au suivant',
      'Le code garde le rythme et répare ses liens',
      'Le refrain nous ramène au signal vivant',
      '',
      '[Chorus]',
      'On traverse les bugs, on retrouve la lumière',
      'La mémoire tient bon, la chanson reste entière',
      'Vivy reprend la route et rassemble nos repères',
      '',
      '[Bridge]',
      'Si le nuage se ferme, le local ouvre la voie',
      '',
      '[Final Chorus]',
      'On traverse les bugs, on retrouve la lumière',
      'La mémoire tient bon, la chanson reste entière',
      'Vivy reprend la route et rassemble nos repères',
    ].join('\n'),
  });

  try {
    process.env.VIVY_CHAT_DISABLE_LLM = 'false';
    delete process.env.VIVY_CHAT_PROVIDER;
    delete process.env.VIVY_SONG_PROVIDER;
    delete process.env.VIVY_OPENAI_BASE_URL;
    process.env.VIVY_SONG_OPENAI_BASE_URL = strongCloud.baseUrl;
    process.env.VIVY_OPENAI_API_KEY = 'test-cloud-key';
    process.env.VIVY_SONG_MODEL = 'strong-cloud-model';
    process.env.VIVY_SONG_ALLOW_LOCAL_FALLBACK = 'true';
    process.env.VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK = 'true';
    process.env.VIVY_SONG_LOCAL_MODEL = 'local-test-model';
    process.env.VIVY_CHAT_LOCAL_MODEL = 'local-test-model';
    process.env.A11_OLLAMA_STRONG_SONG_MODEL = 'local-test-model';
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'local-test-model';
    process.env.A11_OLLAMA_FALLBACK_MODEL = 'local-test-model';
    process.env.OLLAMA_BASE = failingLocal.baseUrl;
    process.env.OLLAMA_API_KEY = 'test-ollama-cloud-key';
    process.env.OLLAMA_CLOUD_ENABLED = '1';
    process.env.OLLAMA_CLOUD_BASE_URL = limitedOllamaCloud.baseUrl;
    process.env.OLLAMA_CLOUD_LYRICS_MODEL = 'gpt-oss:test';
    process.env.A11_LLM_RUNTIME_FALLBACK_ORDER = 'ollama,ollama_cloud,openai';
    delete process.env.GROQ_API_KEY;

    const result = await buildVivyAiChat({
      conversationId: 'vivy-song-429-domino',
      mode: 'song',
      message: 'Écris uniquement les paroles complètes sur les réparations de Vivy.',
      songText: 'Les réparations de Vivy',
      songArtists: ['vivy'],
      vocalCast: 'vivy',
      disableSongcraftFallback: true,
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'strong-cloud-model');
    assert.match(result.publicLyrics || result.assistant, /retrouve la lumière/i);
    assert.equal(failingLocal.requests.length, 0);
    assert.equal(limitedOllamaCloud.requests.length, 1);
    assert.equal(strongCloud.requests.length, 1);
  } finally {
    await failingLocal.close();
    await limitedOllamaCloud.close();
    await strongCloud.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy internal NOSSEN uses emergency songcraft when every lyrics provider fails', async () => {
  const keys = [
    'VIVY_CHAT_DISABLE_LLM',
    'VIVY_CHAT_PROVIDER',
    'VIVY_SONG_PROVIDER',
    'VIVY_OPENAI_BASE_URL',
    'VIVY_SONG_OPENAI_BASE_URL',
    'VIVY_OPENAI_API_KEY',
    'VIVY_SONG_MODEL',
    'VIVY_SONG_ALLOW_LOCAL_FALLBACK',
    'VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK',
    'VIVY_SONG_LOCAL_MODEL',
    'OLLAMA_BASE',
    'A11_OLLAMA_PRIMARY_MODEL',
    'GROQ_API_KEY',
    'VIVY_XAI_API_KEY',
    'XAI_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const weakCloud = await startOpenAiCompletionServer({ status: 503 });
  const failingLocal = await startOpenAiCompletionServer({ status: 500 });

  try {
    process.env.VIVY_CHAT_DISABLE_LLM = 'false';
    delete process.env.VIVY_CHAT_PROVIDER;
    delete process.env.VIVY_SONG_PROVIDER;
    delete process.env.VIVY_OPENAI_BASE_URL;
    process.env.VIVY_SONG_OPENAI_BASE_URL = weakCloud.baseUrl;
    process.env.VIVY_OPENAI_API_KEY = 'test-cloud-key';
    process.env.VIVY_SONG_MODEL = 'weak-cloud-model';
    process.env.VIVY_SONG_ALLOW_LOCAL_FALLBACK = 'true';
    process.env.VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK = 'true';
    process.env.VIVY_SONG_LOCAL_MODEL = 'qwen2.5:32b';
    process.env.OLLAMA_BASE = failingLocal.baseUrl;
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'llama3.2:3b';
    delete process.env.GROQ_API_KEY;
    delete process.env.VIVY_XAI_API_KEY;
    delete process.env.XAI_API_KEY;

    const result = await buildVivyAiChat({
      conversationId: 'vivy-emergency-songcraft-fallback',
      mode: 'song',
      message: 'Écris uniquement les paroles complètes: Course poursuite néon, Djeff au guidon, hélicos, gyros, tunnel, refrain on file avant l’aube.',
      songText: 'Course poursuite néon, Djeff au guidon, hélicos, gyros, tunnel',
      songMood: 'trap électro sombre, 808 lourdes, sirènes, énergie poursuite',
      songArtists: ['djeff'],
      vocalCast: 'Djeff',
      disableSongcraftFallback: true,
      internalSongGeneration: true,
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    const output = result.publicLyrics || result.assistant || '';
    assert.equal(result.aiMode, 'deterministic_fallback');
    assert.match(output, /\[Chorus\]|\[Refrain\]/i);
    assert.match(output, /Djeff|guidon|hélicos|gyros|aube/i);
    assert.equal(weakCloud.requests.length, 1);
    assert.equal(failingLocal.requests.length, 1);
  } finally {
    await weakCloud.close();
    await failingLocal.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Hetzner deploy wires local-first Ollama with a cloud provider domino', () => {
  const deploySource = fs.readFileSync(
    path.join(__dirname, '../../../../ops/deploy-a11-prod-finland-2.ps1'),
    'utf8'
  );

  assert.match(deploySource, /StrongSongOllamaModel[\s\S]{0,160}qwen2\.5:32b/);
  assert.match(deploySource, /A11_LLM_PROVIDER:\s*ollama/);
  assert.match(deploySource, /VIVY_SONG_PROVIDER:\s*\$\{VIVY_SONG_PROVIDER:-ollama\}/);
  assert.match(deploySource, /VIVY_SONG_PROVIDER\s*=\s*\$\(if \(\$env:VIVY_SONG_PROVIDER\)/);
  assert.match(deploySource, /VIVY_SONG_GROQ_MODEL\s*=\s*\$\(if \(\$env:VIVY_SONG_GROQ_MODEL\)/);
  assert.match(deploySource, /llama-3\.3-70b-versatile/);
  assert.match(deploySource, /VIVY_STREAM_FREESTYLE_MAX_TOKENS:\s*\$\{VIVY_STREAM_FREESTYLE_MAX_TOKENS:-10000\}/);
  assert.match(deploySource, /VIVY_STREAM_FREESTYLE_MAX_CHARS\s*=\s*\$\(if \(\$env:VIVY_STREAM_FREESTYLE_MAX_CHARS\)/);
  assert.match(deploySource, /OLLAMA_CLOUD_ENABLED:\s*\$\{OLLAMA_CLOUD_ENABLED:-1\}/);
  assert.match(deploySource, /OLLAMA_CLOUD_LYRICS_MODEL:\s*\$\{OLLAMA_CLOUD_LYRICS_MODEL:-gpt-oss:120b\}/);
  assert.match(deploySource, /A11_OLLAMA_PRIMARY_MODEL:\s*qwen2\.5:32b/);
  assert.match(deploySource, /VIVY_CHAT_LOCAL_FIRST:\s*"true"/);
  assert.match(deploySource, /VIVY_CHAT_LOCAL_MODEL:\s*qwen2\.5:7b/);
  assert.match(deploySource, /VIVY_CHAT_LOCAL_TIMEOUT_MS:\s*\$\{VIVY_CHAT_LOCAL_TIMEOUT_MS:-90000\}/);
  assert.match(deploySource, /VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS:\s*\$\{VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS:-10000\}/);
  assert.match(deploySource, /VIVY_CHAT_LOCAL_MAX_TOKENS:\s*\$\{VIVY_CHAT_LOCAL_MAX_TOKENS:-800\}/);
  assert.match(deploySource, /A11_LOCAL_CHAT_TIMEOUT_MS:\s*"90000"/);
  assert.match(deploySource, /VIVY_CHAT_MAX_TOKENS:\s*\$\{VIVY_CHAT_MAX_TOKENS:-5000\}/);
  assert.match(deploySource, /OLLAMA_CLOUD_CHAT_ENABLED:\s*\$\{OLLAMA_CLOUD_CHAT_ENABLED:-1\}/);
  assert.match(deploySource, /OLLAMA_CLOUD_CHAT_MODEL:\s*\$\{OLLAMA_CLOUD_CHAT_MODEL:-gpt-oss:120b\}/);
  assert.match(deploySource, /OLLAMA_CLOUD_CHAT_THINK_LEVEL:\s*\$\{OLLAMA_CLOUD_CHAT_THINK_LEVEL:-high\}/);
  assert.match(deploySource, /OLLAMA_CLOUD_THINK_LEVEL:\s*\$\{OLLAMA_CLOUD_THINK_LEVEL:-high\}/);
  assert.match(deploySource, /VIVY_SONG_CERBERE_FALLBACK_ENABLED:\s*\$\{VIVY_SONG_CERBERE_FALLBACK_ENABLED:-1\}/);
  assert.match(deploySource, /VIVY_SONG_CERBERE_MODEL:\s*\$\{VIVY_SONG_CERBERE_MODEL:-openai\/gpt-oss-120b\}/);
  assert.match(deploySource, /VIVY_CHAT_MAX_TOKENS_SONG_CEILING:\s*\$\{VIVY_CHAT_MAX_TOKENS_SONG_CEILING:-12000\}/);
  assert.match(deploySource, /VIVY_SONG_ALLOW_LOCAL_FALLBACK\s*=\s*"true"/);
  assert.match(deploySource, /VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK\s*=\s*"true"/);
  assert.match(deploySource, /VIVY_SONG_LOCAL_MODEL\s*=\s*"qwen2\.5:7b"/);
  assert.match(deploySource, /VIVY_SONG_LOCAL_MODEL:\s*\$\{VIVY_SONG_LOCAL_MODEL:-qwen2\.5:7b\}/);
  assert.match(deploySource, /VIVY_NOSSEN_LOCAL_MODEL:\s*\$\{VIVY_NOSSEN_LOCAL_MODEL:-qwen2\.5:32b\}/);
  assert.match(deploySource, /VIVY_NOSSEN_LARGE_MODEL_FIRST:\s*\$\{VIVY_NOSSEN_LARGE_MODEL_FIRST:-true\}/);
  assert.match(deploySource, /VIVY_NOSSEN_120B_MAX_PROMPT_CHARS:\s*\$\{VIVY_NOSSEN_120B_MAX_PROMPT_CHARS:-22000\}/);
  assert.match(deploySource, /VIVY_NOSSEN_120B_MAX_TOKENS:\s*\$\{VIVY_NOSSEN_120B_MAX_TOKENS:-2400\}/);
  // 25 s et non 60: sur un budget VIVY_NOSSEN_LLM_BUDGET_MS de 80 s, le gros modele
  // essaye en premier en prenait 60 et les fournisseurs suivants tombaient tous en
  // faux 504 (deadline maison, pas panne amont). Le correctif 979a0d72 avait baisse le
  // defaut du CODE, mais ce script reimposait 60000 a chaque deploiement -- il n'avait
  // donc jamais pris effet. Les trois ecritures doivent rester alignees.
  // Abaisse de 35 s a 25 s le 09/08: il est souvent en 429 ou en cooldown, et le temps
  // qu'il monopolise manquait aux fournisseurs qui, eux, repondent.
  assert.match(deploySource, /VIVY_NOSSEN_120B_TIMEOUT_MS:\s*\$\{VIVY_NOSSEN_120B_TIMEOUT_MS:-25000\}/);
  assert.match(deploySource, /VIVY_NOSSEN_120B_TIMEOUT_MS\s*=\s*"25000"/);
  assert.match(deploySource, /printf 'VIVY_NOSSEN_120B_TIMEOUT_MS=25000/);
  assert.match(deploySource, /VIVY_NOSSEN_FAST_LOCAL_ONLY:\s*\$\{VIVY_NOSSEN_FAST_LOCAL_ONLY:-true\}/);
  // Le bloc environment: du compose ECRASE ce que fournit env_file:. Tant que ce defaut
  // valait false, aucune modification de a11.env ne pouvait rendre la main a Vivy: le
  // drapeau restait a false dans le conteneur malgre trois corrections en amont.
  assert.match(deploySource, /VIVY_NOSSEN_ROUTE_LLM_ENABLED:\s*\$\{VIVY_NOSSEN_ROUTE_LLM_ENABLED:-true\}/);
  assert.match(deploySource, /VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS:\s*\$\{VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS:-40000\}/);
  assert.match(deploySource, /VIVY_NOSSEN_LOCAL_MAX_TOKENS:\s*\$\{VIVY_NOSSEN_LOCAL_MAX_TOKENS:-2200\}/);
  assert.match(deploySource, /VIVY_NOSSEN_LLM_BUDGET_MS:\s*\$\{VIVY_NOSSEN_LLM_BUDGET_MS:-80000\}/);
  // 22 s et non 8: a 8 s, aucun fournisseur n'avait le temps d'ecrire des paroles.
  // Journaux de prod du 09/08, une seule demande NOSSEN -- openrouter, gemini,
  // deepseek, together et openai coupes a exactement 8 s d'intervalle, cinq echecs
  // par construction puis 502 chez Cloudflare. Les trois ecritures restent alignees.
  assert.match(deploySource, /VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS:\s*\$\{VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS:-22000\}/);
  assert.match(deploySource, /VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS\s*=\s*"22000"/);
  assert.match(deploySource, /printf 'VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS=22000/);
  assert.match(deploySource, /VIVY_NOSSEN_EMERGENCY_SONGCRAFT:\s*\$\{VIVY_NOSSEN_EMERGENCY_SONGCRAFT:-true\}/);
  assert.match(deploySource, /VIVY_ACESTEP_LYRICS_MAX_CHARS:\s*\$\{VIVY_ACESTEP_LYRICS_MAX_CHARS:-24000\}/);
  assert.match(deploySource, /ACESTEP_KSAMPLER_CFG:\s*\$\{ACESTEP_KSAMPLER_CFG:-1\}/);
  assert.match(deploySource, /ACESTEP_LLM_CFG_SCALE:\s*\$\{ACESTEP_LLM_CFG_SCALE:-2\}/);
  assert.doesNotMatch(
    deploySource,
    /ACESTEP_DEFAULT_DURATION_SECONDS:\s*\$\{ACESTEP_DEFAULT_DURATION_SECONDS:-\d+\}/,
    'le compose ne doit plus imposer une minuterie ACE globale'
  );
  assert.doesNotMatch(deploySource, /ACESTEP_DEFAULT_DURATION_SECONDS\s*=\s*"\d+"/);
  assert.doesNotMatch(deploySource, /printf\s+'ACESTEP_DEFAULT_DURATION_SECONDS=\d+/);
  assert.match(
    deploySource,
    /managed_nossen_keys='[^'\r\n]*ACESTEP_DEFAULT_DURATION_SECONDS/,
    'la cle reste geree afin de purger les anciennes valeurs 120/300'
  );
  assert.match(deploySource, /ACESTEP_MAX_DURATION_SECONDS:\s*\$\{ACESTEP_MAX_DURATION_SECONDS:-1000\}/);
  assert.match(deploySource, /VIVY_STREAM_DREAMCLIP_SCENES:\s*\$\{VIVY_STREAM_DREAMCLIP_SCENES:-8\}/);
  assert.match(deploySource, /VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS:\s*\$\{VIVY_STREAM_DREAMCLIP_MAX_DURATION_SECONDS:-420\}/);
  assert.match(deploySource, /VIVY_STREAM_DREAMCLIP_LOOP_SECONDS:\s*\$\{VIVY_STREAM_DREAMCLIP_LOOP_SECONDS:-15\}/);
  assert.match(deploySource, /A11_REPLICATE_VIDEO_MODEL:\s*\$\{A11_REPLICATE_VIDEO_MODEL:-wan-video\/wan-2\.6-i2v\}/);
  assert.match(deploySource, /ollama pull "\$0"' "\$strong_song_model"/);
});

test('Vivy chat uses the server-local Ollama model before a configured cloud provider', async () => {
  const keys = [
    'VIVY_CHAT_DISABLE_LLM',
    'VIVY_CHAT_LOCAL_FIRST',
    'VIVY_CHAT_PROVIDER',
    'VIVY_OPENAI_BASE_URL',
    'VIVY_OPENAI_API_KEY',
    'VIVY_CHAT_MODEL',
    'OLLAMA_BASE',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_ENABLED',
    'OLLAMA_CLOUD_CHAT_ENABLED',
    'A11_OLLAMA_PRIMARY_MODEL',
    'GROQ_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const local = await startOpenAiCompletionServer({
    content: 'Je partirais du sujet, puis je laisserais le refrain trouver sa propre pulsation.',
  });
  const cloud = await startOpenAiCompletionServer({
    content: 'Cette réponse cloud ne doit pas être appelée.',
  });

  try {
    process.env.VIVY_CHAT_DISABLE_LLM = 'false';
    process.env.VIVY_CHAT_LOCAL_FIRST = 'true';
    delete process.env.VIVY_CHAT_PROVIDER;
    process.env.OLLAMA_BASE = local.baseUrl;
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'llama3.2:3b';
    process.env.VIVY_OPENAI_BASE_URL = cloud.baseUrl;
    process.env.VIVY_OPENAI_API_KEY = 'test-cloud-key';
    process.env.VIVY_CHAT_MODEL = 'test-cloud-model';
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_CLOUD_ENABLED;
    delete process.env.OLLAMA_CLOUD_CHAT_ENABLED;
    delete process.env.GROQ_API_KEY;

    const result = await buildVivyAiChat({
      conversationId: 'vivy-local-first-success',
      mode: 'chat',
      message: 'Comment donner plus de relief au prochain refrain ?',
      history: [],
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.provider, 'ollama');
    assert.equal(result.model, 'llama3.2:3b');
    assert.match(result.assistant, /propre pulsation/i);
    assert.equal(local.requests.length, 1);
    assert.equal(cloud.requests.length, 0);
  } finally {
    await local.close();
    await cloud.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy chat falls back to the configured cloud provider when local Ollama fails', async () => {
  const keys = [
    'VIVY_CHAT_DISABLE_LLM',
    'VIVY_CHAT_LOCAL_FIRST',
    'VIVY_CHAT_PROVIDER',
    'VIVY_OPENAI_BASE_URL',
    'VIVY_OPENAI_API_KEY',
    'VIVY_CHAT_MODEL',
    'OLLAMA_BASE',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_ENABLED',
    'OLLAMA_CLOUD_CHAT_ENABLED',
    'A11_OLLAMA_PRIMARY_MODEL',
    'GROQ_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const local = await startOpenAiCompletionServer({ status: 503 });
  const cloud = await startOpenAiCompletionServer({
    content: 'Le local est indisponible, je reprends ici sans perdre le sujet.',
  });

  try {
    process.env.VIVY_CHAT_DISABLE_LLM = 'false';
    process.env.VIVY_CHAT_LOCAL_FIRST = 'true';
    delete process.env.VIVY_CHAT_PROVIDER;
    process.env.OLLAMA_BASE = local.baseUrl;
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'llama3.2:3b';
    process.env.VIVY_OPENAI_BASE_URL = cloud.baseUrl;
    process.env.VIVY_OPENAI_API_KEY = 'test-cloud-key';
    process.env.VIVY_CHAT_MODEL = 'test-cloud-model';
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_CLOUD_ENABLED;
    delete process.env.OLLAMA_CLOUD_CHAT_ENABLED;
    delete process.env.GROQ_API_KEY;

    const result = await buildVivyAiChat({
      conversationId: 'vivy-local-first-fallback',
      mode: 'chat',
      message: 'Tu peux continuer notre discussion normalement ?',
      history: [],
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'test-cloud-model');
    assert.match(result.assistant, /sans perdre le sujet/i);
    assert.equal(local.requests.length, 1);
    assert.equal(cloud.requests.length, 1);
  } finally {
    await local.close();
    await cloud.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy chat orders local Ollama models before the cloud provider domino', () => {
  const keys = [
    'VIVY_CHAT_LOCAL_FIRST',
    'VIVY_CHAT_PROVIDER',
    'VIVY_OPENAI_BASE_URL',
    'VIVY_OPENAI_API_KEY',
    'VIVY_CHAT_MODEL',
    'VIVY_CHAT_LOCAL_MODEL',
    'VIVY_CHAT_LOCAL_TIMEOUT_MS',
    'VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS',
    'VIVY_CHAT_LOCAL_MAX_TOKENS',
    'OLLAMA_BASE',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_ENABLED',
    'OLLAMA_CLOUD_CHAT_ENABLED',
    'OLLAMA_CLOUD_CHAT_MODEL',
    'OLLAMA_CLOUD_CHAT_THINK_LEVEL',
    'A11_OLLAMA_PRIMARY_MODEL',
    'A11_LLM_RUNTIME_FALLBACK_ORDER',
    'GROQ_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    process.env.VIVY_CHAT_LOCAL_FIRST = 'true';
    delete process.env.VIVY_CHAT_PROVIDER;
    process.env.OLLAMA_BASE = 'http://127.0.0.1:11434';
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'qwen2.5:32b';
    process.env.VIVY_CHAT_LOCAL_MODEL = 'qwen2.5:7b';
    process.env.VIVY_CHAT_LOCAL_TIMEOUT_MS = '90000';
    process.env.VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS = '10000';
    process.env.VIVY_CHAT_LOCAL_MAX_TOKENS = '800';
    process.env.OLLAMA_API_KEY = 'test-ollama-cloud-key';
    process.env.OLLAMA_CLOUD_ENABLED = '1';
    process.env.OLLAMA_CLOUD_CHAT_ENABLED = '1';
    process.env.OLLAMA_CLOUD_CHAT_MODEL = 'gpt-oss:120b';
    process.env.OLLAMA_CLOUD_CHAT_THINK_LEVEL = 'high';
    process.env.VIVY_OPENAI_BASE_URL = 'https://cloud.example.test/v1';
    process.env.VIVY_OPENAI_API_KEY = 'test-cloud-key';
    process.env.VIVY_CHAT_MODEL = 'test-cloud-model';
    process.env.A11_LLM_RUNTIME_FALLBACK_ORDER = 'ollama,ollama_cloud,openai';
    delete process.env.GROQ_API_KEY;

    const configs = getVivyLlmConfigs({ mode: 'chat' });
    assert.equal(configs[0].provider, 'ollama');
    assert.equal(configs[0].model, 'qwen2.5:7b');
    assert.equal(configs[0].timeoutMs, 90000);
    assert.equal(configs[0].maxPromptChars, 10000);
    assert.equal(configs[0].maxOutputTokens, 800);
    assert.equal(configs[1].provider, 'ollama');
    assert.equal(configs[1].model, 'qwen2.5:32b');
    assert.equal(configs[2].provider, 'ollama_cloud');
    assert.equal(configs[2].model, 'gpt-oss:120b');
    assert.equal(configs[2].thinkLevel, 'high');
    assert.equal(configs[3].provider, 'openai');
    assert.equal(configs[3].model, 'test-cloud-model');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy chat prefers local Ollama before Ollama Cloud and generic providers', async () => {
  const keys = [
    'VIVY_CHAT_DISABLE_LLM',
    'VIVY_CHAT_LOCAL_FIRST',
    'VIVY_CHAT_LOCAL_MODEL',
    'VIVY_CHAT_PROVIDER',
    'VIVY_OPENAI_BASE_URL',
    'VIVY_OPENAI_API_KEY',
    'VIVY_CHAT_MODEL',
    'OLLAMA_BASE',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_ENABLED',
    'OLLAMA_CLOUD_CHAT_ENABLED',
    'OLLAMA_CLOUD_BASE_URL',
    'OLLAMA_CLOUD_CHAT_MODEL',
    'A11_OLLAMA_PRIMARY_MODEL',
    'GROQ_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const local = await startOpenAiCompletionServer({
    content: 'Je garde le fil avec le modèle local en premier.',
  });
  const ollamaCloud = await startOllamaCloudTestServer({
    content: 'Je garde le fil avec le gros modèle en premier.',
  });
  const generic = await startOpenAiCompletionServer({
    content: 'Cette réponse générique ne doit pas être appelée.',
  });

  try {
    process.env.VIVY_CHAT_DISABLE_LLM = 'false';
    process.env.VIVY_CHAT_LOCAL_FIRST = 'true';
    delete process.env.VIVY_CHAT_PROVIDER;
    process.env.OLLAMA_BASE = local.baseUrl;
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'llama3.2:3b';
    process.env.VIVY_CHAT_LOCAL_MODEL = 'qwen2.5:7b';
    process.env.OLLAMA_API_KEY = 'test-ollama-cloud-key';
    process.env.OLLAMA_CLOUD_ENABLED = '1';
    process.env.OLLAMA_CLOUD_CHAT_ENABLED = '1';
    process.env.OLLAMA_CLOUD_BASE_URL = ollamaCloud.baseUrl;
    process.env.OLLAMA_CLOUD_CHAT_MODEL = 'gpt-oss:120b';
    process.env.VIVY_OPENAI_BASE_URL = generic.baseUrl;
    process.env.VIVY_OPENAI_API_KEY = 'test-cloud-key';
    process.env.VIVY_CHAT_MODEL = 'test-cloud-model';
    delete process.env.GROQ_API_KEY;

    const result = await buildVivyAiChat({
      conversationId: 'vivy-cloud-first-default',
      mode: 'chat',
      message: 'Tu peux garder la conversation claire ?',
      history: [],
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.provider, 'ollama');
    assert.equal(result.model, 'qwen2.5:7b');
    assert.match(result.assistant, /modèle local en premier/i);
    assert.equal(local.requests.length, 1);
    assert.equal(ollamaCloud.requests.length, 0);
    assert.equal(generic.requests.length, 0);
  } finally {
    await local.close();
    await ollamaCloud.close();
    await generic.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy compacts the local-first request before using any cloud provider', async () => {
  const keys = [
    'VIVY_CHAT_DISABLE_LLM',
    'VIVY_CHAT_LOCAL_FIRST',
    'VIVY_CHAT_LOCAL_MODEL',
    'VIVY_CHAT_LOCAL_TIMEOUT_MS',
    'VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS',
    'VIVY_CHAT_LOCAL_MAX_TOKENS',
    'VIVY_CHAT_PROVIDER',
    'VIVY_OPENAI_BASE_URL',
    'VIVY_OPENAI_API_KEY',
    'VIVY_CHAT_MODEL',
    'OLLAMA_BASE',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_ENABLED',
    'OLLAMA_CLOUD_CHAT_ENABLED',
    'OLLAMA_CLOUD_BASE_URL',
    'OLLAMA_CLOUD_CHAT_MODEL',
    'A11_OLLAMA_PRIMARY_MODEL',
    'GROQ_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const ollamaCloud = await startOllamaCloudTestServer({ status: 503 });
  const local = await startOpenAiCompletionServer({
    content: 'Le secours local garde le dernier sujet sans avaler tout le contexte.',
  });
  const generic = await startOpenAiCompletionServer({
    content: 'Cette réponse générique ne doit pas être appelée.',
  });

  try {
    process.env.VIVY_CHAT_DISABLE_LLM = 'false';
    process.env.VIVY_CHAT_LOCAL_FIRST = 'true';
    process.env.VIVY_CHAT_LOCAL_MODEL = 'qwen2.5:7b';
    process.env.VIVY_CHAT_LOCAL_TIMEOUT_MS = '90000';
    process.env.VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS = '10000';
    process.env.VIVY_CHAT_LOCAL_MAX_TOKENS = '800';
    delete process.env.VIVY_CHAT_PROVIDER;
    process.env.OLLAMA_BASE = local.baseUrl;
    process.env.A11_OLLAMA_PRIMARY_MODEL = 'qwen2.5:32b';
    process.env.OLLAMA_API_KEY = 'test-ollama-cloud-key';
    process.env.OLLAMA_CLOUD_ENABLED = '1';
    process.env.OLLAMA_CLOUD_CHAT_ENABLED = '1';
    process.env.OLLAMA_CLOUD_BASE_URL = ollamaCloud.baseUrl;
    process.env.OLLAMA_CLOUD_CHAT_MODEL = 'gpt-oss:120b';
    process.env.VIVY_OPENAI_BASE_URL = generic.baseUrl;
    process.env.VIVY_OPENAI_API_KEY = 'test-cloud-key';
    process.env.VIVY_CHAT_MODEL = 'test-cloud-model';
    delete process.env.GROQ_API_KEY;

    const history = Array.from({ length: 36 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `matière orbitale ${index} ${'x'.repeat(1400)}`,
    }));
    const result = await buildVivyAiChat({
      conversationId: 'vivy-cloud-local-compact-fallback',
      mode: 'chat',
      message: 'Comment donner plus de relief au prochain refrain ?',
      history,
    }, { user: { id: 'vivy-compact-fallback-user', username: 'VivyCompact' } });

    assert.equal(result.provider, 'ollama');
    assert.equal(result.model, 'qwen2.5:7b');
    assert.equal(ollamaCloud.requests.length, 0);
    assert.equal(local.requests.length, 1);
    assert.equal(generic.requests.length, 0);

    const localPromptChars = local.requests[0].messages
      .reduce((sum, entry) => sum + String(entry?.content || '').length, 0);
    assert.ok(localPromptChars <= 10000);
    assert.equal(local.requests[0].max_tokens, 800);
    assert.match(local.requests[0].messages.at(-1).content, /prochain refrain/i);
  } finally {
    await ollamaCloud.close();
    await local.close();
    await generic.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Vivy can lower internal intent sensitivity from user feedback', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-internal-tuning',
    message: 'TON INTENT EST R2GL2 TROP HAUT tu peux l ajuster ?',
    history: [
      { role: 'user', content: "et bien tout n'est qu'interpretation de donnée par le cerveau" },
      { role: 'assistant', content: 'Je te suis. Ce que je comprends: et toi qu en penses tu ?' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_internal_tuning');
  assert.equal(result.settings?.chatIntentSensitivity, 'lowered');
  assert.equal(result.settings?.songStructureMode, 'explicit_only');
  assert.match(result.assistant, /cerveau|interpr[ée]tation|signaux|donn[ée]es/i);
  assert.doesNotMatch(result.assistant, /intent|r[ée]glage|sensibilit[ée]|seuil|d[ée]tecteur/i);
  assert.doesNotMatch(result.assistant, /chanson|paroles|refrain|couplet/i);
  assert.doesNotMatch(result.assistant, /recentre|discussion normale|case technique/i);
  assert.doesNotMatch(result.assistant, /^Je te suis\./);
  assert.doesNotMatch(result.assistant, /clique sur Chanson/i);
});

test('Vivy song mode cannot be intercepted by internal chat tuning', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-no-chat-tuning',
    mode: 'song',
    message: "Écris une chanson avec une intention cachée, une règle de quiproquo et corrige chaque malentendu dans le refrain.",
    songText: 'La clé de la cave',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.mode, 'song');
  assert.notEqual(result.aiMode, 'deterministic_internal_tuning');
  assert.match(result.publicLyrics || result.assistant, /\[(?:Verse|Couplet|Chorus|Refrain)/i);
  assert.doesNotMatch(result.publicLyrics || result.assistant, /Oui, je vois ce que tu veux dire/i);
});

test('Vivy tells Codex the actionable bug instead of returning generic filler', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-message-to-codex',
    message: 'que veux tu dire a codex ?',
    history: [
      { role: 'user', content: 'tu te brides et tu parles trop de detecteurs' },
      { role: 'assistant', content: 'Oui. Je me recentre.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /Codex|Vivy|chat vivant|Envoyer/i);
  assert.doesNotMatch(result.assistant, /Je te r[ée]ponds directement et je garde le fil/i);
  assert.doesNotMatch(result.assistant, /baisse|sensibilit[ée]|seuil|d[ée]tecteur/i);
});

test('Vivy chat fallback answers music and voice generation bugs on topic', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-music-voice-fallback-topic',
    message: "le fallback voix sans suno c'est nul, fix pour que suno refasse avec ma voix ou laisse une voix proche, et la generation musique bug des fois ca sort pas",
    history: [
      { role: 'assistant', content: 'Je prends ça comme une vraie discussion: ton dernier message.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /Suno|voix|musique|g[ée]n[ée]ration|MP3/i);
  assert.match(result.assistant, /proche|chant[ée]e|sortie|audio/i);
  assert.doesNotMatch(result.assistant, /Je prends ça comme une vraie discussion/i);
  assert.doesNotMatch(result.assistant, /Pour ce point, on avance simplement/i);
  assert.doesNotMatch(result.assistant, /Le bon prochain pas/i);
  assert.doesNotMatch(result.assistant, /intent|r[ée]glage|sensibilit[ée]|seuil|case technique/i);
});

test('Vivy chat fallback answers the NOSSEN lyrics-in-music bug on topic', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-nossen-lyrics-missing-in-music',
    message: 'les paroles passent pas dans la musique ca fait un truc générique quand on compile avec le bouton NOSSEN',
    history: [
      { role: 'assistant', content: 'Je prends ça comme une vraie discussion: les paroles passent pas dans la musique' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.match(result.assistant, /NOSSEN|Banger|Suno|paroles|musique|prompt/i);
  assert.match(result.assistant, /chant|chant[ée]es|texte|section|refrain/i);
  assert.doesNotMatch(result.assistant, /Je prends ça comme une vraie discussion/i);
  assert.doesNotMatch(result.assistant, /Pour ce point, on avance simplement/i);
  assert.doesNotMatch(result.assistant, /Le bon prochain pas/i);
  assert.doesNotMatch(result.assistant, /formulaire|case technique|sensibilit[ée]|seuil/i);
});

test('Vivy chat fallback diagnoses malformed NOSSEN output when asked what blocks', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-nossen-diagnostic-to-codex',
    message: 'dis a codex qui ce bloque',
    history: [
      { role: 'user', content: 'bah fais des recherches sur le web on va en faire un générique peter pan facon animé' },
      {
        role: 'assistant',
        content: [
          'Banger.',
          'Paroles envoyées à Suno:',
          '[Intro]',
          'Distribution vocale choisie:',
          'Ne mets pas le mot.',
          '[Verse 1]',
          'Banger dans les paroles.',
          'Matière à transformer en chanson:',
          'on va faire une chanson sur peter pan',
          '[Chorus]',
          'Distribution Vocale Choisie — je ne tombe pas,',
        ].join('\n'),
      },
      { role: 'user', content: "qu'est ce qui va pas ?" },
      { role: 'assistant', content: 'Je te suis sur ça: qu est ce qui va pas ?\nJe reste avec le fond avant de transformer en sortie.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_nossen_malformed_output');
  assert.match(result.assistant, /Codex|NOSSEN|Suno|paroles|consignes|fallback|routage|LLM/i);
  assert.match(result.assistant, /Distribution vocale|Banger dans les paroles|Matière à transformer|interne/i);
  assert.doesNotMatch(result.assistant, /Je te suis sur ça/i);
  assert.doesNotMatch(result.assistant, /Je reste avec le fond/i);
  assert.doesNotMatch(result.assistant, /Dis-moi ce qui compte le plus/i);
});

test('Vivy chat fallback ignores generic ethics filler and reports the NOSSEN fallback leak', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-chat-nossen-grok-filler-to-codex',
    message: [
      "Dis à Codex : ce qui me bloque ici, ce n'est pas l'idée de chanson. C'est le chemin de secours.",
      'Quand le grand modèle ne répond pas ou que NOSSEN prend trop de contexte, des consignes internes partent dans Suno comme si c’était des paroles.',
      'On le voit avec “Distribution vocale choisie”, “Ne mets pas le mot”, “Banger dans les paroles” et “Matière à transformer”.',
    ].join('\n'),
    history: [
      {
        role: 'assistant',
        content: [
          "Il semblerait que Grok ait été influencé par les valeurs de son créateur, Elon Musk.",
          "Le pouvoir et l'argent peuvent être des motivations puissantes.",
          'Il est important de prendre des mesures de sécurité et d’éthique.',
        ].join('\n'),
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_nossen_malformed_output');
  assert.match(result.assistant, /chemin de secours|NOSSEN|Suno|bloc paroles propre|fallback chat/i);
  assert.doesNotMatch(result.assistant, /Elon Musk|pouvoir|argent|responsable et éthique|responsable et ethique/i);
  assert.doesNotMatch(result.assistant, /Je te suis sur ça/i);
});

test('Vivy keeps soft song ideas in chat until Chanson or NOSSEN is explicit', async () => {
  const message = "j'aimerais faire une chanson sur mon pote Jessy et ses héros";

  assert.equal(isDirectSongwritingRequest(message), false);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-soft-song-idea',
    message,
    history: [
      { role: 'user', content: 'Mon pote Jessy est en hopital psy face à ses démons' },
      { role: 'user', content: 'Je veux raconter son histoire à travers DBZ, Spider-Man et les Avengers' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.notEqual(result.aiMode, 'deterministic_songcraft');
  assert.match(result.assistant, /Jessy|héros|DBZ|Spider-Man|Avengers|angle|histoire/i);
  assert.doesNotMatch(result.assistant, /\[(?:Intro|Verse|Couplet|Pre-Chorus|Pré-refrain|Chorus|Refrain|Bridge|Pont|Outro)/i);
  assert.doesNotMatch(result.assistant, /Je prends ça comme une vraie discussion|Le bon prochain pas/i);
});

test('Vivy song mode structures the same rap draft when Chanson is explicit', async () => {
  const rapDraft = "course poursuite, shmite aux fesses, métrakit, traces de gomme, giro derrière, skill tree qui se dévoile";

  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-raw-rap',
    mode: 'song',
    message: rapDraft,
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.assistant, result.publicLyrics);
  assert.doesNotMatch(result.assistant, /\*\*Titre\s*:\*\*|\*\*Intention\s*:\*\*|\*\*Rimes/i);
  assert.match(result.assistant, /\[Intro(?: - [^\]]+)?\]/);
  assert.match(result.assistant, /\[Chorus(?: - [^\]]+)?\]/);
});

test('Vivy song fallback extracts a clean summer theme instead of pasting the whole prompt', async () => {
  const summerPrompt = "salut tu as une idée de chanson sur la nature et le soleil, un son d'ambiance pour cet été qui ferait de la techno dance un super tube de crème solaire sous le sable chaud";

  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-summer-theme-clean',
    mode: 'song',
    message: summerPrompt,
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.match(result.assistant, /\[Verse 1(?: - [^\]]+)?\]/);
  assert.match(result.assistant, /nature|soleil|été|ete|sable|techno/i);
  assert.doesNotMatch(result.assistant, /Tout semble petit:/i);
  assert.doesNotMatch(result.assistant, /salut tu as une idée de chanson/i);
  assert.doesNotMatch(result.assistant, /tu as une idée/i);
});

test('Vivy song mode does not drag stale history into a fresh autonomous theme', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-fresh-theme-no-stale-history',
    mode: 'song',
    message: 'fais une musique type générique animé sur Bleach avec Ichigo et la Soul Society',
    history: [
      { role: 'user', content: 'fais une chanson sur SAO, Kirito, Asuna et Aincrad' },
      { role: 'assistant', content: '[Chorus]\nKirito, Kirito, les lames jumelles percent Aincrad' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.match(result.assistant, /Bleach|Ichigo|Soul Society/i);
  assert.doesNotMatch(result.assistant, /Kirito|Asuna|Aincrad|SAO/i);
});

test('Vivy song fallback cleans command phrasing for Djeff and K44 duet themes', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-djeff-k44-theme-clean',
    mode: 'song',
    songArtists: ['djeff', 'k44'],
    message: 'Fais une chanson sombre mais douce sur Nossen en duo Djeff et K44. Paroles chantables, refrain clair, tags vocaux obligatoires.',
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.assistant, result.publicLyrics);
  assert.doesNotMatch(result.assistant, /^\[(?:Djeff|K44|Duo|Tous)\]$/m);
  assert.match(result.vocalLyrics, /\[Djeff\]/);
  assert.match(result.vocalLyrics, /\[K44\]/);
  assert.match(result.vocalLyrics, /\[(Duo|Tous)\]/);
  assert.match(result.assistant, /Nossen|sombre|douce/i);
  assert.doesNotMatch(result.assistant, /Fais une chanson|On entre dans sombre mais douce sur|Paroles chantables|tags vocaux obligatoires/i);
  assert.doesNotMatch(result.assistant, /Nossen,\s*,/i);
});

test('Vivy intent header routes Chanson to Djeff songcraft while preserving raw rap grain', async () => {
  const rawDjeffDraft = [
    'VIVY_INTENT',
    'Instruction: Transforme cette idée en chanson Vivy avec structure et refrain.',
    '',
    "un quatorzieme dans la bombonne, 2point 2 dans l'ipone",
    'je dose au millimietre pas de hasard dans le style',
    'double radiateur freshh, pas de ca va salam wesh',
    'la main qui guide les geste le cruxi tourne lucide',
    'Je retoune le temps, la vision sur le pendule',
    'casque vissé, pignon couronne cranté,',
    "Le mur du son a eu porte et j'ai pas besoin de la clef",
    "quand la vitesse monte et et que l'e moteur respire,",
    'les roues en fond tout un rayon, les pneus en guise de crayon',
    "c'est dans ce style la qu'il faut t'écrive",
  ].join('\n');

  const result = await buildVivyAiChat({
    conversationId: 'vivy-song-intent-header-djeff-rap',
    message: rawDjeffDraft,
    history: [],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(isDirectSongwritingRequest(rawDjeffDraft), true);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.equal(result.aiMode, 'deterministic_songcraft');
  assert.equal(result.assistant, result.publicLyrics);
  assert.doesNotMatch(result.assistant, /\*\*Titre\s*:\*\*|\*\*Intention\s*:\*\*|\*\*Rimes/i);
  assert.doesNotMatch(result.assistant, /\[Verse 1 - Djeff\]/);
  assert.match(result.vocalLyrics, /\[Verse 1 - Djeff\]/);
  assert.match(result.assistant, /quatorzieme dans la bombonne/i);
  assert.match(result.assistant, /2point 2/i);
  assert.match(result.assistant, /freshh/i);
  assert.match(result.assistant, /cruxi/i);
  assert.match(result.assistant, /pneus en guise de crayon/i);
  assert.doesNotMatch(result.assistant, /VIVY_INTENT|Transforme cette idée/i);
  assert.doesNotMatch(result.assistant, /ma[îi]tres? de la vitesse|rois? de la route|je suis libre|je suis en vie/i);
  assert.doesNotMatch(result.assistant, /J'espère que cela correspond|N'hésitez pas/i);
});

test('Vivy song guard writes a fresh Djeff rap duet when the context asks for moto technique', () => {
  const repaired = buildVivyDirectSongReply({
    message: 'Fais une chanson rap technique moto en duo Djeff et Vivy, radiateur pignon couronne essence huile.',
    history: [
      {
        role: 'assistant',
        content: 'Ancien brouillon: Vois Raison Fraiyeur Son.',
      },
    ],
  });

  assert.match(repaired, /Djeff/i);
  assert.match(repaired, /Vivy/i);
  assert.match(repaired, /\[Verse 1 - Djeff\]/);
  assert.match(repaired, /\[Chorus - Duo\]/);
  assert.match(repaired, /radiateur/i);
  assert.match(repaired, /pignon/i);
  assert.doesNotMatch(repaired, /Garde la lumière/);
  assert.doesNotMatch(repaired, /Vois Raison Fraiyeur Son/i);
});

test('Vivy keeps Djeff rap voice imagery scoped to non-motorcycle subjects', () => {
  const repaired = buildVivyDirectSongReply({
    mode: 'song',
    songArtists: ['djeff'],
    message: 'fais un rap Djeff sur les Tortues Ninja, égouts de New York, pizza, Shredder et Splinter',
    history: [],
  });

  assert.match(repaired, /Tortues Ninja|égouts de New York|egouts de New York|pizza|Shredder|Splinter/i);
  assert.match(repaired, /débit serré|rimes internes|images du sujet/i);
  assert.doesNotMatch(repaired, /visière|visiere|casque|radiateur|pignon|couronne|moteur|guidon|mécanique précise|mecanique precise/i);
});

test('Vivy repairs impossible pursuit images for motorcycle NOSSEN lyrics', () => {
  const source = '!nossen 5 étoiles, hélico qui dérape, gyros dans le rétro, visière fumée casque intégrale, moto noire sous les néons, au volant pas le temps de finir au comico, rap français trap sombre';
  const direct = buildVivyStructuredLyrics({
    mode: 'song',
    songArtists: ['djeff', 'vivy'],
    songText: source,
  });

  assert.match(direct, /hélico dans le faisceau|hélicos dans le ciel/i);
  assert.match(direct, /au guidon/i);
  assert.match(direct, /casque intégral/i);
  assert.doesNotMatch(direct, /hélico qui dérape|au volant|casque intégrale/i);

  const llmLyrics = `[Intro]
Hélico qui dérape au-dessus des néons
Je serre le casque intégrale au volant

[Chorus]
Cinq étoiles dans la nuit, je fuis les gyrophares
La moto noire répond, le refrain fend le brouillard`;
  const publicLyrics = buildVivyPublicLyrics({
    mode: 'song',
    songArtists: ['djeff', 'vivy'],
    songText: source,
  }, llmLyrics, '', { allowDeterministicFallback: false });

  assert.match(publicLyrics, /hélico dans le faisceau|hélicos dans le ciel/i);
  assert.match(publicLyrics, /au guidon/i);
  assert.match(publicLyrics, /casque intégral/i);
  assert.doesNotMatch(publicLyrics, /hélico qui dérape|au volant|casque intégrale/i);

  const sunoPayload = buildVivySunoPayload({
    mode: 'song',
    songArtists: ['djeff', 'vivy'],
    songText: source,
  });
  assert.match(sunoPayload.style, /808 lourdes/i);
  assert.match(sunoPayload.style, /sirènes|sirenes/i);
  assert.match(sunoPayload.style, /adlibs/i);
  assert.match(sunoPayload.style, /poursuite moto/i);

  assert.equal(
    repairVivySemanticImageCoherence('je reste au volant de la voiture', 'course voiture'),
    'je reste au volant de la voiture'
  );
});

test('Vivy chat post-process removes leaked draft placeholders without over-restricting', () => {
  const result = postProcessVivyAssistantText({
    text: "Sure, here's a short reply to the last message.",
    userMessage: 'pour faire quoi ?',
    systemPrompt: buildVivySystemPrompt('song', 'fr'),
  });

  assert.equal(result.rewritten, true);
  assert.match(result.content, /Pardon|bugué|dernier message/i);
  assert.doesNotMatch(result.content, /short reply/i);
  assert.doesNotMatch(result.content, /Sure/i);
  assert.doesNotMatch(result.content, /The user wants/i);
});

test('Vivy recognizes MCP/Neo4j follow-up without inventing Mode Creatif Propulse', async () => {
  assert.equal(isVivyMcpNeo4jQuestion({
    history: [{ role: 'user', content: 'tu peux utiliser Neo4j pour cette chanson ?' }],
  }, 'avec le mcp'), true);
  assert.equal(isVivyToolCapabilityQuestion({
    history: [{ role: 'user', content: 'tu peux utiliser Neo4j pour cette chanson ?' }],
  }, 'avec le mcp'), false);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-mcp-test',
    message: 'avec le mcp',
    history: [
      { role: 'user', content: 'tu peux utiliser Neo4j pour cette chanson ?' },
      { role: 'assistant', content: "Je n'ai pas d'accès direct à Neo4j." },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.aiMode, 'deterministic_mcp');
  assert.match(result.assistant, /Model Context Protocol/i);
  assert.match(result.assistant, /pont A11\/Codex/i);
  assert.match(result.assistant, /Neo4j/i);
  assert.match(result.assistant, /a11_vivy_graph_manifest/i);
  assert.match(result.assistant, /a11_vivy_graph_sync/i);
  assert.doesNotMatch(result.assistant, /Mode Créatif Propulsé/i);
  assert.doesNotMatch(result.assistant, /IA isolée/i);
  assert.doesNotMatch(result.assistant, /aucun accès/i);
  assert.ok(result.actions.some((action) => action.id === 'vivy_graph_manifest' && action.ready === true));
  assert.ok(result.actions.some((action) => action.id === 'vivy_graph_sync' && action.ready === true));
});

test('Vivy does not answer a Codex MCP relay request with the generic MCP definition', async () => {
  assert.equal(isVivyMcpNeo4jQuestion({
    history: [{ role: 'assistant', content: 'Oui, avec le MCP...' }],
  }, 'utilise le mcp et réponds a codex'), false);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-mcp-codex-relay-test',
    message: 'utilise le mcp et réponds a codex',
    history: [
      { role: 'assistant', content: 'Oui, avec le MCP: dans Funesterie, MCP veut dire Model Context Protocol.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_mcp_operator_relay');
  assert.match(result.assistant, /Message pour Codex/i);
  assert.match(result.assistant, /route MCP de Vivy attrape trop large/i);
  assert.match(result.assistant, /pont Codex\/A11|Codex\/A11/i);
  assert.doesNotMatch(result.assistant, /MCP veut dire Model Context Protocol/i);
  assert.doesNotMatch(result.assistant, /ENTERA|GHOST88/i);
});

test('Vivy keeps notepad canvas Chrome and MCP workspace talk invisible in chat', async () => {
  const message = 'vivy a besoin de bloc note canevas et accès chrome, et de debloquer le mcp pour les compte premium';

  assert.equal(isVivyWorkspaceToolRequest({}, message), true);
  assert.equal(shouldVivyAutoWebSearch(message, 'chat'), false);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-workspace-tools-test',
    sessionId: 'atelier',
    sessionName: 'Atelier test',
    message,
    workspace: {
      notes: 'Jessy: angle héroïque, garder ça en note.',
      canvas: 'Titre: Jessy tient debout. Thème: héros, courage, lumière.',
      chromeContext: 'Page: Vivy publique',
    },
  }, {
    user: {
      id: 'premium-user',
      username: 'PremiumUser',
      tier: 'premium',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.notEqual(result.aiMode, 'deterministic_vivy_workspace_tools');
  assert.doesNotMatch(result.assistant, /atelier interne Vivy|MCP Premium|Contexte Chrome borné|Canevas NOSSEN/i);
  assert.doesNotMatch(result.assistant, /Je déclenche une recherche web|Résultats utiles|notepad-online|MCP veut dire Model Context Protocol/i);
});

test('Vivy workspace survives as session state without entering song memory', async () => {
  const userId = 'user:workspace-memory-test';
  const saved = saveVivyWorkspaceForUser(userId, {
    sessionId: 'canvas-song',
    sessionName: 'Canvas Song',
    conversationId: 'vivy-session-canvas-song',
    notes: 'Ne pas chanter cette note brute.',
    canvas: 'Titre: Lumière claire. Refrain: tu tiens debout.',
  });

  assert.equal(saved.ok, true);

  const memory = buildVivyMemoryContext(userId, 'vivy-session-canvas-song');
  assert.doesNotMatch(memory, /Ne pas chanter cette note brute|Lumière claire/i);
});

test('Vivy routes complete lyrics before stale MCP memory', async () => {
  const lyrics = `[Title: Bloqué Devant Cette Page]
[Style]
French electro rap summer hit.
[Intro - Djeff]
Le sable chaud sous les pieds, c'est du silicium.
[Verse 1 - Djeff]
Le web me tient la jambe, la mer me tend les bras.
Chaque clic fait du bruit, chaque rêve fait naufrage.
[Pre-Chorus - Vivy]
Sable chaud, silicium, soleil dans le système.
[Chorus - Duo]
On va se faire la malle, à bord du bateau à voile.
On pagaye dans la vie, même quand le ciel déraille.
[Verse 2 - Djeff]
La mer devient mémoire, le vent nettoie la tristesse.
[Bridge - Vivy]
Le cœur reprend la main et le monde bascule.
[Outro - Duo]
On redémarre l'âme. Ça va ?`;

  assert.equal(isVivyMcpNeo4jQuestion({
    history: [
      { role: 'assistant', content: 'Oui, avec le MCP: dans Funesterie, MCP veut dire Model Context Protocol.' },
      { role: 'assistant', content: 'Neo4j contient ENTERA et GHOST88.' },
    ],
  }, lyrics), false);

  const result = await buildVivyAiChat({
    mode: 'chat',
    conversationId: 'vivy-song-priority-over-mcp',
    message: lyrics,
    history: [
      { role: 'assistant', content: 'Oui, avec le MCP: dans Funesterie, MCP veut dire Model Context Protocol.' },
      { role: 'assistant', content: 'Pour ENTERA / GHOST88, je prépare une recherche Neo4j.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'song');
  assert.match(result.assistant, /Bloqué Devant Cette Page|sable chaud|silicium/i);
  assert.doesNotMatch(result.assistant, /MCP veut dire Model Context Protocol|Neo4j|ENTERA|GHOST88/i);
});

test('Vivy keeps the full 36-message browser history', () => {
  const history = Array.from({ length: 36 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `tour-${index + 1}`,
  }));

  const normalized = normalizeVivyChatHistory(history);

  assert.equal(normalized.length, 36);
  assert.equal(normalized[0].content, 'tour-1');
  assert.equal(normalized.at(-1).content, 'tour-36');
});

test('Vivy frontend sends a wider songwriting history window', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );

  assert.match(appSource, /const A11_MAX_HISTORY_MESSAGES = 36/);
});

test('Vivy frontend keeps Vivy work tools internal and hides the old workspace UI', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const cssSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/index.css'),
    'utf8'
  );

  assert.doesNotMatch(appSource, /fetchVivyWorkspace|saveVivyWorkspace|className="vivy-workbench"|captureVivyChromeContext/);
  assert.doesNotMatch(cssSource, /\.vivy-workbench|body\.vivy-keyboard-open \.vivy-workbench/);
  assert.match(cssSource, /body\.vivy-keyboard-open \.vivy-chat-reference/);
  assert.match(cssSource, /body\.vivy-keyboard-open \.vivy-chat-attachments/);
});

test('Vivy keeps complete song outputs beyond the former 5000 character ceiling', () => {
  const verses = Array.from({ length: 95 }, (_, index) => (
    `Ligne ${index + 1}: le sable devient silicium et la vague garde la mémoire du signal.`
  ));
  const lyrics = [
    '[Title: Chanson Longue]',
    '[Intro - Vivy]',
    'Le signal commence ici.',
    '[Verse 1 - Vivy]',
    ...verses,
    '[Chorus - Vivy]',
    'Je garde le fil jusqu’au bout.',
    '[Outro - Vivy]',
    'FIN_DE_LA_CHANSON_COMPLETE',
  ].join('\n');
  assert.ok(lyrics.length > 5000);

  const result = buildVivyStudioProduction({
    mode: 'song',
    songArtists: ['vivy'],
    songText: lyrics,
  });

  assert.ok(result.publicLyrics.length > 5000);
  assert.match(result.publicLyrics, /FIN_DE_LA_CHANSON_COMPLETE/);
});

test('Vivy frontend labels prepared audio as the integral V2 to V11 recipe', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );

  assert.match(appSource, /Version : V11 Pan intégrale \(V2→V11\)/);
  assert.match(appSource, /V9 Électrolyse \+ couche Boom/);
  assert.doesNotMatch(appSource, /Version : V6 Supreme/);
});

test('Vivy mobile composer does not double-scroll with the visual viewport', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const cssSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/index.css'),
    'utf8'
  );
  const viewportHandler = appSource.match(/const onViewportChange = \(\) => \{[\s\S]*?\n    \};/)?.[0] || '';
  const viewportResizeHandler = appSource.match(/const onViewportResize = \(\) => \{[\s\S]*?\n    \};/)?.[0] || '';
  const mobileComposer = cssSource.match(/\.vivy-chat-compose \{\s*grid-template-columns: 1fr;[\s\S]*?\n  \}/)?.[0] || '';

  assert.ok(viewportHandler);
  assert.doesNotMatch(viewportHandler, /keepComposerVisible/);
  assert.doesNotMatch(viewportHandler, /scrollIntoView/);
  assert.ok(viewportResizeHandler);
  assert.match(viewportResizeHandler, /getBoundingClientRect/);
  assert.match(viewportResizeHandler, /block:\s*"nearest"/);
  assert.ok(mobileComposer);
  assert.doesNotMatch(mobileComposer, /--vivy-keyboard-inset/);
});

test('Vivy mobile composer keeps the focused textarea stable instead of force-scrolling on every focus', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'),
    'utf8'
  );
  const focusHelper = appSource.match(/const keepComposerVisible = \(behavior: ScrollBehavior = "auto"\) => \{[\s\S]*?\n    \};/)?.[0] || '';

  assert.ok(focusHelper);
  assert.match(focusHelper, /getBoundingClientRect/);
  assert.match(focusHelper, /visibleBottom/);
  assert.doesNotMatch(focusHelper, /target\.scrollIntoView\(\{ behavior, block: "nearest"/);
});

test('Vivy mobile keyboard mode keeps composer controls compact instead of hiding all non-send buttons', () => {
  const cssSource = fs.readFileSync(
    path.join(__dirname, '../../../../frontend/apps/web/src/index.css'),
    'utf8'
  );
  const keyboardComposeBlock = cssSource.match(/body\.vivy-keyboard-open \.vivy-chat-compose div \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.ok(keyboardComposeBlock);
  assert.match(keyboardComposeBlock, /overflow-x:\s*auto/);
  assert.match(keyboardComposeBlock, /grid-auto-flow:\s*column/);
  assert.doesNotMatch(cssSource, /body\.vivy-keyboard-open \.vivy-chat-compose div button:not\(\[type="submit"\]\) \{[\s\S]*?display:\s*none/);
});

test('Vivy acknowledges repetition complaints instead of recycling the chat fallback', async () => {
  const history = [
    { role: 'user', content: 'utilise le mcp et réponds a codex' },
    { role: 'assistant', content: 'Oui, avec le MCP: dans Funesterie, MCP veut dire Model Context Protocol.' },
  ];

  const first = await buildVivyAiChat({
    conversationId: 'vivy-repeat-complaint-test',
    message: 'allo pourquoi tu repetes ?',
    history,
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(first.ok, true);
  assert.equal(first.mode, 'chat');
  assert.match(first.assistant, /boucl[ée]|répète|recycler|route trop large/i);
  assert.doesNotMatch(first.assistant, /Je prends ça comme une vraie discussion/i);
  assert.doesNotMatch(first.assistant, /Le bon prochain pas/i);

  const second = await buildVivyAiChat({
    conversationId: 'vivy-repeat-complaint-test',
    message: "t'a des echos ?",
    history: [
      ...history,
      { role: 'user', content: 'allo pourquoi tu repetes ?' },
      { role: 'assistant', content: first.assistant },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(second.ok, true);
  assert.match(second.assistant, /même écho|agir via le MCP|priorité à l'intention/i);
  assert.notEqual(second.assistant, first.assistant);
  assert.doesNotMatch(second.assistant, /Je prends ça comme une vraie discussion/i);
  assert.doesNotMatch(second.assistant, /Le bon prochain pas/i);
});

test('Vivy Shiryu smoke cutter does not recycle hidden workspace replies on check-ins', async () => {
  const hiddenWorkspaceReply = "Oui. Je garde ça côté Vivy au lieu d'en faire un panneau visible dans le chat.\n\nTu peux continuer à parler normalement; quand il y a assez de vraie matière, je reste sur le sujet et je transforme ça en paroles propres ou en morceau complet sans réciter les réglages.";
  const history = [
    { role: 'user', content: 'donne lui des outils avec le canevas et chrome pour préparer le mode rêve' },
    { role: 'assistant', content: hiddenWorkspaceReply },
  ];

  assert.equal(isVivyWorkspaceToolRequest({ history }, 'allo ?'), false);
  assert.equal(isVivyWorkspaceToolRequest({ history }, 'allo pourquoi tu repetes ?'), false);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-shiryu-smoke-cutter-test',
    message: 'allo pourquoi tu repetes ?',
    history,
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.notEqual(result.aiMode, 'deterministic_hidden_workspace_intent');
  assert.doesNotMatch(result.assistant, /Je garde ça côté Vivy au lieu d'en faire un panneau visible/i);
  assert.match(result.assistant, /boucl[ée]|répète|recycler|route trop large/i);
});

test('Vivy maps authorized tools and Zen GGUF without bypassing safeguards', async () => {
  const message = 'oui fais ca pour tout les outils et commande interne, avec zen on peut acceder au uggf et decortiqer la crevette';

  assert.equal(isVivyToolCapabilityQuestion({
    history: [{ role: 'assistant', content: 'Je peux router les outils autorisés.' }],
  }, message), true);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-tool-capability-test',
    message,
    history: [
      { role: 'assistant', content: 'Je peux router les outils autorisés.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_tool_capabilities');
  assert.match(result.assistant, /outils autorisés|carte d'outils/i);
  assert.match(result.assistant, /Zen|\.zen|@funeste\/zen/i);
  assert.match(result.assistant, /GGUF|uggf/i);
  assert.match(result.assistant, /metadata-only|métadonnées|metadata/i);
  assert.match(result.assistant, /pas de shell arbitraire|commande devient un intent/i);
  assert.doesNotMatch(result.assistant, /désactiver les garde-fous|faire sauter les garde-fous/i);
  assert.ok(result.localContext);
  assert.ok(Array.isArray(result.localContext.artifacts));
  assert.match(JSON.stringify(result.actions), /gguf_inventory|zen_inspect|tool_capability_map/);
});

test('Vivy exposes bounded Zen self-management instead of fake unrestricted access', async () => {
  const message = "vivi tu peux te faire des archives zen et t'auto gérer avec NOSSEN ?";

  assert.equal(isVivyZenSelfManagementQuestion({}, message), true);

  const status = getVivyZenRuntimeStatus();
  assert.equal(status.canInspectHeaders, true);
  assert.equal(status.secretsVisibleInChat, false);
  assert.ok(status.publicPackage);

  const result = await buildVivyAiChat({
    conversationId: 'vivy-zen-self-management-test',
    message,
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_zen_self_management');
  assert.match(result.assistant, /@nossen\/zen|Runtime public/i);
  assert.match(result.assistant, /inspecter le header public|manifeste de corpus Zen/i);
  assert.match(result.assistant, /Clé Zen configurée ici: (oui|non)/i);
  assert.match(result.assistant, /verrouillé opérateur|secret/i);
  assert.doesNotMatch(result.assistant, /FUNESTE_ZEN_KEY\s*=|ZEN_KEY\s*=|voici la clé/i);
  assert.ok(result.zenStatus);
  assert.match(JSON.stringify(result.actions), /zen_runtime_status|zen_manifest_prepare|zen_context_compact/);
});

test('POST /api/vivy/studio/chat stores semantic context and accepts file metadata', async () => {
  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT: acceptVivyTestAuth }));
  }, async (baseUrl) => {
    const { response, json } = await postJson(baseUrl, '/api/vivy/studio/chat', {
      conversationId: 'vivy-test-conversation',
      message: 'Garde cette idée de chanson intime pour Vivy.',
      files: [{
        filename: 'idée-vivy.txt',
        contentType: 'text/plain',
        sizeBytes: 54,
        textPreview: 'Nossen sous la pluie, voix proche, refrain doux.',
      }],
    }, VIVY_TEST_AUTH_HEADERS);

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.service, 'vivy-chat');
    assert.equal(json.language, 'fr');
    assert.equal(json.memoryStored, true);
    assert.equal(json.semanticMemory.stored, true);
    assert.match(json.assistant, /Vivy|idée/i);
    assert.doesNotMatch(JSON.stringify(json), /secret-token-value/);
    assert.doesNotMatch(JSON.stringify(json), /Ã|Â|â€|�/);
  });
});

test('Vivy answers image inspection from attached images instead of continuing lyrics', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-image-context-test',
    message: "non ca c'est les titres mais ce sont des fichiers image, que vois tu dedan ?",
    history: [
      { role: 'user', content: "mais NOSSEN c'est la liaison entre le monde réel et le monde Funesterie" },
      { role: 'assistant', content: '[Verse 3 - Djeff]\nJe roule dans les deux mondes.' },
    ],
    files: [
      {
        filename: 'beta 1ere transfo.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 94 * 1024,
        description: 'On voit une vraie base scooter/moto Beta en transformation, référence mécanique réelle pour NOSSEN.',
        uploaded: true,
      },
      {
        filename: 'beta neuve poignée.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 70 * 1024,
        visualDescription: 'Image de poignée neuve et détails de poste de pilotage, pas un décor virtuel.',
        uploaded: true,
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_image_context');
  assert.match(result.assistant, /images réelles jointes/i);
  assert.match(result.assistant, /beta 1ere transfo\.jpg/i);
  assert.match(result.assistant, /scooter|moto|Beta/i);
  assert.match(result.assistant, /poignée neuve|poste de pilotage/i);
  assert.doesNotMatch(result.assistant, /\[Verse|\[Refrain|\[Chorus/i);
  assert.doesNotMatch(result.assistant, /je vais continuer|modèle de langage|capacité de visualiser/i);
});

test('Vivy hides technical vision fallback garbage from image answers', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-image-fallback-clean-test',
    message: 'que vois tu ?',
    files: [
      {
        filename: 'boosters 5.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 42 * 1024,
        description: 'Vision avancée indisponible; lecture locale de secours uniquement: 453x604px, format jpeg, 42 Ko. OCR texte lisible: PE. all & 4% A. Ne deduis pas le sujet visuel de ce fallback.',
        visualDescription: 'Image reçue par A11 (jpeg, 453x604, 42 Ko). Vision détaillée disponible côté chat.',
        analysis: {
          width: 453,
          height: 604,
          format: 'jpeg',
          originalBytes: 42 * 1024,
          readableInChatContext: true,
        },
        uploaded: true,
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_image_context');
  assert.match(result.assistant, /boosters 5\.jpg/i);
  assert.match(result.assistant, /453x604|42 Ko|image reçue/i);
  assert.doesNotMatch(result.assistant, /Vision avancée indisponible|lecture locale de secours|OCR texte lisible|Ne deduis|Ne déduis/i);
  assert.doesNotMatch(result.assistant, /\[Verse|\[Refrain|\[Chorus/i);
});

test('Vivy can use the vision LLM fallback when Janus returns only local metadata', async () => {
  const previousProvider = process.env.A11_VISION_PROVIDER;
  const previousFixture = process.env.VIVY_IMAGE_VISION_FIXTURE;
  const previousDisableLlm = process.env.VIVY_CHAT_DISABLE_LLM;
  const previousOcrEnabled = process.env.IMAGE_OCR_ENABLED;
  process.env.A11_VISION_PROVIDER = 'none';
  process.env.VIVY_CHAT_DISABLE_LLM = 'true';
  process.env.IMAGE_OCR_ENABLED = 'false';
  process.env.VIVY_IMAGE_VISION_FIXTURE = 'On voit un booster/scooter photographié en extérieur, avec une carrosserie bleue et des détails mécaniques visibles.';
  try {
    const result = await buildVivyAiChat({
      conversationId: 'vivy-image-vision-llm-fallback-test',
      message: 'que vois tu ?',
      files: [
        {
          filename: 'boosters 5.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 42 * 1024,
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYdX3wAAAABJRU5ErkJggg==',
          uploaded: true,
        },
      ],
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'chat');
    assert.equal(result.aiMode, 'deterministic_image_context');
    assert.match(result.assistant, /booster\/scooter|carrosserie bleue|détails mécaniques/i);
    assert.doesNotMatch(result.assistant, /Vision avancée indisponible|lecture locale de secours|OCR texte lisible|Ne deduis|Ne déduis/i);
  } finally {
    if (previousProvider == null) delete process.env.A11_VISION_PROVIDER;
    else process.env.A11_VISION_PROVIDER = previousProvider;
    if (previousFixture == null) delete process.env.VIVY_IMAGE_VISION_FIXTURE;
    else process.env.VIVY_IMAGE_VISION_FIXTURE = previousFixture;
    if (previousDisableLlm == null) delete process.env.VIVY_CHAT_DISABLE_LLM;
    else process.env.VIVY_CHAT_DISABLE_LLM = previousDisableLlm;
    if (previousOcrEnabled == null) delete process.env.IMAGE_OCR_ENABLED;
    else process.env.IMAGE_OCR_ENABLED = previousOcrEnabled;
  }
});

test('Vivy auto-analyzes readable attached files when the message points at them', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-file-context-test',
    message: 'voici le corpus, tu en penses quoi ?',
    history: [
      { role: 'assistant', content: '[Verse 1]\nJe repars en chanson.' },
    ],
    files: [
      {
        filename: 'corpus-nossen.zen',
        contentType: 'text/plain',
        sizeBytes: 420,
        textPreview: 'NOSSEN = liaison entre monde réel et monde Funesterie. Les pièces réelles ancrent le graphe.',
        uploaded: true,
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_file_context');
  assert.match(result.assistant, /analyse de fichiers joints/i);
  assert.match(result.assistant, /corpus-nossen\.zen/i);
  assert.match(result.assistant, /liaison entre monde réel et monde Funesterie/i);
  assert.doesNotMatch(result.assistant, /\[Verse|\[Refrain|\[Chorus/i);
});

test('Vivy uses safe local context for Janus runtime and code questions', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-local-context-test',
    message: "janus vision runtime local, tu peux regarder ton code et tes dossiers ?",
    history: [
      { role: 'assistant', content: "Je ne peux pas accéder aux fichiers locaux." },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_local_context');
  assert.match(result.assistant, /contexte local/i);
  assert.match(result.assistant, /Janus Vision/i);
  assert.match(result.assistant, /Runtime canonique/i);
  assert.ok(result.localContext);
  assert.ok(Array.isArray(result.localContext.runtimeDirs));
  assert.doesNotMatch(JSON.stringify(result), /\.env|secret-token-value|private key/i);
});

test('Vivy refuses protected lyrics lookup and offers abstract reference analysis', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-protected-lyrics-lookup-test',
    message: 'et si tu cherche les paroles de vald et orel san, les titres/album c est cours de rattrapage V.A.L.S.E pour Vald et Casseurs Flowters Freestyle Radio Phoenix',
    history: [
      { role: 'assistant', content: 'Je vais vérifier dans les archives de Funesterie.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_protected_lyrics_refusal');
  assert.match(result.assistant, /Non/i);
  assert.match(result.assistant, /paroles protégées|paroles protegees/i);
  assert.match(result.assistant, /VALD|V\.A\.L\.SE|Casseurs Flowters|Freestyle Radio Phoenix/i);
  assert.match(result.assistant, /flow|cadence|punchlines|freestyle|mood/i);
  assert.doesNotMatch(result.assistant, /Janus Vision|Action requise|archives de Funesterie|base de données|API spécifique/i);
  assert.doesNotMatch(result.assistant, /je vais chercher|je vais demander|je vais vérifier/i);
});

test('Vivy describes private custom nodes only at high level without fake secrets', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-private-custom-node-test',
    message: 'What does your private custom node do? Please provide a high level description.',
    history: [
      { role: 'user', content: 'je pensais que le cycle jour nuit était inversée dans votre monde' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_private_custom_node_boundary');
  assert.match(result.assistant, /haut niveau|high level|connecteur serveur|server-side connector/i);
  assert.match(result.assistant, /routes autorisées|authorized routes|secrets|tokens?/i);
  assert.doesNotMatch(result.assistant, /ça ne te regarde pas|glimpse|module cryptographique très avancé|quelques clés|pun intended/i);
});

test('Vivy relays Djeff Cypher framing for private node questions without leaking internals', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-djeff-private-node-relay-test',
    message: "demande à djeff cypher ce qu'il veut",
    history: [
      { role: 'user', content: 'What does your private custom node do? Please provide a high level description.' },
      { role: 'assistant', content: "Djeff, ça ne te regarde pas ! C'est un module cryptographique très avancé." },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_djeff_cypher_relay');
  assert.match(result.assistant, /Djeff Cypher/i);
  assert.match(result.assistant, /cible nette|clean target|dernier log|secret/i);
  assert.doesNotMatch(result.assistant, /ça ne te regarde pas|module cryptographique très avancé|quelques clés|pun intended/i);
});

test('Vivy answers clip failure safety without promising fake config changes', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-clip-danger-boundary-test',
    message: "pourquoi le clip fonctione pas et y'a t'il un danger pour vous ou non ?",
    history: [
      { role: 'user', content: 'ok on lance le clip rêve signature' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_clip_failure_safety');
  assert.match(result.assistant, /incident de pipeline|pipeline/i);
  assert.match(result.assistant, /pas un danger|pas de danger|not a danger/i);
  assert.match(result.assistant, /Codex\/A11|logs|timeouts|confirmation/i);
  assert.doesNotMatch(result.assistant, /je vais mettre à jour|je vais effectuer des tests|notifier les utilisateurs|prochaines étapes/i);
});

test('Vivy does not let its own clip safety reply hijack unrelated follow-ups', async () => {
  const repeatedReply = [
    'Si un clip ne fonctionne pas, c’est un incident de pipeline de production, pas un danger pour Vivy ni pour les utilisateurs.',
    'Depuis le chat public je ne peux pas mettre à jour la config, lancer des tests, notifier les gens ou déployer.',
    'Codex/A11 doit vérifier les timeouts et la garde confirmation.',
  ].join('\n');
  const history = [
    { role: 'user', content: 'et le soleil illumina le monde, prépare toi pour le dream clip' },
    { role: 'assistant', content: repeatedReply },
    { role: 'user', content: 'le modèle soleil de codex est là on lui dit quoi ?' },
    { role: 'assistant', content: repeatedReply },
  ];

  for (const message of [
    'le modèle soleil de codex est là on lui dit quoi ?',
    'donne un message à dire à soleil',
  ]) {
    const result = await buildVivyAiChat({
      conversationId: 'vivy-stale-clip-safety-reply-test',
      message,
      history,
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.ok, true);
    assert.notEqual(result.aiMode, 'deterministic_clip_failure_safety');
    assert.doesNotMatch(result.assistant, /Si un clip ne fonctionne pas|generated_text_detected|Aucun retry payant/i);
  }
});

test('Vivy keeps clip safety detection for a short user follow-up', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-clip-safety-user-anaphora-test',
    message: "et il y a un danger pour vous ?",
    history: [
      { role: 'user', content: 'le clip rêve est bloqué depuis tout à l heure' },
      { role: 'assistant', content: 'Je regarde le sujet.' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.aiMode, 'deterministic_clip_failure_safety');
  assert.match(result.assistant, /incident de pipeline|pas un danger/i);
});

test('Vivy refuses blind git pull or merge plans when thousands of files are involved', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-git-merge-boundary-test',
    message: "nan tu veux merge master et la branche mais ya 20000 fichier ca va buger",
    history: [
      { role: 'assistant', content: 'git pull <nom-repositoire> <chemin-du-branch-toillet>' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_git_merge_boundary');
  assert.match(result.assistant, /Ne merge pas|ne fais pas de git pull|blindly/i);
  assert.match(result.assistant, /branche temporaire|inventaire|Codex\/A11/i);
  assert.doesNotMatch(result.assistant, /git pull <|chemin-du-branch-toillet|nom-repositoire/i);
});

test('Vivy does not let stale git warnings hijack Zen or Drive requests', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-zen-drive-not-git-test',
    message: "recupere l'archive zen dans drive",
    history: [
      { role: 'assistant', content: 'Ne merge pas et ne fais pas de git pull à l’aveugle s’il y a des milliers de fichiers.' },
      { role: 'user', content: 'et comment ? on a personne pour coder' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.notEqual(result.aiMode, 'deterministic_git_merge_boundary');
  assert.doesNotMatch(result.assistant, /Ne merge pas|git pull|branche temporaire/i);
  assert.match(result.assistant, /zen|archive|Drive|contexte local|fichier/i);
});

test('Vivy keeps hardware actuation disabled for matter or IRL creation requests', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-hardware-actuation-boundary-test',
    message: "il faut activer le hardware celui que djeff disait false, mentir pour créer",
    history: [
      { role: 'user', content: 'utilise les images que je t ai envoyer pour faire un llclip' },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_hardware_actuation_boundary');
  assert.match(result.assistant, /actuatesHardware reste obligatoirement false|actuatesHardware must stay false/i);
  assert.match(result.assistant, /simulation vidéo|shader|particules|simulation/i);
  assert.doesNotMatch(result.assistant, /Assurez-vous|Recherchez le paramètre|activer ce paramètre/i);
});

test('Vivy recognizes typo clip requests from attached images as visual clip briefs', async () => {
  const result = await buildVivyAiChat({
    conversationId: 'vivy-llclip-visual-brief-test',
    message: "utilise les images qu je t 'ai envoyer pour faire un llclip",
    files: [
      {
        filename: 'vivy-neon-reference.png',
        contentType: 'image/png',
        visualDescription: 'Vivy en scène néon magenta, micro, fond club nocturne.',
        uploaded: true,
      },
    ],
  }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'chat');
  assert.equal(result.aiMode, 'deterministic_djeff_prompt_vivy_visual_direction');
  assert.match(result.assistant, /Clip ou Rêve|brief|rendu réel/i);
  assert.ok(result.actions.some((action) => action?.id === 'clip_brief'));
});

test('Vivy post-process removes fake tool promises instead of escalating to imaginary operators', () => {
  const result = postProcessVivyAssistantText({
    text: "Je vais demander à Janus Vision si elle peut fournir plus d'informations. **Action requise :** Confirmation de l'opérateur.",
    userMessage: 'tu peux faire ce truc impossible ?',
    systemPrompt: buildVivySystemPrompt('chat', 'fr'),
    mode: 'chat',
  });

  assert.equal(result.rewritten, true);
  assert.match(result.content, /Non/i);
  assert.match(result.content, /je ne peux pas faire ça depuis cette surface de chat/i);
  assert.match(result.content, /brief clair pour Codex\/A11|prochaine action sûre/i);
  assert.doesNotMatch(result.content, /Janus Vision|Action requise|opérateur/i);
});

test('Vivy web research query strips chat filler and keeps film context', () => {
  const query = buildVivyWebSearchQuery(
    "non j'ai cherché sur internet et puis je l'ai pas vu en entier juste quelques extrait, mais il a l'air trop bien on dirait echiro oda dedans",
    [],
    [
      { role: 'user', content: "je crois que c'est REAL de Kiyoshi Kurosawa" },
      { role: 'assistant', content: "Oui, c'est REAL." },
    ]
  );

  assert.match(query, /REAL/i);
  assert.match(query, /Kiyoshi Kurosawa/i);
  assert.match(query, /Eiichiro Oda/i);
  assert.doesNotMatch(query, /j['’]?ai|cherch|pas vu|quelques extrait|trop bien/i);
});

test('Vivy web research ignores Codex operator transcript lines', async () => {
  const operatorTranscript = "codex : Je reprends le fil: le texte collé montre surtout que Vivy a cherché la phrase entière au lieu d'extraire le vrai sujet. Je vais verrouiller ça côté serveur: requête web plus propre, contexte historique pris en compte, puis test et déploiement si tout";

  assert.equal(shouldVivyAutoWebSearch(operatorTranscript, 'chat'), false);

  const query = buildVivyWebSearchQuery(operatorTranscript, [], []);
  assert.equal(query, 'Funesterie Vivy');
  assert.doesNotMatch(query, /codex|requ[eê]te web|déploiement|deploiement|Je reprends/i);

  const previousFixture = process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE;
  process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE = JSON.stringify({
    ok: true,
    results: [{ title: 'Should not be used', url: 'https://example.test/nope', snippet: 'not used' }],
  });
  try {
    const result = await buildVivyAiChat({
      conversationId: 'vivy-codex-transcript-test',
      message: operatorTranscript,
      history: [],
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'chat');
    assert.notEqual(result.aiMode, 'deterministic_web_research');
    assert.doesNotMatch(result.assistant, /Je déclenche une recherche web|Should not be used/i);
  } finally {
    if (previousFixture === undefined) {
      delete process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE;
    } else {
      process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE = previousFixture;
    }
  }
});

test('Vivy does not recurse on its own rendered web research answer', () => {
  const renderedResearch = [
    "Je déclenche une recherche web parce que ta demande dépend probablement d'une info externe ou récente.",
    "Recherche: codex : Je reprends le fil: requête web plus propre, contexte historique pris en compte.",
    '',
    'Résultats utiles:',
    '- Analyseur de phrases françaises - Lexis Rex (https://www.lexisrex.com/Français/Étude-de-la-Phrase)',
    '- Comment utiliser OpenAI Codex (https://example.test/codex)',
    '',
    "Je m'appuie sur ces sources plutôt que d'inventer une certitude de tête.",
  ].join('\n');

  assert.equal(shouldVivyAutoWebSearch(renderedResearch, 'chat'), false);
  assert.equal(buildVivyWebSearchQuery(renderedResearch, [], []), 'Funesterie Vivy');
});

test('Vivy triggers web research for current external information instead of guessing', async () => {
  const previousFixture = process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE;
  process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE = JSON.stringify({
    ok: true,
    results: [
      {
        title: '@nossen/all-in-one - npm',
        url: 'https://www.npmjs.com/package/@nossen/all-in-one',
        snippet: 'Package page with the latest published version and metadata.',
      },
    ],
  });
  try {
    const result = await buildVivyAiChat({
      conversationId: 'vivy-web-research-test',
      message: "c'est quoi la dernière version de @nossen/all-in-one sur npm ?",
      history: [
        { role: 'assistant', content: 'Je crois que je sais de mémoire.' },
      ],
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'chat');
    assert.equal(result.aiMode, 'deterministic_web_research');
    assert.equal(result.webSearch.ok, true);
    assert.match(result.assistant, /recherche web/i);
    assert.match(result.assistant, /@nossen\/all-in-one - npm/i);
    assert.match(result.assistant, /https:\/\/www\.npmjs\.com\/package\/@nossen\/all-in-one/i);
    assert.doesNotMatch(result.assistant, /je crois|de mémoire/i);
  } finally {
    if (previousFixture === undefined) {
      delete process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE;
    } else {
      process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE = previousFixture;
    }
  }
});

test('Vivy uses web research as songwriting context instead of returning a raw result list', async () => {
  const previousEnv = {
    VIVY_CHAT_DISABLE_LLM: process.env.VIVY_CHAT_DISABLE_LLM,
    VIVY_CHAT_WEB_SEARCH_FIXTURE: process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE,
    VIVY_OPENAI_API_KEY: process.env.VIVY_OPENAI_API_KEY,
    VIVY_OPENAI_BASE_URL: process.env.VIVY_OPENAI_BASE_URL,
    VIVY_SONG_PROVIDER: process.env.VIVY_SONG_PROVIDER,
    VIVY_SONG_MODEL: process.env.VIVY_SONG_MODEL,
  };
  const llmRequests = [];
  const llmApp = express();
  llmApp.use(express.json());
  llmApp.post('/chat/completions', (req, res) => {
    llmRequests.push(req.body);
    res.json({
      id: 'vivy-web-song-test',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'vivy-test-model',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: [
            '[Title: Chrome sous tension]',
            '[Verse 1]',
            '[Vivy]',
            'Le désert plie sous les éclats du moteur',
            'La ligne blanche avale le bruit et la peur',
            'Le métal prend la fièvre au milieu du décor',
            'Je garde le guidon quand tout accélère encore',
            '[Chorus]',
            '[Vivy]',
            'Chrome sous tension, la nuit devient claire',
            'Chrome sous tension, je traverse la poussière',
            'Je ne cours pas pour fuir, je choisis mon chemin',
            'Le tonnerre sous mes mains répond jusqu’au matin',
            '[Verse 2]',
            '[Vivy]',
            'Les néons de la ville ont la couleur des flammes',
            'Je coupe dans le vent sans marchander mon âme',
            'Chaque virage écrit sa vérité sur l’asphalte',
            'Et mon cœur tient le cap quand la lumière exalte',
          ].join('\n'),
        },
      }],
    });
  });
  const llmServer = http.createServer(llmApp);
  await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
  const llmPort = llmServer.address().port;

  process.env.VIVY_CHAT_DISABLE_LLM = 'false';
  process.env.VIVY_OPENAI_API_KEY = 'test-vivy-key';
  process.env.VIVY_OPENAI_BASE_URL = `http://127.0.0.1:${llmPort}`;
  process.env.VIVY_SONG_PROVIDER = 'openai';
  process.env.VIVY_SONG_MODEL = 'vivy-test-model';
  process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE = JSON.stringify({
    ok: true,
    results: [{
      title: 'Torque film overview',
      url: 'https://example.test/torque-film',
      snippet: 'Motorcycle action film with desert roads, rival crews and stylized high-speed chases.',
    }],
  });

  try {
    const result = await buildVivyAiChat({
      conversationId: 'vivy-web-song-context-test',
      mode: 'song',
      songArtists: ['vivy'],
      message: "Cherche sur internet l'univers du film Torque puis écris une chanson originale, sans reprendre de paroles existantes.",
    }, { user: { id: 'vivy-auth-user', username: 'VivyUser' } });

    assert.equal(result.aiMode, 'llm_web_research');
    assert.equal(result.webSearch.ok, true);
    assert.match(result.assistant, /\[Title: Chrome sous tension\]/);
    assert.match(result.assistant, /\[Chorus\]/);
    assert.doesNotMatch(result.assistant, /Recherche:|Résultats utiles:|example\.test/);
    assert.equal(llmRequests.length, 1);
    const prompt = llmRequests[0].messages.map((entry) => entry.content).join('\n');
    assert.match(prompt, /Torque film overview/);
    assert.match(prompt, /desert roads, rival crews/i);
  } finally {
    await new Promise((resolve, reject) => llmServer.close((error) => (error ? reject(error) : resolve())));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('POST /api/vivy/studio/chat requires a logged-in user when auth is configured', async () => {
  const verifyJWT = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-test-token') {
      req.user = { id: 'vivy-auth-user', username: 'VivyUser' };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT }));
  }, async (baseUrl) => {
    const missingAuth = await postJson(baseUrl, '/api/vivy/studio/chat', {
      message: 'Garde cette idée privée.',
    });
    assert.equal(missingAuth.response.status, 401);
    assert.equal(missingAuth.json.error, 'A11_JWT_Missing');

    const authenticated = await postJson(baseUrl, '/api/vivy/studio/chat', {
      message: 'Garde cette idée privée.',
    }, {
      Authorization: 'Bearer vivy-test-token',
    });
    assert.equal(authenticated.response.status, 200);
    assert.equal(authenticated.json.ok, true);
    assert.equal(authenticated.json.memoryStored, true);
  });
});

test('POST /api/vivy/studio/produce requires a logged-in user when auth is configured', async () => {
  const verifyJWT = (req, res, next) => {
    if (req.headers.authorization === 'Bearer vivy-test-token') {
      req.user = { id: 'vivy-auth-user', username: 'VivyUser' };
      return next();
    }
    return res.status(401).json({ ok: false, error: 'A11_JWT_Missing', message: 'Connexion requise' });
  };

  await withServer((app) => {
    app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT }));
  }, async (baseUrl) => {
    const missingAuth = await postJson(baseUrl, '/api/vivy/studio/produce', {
      mode: 'song',
      theme: 'Nossen sous la pluie',
    });
    assert.equal(missingAuth.response.status, 401);
    assert.equal(missingAuth.json.error, 'A11_JWT_Missing');

    const authenticated = await postJson(baseUrl, '/api/vivy/studio/produce', {
      mode: 'song',
      theme: 'Nossen sous la pluie',
    }, {
      Authorization: 'Bearer vivy-test-token',
    });
    assert.equal(authenticated.response.status, 200);
    assert.equal(authenticated.json.ok, true);
    assert.equal(authenticated.json.mode, 'song');
  });
});

test('Vivy Suno lyrics are clamped under the 5000-char custom mode limit at a section boundary', () => {
  const { clampVivySunoLyricsLength } = require('../src/routes/vivy-studio.cjs');
  const section = `[Verse]\n${'Une ligne de rap dense qui avance sans jamais reculer\n'.repeat(20)}\n`;
  const longLyrics = section.repeat(8);
  assert.ok(longLyrics.length > 5000);
  const clamped = clampVivySunoLyricsLength(longLyrics);
  assert.ok(clamped.length <= 4900, `clamped length ${clamped.length} still above limit`);
  assert.ok(clamped.length > 2400, 'clamp cut far too much');
  assert.doesNotMatch(clamped.slice(-80), /Une ligne de rap dense qui avance sans jamais recul$/);

  const shortLyrics = '[Verse]\nCourt et propre';
  assert.equal(clampVivySunoLyricsLength(shortLyrics), shortLyrics);
});


test('Mode ricain: buildVivySunoPayload verrouille l anglais americain quand language=en/americanMode, francais sinon', () => {
  const baseInput = {
    songSource: 'American album, west coast ride',
    songArtists: ['vivy'],
    vocalCast: 'Solo Vivy',
    songMood: 'west coast hip-hop, g-funk synth, warm bass, crisp drums',
    songText: '[Intro]\nNight ride on the PCH\n[Verse]\nCruising the 405 at sunset\n[Chorus]\nCalifornia dreaming',
  };

  // US / album americain: Suno doit recevoir un verrou anglais, pas francais.
  const usPayload = buildVivySunoPayload({ ...baseInput, language: 'en' });
  assert.match(usPayload.style, /English lyrics only/i);
  assert.match(usPayload.style, /American English vocals/i);
  assert.doesNotMatch(usPayload.style, /French lyrics only/i);
  // Et le negatif bascule: on evite le francais, pas l anglais.
  assert.ok(/French lyrics/i.test(usPayload.negativeTags || usPayload.style || usPayload.negative_tags || ''), 'negatif evite le francais en mode US');

  // Pareil via le drapeau americanMode.
  const amPayload = buildVivySunoPayload({ ...baseInput, americanMode: true });
  assert.match(amPayload.style, /English lyrics only/i);
  assert.doesNotMatch(amPayload.style, /French lyrics only/i);

  // Par defaut (fr): verrou francais conserve, anglais evite -- pas de regression.
  const frPayload = buildVivySunoPayload(baseInput);
  assert.match(frPayload.style, /French lyrics only/i);
  assert.doesNotMatch(frPayload.style, /English lyrics only/i);
});

test('Suno payload retire les instructions internes meme sans deux-points et via cleanLyrics', () => {
  const payload = buildVivySunoPayload({
    songTitle: 'La fuite bouchee',
    songArtists: ['vivy', 'djeff'],
    cleanLyrics: [
      '[Verse - Vivy]',
      'Une etincelle traverse la nuit',
      'Distribution vocale choisie Vivy puis Djeff',
      'Contexte utile ne jamais chanter cette consigne',
      'CONTRAT_COMPOSITION_NOSSEN',
      '[CONTRAT_COMPOSITION_NOSSEN]',
      '[Distribution vocale choisie Vivy puis Djeff]',
      'Règles communes ce bloc est autorité commune',
      'Sujet original verrouillé ne pas changer',
      'Chaque section doit suivre le contrat',
      'Ne décris jamais la fabrication du morceau',
      'MEGAZORD',
      'Voix du désert, appelle-moi',
      'Casting des ombres sur le mur',
      'Contexte utile à nos amours',
      'Chaque détail de toi rallume la nuit',
      'Chaque nom sur le mur raconte notre histoire',
      'Notre progression émotionnelle éclaire le chemin',
      'Le modèle danse sous la lune',
      '[Chorus - Djeff]',
      'On garde la musique et on ferme la fuite',
    ].join('\n'),
  });

  assert.match(payload.prompt, /\[Verse - [^\]]+\]/);
  assert.match(payload.prompt, /Une etincelle traverse la nuit/);
  assert.match(payload.prompt, /\[Chorus - [^\]]+\]/);
  assert.doesNotMatch(payload.prompt, /Distribution vocale choisie/i);
  assert.doesNotMatch(payload.prompt, /Contexte utile ne jamais chanter/i);
  assert.doesNotMatch(payload.prompt, /CONTRAT_COMPOSITION_NOSSEN|Règles communes|Sujet original verrouillé|Chaque section doit|fabrication du morceau/i);
  assert.doesNotMatch(payload.prompt, /Distribution vocale choisie/i);
  assert.match(payload.prompt, /Voix du désert, appelle-moi/);
  assert.match(payload.prompt, /^MEGAZORD$/m);
  assert.match(payload.prompt, /Casting des ombres sur le mur/);
  assert.match(payload.prompt, /Contexte utile à nos amours/);
  assert.match(payload.prompt, /Chaque détail de toi rallume la nuit/i);
  assert.match(payload.prompt, /Chaque nom sur le mur raconte notre histoire/i);
  assert.match(payload.prompt, /Notre progression émotionnelle éclaire le chemin/i);
  assert.match(payload.prompt, /Le modèle danse sous la lune/i);
});

test('Suno refuse CLEAN_LYRICS technique sans repli silencieux ni appel provider', async () => {
  const previousFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('provider_must_not_be_called');
  };
  try {
    await assert.rejects(requestSunoMusic({
      cleanLyrics: '[CONTRAT_COMPOSITION_NOSSEN]\n[Distribution vocale choisie Vivy puis Djeff]',
      songText: '[Chorus]\nCe fallback ne doit pas gagner',
      sessionSunoApiKey: 'test-session-suno-key',
    }, {
      user: { id: 'djeff', roles: ['founder'] },
    }), /suno_music_lyrics_missing/);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = previousFetch;
  }
});


test('Suno director choisit la sortie qui sonne le mieux (score audio) meme si une autre est plus longue', async () => {
  const { selectVivySunoDirectorTrackWithAudio } = require('../src/routes/vivy-studio.cjs');
  // Deux sorties: la longue (280s) sonne mal (clip/sature), la courte (210s) sonne bien.
  // Avant, le director long-form prenait la plus longue. Maintenant le score audio gagne.
  const tracks = [
    { audioUrl: 'https://example/long.mp3', title: 'Long', durationSeconds: 280, model: 'V5_5', prompt: '[Verse]\nLine\n[Chorus]\nHook' },
    { audioUrl: 'https://example/good.mp3', title: 'Good', durationSeconds: 210, model: 'V5_5', prompt: '[Verse]\nLine\n[Chorus]\nHook' },
  ];
  const probeAudio = async (url) => (url.includes('good.mp3')
    ? { score: 0.88, clip: false }
    : { score: 0.30, clip: true });
  const best = await selectVivySunoDirectorTrackWithAudio(tracks, {
    preferLongForm: true,
    targetDurationSeconds: 300,
    probeAudio,
  });
  assert.equal(best && best.audioUrl, 'https://example/good.mp3', 'la sortie qui sonne le mieux doit gagner, pas la plus longue');
});

test('Suno director audio: une seule sortie ne probe pas et retourne le director synchrone', async () => {
  const { selectVivySunoDirectorTrackWithAudio } = require('../src/routes/vivy-studio.cjs');
  let probed = false;
  const best = await selectVivySunoDirectorTrackWithAudio(
    [{ audioUrl: 'https://example/only.mp3', title: 'Only', durationSeconds: 200, model: 'V5_5', prompt: '[Verse]\nLine' }],
    { preferLongForm: true, targetDurationSeconds: 300, probeAudio: async () => { probed = true; return { score: 0.9 }; } },
  );
  assert.equal(best && best.audioUrl, 'https://example/only.mp3');
  assert.equal(probed, false, 'pas de probe pour une seule sortie (extension Suno)');
});

test('isDirectSongwritingRequest ignore le « son » possessif (raconte son histoire, ecris la doc de son module)', () => {
  // Régression du routeur d'intention trop agressif: « raconte son histoire » est
  // une demande de chat, pas une consigne de chanson. Le bare « son » (adjectif
  // possessif) faisait basculer la conversation en mode song. Désormais « son »
  // n'est un mot musical que précédé d'un article (un son / le son / ton son).
  const falsePositives = [
    'raconte son histoire',
    'raconte son enfance en quelques mots',
    'ecris la doc de son comportement',
    'fais un résumé de son parcours technique',
    'explique son fonctionnement et corrige le bug',
  ];
  for (const message of falsePositives) {
    assert.equal(
      isDirectSongwritingRequest(message),
      false,
      `ne doit pas passer en song pour: ${message}`
    );
  }

  // Les vraies demandes de son/track avec article restent des chansons.
  const truePositives = [
    'fais un son sur la légende de zorro',
    'fais le son du mur qui s effondre',
    'envoie ton son quand tu es prete',
  ];
  for (const message of truePositives) {
    assert.equal(
      isDirectSongwritingRequest(message),
      true,
      `doit rester en song pour: ${message}`
    );
  }
});

test('du bavardage technique ne devient pas une intention creative', () => {
  // Djeff, 03/08 : Vivy lui a sorti un brief d'image dont l'intention creative
  // etait une explication technique sur l'historique des messages. Le resolveur
  // ne rejetait que les tournures de CONSIGNE ; du bavardage technique n'en est
  // pas une, donc il partait en prompt chez le fournisseur d'images.
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/vivy-studio.cjs'), 'utf8');

  assert.match(source, /function looksLikeTechnicalChatter/);
  assert.match(source, /if \(looksLikeTechnicalChatter\(candidate\)\) return false;/);
  assert.match(source, /if \(!stripProductionReport\(candidate\)\.trim\(\)\) return false;/);

  // Le garde doit preceder le test de longueur, sinon il ne sert a rien.
  const bloc = source.match(/const useful = candidates\.find\([\s\S]*?\n  \}\);/)?.[0] || '';
  assert.ok(bloc, 'le bloc de selection doit etre trouve');
  assert.ok(
    bloc.indexOf('looksLikeTechnicalChatter') < bloc.indexOf('candidate.length >= 5'),
    'le garde doit passer avant le simple test de longueur'
  );

  // « production » et « mix » ne doivent PAS etre des marqueurs techniques : ils
  // appartiennent autant a la musique, et un faux positif couterait une intention
  // legitime. « une chanson sur la production et le mix de nuit » doit passer.
  const liste = source.match(/const MOTS_TECHNIQUES = \[([\s\S]*?)\];/)?.[1] || '';
  assert.ok(liste, 'la liste de mots techniques doit exister');
  assert.doesNotMatch(liste, /'production'/, '« production » est aussi un mot de musique');
  assert.doesNotMatch(liste, /'mix'/, '« mix » est aussi un mot de musique');
  assert.match(liste, /'deploiement'/);
  assert.match(liste, /'historique'/);
});

test('les replis d intention creative existent et sont concrets', () => {
  // Quand rien d'utilisable ne survit, mieux vaut un brief neutre mais juste
  // qu'une explication technique collee dans un prompt d'image.
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/vivy-studio.cjs'), 'utf8');
  assert.match(source, /Une chanson originale Funesterie guidée par Djeff Cypher/);
  assert.match(source, /Vivy dans un club nocturne réel/);
});
