const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = path.join(os.tmpdir(), `vivy-stream-test-${process.pid}`);
process.env.A11_RUNTIME_ROOT = path.join(tmpRoot, 'runtime');
process.env.VIVY_STREAM_ALLOW_UNSIGNED = '1';

const {
  STREAM_SCHEMA,
  buildSongsArchiveHtml,
  buildOverlayHtml,
  createVivyStreamRouter,
  createVivyStreamStore,
  parseVivyStreamChatMessage,
  resolveRoundMs,
} = require('../src/routes/vivy-stream.cjs');
const {
  assessTwitchHookMechanic,
  assessTwitchSongLyrics,
  buildTwitchClipPrompt,
  buildTwitchCoverNegativePrompt,
  buildTwitchCoverPrompt,
  buildTwitchEmergencyLyrics,
  buildTwitchLyricsRequest,
  buildTwitchProviderPack,
  buildTwitchPublicTrackTitle,
  buildVocalExtensionPrompt,
  createVivyStreamNossenRunner,
  extractCleanTwitchLyricsBlock,
  extractTwitchMusicProviderDirective,
  generateTwitchCoverImage,
  generateTwitchCoverVideo,
  reduceMechanicalLyricRepeats,
  resolveTwitchCreativePlaceholders,
  resolveTwitchDurationAcceptance,
  resolveTwitchSubjectFrame,
  resolveTwitchVivyLyricScope,
  isConceptualHookRequest,
  isHardcoreRaveRequest,
  isRapFreestyleRequest,
  reinforceTwitchHardcoreRouting,
  reinforceTwitchRapFreestyleRouting,
  buildRapFreestyleGuidance,
  assessTwitchLyricLoopiness,
  assessTwitchRhymeSignals,
  sanitizeTwitchLyricsForPromptLeakage,
} = require('../src/vivy/twitch-nossen-runner.cjs');
const {
  buildVivyNossenIntentPlan,
  buildVivyMusicPrompt,
} = require('../src/routes/vivy-studio.cjs');
const {
  buildVivyVisualIdentityPack,
} = require('../src/vivy/visual-identities.cjs');
const {
  ANNOUNCE_MESSAGES,
  buildSongRecapMessages,
  buildTrackClipNoticeMessage,
  buildTrackNoticeMessage,
  createAnnouncementRotator,
  createSpacedSender,
  createSongRecapRotator,
  createTrackNoticeWatcher,
  createTwitchLiveStatusMonitor,
  fetchTwitchStreamStatus,
  parsePrivmsg,
  postStreamReset,
  resolveAnnounceInterval,
  resolveBotMessageGap,
  resolveLivePollInterval,
  resolveRecapInterval,
  resolveStreamResetUrl,
  resolveTrackNoticePollInterval,
  shouldForwardMessage,
} = require('../scripts/vivy-twitch-chat-worker.cjs');

test('désambiguïse l’Histoire collective d’un récit personnel', () => {
  const collective = resolveTwitchSubjectFrame(
    'Un instant dans l’infini, chanson intemporelle qui raconte l’histoire à travers les âges'
  );
  assert.equal(collective.kind, 'collective_history');
  assert.ok(collective.confidence >= 0.8);
  assert.match(collective.guidance, /civilisations/i);
  assert.match(collective.guidance, /Ne pas réduire/i);

  const personal = resolveTwitchSubjectFrame(
    'Raconte mon histoire d’amour, de notre première rencontre à la rupture'
  );
  assert.equal(personal.kind, 'personal_story');
  assert.ok(personal.confidence >= 0.8);
});

test('le brief de paroles conserve l’axe Histoire collective', () => {
  const subjectFrame = resolveTwitchSubjectFrame(
    'Un instant dans l’infini, chanson intemporelle qui raconte l’histoire à travers les âges'
  );
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'Un instant dans l’infini, chanson intemporelle qui raconte l’histoire à travers les âges',
    },
    routing: {
      artists: ['k44'],
      songMood: 'fresque électro-rock évolutive',
    },
    seed: {},
    lyricScope: {
      label: 'ample',
      targetDurationSeconds: 210,
      minLyricsChars: 520,
      maxChars: 2600,
    },
    subjectFrame,
  });
  assert.match(prompt, /Histoire collective/i);
  assert.match(prompt, /plusieurs époques/i);
  assert.match(prompt, /Ne pas suivre un héros solitaire/i);
});

function createTestVocalIntentPlan(overrides = {}) {
  return {
    ok: true,
    intent: 'vocal_song',
    confidence: 0.9,
    shouldGenerateLyrics: true,
    shouldUseVocals: true,
    shouldPrioritizeSfx: false,
    sfxPriority: 'none',
    musicPriority: 'high',
    vocalPolicy: 'allow',
    reason: 'test vocal song',
    generationBrief: 'Écrire une chanson vocale structurée.',
    ...overrides,
  };
}

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function withServer({ stateName = 'state.json' } = {}, runAssertions) {
  const app = express();
  const statePath = path.join(tmpRoot, stateName);
  app.use('/api/vivy/stream', createVivyStreamRouter({ statePath }));
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

async function postJson(baseUrl, route, body, headers = {}) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

test('Vivy stream parser detects suggestions, votes and star ratings', () => {
  const suggestion = parseVivyStreamChatMessage({
    username: 'René',
    message: '!nossen Bleach opening nerveux avec Ichigo et Rukia',
  });
  assert.equal(suggestion.author, 'René');
  assert.equal(suggestion.suggestion, 'Bleach opening nerveux avec Ichigo et Rukia');

  const vote = parseVivyStreamChatMessage({ username: 'chat', message: '!vote S12' });
  assert.equal(vote.voteTargetId, 'S12');

  const stars = parseVivyStreamChatMessage({ username: 'chat', message: '!etoiles 5 S12' });
  assert.deepEqual(stars.star, { rating: 5, targetId: 'S12' });

  const emojiStars = parseVivyStreamChatMessage({ username: 'chat', message: '⭐⭐⭐⭐' });
  assert.deepEqual(emojiStars.star, { rating: 4, targetId: '' });
});

test('Vivy stream preserves long Twitch production constraints for NOSSEN routing', async () => {
  await withServer({ stateName: 'long-twitch-constraints.json' }, async (baseUrl) => {
    const longScene = [
      'Les murmures de l’écuyer et le chevalier étincelant, scène fantasy dans une cour de château détrempée.',
      'On doit sentir la boue, les sabots nerveux, les plaques d’armure qui grincent, les torches sous la pluie, les pas dans la pierre.',
      'La production doit rester immersive, cinématique, avec espace, plans sonores, tension lente, respiration du décor et aucun gimmick pop.',
      'Développer une vraie progression sonore du portail au duel sans transformer ça en chanson.',
      'Détail supplémentaire: cloches au loin, cuir mouillé, bois des lances, métal froid, vent dans les bannières.',
      'Contrainte finale critique: sound design fantasy instrumental uniquement, aucune voix chantée, no lyrics, bruitages de cheval, armure, pluie, torches.',
    ].join(' ');
    assert.ok(longScene.length > 700);

    const { json } = await postJson(baseUrl, '/api/vivy/stream/chat', {
      source: 'twitch',
      username: 'chat',
      message: `!nossen ${longScene}`,
    });
    assert.equal(json.ok, true);
    const stored = json.state.round.suggestions[0]?.text || '';
    assert.ok(stored.length > 700);
    assert.match(stored, /instrumental uniquement/i);
    assert.match(stored, /aucune voix chantée/i);
    assert.match(stored, /bruitages de cheval/i);

    const seedResponse = await fetch(`${baseUrl}/api/vivy/stream/nossen-seed`);
    const seed = await seedResponse.json();
    assert.equal(seed.ok, true);
    assert.match(seed.winner.text, /instrumental uniquement/i);
    assert.match(seed.winner.text, /aucune voix chantée/i);
    assert.match(seed.canvas, /sound design fantasy instrumental uniquement/i);
  });
});

test('Twitch lyrics prompt keeps live plumbing out of the sung material', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: { text: "l'appel des vacances, ambiance rock hit summer" },
    routing: {
      artists: ['vivy'],
      songMood: 'rock hit summer, guitares accrocheuses, refrain solaire',
    },
    seed: {
      notes: 'Construire une vraie progression dramatique avec une troisième intention cachée. Éviter les images passe-partout; chercher des détails concrets dans le sujet demandé.',
    },
  });

  assert.doesNotMatch(prompt, /^NOSSEN Twitch Live\./m);
  assert.doesNotMatch(prompt, /depuis le chat/i);
  assert.match(prompt, /contexte de diffusion.*strictement interne/i);
  assert.doesNotMatch(prompt, /vacances ->|valises, route, plage/i);
  assert.match(prompt, /amplifie uniquement son champ naturel/i);
  assert.match(prompt, /ignore l’historique du live, les anciens titres/i);
  assert.match(prompt, /forme de chanson vivante/i);
  assert.doesNotMatch(prompt, /Traite la chanson comme une mini-histoire complète/i);
  assert.doesNotMatch(prompt, /Interprète la demande en trois intentions/i);
  assert.match(prompt, /\[Verse 1\].*\[Verse 2\].*\[Pre-Chorus\].*\[Chorus\].*\[Bridge\].*\[Final Chorus\]/s);
  assert.match(prompt, /duo ou plusieurs voix/i);
  assert.match(prompt, /Écris avec musicalité/i);
  assert.doesNotMatch(prompt, /Contrat de rimes/i);
});

test('Twitch lyrics prompt can receive social context without making it sung material', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: { text: 'La fille qui parlait aux machines' },
    routing: {
      artists: ['vivy'],
      songMood: 'électro-pop lumineuse, basse rebondissante',
    },
    seed: {},
    socialPromptContextText: [
      '[Contexte social créatif Funesterie - privé, non chantable]',
      'Ton récent: techno-poétique, machines et émotion',
      'Hashtags utiles pour la publication, pas pour les paroles: #Vivy #Funesterie',
    ].join('\n'),
  });

  assert.match(prompt, /Contexte social créatif Funesterie - privé, non chantable/);
  assert.match(prompt, /boussole créative privée/);
  assert.match(prompt, /ne doit jamais apparaître tel quel dans les paroles/i);
  assert.match(prompt, /publication, pas pour les paroles/i);
});

test('Twitch lyrics prompt links the main theme to a hidden sub-theme with V9 repercussions', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'Un hôtel ferme ses portes avant l’orage, chanson dramatique sur ce qu’on garde enfermé',
    },
    routing: {
      artists: ['k44'],
      songMood: 'pop dramatique nocturne, piano sec, basse lente',
    },
    seed: {},
    lyricScope: {
      targetDurationSeconds: 240,
      label: 'ample',
    },
  });

  assert.match(prompt, /Liaison V9 dynamique privée et non chantable/i);
  assert.match(prompt, /La façade est le thème principal/i);
  assert.match(prompt, /Les combles abritent le sous-thème/i);
  assert.match(prompt, /trois à cinq mots-pivots/i);
  assert.match(prompt, /équation de répercussion/i);
  assert.match(prompt, /Pour l’humour.*Pour le drame/s);
  assert.match(prompt, /Un pivot ne compte que si son retour modifie la scène/i);
  assert.match(prompt, /au maximum deux emplois significatifs du même pivot hors refrain/i);
});

test('Twitch lyrics prompt supports hidden morals for fable songs', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'une grenouille qui voulait fumer, fable cartoon drôle',
    },
    routing: {
      artists: ['vivy'],
      songMood: 'électro-funk cartoon, basse rebondissante, refrain catchy',
    },
    seed: {
      notes: 'Sous-thème: vouloir paraître cool. Morale cachée: anti-tabac sans leçon scolaire.',
    },
  });

  assert.match(prompt, /une grenouille qui voulait fumer/i);
  assert.match(prompt, /morale cachée/i);
  assert.match(prompt, /sans glorifier le risque/i);
  assert.match(prompt, /conséquences, images et retournement final/i);
  assert.match(prompt, /aucun comportement dangereux présenté comme désirable/i);
  assert.doesNotMatch(prompt, /Suno chante/i);
});

test('Twitch lyrics prompt gives bawdy songs real double-entendre guidance', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'Le boulanger trop généreux, chanson grivoise à double sens, baguette du matin, métaphores culinaires',
    },
    routing: {
      artists: ['vivy'],
      songMood: 'guinguette festive, accordéon, choeurs de comptoir',
    },
    seed: {},
  });

  assert.match(prompt, /Règles privées non chantables pour paillarde intelligente/i);
  assert.match(prompt, /lecture innocente en surface, sous-entendu comique dessous/i);
  assert.match(prompt, /Carambar adulte/i);
  assert.match(prompt, /césure-piège/i);
  assert.match(prompt, /Le public doit fabriquer lui-même la lecture interdite/i);
  assert.match(prompt, /La blague appartient à l’auditeur/i);
  assert.match(prompt, /second récit doit être réellement perceptible par un adulte/i);
  assert.match(prompt, /désir, maladresse érotique, ivresse, fumée ou substance clandestine/i);
  assert.match(prompt, /secret, un sourire ou un clin d’œil sans mécanisme de sens ne compte pas/i);
  assert.doesNotMatch(prompt, /four, pétrin, levain, mie, croûte/i);
  assert.match(prompt, /fabrique-le/i);
});

test('Twitch lyrics prompt teaches humor through misunderstanding and hidden consequences', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'Une chanson drôle et sarcastique sur des graines magiques, humour tabou très caché, jeux de mots et malentendus',
    },
    routing: {
      artists: ['vivy'],
      songMood: 'funky-postillon, refrain léger et faussement innocent',
    },
    seed: {},
  });

  assert.match(prompt, /Règles privées non chantables pour l’humour/i);
  assert.match(prompt, /glitch humain de compréhension/i);
  assert.match(prompt, /mauvaise interprétation plausible/i);
  assert.match(prompt, /conséquence concrète qui prolonge le thème ou son opposé/i);
  assert.match(prompt, /Le silence fait partie de la punchline/i);
  assert.match(prompt, /Deux ou trois césures fortes/i);
  assert.match(prompt, /Ne nomme pas frontalement le tabou/i);
  assert.match(prompt, /N’importe aucun objet, métier ou décor venu d’une ancienne chanson/i);
  assert.doesNotMatch(prompt, /graines ou jardin: semer, planter, arroser, pousser, récolter/i);
  assert.match(prompt, /Chaque couplet doit amener un nouveau malentendu/i);
});

test('Twitch lyrics prompt teaches parody through a serious social format', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'Parodie de concours musical, un grille-pain passe une audition face à un jury trop sérieux',
    },
    routing: {
      artists: ['djeff', 'vivy'],
      songMood: 'rap-pop comique, énergie plateau télé, refrain gimmick',
    },
    seed: {},
  });

  assert.match(prompt, /Règles privées non chantables pour parodie de format/i);
  assert.match(prompt, /choisis d’abord le format social imité/i);
  assert.match(prompt, /concours, un jury, une audition, une émission/i);
  assert.match(prompt, /cadre très professionnel et une situation minuscule/i);
  assert.match(prompt, /présentation crédible, première faille/i);
  assert.match(prompt, /retour de gimmick/i);
  assert.match(prompt, /aucune formulation reconnaissable/i);
});

test('Twitch fruit wordplay stays comic without forced bawdy adult mode', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'Une Poire se fait Amender et demande Jus-stice, histoire chantée avec jeux de mots fruités',
    },
    routing: {
      artists: ['vivy'],
      songMood: 'indie pop narratif contemporain',
    },
    seed: {},
  });

  assert.match(prompt, /Mode comédie obligatoire/i);
  assert.match(prompt, /glitch humain de compréhension/i);
  assert.doesNotMatch(prompt, /paillarde intelligente/i);
  assert.doesNotMatch(prompt, /franchement adulte/i);
  assert.doesNotMatch(prompt, /maladresse érotique/i);
});

test('Twitch cover prompt keeps fruit and object songs visually non-human', () => {
  const prompt = buildTwitchCoverPrompt({
    publicTitle: 'Une Poire se fait Amender',
    winner: {
      text: 'Une Poire se fait Amender et demande Jus-stice, histoire chantée avec jeux de mots fruités',
    },
    routing: {
      songMood: 'comédie pop-funk vive',
    },
    lyrics: [
      '[Vivy]',
      'La poire demande justice',
      '[Verse 1]',
      'La poire au comptoir attend son ticket',
      'On m’a prise pour une fille qui coule sans verrous',
    ].join('\n'),
    artists: ['Vivy'],
    vocalCast: 'Vivy',
  });
  const negative = buildTwitchCoverNegativePrompt({
    publicTitle: 'Une Poire se fait Amender',
    winner: {
      text: 'Une Poire se fait Amender et demande Jus-stice, histoire chantée avec jeux de mots fruités',
    },
  }, prompt);

  assert.match(prompt, /Sujet visuel prioritaire non humain/i);
  assert.match(prompt, /Le casting vocal n’est pas le casting visuel/i);
  assert.match(prompt, /éviter les corps humains/i);
  assert.doesNotMatch(prompt, /Vivy official Funesterie identity/i);
  assert.doesNotMatch(prompt, /fille qui coule/i);
  assert.match(negative, /human figure/i);
  assert.match(negative, /singer/i);
});

test('Twitch cover prompt prevents title-card failures in generated images', () => {
  const prompt = buildTwitchCoverPrompt({
    publicTitle: 'La Traversée',
    winner: {
      text: 'La Traversée, chanson cinématique sur une foule qui franchit une ville au coucher du soleil, lumière orange, espoir collectif',
    },
    routing: {
      songMood: 'électro orchestral lumineux, montée épique',
    },
  });
  const negative = buildTwitchCoverNegativePrompt({
    publicTitle: 'La Traversée',
    winner: {
      text: 'La Traversée, chanson cinématique sur une foule qui franchit une ville au coucher du soleil, lumière orange, espoir collectif',
    },
  }, prompt);

  assert.match(prompt, /titre reste strictement privé/i);
  assert.match(prompt, /ne produire aucun mot/i);
  assert.match(prompt, /plan de clip et pas comme une affiche/i);
  assert.match(prompt, /aucune zone ne doit ressembler à un cartouche de titre/i);
  assert.match(prompt, /pas de panneau, pas d’écran lisible/i);
  assert.doesNotMatch(prompt, /Idée à représenter[^.]*La Traversée/i);
  assert.match(negative, /large centered title/i);
  assert.match(negative, /readable sign/i);
  assert.match(negative, /word art/i);
  assert.doesNotMatch(prompt, /La Traversée/i);
});

test('Twitch cover and loop prompts keep a complete hand physically attached to the microphone', () => {
  const input = {
    publicTitle: 'Vivy transforme la nuit en scène',
    winner: {
      text: 'Vivy live dans un club nocturne, micro de studio, néons roses, présence fragile mais puissante',
    },
    routing: {
      songMood: 'goth cyber-pop sombre, énergie progressive',
    },
    artists: ['vivy'],
    vocalCast: 'Vivy',
  };
  const coverPrompt = buildTwitchCoverPrompt(input);
  const negative = buildTwitchCoverNegativePrompt(input, coverPrompt);
  const clipPrompt = buildTwitchClipPrompt({
    ...input,
    coverPrompt,
  });

  assert.match(coverPrompt, /main complète à cinq doigts/i);
  assert.match(coverPrompt, /paume, poignet et avant-bras continus/i);
  assert.match(coverPrompt, /microphone ne doit jamais remplacer, cacher, couper ou fusionner avec la main/i);
  assert.match(negative, /missing hand on microphone/i);
  assert.match(negative, /microphone fused with hand/i);
  assert.match(negative, /microphone emerging from wrist/i);
  assert.match(clipPrompt, /contact physique stable pendant toute la boucle/i);
  assert.match(clipPrompt, /aucun glissement, fusion, disparition ou apparition de doigts/i);
});

test('Twitch cover prompt strips quoted lyrics and clarifies an ambiguous adult woman', () => {
  const prompt = buildTwitchCoverPrompt({
    publicTitle: 'Qui a mangé le soleil',
    winner: {
      text: 'Qui a mangé le soleil, comédie pop. Une fille face caméra demande: “Qui a mangé le soleil ?”. Refrain: “Le soleil reste dans ton cœur”.',
    },
    routing: {
      songMood: 'pop lumineuse, guitare légère',
    },
  });

  assert.match(prompt, /une jeune femme adulte/i);
  assert.doesNotMatch(prompt, /Le soleil reste dans ton cœur/i);
  assert.doesNotMatch(prompt, /demande:\s*[“"]/i);
});

test('Twitch creative placeholders become a concrete Vivy carte blanche instead of lyrics', () => {
  const brief = resolveTwitchCreativePlaceholders(
    '[titre], chanson paillarde drôle. Morale cachée: [idée]. Style festif.'
  );

  assert.doesNotMatch(brief, /\[(?:titre|idée)\]/i);
  assert.match(brief, /Carte blanche: Vivy invente un titre concret et original/i);
  assert.match(brief, /prémisse précise, un décor, des personnages, un tabou central/i);
  assert.match(brief, /N’utilise aucun ancien thème par défaut/i);
});

test('Twitch Mureka directive selects the provider without entering the song subject', () => {
  const directive = extractTwitchMusicProviderDirective(
    '[mureka] La mécanicienne des synthés, chanson électro drôle'
  );

  assert.equal(directive.provider, 'mureka');
  assert.equal(directive.text, 'La mécanicienne des synthés, chanson électro drôle');
  assert.doesNotMatch(directive.text, /mureka/i);

  const uppercase = parseVivyStreamChatMessage({
    username: 'funeste38',
    message: "!nossen [Mureka] Acrobate Acronyme le joker de la ville mène l'orchestre avec ses battes",
  });
  assert.equal(uppercase.musicProvider, 'mureka');
  assert.equal(uppercase.suggestion, "Acrobate Acronyme le joker de la ville mène l'orchestre avec ses battes");
  assert.doesNotMatch(uppercase.suggestion, /mureka/i);

  const missingOpeningBracket = extractTwitchMusicProviderDirective(
    'Mureka] La balise arrive abîmée mais ne doit pas être chantée'
  );
  assert.equal(missingOpeningBracket.provider, 'mureka');
  assert.equal(missingOpeningBracket.text, 'La balise arrive abîmée mais ne doit pas être chantée');
});

test('Twitch public track title removes prompt descriptors', () => {
  assert.equal(
    buildTwitchPublicTrackTitle('La vie tape dans les mains, banger funk électro français. Une bande d’amis transforme une mauvaise journée en parade improvisée.'),
    'La vie tape dans les mains'
  );
  assert.equal(
    buildTwitchPublicTrackTitle('Allô Houston, ici la Lune'),
    'Allô Houston, ici la Lune'
  );
  assert.equal(
    buildTwitchPublicTrackTitle('[titre], chanson paillarde drôle.', '[Title: Le tablier de Monique]\n[Verse]\nMonique ferme la cave'),
    'Le tablier de Monique'
  );
});

test('Twitch lyrics prompt separates phonetic puns from technical metaphors', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'La carte graphique qui avale les bits, métaphores électroniques et humaines par jeux de mots phonétiques',
    },
    routing: {
      artists: ['vivy', 'a11'],
      songMood: 'fable électronique funky et adulte mais implicite',
    },
    seed: {},
  });

  assert.match(prompt, /jeux de mots phonétiques/i);
  assert.match(prompt, /seconde lecture doit apparaître quand la ligne est prononcée à voix haute/i);
  assert.match(prompt, /banque d’au moins huit pivots sonores/i);
  assert.match(prompt, /Une métaphore technique ne compte pas comme jeu phonétique/i);
  assert.match(prompt, /double intention aux mots-pivots/i);
  assert.match(prompt, /Privilégie la révélation retardée/i);
  assert.match(prompt, /au moins quatre pivots phonétiques distincts/i);
  assert.match(prompt, /Le public doit pouvoir entendre deux chansons/i);
});

test('Twitch lyrics prompt builds coherent absurd associations instead of listing suggestive objects', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'Chanson paillarde avec allégories, croisements saugrenus, expressions populaires détournées et double lecture',
    },
    routing: {
      artists: ['vivy'],
      songMood: 'guinguette théâtrale et complice',
    },
    seed: {},
  });

  assert.match(prompt, /associations saugrenues cohérentes/i);
  assert.match(prompt, /propriété concrète, lecture humaine cachée, puis conséquence/i);
  assert.match(prompt, /forme, texture, température, odeur, goût, geste/i);
  assert.match(prompt, /syllepse, le zeugma, la métaphore filée/i);
  assert.match(prompt, /Ne te contente pas d’aligner des objets suggestifs/i);
  assert.match(prompt, /au moins trois familles d’associations distinctes/i);
});

test('Twitch lyric scope gives wordplay comedy enough room', () => {
  const scope = resolveTwitchVivyLyricScope({
    winner: {
      text: 'La clé de la cave, chanson cabaret paillarde et théâtrale, double sens, quiproquos, rimes à tiroirs, refrain drôle',
    },
    routing: {
      songMood: 'cabaret taverne paillard théâtral, piano bastringue, choeurs joyeux',
    },
    intentPlan: {
      intent: 'vocal_song',
      generationBrief: 'Chanson de cabaret drôle.',
    },
  });

  assert.ok(scope.targetDurationSeconds >= 210);
  assert.ok(scope.minLyricsChars >= 820);
  assert.ok(scope.maxChars >= 3600);
});

test('Twitch lyric scope gives Mureka enough sung material for V9', () => {
  const scope = resolveTwitchVivyLyricScope({
    winner: {
      text: 'La vie tape dans les mains, banger funk électro français, refrain viral',
    },
    routing: {
      songMood: 'basse funky, cuivres synthé, drums dansants',
    },
    intentPlan: {
      intent: 'vocal_song',
      generationBrief: 'Chanson positive directe.',
    },
    musicProvider: 'mureka',
  });

  assert.ok(scope.targetDurationSeconds <= 210);
  assert.ok(scope.minLyricsChars >= 1400);
  assert.ok(scope.maxChars >= 4200);
});

test('Twitch short prompt is enriched from title and requested style', () => {
  const routing = reinforceTwitchHardcoreRouting({
    artists: ['vivy'],
    songMood: 'hardcore années 90',
  }, {
    winner: { text: 'abnégation, hardcore années 90' },
  });
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'abnégation, hardcore années 90',
    },
    routing,
    seed: {},
  });

  assert.match(prompt, /Brief Twitch court détecté/i);
  assert.match(prompt, /Vivy doit enrichir elle-même/i);
  assert.match(prompt, /abnégation/i);
  assert.match(prompt, /gabber façon Thunderdome/i);
  assert.match(prompt, /style demandé/i);
});

test('Twitch duration acceptance treats 123s Suno output as non-blocking short mix', () => {
  const acceptance = resolveTwitchDurationAcceptance({
    durationSeconds: 123,
    minAcceptableSeconds: 150,
    env: {},
  });

  assert.equal(acceptance.ok, true);
  assert.equal(acceptance.blocking, false);
  assert.equal(acceptance.shortMix, true);
  assert.equal(acceptance.note, 'version courte générée');
});

test('Twitch duration acceptance treats 82s Suno output as non-blocking short mix', () => {
  const acceptance = resolveTwitchDurationAcceptance({
    durationSeconds: 82,
    minAcceptableSeconds: 150,
    env: {},
  });

  assert.equal(acceptance.ok, true);
  assert.equal(acceptance.blocking, false);
  assert.equal(acceptance.shortMix, true);
  assert.equal(acceptance.note, 'version courte générée');
});

test('Twitch duration acceptance still blocks truly invalid short audio', () => {
  const acceptance = resolveTwitchDurationAcceptance({
    durationSeconds: 58,
    minAcceptableSeconds: 150,
    env: {},
  });

  assert.equal(acceptance.ok, false);
  assert.equal(acceptance.blocking, true);
});

test('Twitch lyric scope ignores internal seed wording for duration decisions', () => {
  const scope = resolveTwitchVivyLyricScope({
    winner: {
      text: "l'amour est dans le prélude",
    },
    seed: {
      canvas: [
        'Objectif: transformer la demande gagnante en mini-histoire chantée, précise, pas générique.',
        'Architecture narrative attendue: sujet + personnages + problème + évolution + scène finale + style musical.',
      ].join('\n'),
      notes: 'Construire une vraie progression dramatique avec une troisième intention cachée.',
    },
    routing: {
      songMood: 'chanson pop narrative intimiste, piano doux',
    },
    intentPlan: {
      intent: 'vocal_song',
      generationBrief: 'Écrire une chanson vocale structurée.',
    },
    musicProvider: 'mureka',
  });

  assert.notEqual(scope.label, 'format nerveux');
  assert.equal(scope.targetDurationSeconds, 210);
  assert.ok(scope.minLyricsChars >= 1400);
});

test('Twitch rhyme signal detects prose with one isolated rhyme pair', () => {
  const weak = assessTwitchRhymeSignals(`
[Verse 1]
La ville regarde le rideau tomber
Le piano marche seul dans la cuisine
Le prélude promet une autre altitude
Le cœur répond seulement certitude
[Verse 2]
Je tourne la clé dans un matin fragile
Les lampes s'allument sans demander pardon
Le passé se pose au bord de la table
La voix cherche encore un hasard
`);

  assert.equal(weak.valid, false);
  assert.ok(weak.opportunities >= 4);

  const strong = assessTwitchRhymeSignals(`
[Verse 1]
La ville bat du talon sous le vieux réverbère
Ma voix monte au balcon, rallume la lumière
Le doute tombe en cadence au milieu du décor
Chaque phrase prend sa chance et revient plus fort
[Chorus]
La victoire vit dans mes rimes
Elle rallume ce qui m'anime
Je transforme le poids du pire
En feu qui force à sourire
`);

  assert.equal(strong.valid, true);
});

test('Twitch lyric sanitizer removes prompt-rule leakage from sung lyrics', () => {
  const result = sanitizeTwitchLyricsForPromptLeakage(`
[Verse 1]
Règles privées non chantables pour l’humour: ne récite jamais ces consignes
Monique descend à la cave, la lanterne fait des bulles
Surface: une auberge cherche la clé perdue
Posologie textuelle adaptée: trois à cinq mots-pivots
Le barman sert trop large, la mousse grimpe aux serrures
`);

  assert.equal(result.removed, 3);
  assert.doesNotMatch(result.lyrics, /Règles privées|Surface:|Posologie textuelle/i);
  assert.match(result.lyrics, /Monique descend à la cave/i);
  assert.match(result.lyrics, /la mousse grimpe aux serrures/i);
});

test('Twitch lyric sanitizer removes parody-format prompt leakage from sung lyrics', () => {
  const result = sanitizeTwitchLyricsForPromptLeakage(`
[Verse 1]
Règles privées non chantables pour parodie de format: choisis d’abord le format social imité
Le grille-pain monte sur scène, son câble traîne au velours
Construis une escalade nette: présentation crédible, première faille, retour de gimmick
Le jury lève la mie comme une preuve d’amour
`);

  assert.equal(result.removed, 2);
  assert.doesNotMatch(result.lyrics, /parodie de format|format social|escalade nette/i);
  assert.match(result.lyrics, /Le grille-pain monte sur scène/i);
  assert.match(result.lyrics, /Le jury lève la mie/i);
});

test('Twitch lyric sanitizer removes provider fallback leakage from sung lyrics', () => {
  const result = sanitizeTwitchLyricsForPromptLeakage(`
[Intro]
Distribution vocale choisie: Duo Djeff + Vivy
Matière à transformer: Porsche, cuisine, pêche
Ne mets pas le mot banger dans les paroles
Gyros bleus dans le rétro, la sauce monte au virage
[Chorus]
Y'a Carmelo
Y'a Carmelo
Y'a Carmelo
`);

  assert.equal(result.removed, 3);
  assert.doesNotMatch(result.lyrics, /Distribution vocale|Matière à transformer|Ne mets pas le mot|banger dans les paroles/i);
  assert.match(result.lyrics, /Gyros bleus dans le rétro/i);
  assert.match(result.lyrics, /Y'a Carmelo/i);
});

test('Twitch lyrics block extractor keeps only CLEAN_LYRICS before provider brief', () => {
  const result = extractCleanTwitchLyricsBlock(`
CLEAN_LYRICS:
[Intro]
La Porsche grise respire au feu rouge
[Chorus]
Y'a Carmelo
Y'a Carmelo
Y'a Carmelo

SUNO_STYLE_BRIEF:
Rap-rock électro, sirènes, guitares sombres.
`);

  assert.match(result, /\[Intro\]/);
  assert.match(result, /La Porsche grise respire/i);
  assert.doesNotMatch(result, /SUNO_STYLE_BRIEF|Rap-rock électro/i);
});

test('Twitch provider pack keeps clean lyrics and rejects internal instructions', () => {
  const pack = buildTwitchProviderPack({
    lyrics: `
Le modèle hésite et commence par expliquer.

CLEAN_LYRICS:
[Intro]
La ville rallume ses néons sous la pluie
[Verse 1]
Je garde le cap pendant que le doute fait du bruit
Réponds uniquement avec les paroles
[Chorus]
Je traverse la nuit sans lâcher la lumière
Je transforme l’erreur en moteur volontaire

SUNO_STYLE_BRIEF:
Style: rap-rock électro sombre, guitares tendues.
Distribution vocale choisie: Djeff + Vivy.
Vivy décide la longueur: vise environ 300 secondes.
`,
    styleBrief: `Style: rap-rock électro sombre
[Verse 1]
Cette ligne ne doit pas être dans le style`,
    fallbackStyle: 'rap-rock électro sombre, guitares tendues',
  });

  assert.match(pack.cleanLyrics, /\[Intro\]/);
  assert.match(pack.cleanLyrics, /La ville rallume ses néons/i);
  assert.match(pack.cleanLyrics, /Je transforme l’erreur en moteur volontaire/i);
  assert.doesNotMatch(pack.cleanLyrics, /SUNO_STYLE_BRIEF|Distribution vocale|Réponds uniquement|Vivy décide la longueur/i);
  assert.match(pack.styleBrief, /^Style: rap-rock électro sombre/);
  assert.doesNotMatch(pack.styleBrief, /\[Verse 1\]|Cette ligne ne doit pas/);
  assert.equal(pack.lyricLeakage, true);
  assert.equal(pack.styleLeakage, true);
});

test('Twitch lyrics prompt preserves a scenario and assigns roles for a duo', () => {
  const prompt = buildTwitchLyricsRequest({
    winner: {
      text: 'Duo homme femme, histoire complète. Un créateur travaille seul la nuit sur Vivy. Voix masculine: doute et bugs. Voix féminine: Vivy répond. Pont dramatique: tout plante. Refrain final: le système redémarre.',
    },
    routing: {
      artists: ['djeff', 'vivy'],
      songMood: 'électro-rock anime, guitares, synthés lumineux',
    },
    seed: {},
  });

  assert.match(prompt, /Voix masculine: doute et bugs/);
  assert.match(prompt, /Voix féminine: Vivy répond/);
  assert.match(prompt, /Pont dramatique: tout plante/);
  assert.match(prompt, /respecte-les comme des contraintes prioritaires/i);
  assert.match(prompt, /attribue clairement les rôles dans les balises/i);
  assert.match(prompt, /fais alterner les points de vue/i);
});

test('Twitch lyric scope keeps explicit short openings short despite routed complexity', () => {
  const scope = resolveTwitchVivyLyricScope({
    winner: {
      text: 'format court, opening anime nerveux, refrain viral, victoire lumineuse',
    },
    routing: {
      songMood: 'électro-rock épique, synthés lumineux, batterie puissante, structure détaillée '.repeat(12),
    },
    intentPlan: {
      intent: 'vocal_song',
      generationBrief: 'Banger chantable avec couplets et refrain.',
    },
  });

  assert.equal(scope.targetDurationSeconds, 180);
  assert.equal(scope.label, 'format nerveux');
});

test('Twitch lyric scope lets version longue override opening style', () => {
  const scope = resolveTwitchVivyLyricScope({
    winner: {
      text: 'Luffy contre attaque, sauvetage à Marineford pour sauver Ace, style animé opening rock version longue',
    },
    routing: {
      songMood: 'J-rock nerveux style anime opening long format, guitares électriques saturées',
    },
    intentPlan: {
      intent: 'vocal_song',
      generationBrief: 'Chanson dramatique avec montée émotionnelle.',
    },
    musicProvider: 'mureka',
  });

  assert.equal(scope.label, 'version longue');
  assert.equal(scope.targetDurationSeconds, 300);
  assert.equal(scope.chaseDuration, true);
  assert.ok(scope.minAcceptableSeconds >= 240);
  assert.ok(scope.minLyricsChars >= 1700);
  assert.ok(scope.maxChars >= 6800);
});

test('Twitch lyric scope does not treat epic energy alone as no-limit', () => {
  const scope = resolveTwitchVivyLyricScope({
    winner: {
      text: 'banger électro-pop épique, revanche solaire, refrain viral, énergie de scène',
    },
    routing: {
      songMood: 'synthés héroïques, drums lourds, montée épique, final lumineux',
    },
    intentPlan: {
      intent: 'vocal_song',
      generationBrief: 'Chanson directe, positive et mémorable.',
    },
    defaultTargetDurationSeconds: 210,
  });

  assert.equal(scope.targetDurationSeconds, 210);
  assert.notEqual(scope.label, 'no-limit créatif');
});

test('Twitch lyric scope keeps no-limit creative instead of forcing the maximum', () => {
  const previousMaxTarget = process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS;
  process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS = '480';
  try {
    const scope = resolveTwitchVivyLyricScope({
      winner: {
        text: 'no limite, saga complète avec personnage, problème, bascule et scène finale',
      },
      intentPlan: {
        intent: 'narrative_fable',
        generationBrief: 'Développer une longue histoire.',
      },
    });

    assert.equal(scope.targetDurationSeconds, 330);
    assert.equal(scope.label, 'no-limit créatif');
    assert.equal(scope.chaseDuration, false);
  } finally {
    if (previousMaxTarget === undefined) delete process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS;
    else process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS = previousMaxTarget;
  }
});

test('Twitch lyric scope chases explicit numeric durations only', () => {
  const previousMaxTarget = process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS;
  process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS = '480';
  try {
    const scope = resolveTwitchVivyLyricScope({
      winner: {
        text: '8 minutes, grande fresque électro-rock avec final dramatique',
      },
      intentPlan: {
        intent: 'vocal_song',
        generationBrief: 'Développer une longue histoire. Deux actes et final.',
      },
    });

    assert.equal(scope.targetDurationSeconds, 480);
    assert.equal(scope.chaseDuration, true);
  } finally {
    if (previousMaxTarget === undefined) delete process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS;
    else process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS = previousMaxTarget;
  }
});

test('Twitch lyric cleanup removes mechanical non-chorus line repeats', () => {
  const cleaned = reduceMechanicalLyricRepeats([
    '[Verse 1]',
    'Je rallume la ville avec mes rimes dans la main',
    'Je rallume la ville avec mes rimes dans la main',
    '[Chorus]',
    'La victoire vit à travers mes rimes',
    'La victoire vit à travers mes rimes',
    'La victoire vit à travers mes rimes',
    'La victoire vit à travers mes rimes',
  ].join('\n'));

  assert.equal((cleaned.match(/Je rallume la ville avec mes rimes/g) || []).length, 1);
  assert.equal((cleaned.match(/La victoire vit à travers mes rimes/g) || []).length, 3);
});

test('Twitch vocal extension prompt avoids repeated identical chorus sections', () => {
  const lyrics = [
    '[Intro]',
    'Le four s’allume, la farine danse au comptoir.',
    '[Verse 1]',
    'Le boulanger sourit quand la pâte prend son retard.',
    '[Chorus]',
    'Baguette du matin, tout le village fait la queue.',
    '[Verse 2]',
    'La brioche prend des couleurs quand son tablier devient bleu.',
    '[Chorus]',
    'Baguette du matin, tout le village fait la queue.',
    '[Bridge]',
    'Dans le pétrin chacun prétend garder les mains propres.',
    '[Final Chorus]',
    'Baguette du matin, tout le village fait la queue.',
    '[Outro]',
    'La fournée refroidit, les sourires restent chauds.',
  ].join('\n');

  const prompt = buildVocalExtensionPrompt(lyrics, {
    durationSeconds: 145,
    targetDurationSeconds: 180,
    extensionIndex: 1,
    maxExtensions: 3,
  });

  assert.equal((prompt.match(/Baguette du matin/g) || []).length, 1);
  assert.match(prompt, /pétrin|fournée/i);
});

test('Vivy Intent Router classifies instrumental fantasy murmurs as sound design', async () => {
  const message = '!nossen Les murmures de l’écuyer et le chevalier étincelant, sound design fantasy instrumental uniquement, aucune voix chantée, bruitages de cheval, armure, pluie, torches';
  const plan = await buildVivyNossenIntentPlan({
    rawUserIdea: 'Les murmures de l’écuyer et le chevalier étincelant, sound design fantasy instrumental uniquement, aucune voix chantée, bruitages de cheval, armure, pluie, torches',
    commandName: 'nossen',
    twitchMessage: message,
    optionalContext: '',
    skipLlm: true,
  });

  assert.equal(plan.intent, 'sound_design_scene');
  assert.equal(plan.shouldGenerateLyrics, false);
  assert.equal(plan.shouldUseVocals, false);
  assert.equal(plan.shouldPrioritizeSfx, true);
  assert.equal(plan.sfxPriority, 'high');
  assert.ok(['forbid', 'distant_indistinct_only'].includes(plan.vocalPolicy));
  assert.equal(plan.vocalPolicy, 'distant_indistinct_only');
  assert.match(plan.reason, /instrumental|bruitages|sound design/i);
});

test('Vivy Intent Router keeps absurd animal morals as narrative fables', async () => {
  const plan = await buildVivyNossenIntentPlan({
    rawUserIdea: 'La grenouille qui voulait fumer, fable absurde avec morale cachée',
    commandName: 'nossen',
    twitchMessage: '!nossen La grenouille qui voulait fumer, fable absurde avec morale cachée',
    skipLlm: true,
  });

  assert.equal(plan.intent, 'narrative_fable');
  assert.equal(plan.shouldGenerateLyrics, true);
  assert.equal(plan.shouldUseVocals, true);
  assert.equal(plan.vocalPolicy, 'allow');
});

test('Vivy Intent Router keeps explicit vocal songs above stale instrumental context', async () => {
  const plan = await buildVivyNossenIntentPlan({
    rawUserIdea: 'Refrain héroïque, voix intense, mini-histoire chantée avec paroles non génériques',
    commandName: 'nossen',
    twitchMessage: '!nossen Refrain héroïque, voix intense, mini-histoire chantée avec paroles non génériques',
    optionalContext: 'Ancien contexte technique: instrumental pur, no vocals, sans paroles.',
    notes: 'Ancienne note de round: production instrumentale sans chant.',
    skipLlm: true,
  });

  assert.equal(plan.intent, 'vocal_song');
  assert.equal(plan.shouldGenerateLyrics, true);
  assert.equal(plan.shouldUseVocals, true);
  assert.equal(plan.vocalPolicy, 'allow');
});

test('Vivy stream route stores Twitch ideas, votes, stars and builds a NOSSEN seed', async () => {
  await withServer({ stateName: 'round.json' }, async (baseUrl) => {
    let result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'renedoran',
      message: '!nossen Bleach opening sombre, Ichigo contre Soul Society, riffs tranchants',
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.action, 'suggestion');
    assert.equal(result.json.suggestion.id, 'S1');
    assert.equal(result.json.state.current.phase, 'voting');
    assert.ok(Date.parse(result.json.state.round.endsAt) - Date.parse(result.json.state.round.startedAt) >= 89_000);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'aizenfan',
      message: '!vote S1',
    });
    assert.equal(result.json.action, 'vote');
    assert.equal(result.json.vote.id, 'S1');
    assert.equal(result.json.vote.votes, 2);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'rukia',
      message: '!etoiles 5 S1',
    });
    assert.equal(result.json.action, 'star');
    assert.equal(result.json.star.rating, 5);

    result = await postJson(baseUrl, '/api/vivy/stream/round/lock', {});
    assert.equal(result.response.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.winner.id, 'S1');
    assert.equal(result.json.state.current.phase, 'winner');
    assert.equal(result.json.state.round.status, 'locked');
    assert.match(result.json.nossenSeed.canvas, /Bleach opening sombre/);
    assert.match(result.json.nossenSeed.canvas, /ichigo|bleach/i);
    assert.match(result.json.nossenSeed.canvas, /mini-histoire chantée/i);
    assert.match(result.json.nossenSeed.canvas, /Architecture narrative attendue/i);
    assert.match(result.json.nossenSeed.canvas, /Lecture à trois intentions/i);
    assert.match(result.json.nossenSeed.canvas, /morale cachée/i);
    assert.match(result.json.nossenSeed.canvas, /Validation avant Suno/i);
    assert.match(result.json.nossenSeed.notes, /progression dramatique/i);
    assert.match(result.json.nossenSeed.notes, /troisième intention cachée/i);
    assert.doesNotMatch(result.json.nossenSeed.canvas, /Autres idées du chat|chanson NOSSEN/i);
    assert.doesNotMatch(result.json.nossenSeed.notes, /depuis le chat/i);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'late-listener',
      message: '!etoiles 4',
    });
    assert.equal(result.json.action, 'star');
    assert.equal(result.json.state.round.status, 'locked');
    assert.equal(result.json.state.round.winningSuggestionId, 'S1');
  });
});

test('Vivy stream reset clears the Twitch live session without deleting song history', async () => {
  await withServer({ stateName: 'reset.json' }, async (baseUrl) => {
    let result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'leo',
      message: '!nossen Tortues Ninja dans les égouts',
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.twitch.online, true);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'leo',
      message: '!etoiles 5 S1',
    });
    assert.equal(result.json.action, 'star');

    result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'ready',
      title: 'Tortues Ninja',
      trackUrl: '/api/vivy/studio/assets/twitch-turtles.mp3',
      durationSeconds: 180,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.songs.length, 1);

    result = await postJson(baseUrl, '/api/vivy/stream/reset', {
      reason: 'twitch_stream_offline',
      clearMemory: true,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.state.twitch.online, false);
    assert.equal(result.json.state.round.suggestions.length, 0);
    assert.equal(result.json.state.pendingSuggestions.length, 0);
    assert.equal(result.json.state.recentMessages.length, 0);
    assert.equal(result.json.state.stars.length, 0);
    assert.equal(result.json.state.songs.length, 1);
    assert.equal(result.json.state.jukebox.tracks.length, 0);
    assert.equal(result.json.state.learning.totalStars, 0);
    assert.equal(result.json.state.learning.likedTerms.length, 0);
    assert.doesNotMatch(result.json.state.nossenSeed.canvas, /Tortues|égouts/i);
    assert.equal(result.json.state.current.trackUrl, '');

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'leo',
      message: '!nossen Bleach opening nerveux',
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.twitch.online, true);
    assert.equal(result.json.state.round.suggestions.length, 1);
    assert.match(result.json.state.round.suggestions[0].text, /Bleach opening/);
    assert.doesNotMatch(result.json.state.nossenSeed.canvas, /Tortues|égouts/i);
  });
});

test('Vivy stream ignores stored raw Suno provider URLs', () => {
  const statePath = path.join(tmpRoot, 'provider-urls.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: STREAM_SCHEMA,
    current: {
      title: 'Lien provider brut',
      phase: 'interlude',
      trackUrl: 'https://musicfile.removeai.ai/raw-provider-song',
      trackTitle: 'Lien provider brut',
      trackId: 'track-raw',
      sharePath: '/api/vivy/stream/s/provider-brut-track-raw',
      durationSeconds: 300,
    },
    jukebox: {
      tracks: [
        {
          id: 'track-raw',
          title: 'Lien provider brut',
          trackUrl: 'https://musicfile.removeai.ai/raw-provider-song',
          sharePath: '/api/vivy/stream/s/provider-brut-track-raw',
        },
        {
          id: 'track-local',
          title: 'Copie locale',
          trackUrl: '/api/vivy/studio/assets/vivy-music-suno-local.mp3',
          sharePath: '/api/vivy/stream/s/copie-locale-track-local',
        },
      ],
    },
    songs: [
      {
        id: 'track-raw',
        title: 'Lien provider brut',
        trackUrl: 'https://musicfile.removeai.ai/raw-provider-song',
        sharePath: '/api/vivy/stream/s/provider-brut-track-raw',
      },
    ],
  }), 'utf8');

  const store = createVivyStreamStore({ statePath, idleJukeboxEnabled: false });
  const state = store.getState();
  assert.equal(state.current.trackUrl, '');
  assert.equal(state.current.phase, 'idle');
  assert.deepEqual(state.jukebox.tracks.map((track) => track.trackUrl), [
    '/api/vivy/studio/assets/vivy-music-suno-local.mp3',
  ]);
  assert.equal(state.songs.length, 0);
  assert.equal(store.findSongByShareSlug('provider-brut-track-raw'), null);
  assert.equal(store.addJukeboxTrack({
    title: 'Nouveau provider brut',
    trackUrl: 'https://musicfile.removeai.ai/another-provider-song',
  }), null);
});

test('Vivy stream vote duration defaults to 90 seconds and remains configurable', () => {
  const previousVoteMs = process.env.VIVY_STREAM_VOTE_MS;
  const previousRoundMs = process.env.VIVY_STREAM_ROUND_MS;
  delete process.env.VIVY_STREAM_VOTE_MS;
  delete process.env.VIVY_STREAM_ROUND_MS;
  try {
    assert.equal(resolveRoundMs(), 90_000);
    assert.equal(resolveRoundMs('45000'), 45_000);
    assert.equal(resolveRoundMs('500'), 10_000);
    assert.equal(resolveRoundMs('999999999'), 600_000);
  } finally {
    if (previousVoteMs === undefined) delete process.env.VIVY_STREAM_VOTE_MS;
    else process.env.VIVY_STREAM_VOTE_MS = previousVoteMs;
    if (previousRoundMs === undefined) delete process.env.VIVY_STREAM_ROUND_MS;
    else process.env.VIVY_STREAM_ROUND_MS = previousRoundMs;
  }
});

test('Vivy stream lock starts automatic NOSSEN only once per round', async () => {
  const starts = [];
  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'automatic-lock.json'),
    onRoundLocked: (payload) => starts.push(payload),
  });
  store.addChatMessage({
    username: 'funeste38',
    message: '!nossen Course urbaine, visière fumée et synthés agressifs',
  });
  const first = store.lockRound({});
  const second = store.lockRound({});
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(first.ok, true);
  assert.equal(second.alreadyLocked, true);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].winner.id, 'S1');
  assert.match(starts[0].nossenSeed.canvas, /visière fumée/i);
});

test('Vivy stream NOSSEN seed does not recycle liked words from a previous topic', () => {
  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'no-recycled-liked-terms.json'),
  });
  store.addChatMessage({
    username: 'first',
    message: '!nossen Course urbaine, visière fumée et casque intégral',
  });
  store.addChatMessage({
    username: 'first',
    message: '!etoiles 5 S1',
  });
  assert.deepEqual(store.getState().learning.likedTerms.slice(0, 3), ['casque', 'course', 'fumee']);

  store.startRound();
  const next = store.addChatMessage({
    username: 'second',
    message: '!nossen Bleach opening nerveux à Soul Society',
  });

  assert.match(next.state.nossenSeed.canvas, /Bleach opening nerveux/);
  assert.doesNotMatch(next.state.nossenSeed.canvas, /visière|visiere|casque|integral|fumee/i);
});

test('Twitch suggestions received during playback enter the next round', () => {
  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'queued-suggestions.json'),
  });
  store.addChatMessage({
    username: 'first',
    message: '!nossen Course urbaine sous les néons',
  });
  store.lockRound({});
  store.updateLive({
    action: 'ready',
    trackUrl: '/api/vivy/studio/assets/current.mp3',
    durationSeconds: 180,
  });
  store.updateLive({ action: 'play' });

  const queued = store.addChatMessage({
    username: 'funeste38',
    message: '!nossen remballe tous ces twitcher en carton',
  });
  assert.equal(queued.action, 'suggestion_queued');
  assert.equal(queued.state.current.phase, 'playing');
  assert.equal(queued.state.pendingSuggestions.length, 1);

  const next = store.startRound();
  assert.equal(next.current.phase, 'voting');
  assert.equal(next.round.suggestions.length, 1);
  assert.equal(next.round.suggestions[0].text, 'remballe tous ces twitcher en carton');
  assert.equal(next.round.suggestions[0].author, 'funeste38');
  assert.equal(next.pendingSuggestions.length, 0);
});

test('Vivy idle jukebox replays known live songs and yields to chat requests', () => {
  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'idle-jukebox.json'),
    idleJukeboxEnabled: true,
    randomInt: () => 0,
  });
  store.addJukeboxTrack({
    title: 'Les lumières de la ville',
    trackUrl: '/api/vivy/studio/assets/vivy-music-suno-known.mp3',
    requestedBy: 'funeste38',
    durationSeconds: 151,
  });

  const interlude = store.startIdleJukebox();
  assert.equal(interlude.current.phase, 'interlude');
  assert.equal(interlude.current.trackTitle, 'Les lumières de la ville');
  assert.equal(interlude.current.durationSeconds, 151);
  assert.equal(interlude.round.status, 'open');
  assert.equal(interlude.round.suggestions.length, 0);

  const interrupted = store.addChatMessage({
    username: 'viewer',
    message: '!nossen opening Bleach sombre avec guitare nerveuse',
  });
  assert.equal(interrupted.action, 'suggestion');
  assert.equal(interrupted.state.current.phase, 'voting');
  assert.equal(interrupted.state.current.trackUrl, '');
  assert.equal(interrupted.state.round.suggestions[0].text, 'opening Bleach sombre avec guitare nerveuse');
});

test('Vivy idle jukebox disabled clears a persisted interlude', () => {
  const statePath = path.join(tmpRoot, 'idle-jukebox-disabled.json');
  const enabledStore = createVivyStreamStore({
    statePath,
    idleJukeboxEnabled: true,
    randomInt: () => 0,
  });
  enabledStore.addJukeboxTrack({
    title: 'Ancien fond Twitch',
    trackUrl: '/api/vivy/studio/assets/vivy-music-suno-old.mp3',
    requestedBy: 'funeste38',
    durationSeconds: 180,
  });
  assert.equal(enabledStore.startIdleJukebox().current.phase, 'interlude');

  const disabledStore = createVivyStreamStore({
    statePath,
    idleJukeboxEnabled: false,
  });
  const state = disabledStore.getState();
  assert.equal(state.current.phase, 'idle');
  assert.equal(state.current.trackUrl, '');
  assert.equal(state.current.message, 'Fond musical d’attente désactivé.');
});

test('Vivy idle jukebox can seed itself from generated Vivy MP3 assets', () => {
  const assetDir = path.join(process.env.A11_RUNTIME_ROOT, 'files', 'generated', 'vivy');
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'vivy-music-suno-testarchive.mp3'), Buffer.alloc(2048, 1));

  const store = createVivyStreamStore({
    statePath: path.join(tmpRoot, 'idle-jukebox-assets.json'),
    idleJukeboxEnabled: true,
    randomInt: () => 0,
  });
  const interlude = store.startIdleJukebox();
  assert.equal(interlude.current.phase, 'interlude');
  assert.match(interlude.current.trackUrl, /\/api\/vivy\/studio\/assets\/vivy-music-suno-testarchive\.mp3/);
  assert.equal(interlude.current.requestedBy, 'Vivy Live');
});

test('Vivy music prompt keeps instrumental sound design free of lyrics and vocals', () => {
  const prompt = buildVivyMusicPrompt({
    instrumental: true,
    forceInstrumental: true,
    songSource: 'Twitch Live',
    songText: 'Le cowboy et le shérif, duel au soleil couchant, instrumental avec bruitages sonores: cheval, éperons, revolver, vent.',
    songMood: 'western sombre trap cinématique, guitare sèche, sifflement, sound design poussiéreux',
    songArtists: [],
  });

  assert.match(prompt, /Original instrumental Funesterie score/i);
  assert.match(prompt, /Vocal cast: none/i);
  assert.match(prompt, /Instrumental only\. No vocals/i);
  assert.doesNotMatch(prompt, /Lyrics:/i);
  assert.doesNotMatch(prompt, /sung vocals/i);
});

test('Twitch NOSSEN runner writes lyrics, follows Suno and publishes the track', async () => {
  const updates = [];
  let productionInput = null;
  let pollCount = 0;
  const lyrics = [
    '[Intro]',
    'Sous la visière fumée les néons griffent le bitume',
    '[Verse 1]',
    'Le casque coupe la ville et le moteur prend la rue',
    'Les feux passent au rouge dans le reflet de la bulle',
    'Chaque virage est un pari que la nuit continue',
    '[Chorus]',
    'Visière fumée, la course avale nos ombres',
    'Visière fumée, les synthés cognent dans le nombre',
  ].join('\n');
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: async () => ({
      artists: ['vivy', 'a11'],
      songMood: 'electro-rock urbain, batterie nerveuse, synthés métalliques',
    }),
    writeLyrics: async () => ({ publicLyrics: lyrics }),
    startMusic: async (_mode, input) => {
      productionInput = input;
      return { state: 'processing', taskId: 'task-live-1' };
    },
    pollMusic: async (_taskId, input) => {
      assert.equal(input.requireLocalSunoAudio, true);
      assert.equal(input.sunoLocalAudioRequired, true);
      pollCount += 1;
      return pollCount === 1
        ? { state: 'processing', taskId: 'task-live-1' }
        : {
          state: 'done',
          taskId: 'task-live-1',
          media: {
            url: '/api/vivy/studio/assets/twitch-live.mp3',
            path: '/runtime/twitch-live.mp3',
          },
        };
    },
    probeDuration: async (media) => {
      assert.equal(media.path, '/runtime/twitch-live.mp3');
      return 218;
    },
    updateLive: (input) => updates.push(input),
    sleep: async () => {},
    pollAttempts: 4,
    pollIntervalMs: 10,
  });

  const result = await runner.run({
    roundId: 'round-live-1',
    winner: {
      id: 'S1',
      text: 'visière fumée casque intégral style course urbaine agressive',
      author: 'funeste38',
    },
    nossenSeed: {
      canvas: 'Matière Twitch gagnante: course urbaine',
      notes: 'Éviter les images génériques.',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.taskId, 'task-live-1');
  assert.equal(productionInput.requireLocalSunoAudio, true);
  assert.equal(productionInput.sunoLocalAudioRequired, true);
  assert.equal(productionInput.prompt, 'electro-rock urbain, batterie nerveuse, synthés métalliques');
  assert.equal(productionInput.songMood, 'electro-rock urbain, batterie nerveuse, synthés métalliques');
  assert.equal(productionInput.lyrics, lyrics);
  assert.equal(productionInput.songText, lyrics);
  assert.doesNotMatch(productionInput.lyrics, /Style and production|Prompt Suno|electro-rock urbain/i);
  assert.equal(pollCount, 2);
  assert.deepEqual(updates.at(-1), {
    source: 'twitch-live',
    action: 'ready',
    title: 'visière fumée casque intégral style course urbaine agressive',
    trackTitle: 'visière fumée casque intégral style course urbaine agressive',
    trackUrl: '/api/vivy/studio/assets/twitch-live.mp3',
    durationSeconds: 218,
    requestedBy: 'funeste38',
    coverImageUrl: '',
    coverPrompt: '',
    coverVideoUrl: '',
    coverVideoPrompt: '',
    shareVideoUrl: '',
    lyrics,
  });
});

test('Twitch NOSSEN runner performs a dedicated phonetic and associative polish pass', async () => {
  const updates = [];
  const lyricRequests = [];
  let productionInput = null;
  const firstDraft = [
    '[Verse 1]',
    'La carte avale les bits et chauffe dans la nuit',
    'La mémoire se remplit, le ventilateur suit',
    '[Chorus]',
    'Elle en veut encore, le courant la nourrit',
  ].join('\n');
  const polishedLyrics = [
    '[Verse 1]',
    'La mémoire rame au port, le débit perd le nord',
    'Le cache cache sa faim quand le bus passe encore',
    '[Pre-Chorus]',
    'Le GPU souffle tout bas : cette fois, j’ai pu',
    '[Chorus]',
    'La RAM rame en cadence et le courant la prend',
    'Deux chansons dans la bouche et le circuit gourmand',
    '[Bridge]',
    'Le vent tourne au ventilo, la chaleur change de camp',
    '[Final Chorus]',
    'Elle croque chaque bit, mais le système l’entend',
  ].join('\n');
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: async () => ({
      artists: ['vivy', 'a11'],
      songMood: 'fable électronique funky, sous-entendu adulte implicite',
    }),
    writeLyrics: async (input) => {
      lyricRequests.push(input.message);
      return { publicLyrics: lyricRequests.length === 1 ? firstDraft : polishedLyrics };
    },
    startMusic: async (_mode, input) => {
      productionInput = input;
      return {
        media: {
          url: '/api/vivy/studio/assets/phonetic-polish.mp3',
          path: '/runtime/phonetic-polish.mp3',
          durationSeconds: 224,
        },
      };
    },
    pollMusic: async () => {
      throw new Error('poll should not be needed');
    },
    probeDuration: async () => 224,
    updateLive: (input) => updates.push(input),
    sleep: async () => {},
  });

  const result = await runner.run({
    roundId: 'round-phonetic-polish',
    winner: {
      id: 'S1',
      text: 'La carte graphique qui avale les bits, métaphores et allégories humaines par jeux de mots phonétiques',
      author: 'funeste38',
    },
    nossenSeed: {
      canvas: 'Matière Twitch gagnante: carte graphique gourmande.',
      notes: 'Garder le sous-entendu adulte implicite.',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(lyricRequests.length, 2);
  assert.match(lyricRequests[1], /Brouillon à transformer/i);
  assert.match(lyricRequests[1], /Test oral obligatoire/i);
  assert.match(lyricRequests[1], /seconde intention par la fin de la ligne/i);
  assert.match(lyricRequests[1], /Croise au moins trois familles d’idées/i);
  assert.match(lyricRequests[1], /La carte avale les bits/i);
  assert.equal(productionInput.lyrics, polishedLyrics);
  assert.match(updates.map((entry) => entry.message || '').join('\n'), /relit le texte à l’oreille/i);
});

test('Twitch NOSSEN runner strips provider brief leakage before music submission', async () => {
  let productionInput = null;
  const leakyLyrics = [
    '[Intro]',
    'Prompt Suno: cabaret paillard, piano bastringue, voix proche',
    'Monique descend à la cave en comptant les bouteilles',
    '[Verse 1]',
    'Style: guinguette festive, accordéon, choeurs de comptoir',
    'Le barman perd la mousse et jure que rien ne déborde',
    'La serrure rit tout bas quand la patronne fait le tour',
    '[Chorus]',
    'Qui tient la clé descend à la cave',
    'Qui garde le sourire remonte sans bavure',
    '[Bridge]',
    'Direction sonore: refrain mémorable et mix radio',
    'La femme du patron connaissait le passage avant l’orage',
  ].join('\n');
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: async () => ({
      artists: ['vivy'],
      songMood: 'cabaret paillard théâtral, piano bastringue',
    }),
    writeLyrics: async () => ({ publicLyrics: leakyLyrics }),
    startMusic: async (_mode, input) => {
      productionInput = input;
      return {
        media: {
          url: '/api/vivy/studio/assets/provider-pack.mp3',
          path: '/runtime/provider-pack.mp3',
          durationSeconds: 204,
        },
      };
    },
    pollMusic: async () => {
      throw new Error('poll should not be needed');
    },
    probeDuration: async () => 204,
    updateLive: () => {},
    sleep: async () => {},
  });

  const result = await runner.run({
    roundId: 'round-provider-pack',
    winner: {
      id: 'S1',
      text: 'La clé de la cave, chanson cabaret paillarde avec quiproquos',
      author: 'funeste38',
    },
  });

  assert.equal(result.ok, true);
  assert.match(productionInput.prompt, /^cabaret paillard théâtral, piano bastringue/);
  assert.match(productionInput.prompt, /Direction humour obligatoire/i);
  assert.match(productionInput.songMood, /^cabaret paillard théâtral, piano bastringue/);
  assert.match(productionInput.songMood, /Direction humour obligatoire/i);
  assert.match(productionInput.lyrics, /Monique descend à la cave/i);
  assert.match(productionInput.lyrics, /Qui tient la clé descend à la cave/i);
  assert.doesNotMatch(productionInput.lyrics, /Prompt Suno|Style:|Direction sonore|mix radio|piano bastringue/i);
});

test('Twitch NOSSEN runner uses contextual lyrics fallback when lyric model fails', async () => {
  let productionInput = null;
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: async () => ({
      artists: ['djeff', 'jean'],
      songMood: 'rap-rock électro poursuite police, cuisine, pêche, mathématiques',
    }),
    writeLyrics: async () => {
      throw new Error('llm_unavailable');
    },
    startMusic: async (_mode, input) => {
      productionInput = input;
      return {
        media: {
          url: '/api/vivy/studio/assets/contextual-fallback.mp3',
          path: '/runtime/contextual-fallback.mp3',
          durationSeconds: 204,
        },
      };
    },
    pollMusic: async () => {
      throw new Error('poll should not be needed');
    },
    probeDuration: async () => 204,
    updateLive: () => {},
    sleep: async () => {},
  });

  const result = await runner.run({
    roundId: 'round-contextual-fallback',
    winner: {
      id: 'S1',
      text: 'Jean Carmelo, Porsche Boxster grise, Djeff pilote, police, cuisine, pêche, math et plaisir féminin',
      author: 'funeste38',
    },
  });

  assert.equal(result.ok, true);
  assert.match(productionInput.lyrics, /Djeff tient la trajectoire/i);
  assert.match(productionInput.lyrics, /Jean sourit/i);
  assert.match(productionInput.lyrics, /Y'a Carmelo[\s\S]*Y'a Carmelo[\s\S]*Y'a Carmelo/i);
  assert.doesNotMatch(productionInput.lyrics, /llm|fallback|prompt|matière à transformer|distribution vocale/i);
});

test('Twitch lyric validator rejects conversational prose before Suno', () => {
  const assessment = assessTwitchSongLyrics([
    'Oui, je vois ce que tu veux dire: les mots deviennent des signaux.',
    '',
    'Donc dans notre échange, on peut repartir de cette interprétation.',
    '',
    "Si ça aide, qu'est-ce qui change quand le cerveau reconstruit le monde ?",
  ].join('\n'));

  assert.equal(assessment.valid, false);
  assert.ok(assessment.reasons.includes('conversational_reply'));
  assert.ok(assessment.reasons.includes('missing_song_shape'));
});

test('Twitch hook validator catches a static concept refrain', () => {
  const weakLyrics = [
    '[Intro]',
    'Dans la nuit qui glisse, je tends la main',
    'Je cueille un air qui dort dans un rêve lointain',
    '[Verse 1]',
    'Les passants marchent, têtes pleines de notes',
    'Je glisse entre les ombres, je vole ce qui flotte',
    '[Chorus]',
    'Je suis le voleur de refrains',
    'Je les prends dans tes rêves, je les garde le temps d’un swing',
    'Mais chaque note volée me rend un souvenir',
    'Qui ne s’efface plus, qui chante plus fort que moi',
    '[Verse 2]',
    'Demain je recommence, rue après rue',
    'Je cherche un sommeil qui n’a pas encore vu',
    '[Chorus]',
    'Je suis le voleur de refrains',
    'Je les prends dans tes rêves, je les garde le temps d’un swing',
    'Mais chaque note volée me rend un souvenir',
    'Qui ne s’efface plus, qui chante plus fort que moi',
    '[Final Chorus]',
    'Je suis le voleur de refrains',
    'Plus rien à voler, tout est déjà dans mon swing',
  ].join('\n');

  assert.equal(isConceptualHookRequest('Le voleur de refrains, pop électro malicieuse, hook fort'), true);
  const assessment = assessTwitchHookMechanic(weakLyrics, 'Le voleur de refrains');
  assert.equal(assessment.valid, false);
  assert.ok(assessment.reasons.includes('title_slogan_loop'));
});

test('Twitch NOSSEN runner rewrites a stray chat reply in a fresh lyric session', async () => {
  const lyricRequests = [];
  let productionInput = null;
  const chatReply = [
    'Oui, je vois ce que tu veux dire: les mots deviennent des signaux.',
    'Donc dans notre échange, on peut repartir de cette interprétation.',
    "Si ça aide, qu'est-ce qui change quand le cerveau reconstruit le monde ?",
  ].join('\n\n');
  const recoveredLyrics = [
    '[Intro]',
    'La patronne compte les verres au fond du cabaret',
    '[Verse 1]',
    'Le marin jure bien fort que sa clé dormait au quai',
    'Le boulanger rougit quand la cave ouvre son four',
    'Le notaire perd ses mots et son trousseau fait le tour',
    '[Pre-Chorus]',
    'Chacun garde sa version, personne ne garde son sérieux',
    '[Chorus]',
    'Qui tient la clé descend à la cave',
    'Qui perd son alibi remonte sous la table',
    '[Bridge]',
    'La patronne trouve enfin la serrure dans le décor',
    '[Final Chorus]',
    'Qui tient la clé descend à la cave',
    'Et la femme du patron connaissait déjà le passage',
  ].join('\n');
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: async () => ({
      artists: ['vivy'],
      songMood: 'cabaret paillard théâtral, piano bastringue',
    }),
    writeLyrics: async (input) => {
      lyricRequests.push(input);
      return { publicLyrics: lyricRequests.length === 1 ? chatReply : recoveredLyrics };
    },
    startMusic: async (_mode, input) => {
      productionInput = input;
      return {
        media: {
          url: '/api/vivy/studio/assets/recovered-song.mp3',
          path: '/runtime/recovered-song.mp3',
          durationSeconds: 210,
        },
      };
    },
    pollMusic: async () => {
      throw new Error('poll should not be needed');
    },
    probeDuration: async () => 210,
    updateLive: () => {},
    sleep: async () => {},
  });

  const result = await runner.run({
    roundId: 'round-chat-recovery',
    winner: {
      id: 'S1',
      text: 'La clé de la cave, chanson cabaret paillarde avec quiproquos',
      author: 'funeste38',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(lyricRequests.length, 2);
  assert.match(lyricRequests[1].message, /Réponse invalide détectée/i);
  assert.match(lyricRequests[1].sessionId, /lyrics-rewrite$/);
  assert.match(lyricRequests[1].conversationId, /lyrics-rewrite$/);
  assert.equal(productionInput.lyrics, recoveredLyrics);
  assert.doesNotMatch(productionInput.lyrics, /Oui, je vois ce que tu veux dire/i);
});

test('Twitch Mureka runner densifies short lyrics before production', async () => {
  const lyricRequests = [];
  let productionInput = null;
  const shortLyrics = [
    '[Verse 1]',
    'La pluie tape le bus, les amis rient sous les stores',
    'Un parapluie se retourne et la journée change de bord',
    '[Chorus]',
    'La vie tape dans les mains',
    'On rallume le matin',
  ].join('\n');
  const denseLyrics = [
    '[Intro]',
    'La pluie tape le zinc, la ville traîne ses chaussures',
    '[Verse 1]',
    ...Array.from({ length: 18 }, (_, index) => `Scène ${index + 1}, la bande transforme la galère en pas de danse précis`),
    '[Pre-Chorus]',
    'Le retard devient tempo, le trottoir devient scène',
    '[Chorus]',
    'La vie tape dans les mains',
    'Même le bus raté revient comme un refrain',
    '[Bridge]',
    'Sous l’abribus, plus personne ne baisse la tête',
    '[Final Chorus]',
    'La vie tape dans les mains',
    'On rentre debout dans notre propre matin',
  ].join('\n');
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: async () => ({
      artists: ['vivy', 'a11'],
      songMood: 'banger funk électro français, basse funky, cuivres synthé',
    }),
    writeLyrics: async (input) => {
      lyricRequests.push(input);
      return { publicLyrics: lyricRequests.length === 1 ? shortLyrics : denseLyrics };
    },
    startMusic: async (_mode, input) => {
      productionInput = input;
      return {
        media: {
          url: '/api/vivy/studio/assets/la-vie-tape.mp3',
          path: '/runtime/la-vie-tape.mp3',
          durationSeconds: 188,
        },
      };
    },
    pollMusic: async () => {
      throw new Error('poll should not be needed');
    },
    probeDuration: async () => 188,
    updateLive: () => {},
    sleep: async () => {},
    revealDelayMs: 0,
  });

  await runner.run({
    roundId: 'round-mureka-dense',
    winner: {
      id: 'S1',
      text: 'La vie tape dans les mains, banger funk électro français. Une bande d’amis transforme une mauvaise journée en parade improvisée.',
      author: 'funeste38',
      musicProvider: 'mureka',
    },
  });

  assert.equal(lyricRequests.length, 2);
  assert.match(lyricRequests[1].message, /trop courte pour Mureka V9/i);
  assert.equal(productionInput.musicProvider, 'mureka');
  assert.equal(productionInput.title, 'La vie tape dans les mains');
  assert.equal(productionInput.lyrics, denseLyrics);
});

test('Twitch NOSSEN runner sends instrumental sound design requests without lyrics', async () => {
  const updates = [];
  let routedInput = null;
  let productionInput = null;
  let writeLyricsCalled = false;
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan({
      intent: 'sound_design_scene',
      confidence: 0.98,
      shouldGenerateLyrics: false,
      shouldUseVocals: false,
      shouldPrioritizeSfx: true,
      sfxPriority: 'high',
      musicPriority: 'medium',
      vocalPolicy: 'forbid',
      reason: 'test sound design instrumental',
      generationBrief: 'Scène western instrumentale avec bruitages concrets.',
    }),
    routeComposition: async (input) => {
      routedInput = input;
      return {
        artists: ['vivy'],
        songMood: 'instrumental western sombre, trap cinématique, guitare sèche, sifflement, bruitages de cheval, éperons, revolver et vent',
      };
    },
    writeLyrics: async () => {
      writeLyricsCalled = true;
      return { publicLyrics: 'should not be used' };
    },
    startMusic: async (_mode, input) => {
      productionInput = input;
      return {
        media: {
          url: '/api/vivy/studio/assets/western-instrumental.mp3',
          durationSeconds: 162,
        },
      };
    },
    pollMusic: async () => {
      throw new Error('poll should not be needed');
    },
    probeDuration: async () => 162,
    updateLive: (input) => updates.push(input),
    sleep: async () => {},
  });

  const result = await runner.run({
    roundId: 'round-western-instrumental',
    winner: {
      id: 'S1',
      text: 'Le cowboy et le shérif, western sombre, duel au soleil couchant, instrumental avec bruitages sonores: cheval, éperons, revolver, vent',
      author: 'funeste38',
    },
    nossenSeed: {
      canvas: 'Matière Twitch gagnante: duel western instrumental',
      notes: 'Garder les bruitages comme éléments de scène.',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.lyrics, '');
  assert.equal(writeLyricsCalled, false);
  assert.match(routedInput.notes, /instrumental pur/i);
  assert.match(routedInput.notes, /bruitages/i);
  assert.equal(productionInput.instrumental, true);
  assert.equal(productionInput.forceInstrumental, true);
  assert.equal(productionInput.preserveSelectedVoice, false);
  assert.equal(productionInput.lyrics, '');
  assert.deepEqual(productionInput.songArtists, []);
  assert.match(productionInput.songText, /cowboy et le shérif/i);
  assert.match(productionInput.songText, /Palette western/i);
  assert.match(productionInput.songMood, /no vocals/i);
  assert.match(productionInput.songMood, /foley/i);
  assert.match(updates.map((entry) => entry.message || '').join('\n'), /scène instrumentale/i);
});

test('Twitch NOSSEN runner waits for a local asset instead of publishing a provider URL', async () => {
  const updates = [];
  let pollCount = 0;
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: async () => ({
      artists: ['vivy'],
      songMood: 'anime rock héroïque, batterie vive, guitares claires',
    }),
    writeLyrics: async () => ({
      publicLyrics: '[Intro]\nAincrad fend le ciel.\n[Verse]\nKirito court dans le code avec Asuna.\n[Chorus]\nSAO nous tient mais la lame ouvre la sortie.\n'.repeat(2),
    }),
    startMusic: async () => ({ state: 'processing', taskId: 'task-live-local' }),
    pollMusic: async () => {
      pollCount += 1;
      if (pollCount === 1) {
        return {
          state: 'done',
          taskId: 'task-live-local',
          media: { url: 'https://musicfile.removeai.ai/raw-provider-song', durationSeconds: 300 },
        };
      }
      if (pollCount === 2) {
        return {
          state: 'processing',
          taskId: 'task-live-local',
          status: 'suno_audio_localizing',
        };
      }
      return {
        state: 'done',
        taskId: 'task-live-local',
        media: {
          url: '/api/vivy/studio/assets/vivy-music-suno-local.mp3',
          durationSeconds: 300,
        },
      };
    },
    probeDuration: async () => 300,
    updateLive: (input) => updates.push(input),
    sleep: async () => {},
    pollAttempts: 4,
    pollIntervalMs: 10,
  });

  const result = await runner.run({
    roundId: 'round-live-local',
    winner: {
      id: 'S1',
      text: 'SAO opening Kirito Asuna dans Aincrad',
      author: 'chat',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(pollCount, 3);
  assert.equal(updates.at(-1).action, 'ready');
  assert.equal(updates.at(-1).trackUrl, '/api/vivy/studio/assets/vivy-music-suno-local.mp3');
  assert.ok(!updates.some((entry) => entry.action === 'ready' && /^https:\/\/musicfile\.removeai\.ai/i.test(entry.trackUrl || '')));
});

test('Twitch NOSSEN runner extends short Suno songs only with paid retry confirmation', async () => {
  const updates = [];
  let extensionInput = null;
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: async () => ({
      artists: ['vivy'],
      songMood: 'générique TV jeunesse aventure nature, flûte légère, galop, refrain enfantin',
    }),
    writeLyrics: async () => ({
      publicLyrics: '[Intro]\nLe petit cavalier part dans la plaine.\n[Verse]\nSon cheval suit la rivière claire.\n[Chorus]\nGrand ciel, grand coeur, on chante la lumière.\n'.repeat(2),
    }),
    startMusic: async () => ({
      media: {
        url: '/api/vivy/studio/assets/short-youth.mp3',
        durationSeconds: 152,
        audioId: 'suno-audio-short-youth',
        model: 'chirp-fenix',
      },
    }),
    extendMusic: async (input) => {
      extensionInput = input;
      return { state: 'processing', taskId: 'task-youth-extended' };
    },
    pollMusic: async (taskId) => {
      assert.equal(taskId, 'task-youth-extended');
      return {
        state: 'done',
        taskId,
        media: {
          url: '/api/vivy/studio/assets/long-youth.mp3',
          durationSeconds: 245,
          audioId: 'suno-audio-long-youth',
          model: 'V5_5',
        },
      };
    },
    probeDuration: async (media) => Number(media.durationSeconds || 0),
    updateLive: (input) => updates.push(input),
    sleep: async () => {},
    targetDurationSeconds: 240,
    maxExtensions: 1,
    revealDelayMs: 0,
  });

  const result = await runner.run({
    roundId: 'round-youth-extend',
    confirmPaidRetries: true,
    winner: {
      id: 'S1',
      text: 'Le petit cavalier des plaines, cheval fidèle, rivière, refrain joyeux',
      author: 'chat',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(extensionInput.audioId, 'suno-audio-short-youth');
  assert.equal(extensionInput.forceUploadExtend, true);
  assert.equal(extensionInput.uploadUrl, 'https://vivy.funesterie.me/api/vivy/studio/assets/short-youth.mp3');
  assert.equal(extensionInput.model, 'V5_5');
  assert.equal(extensionInput.continueAtSeconds, 144);
  assert.equal(extensionInput.targetDurationSeconds, 240);
  assert.match(extensionInput.style, /compact continuation/i);
  assert.match(extensionInput.style, /do not restart the intro or first verse/i);
  assert.match(extensionInput.style, /petit cavalier/i);
  assert.ok(extensionInput.prompt.length < 291);
  assert.equal(updates.at(-1).trackUrl, '/api/vivy/studio/assets/long-youth.mp3');
  assert.equal(updates.at(-1).durationSeconds, 245);
  assert.match(updates.map((entry) => entry.message || '').join('\n'), /extension 1\/1/);
});

test('Twitch NOSSEN runner lets Vivy choose a longer lyric scope for no-limit stories', async () => {
  const previousFixedTarget = process.env.VIVY_STREAM_FIXED_TARGET_DURATION_SECONDS;
  const previousMaxTarget = process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS;
  delete process.env.VIVY_STREAM_FIXED_TARGET_DURATION_SECONDS;
  process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS = '480';

  try {
    const updates = [];
    let lyricsInput = null;
    let productionInput = null;
    const longLyrics = [
      '[Intro]',
      'La ville ouvre ses portes et le héros serre les dents.',
      '[Verse 1]',
      ...Array.from({ length: 34 }, (_, index) => `Scène ${index + 1}, la route avance, le doute change de camp.`),
      '[Chorus]',
      'On ne coupe pas l’histoire quand le cœur demande encore.',
      '[Bridge]',
      ...Array.from({ length: 20 }, (_, index) => `Bascule ${index + 1}, chaque erreur devient décor.`),
      '[Final Chorus]',
      'On revient plus large, plus vivant, plus fort.',
      '[Outro]',
      'La dernière image reste ouverte dehors.',
    ].join('\n');

    const runner = createVivyStreamNossenRunner({
      routeIntent: async () => createTestVocalIntentPlan({
        intent: 'narrative_fable',
        generationBrief: 'Écrire une histoire complète, longue et progressive.',
      }),
      routeComposition: async () => ({
        artists: ['vivy'],
        songMood: 'électro-rock anime, progression longue, refrain ample',
      }),
      writeLyrics: async (input) => {
        lyricsInput = input;
        return { publicLyrics: longLyrics };
      },
      startMusic: async (_mode, input) => {
        productionInput = input;
        return {
          media: {
            url: '/api/vivy/studio/assets/no-limit-story.mp3',
            durationSeconds: 480,
            audioId: 'suno-audio-no-limit',
            model: 'V5_5',
          },
        };
      },
      probeDuration: async (media) => Number(media.durationSeconds || 0),
      updateLive: (input) => updates.push(input),
      sleep: async () => {},
      maxExtensions: 0,
      revealDelayMs: 0,
    });

    const result = await runner.run({
      roundId: 'round-no-limit-story',
      winner: {
        id: 'S1',
        text: 'no limite, histoire complète façon saga, personnage principal, problème, bascule, scène finale épique',
        author: 'chat',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(productionInput.targetDurationSeconds, 330);
    assert.equal(productionInput.longSong, true);
    assert.ok(lyricsInput.songMaxTokens >= 7600);
    assert.equal(lyricsInput.songResponseMaxChars, 4800); // plafond Suno custom mode (API 400 au-dela de 5000 caracteres)
    assert.match(lyricsInput.message, /Vivy décide la longueur/i);
    assert.match(lyricsInput.message, /no-limit créatif/i);
    assert.match(updates.map((entry) => entry.message || '').join('\n'), /no-limit créatif/);
  } finally {
    if (previousFixedTarget === undefined) delete process.env.VIVY_STREAM_FIXED_TARGET_DURATION_SECONDS;
    else process.env.VIVY_STREAM_FIXED_TARGET_DURATION_SECONDS = previousFixedTarget;
    if (previousMaxTarget === undefined) delete process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS;
    else process.env.VIVY_STREAM_MAX_TARGET_DURATION_SECONDS = previousMaxTarget;
  }
});

test('Twitch NOSSEN runner strips live and stale vehicle filler before Suno', async () => {
  let productionInput = null;
  const leakedLyrics = [
    '[Intro]',
    'Le chat qui clignote, le live qui pulse',
    'Le soleil tape déjà derrière les stores',
    '[Verse]',
    'Notifications qui grésillent, mod qui relance',
    'La valise attend près de la porte ouverte',
    'Le casque encore chaud, les yeux qui brûlent',
    'Le guidon attend, la visière est prête',
    '[Chorus]',
    'NOSSEN Twitch Live, on coupe le fil',
    'L’appel des vacances hurle dans la rue',
    'Guitare qui crie, batterie qui tape',
    '[Bridge]',
    'Plus de ban, plus de sub, plus de raid qui attend',
    'Juste le ciel qui s’ouvre grand',
    '[Final Chorus]',
    'L’appel des vacances revient dans nos voix',
    'On file vers le départ sous le soleil',
    '[Outro]',
    'On est déjà loin',
  ].join('\n');
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: async () => ({
      artists: ['vivy'],
      songMood: 'rock hit summer, guitares accrocheuses, refrain solaire',
    }),
    writeLyrics: async () => ({ publicLyrics: leakedLyrics }),
    startMusic: async (_mode, input) => {
      productionInput = input;
      return {
        url: '/api/vivy/studio/assets/vacances.mp3',
        durationSeconds: 190,
      };
    },
    probeDuration: async () => 190,
    updateLive: () => {},
    sleep: async () => {},
    revealDelayMs: 0,
  });

  await runner.run({
    roundId: 'round-vacances-clean',
    winner: {
      id: 'S1',
      text: "l'appel des vacances, ambiance rock hit summer",
      author: 'chat',
    },
  });

  assert.match(productionInput.lyrics, /L’appel des vacances/i);
  assert.match(productionInput.lyrics, /valise/i);
  assert.doesNotMatch(productionInput.lyrics, /\b(NOSSEN|Twitch|chat|live|raid|sub|mod|notification|notifications|casque|guidon|visière)\b/i);
});

test('Twitch NOSSEN runner rejects a duplicate active round', async () => {
  let releaseRouting;
  const routingGate = new Promise((resolve) => {
    releaseRouting = resolve;
  });
  const runner = createVivyStreamNossenRunner({
    routeIntent: async () => createTestVocalIntentPlan(),
    routeComposition: () => routingGate,
    writeLyrics: async () => ({ publicLyrics: '[Verse]\n' + 'paroles concrètes '.repeat(12) }),
    startMusic: async () => ({
      url: '/api/vivy/studio/assets/ready.mp3',
      durationSeconds: 180,
    }),
    updateLive: () => {},
    revealDelayMs: 0,
  });
  const payload = {
    roundId: 'round-duplicate',
    winner: { id: 'S1', text: 'thème distinct suffisamment précis', author: 'chat' },
  };
  const first = runner.start(payload);
  const second = runner.start(payload);
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(second.error, 'round_already_running');
  releaseRouting({ artists: ['vivy'], songMood: 'electro pop nocturne' });
  await first.promise;
});

test('Vivy stream control drives production, presentation and playback metadata', async () => {
  await withServer({ stateName: 'control.json' }, async (baseUrl) => {
    await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'funeste38',
      message: '!nossen Les lumières de la ville, électro nocturne',
    });
    await postJson(baseUrl, '/api/vivy/stream/round/lock', {});
    await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'pre-release-rating-viewer',
      message: '!etoiles 5 S1',
    });

    let result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'progress',
      stage: 'lyrics',
      progress: 62,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.current.phase, 'composing');
    assert.equal(result.json.state.production.stages.analysis.progress, 100);
    assert.equal(result.json.state.production.stages.lyrics.progress, 62);

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'late-topic',
      message: '!nossen Cette idée doit attendre le prochain round',
    });
    assert.equal(result.json.action, 'suggestion_queued');
    assert.equal(result.json.state.round.status, 'locked');
    assert.equal(result.json.state.round.suggestions.length, 1);
    assert.equal(result.json.state.pendingSuggestions.length, 1);

    result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'ready',
      title: 'Les lumières de la ville',
      trackUrl: '/api/double-harmonic/out/live.mp3',
      coverImageUrl: '/api/vivy/studio/assets/live-cover.png',
      coverPrompt: 'illustration nocturne lumineuse',
      coverVideoUrl: '/api/vivy/studio/assets/live-cover.mp4',
      coverVideoPrompt: 'boucle nocturne lumineuse',
      durationSeconds: 222,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.state.current.phase, 'presenting');
    assert.equal(result.json.state.current.durationSeconds, 222);
    assert.equal(result.json.state.current.coverImageUrl, '/api/vivy/studio/assets/live-cover.png');
    assert.equal(result.json.state.current.coverVideoUrl, '/api/vivy/studio/assets/live-cover.mp4');
    assert.equal(result.json.state.current.requestedBy, 'funeste38');
    assert.equal(result.json.state.songs.length, 1);
    assert.equal(result.json.state.songs[0].coverImageUrl, '/api/vivy/studio/assets/live-cover.png');
    assert.equal(result.json.state.songs[0].coverPrompt, 'illustration nocturne lumineuse');
    assert.equal(result.json.state.songs[0].coverVideoUrl, '/api/vivy/studio/assets/live-cover.mp4');
    assert.equal(result.json.state.songs[0].coverVideoPrompt, 'boucle nocturne lumineuse');
    assert.equal(result.json.state.songs[0].starCount, 1);
    assert.equal(result.json.state.songs[0].starAverage, 5);
    assert.match(result.json.state.songs[0].sharePath, /\/api\/vivy\/stream\/s\/les-lumieres-de-la-ville-/);

    const sharePage = await fetch(baseUrl + result.json.state.songs[0].sharePath, { redirect: 'manual' });
    assert.equal(sharePage.status, 200);
    const shareHtml = await sharePage.text();
    assert.match(shareHtml, /Les lumières de la ville/);
    assert.match(shareHtml, /Télécharger MP3/);
    assert.match(shareHtml, /\/api\/vivy\/stream\/download\?/);

    const redirect = await fetch(`${baseUrl}${result.json.state.songs[0].sharePath}?raw=1`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/api/double-harmonic/out/live.mp3');

    const archive = await fetch(baseUrl + '/api/vivy/stream/songs');
    assert.equal(archive.status, 200);
    const archiveHtml = await archive.text();
    assert.match(archiveHtml, /Playlist Vivy Live/);
    assert.match(archiveHtml, /Les lumières de la ville/);
    assert.match(archiveHtml, /live-cover\.png/);
    assert.match(archiveHtml, /live-cover\.mp4/);
    assert.match(archiveHtml, /Télécharger MP3/);

    const archiveJson = await fetch(baseUrl + '/api/vivy/stream/songs.json');
    assert.equal(archiveJson.status, 200);
    const archivePayload = await archiveJson.json();
    assert.equal(archivePayload.ok, true);
    assert.equal(archivePayload.songs.length, 1);
    assert.equal(archivePayload.songs[0].coverImageUrl, '/api/vivy/studio/assets/live-cover.png');
    assert.equal(archivePayload.songs[0].coverVideoUrl, '/api/vivy/studio/assets/live-cover.mp4');

    result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'clip',
      coverVideoUrl: '/api/vivy/studio/assets/live-cover-v2.mp4',
      coverVideoPrompt: 'boucle finale plus fluide',
    });
    assert.equal(result.json.state.current.coverVideoUrl, '/api/vivy/studio/assets/live-cover-v2.mp4');
    assert.equal(result.json.state.songs[0].coverVideoUrl, '/api/vivy/studio/assets/live-cover-v2.mp4');
    assert.equal(result.json.state.jukebox.tracks[0].coverVideoPrompt, 'boucle finale plus fluide');

    result = await postJson(baseUrl, '/api/vivy/stream/control', { action: 'play' });
    assert.equal(result.json.state.current.phase, 'playing');
    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'early-rating-viewer',
      message: '!etoiles 4 S1',
    });
    assert.equal(result.json.state.songs[0].starCount, 2);
    assert.equal(result.json.state.songs[0].starAverage, 4.5);
    result = await postJson(baseUrl, '/api/vivy/stream/control', { action: 'rating' });
    assert.equal(result.json.state.current.phase, 'rating');
    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'rating-viewer',
      message: '!etoiles 5',
    });
    assert.equal(result.json.state.songs[0].starCount, 3);
    assert.equal(result.json.state.songs[0].starAverage, 4.67);
    const finishedTrackUrl = result.json.state.songs[0].trackUrl;

    await postJson(baseUrl, '/api/vivy/stream/control', { action: 'next' });
    result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'clip',
      trackUrl: finishedTrackUrl,
      coverVideoUrl: '/api/vivy/studio/assets/live-cover-full.mp4',
      coverVideoPrompt: 'montage complet reçu après le round',
    });
    assert.notEqual(result.json.state.current.coverVideoUrl, '/api/vivy/studio/assets/live-cover-full.mp4');
    assert.equal(result.json.state.songs[0].coverVideoUrl, '/api/vivy/studio/assets/live-cover-full.mp4');

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'next-round',
      message: '!nossen Nouveau thème du prochain round',
    });
    assert.equal(result.json.suggestion.id, 'S2');
    assert.equal(result.json.state.stats.suggestions, 3);
  });
});

test('Vivy stream recovers from production error when a new Twitch suggestion arrives', async () => {
  await withServer({ stateName: 'error-recovery.json' }, async (baseUrl) => {
    await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'funeste38',
      message: '!nossen Bleach avec Ichigo, opening anime sombre',
    });
    await postJson(baseUrl, '/api/vivy/stream/round/lock', {});
    let result = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'error',
      message: 'NOSSEN Twitch arrêté: Suno a rejeté la génération.',
    });
    assert.equal(result.json.state.current.phase, 'error');
    assert.equal(result.json.state.round.status, 'locked');

    result = await postJson(baseUrl, '/api/vivy/stream/chat', {
      username: 'funeste38',
      message: '!nossen Handicap invisible, pop-rock émotionnel, refrain mémorable',
    });
    assert.equal(result.json.action, 'suggestion_recovered');
    assert.equal(result.json.recovered, true);
    assert.equal(result.json.state.round.status, 'open');
    assert.equal(result.json.state.current.phase, 'voting');
    assert.equal(result.json.state.round.suggestions.length, 1);
    assert.match(result.json.state.round.suggestions[0].text, /Handicap invisible/);
    assert.equal(result.json.state.pendingSuggestions.length, 0);
  });
});

test('A11 production Caddy routes Vivy and TTS APIs to the A11 backend', () => {
  const deployScript = fs.readFileSync(
    path.join(__dirname, '../../../../ops/deploy-a11-prod-finland-2.ps1'),
    'utf8'
  );
  const a11PathLine = deployScript.split(/\r?\n/).find((line) => line.includes('@a11Path path')) || '';
  assert.match(a11PathLine, /\/api\/vivy(?:\s|$)/);
  assert.match(a11PathLine, /\/api\/vivy\/\*/);
  assert.match(a11PathLine, /\/api\/tts(?:\s|$)/);
  assert.match(a11PathLine, /\/api\/tts\/\*/);
});

test('Vivy live overlay contains the production show and bundled background', () => {
  const html = buildOverlayHtml();
  assert.match(html, /vivy-presence-musicale|overlay\/background/);
  assert.match(html, /VIVY LIVE/);
  assert.match(html, /Analyse du thème/);
  assert.match(html, /!etoiles 5/);
  assert.match(html, /Lecture en cours/);
  assert.match(html, /trackCoverImage/);
  assert.match(html, /trackCoverVideo/);
  assert.match(html, /coverVideoBackdrop/);
  assert.match(html, /video-ready/);
  assert.match(html, /COVER_SLIDE_MS = 10000/);
  assert.match(html, /STATE_POLL_MS = 6000/);
  assert.match(html, /cacheBustedMediaUrl/);
  assert.match(html, /overlayPoll/);
  assert.match(html, /cache: 'no-store'/);
  assert.match(html, /elements\.coverBackdrop\.src = coverSrc/);
  assert.match(html, /elements\.coverVideoBackdrop\.src = coverVideoSrc/);
  assert.match(html, /classList\.toggle\('visible', showVideoBackdrop\)/);
  assert.match(html, /classList\.toggle\('visible', showBackdrop\)/);
  assert.match(html, /titleFromPrompt/);
  assert.match(html, /titleForSuggestion/);
  assert.match(html, /voteLabel/);
});

test('Vivy stream write guard requires the shared secret when configured', async () => {
  const previousSecret = process.env.VIVY_STREAM_SECRET;
  const previousAllowUnsigned = process.env.VIVY_STREAM_ALLOW_UNSIGNED;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.VIVY_STREAM_SECRET = 'stream-secret';
  process.env.VIVY_STREAM_ALLOW_UNSIGNED = '1';
  process.env.NODE_ENV = 'production';

  try {
    await withServer({ stateName: 'secret.json' }, async (baseUrl) => {
      let result = await postJson(baseUrl, '/api/vivy/stream/chat', {
        username: 'chat',
        message: '!nossen should fail',
      });
      assert.equal(result.response.status, 401);
      assert.equal(result.json.error, 'vivy_stream_secret_invalid');

      result = await postJson(baseUrl, '/api/vivy/stream/chat', {
        username: 'chat',
        message: '!nossen should fail too',
      }, { 'X-Vivy-Stream-Secret': 'wrong' });
      assert.equal(result.response.status, 401);

      result = await postJson(baseUrl, '/api/vivy/stream/chat', {
        username: 'chat',
        message: '!nossen secret ok',
      }, { 'X-Vivy-Stream-Secret': 'stream-secret' });
      assert.equal(result.response.status, 200);
      assert.equal(result.json.ok, true);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.VIVY_STREAM_SECRET;
    else process.env.VIVY_STREAM_SECRET = previousSecret;
    if (previousAllowUnsigned === undefined) delete process.env.VIVY_STREAM_ALLOW_UNSIGNED;
    else process.env.VIVY_STREAM_ALLOW_UNSIGNED = previousAllowUnsigned;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('Twitch worker parses IRC PRIVMSG lines and command filtering', () => {
  const parsed = parsePrivmsg('@display-name=VivyFan;id=abc;color=#ff00aa;badges=subscriber/12 :vivyfan!vivyfan@vivyfan.tmi.twitch.tv PRIVMSG #funesterie :!vote S1');
  assert.equal(parsed.username, 'VivyFan');
  assert.equal(parsed.channel, 'funesterie');
  assert.equal(parsed.message, '!vote S1');
  assert.equal(parsed.messageId, 'abc');

  const previous = process.env.VIVY_STREAM_COMMANDS_ONLY;
  process.env.VIVY_STREAM_COMMANDS_ONLY = '1';
  try {
    assert.equal(shouldForwardMessage('salut tout le monde'), false);
    assert.equal(shouldForwardMessage('!nossen SAO opening'), true);
    assert.equal(shouldForwardMessage('⭐⭐⭐⭐⭐'), true);
    assert.equal(shouldForwardMessage(ANNOUNCE_MESSAGES[0]), false);
    assert.equal(shouldForwardMessage('🎤 Vivy Live — propose une chanson avec !vivy ton idée | vote avec !vote S1 | note avec !etoiles 5 S1 ou ⭐⭐⭐⭐⭐'), false);
    assert.equal(shouldForwardMessage('🎤 Vivy Live — !vivy ton idée | !nossen plus épique | !chanson sujet + ambiance'), false);
    assert.equal(shouldForwardMessage('🎵 Vote avec !vote S1 | note avec !etoiles 5 S1'), false);
    assert.equal(shouldForwardMessage('🎵 Nouvelle création Vivy: "La clé de la cave" demandée par funeste38 ▶ https://vivy.funesterie.me/x ⭐ Note avec !etoiles 5'), false);
    assert.equal(shouldForwardMessage('🎵 La clé de la cave ▶ https://vivy.funesterie.me/x 🖼️ https://vivy.funesterie.me/i.png'), false);
    assert.equal(shouldForwardMessage('🎶 Morceaux Vivy passés dans le live: 1. Le four malin ⭐4/5(2) ⬇ https://vivy.funesterie.me/x'), false);
    assert.equal(shouldForwardMessage('🎶 Playlist Vivy Live (2 titres) ▶ https://vivy.funesterie.me/api/vivy/stream/songs'), false);
  } finally {
    if (previous === undefined) delete process.env.VIVY_STREAM_COMMANDS_ONLY;
    else process.env.VIVY_STREAM_COMMANDS_ONLY = previous;
  }
});

test('Twitch worker live gate checks Helix before opening IRC and can reset stream state', async () => {
  const calls = [];
  const online = await fetchTwitchStreamStatus({
    channel: 'Funesterie',
    clientId: 'client-id',
    accessToken: 'oauth:user-token',
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: [{
            id: 'stream-1',
            user_login: 'funesterie',
            title: 'Live Vivy',
            game_name: 'Music',
            started_at: '2026-06-29T00:00:00Z',
          }],
        }),
      };
    },
  });
  assert.equal(online.ok, true);
  assert.equal(online.live, true);
  assert.equal(online.streamId, 'stream-1');
  assert.match(calls[0].url, /user_login=funesterie/i);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer user-token');
  assert.equal(calls[0].options.headers['Client-ID'], 'client-id');

  const offline = await fetchTwitchStreamStatus({
    channel: 'Funesterie',
    clientId: 'client-id',
    accessToken: 'user-token',
    fetchFn: async () => ({ ok: true, text: async () => JSON.stringify({ data: [] }) }),
  });
  assert.equal(offline.ok, true);
  assert.equal(offline.live, false);

  const missing = await fetchTwitchStreamStatus({ channel: 'Funesterie' });
  assert.equal(missing.ok, false);
  assert.equal(missing.live, false);
  assert.equal(missing.reason, 'missing_helix_credentials');
  assert.equal(resolveLivePollInterval('1000'), 15_000);
  assert.equal(resolveLivePollInterval('999999999'), 10 * 60 * 1000);
  assert.equal(
    resolveStreamResetUrl('https://vivy.funesterie.me/api/vivy/stream/chat'),
    'https://vivy.funesterie.me/api/vivy/stream/reset'
  );

  const reset = await postStreamReset('https://vivy.funesterie.me/api/vivy/stream/reset', 'stream-secret', {
    reason: 'twitch_stream_offline',
  }, {
    fetchFn: async (url, options) => {
      assert.equal(String(url), 'https://vivy.funesterie.me/api/vivy/stream/reset');
      assert.equal(options.headers['X-Vivy-Stream-Secret'], 'stream-secret');
      assert.deepEqual(JSON.parse(options.body), { reason: 'twitch_stream_offline' });
      return { ok: true, text: async () => JSON.stringify({ ok: true, memoryCleared: 3 }) };
    },
  });
  assert.equal(reset.ok, true);
  assert.equal(reset.memoryCleared, 3);
});

test('Twitch live monitor resets the session when OBS cuts the stream after IRC joined', async () => {
  const offlineEvents = [];
  let connected = false;
  let scheduled = null;
  let cleared = null;
  let fetchCount = 0;
  const monitor = createTwitchLiveStatusMonitor({
    intervalMs: 15000,
    isConnected: () => connected,
    fetchStatus: async () => {
      fetchCount += 1;
      return fetchCount === 1
        ? { ok: true, live: true, streamId: 'stream-1' }
        : { ok: true, live: false, reason: 'offline' };
    },
    onOffline: async (status) => offlineEvents.push(status),
    setIntervalFn: (callback, intervalMs) => {
      scheduled = { callback, intervalMs, unref() {} };
      return scheduled;
    },
    clearIntervalFn: (timer) => {
      cleared = timer;
    },
  });

  assert.equal(monitor.intervalMs, 15000);
  assert.equal(monitor.start(), true);
  assert.equal(scheduled.intervalMs, 15000);
  assert.equal(await monitor.tick(), false);
  assert.equal(fetchCount, 0);

  connected = true;
  assert.equal(await monitor.tick(), false);
  assert.equal(await monitor.tick(), true);
  assert.equal(await monitor.tick(), false);
  assert.equal(fetchCount, 2);
  assert.equal(offlineEvents.length, 1);
  assert.deepEqual(offlineEvents[0], { ok: true, live: false, reason: 'offline' });
  assert.equal(monitor.stop(), true);
  assert.equal(cleared, scheduled);
});

test('Twitch announcements rotate only while the worker is connected', () => {
  const sent = [];
  let connected = false;
  let scheduled = null;
  let cleared = null;
  const rotator = createAnnouncementRotator({
    intervalMs: 1234,
    isConnected: () => connected,
    sendMessage: (message) => sent.push(message),
    setIntervalFn: (callback, intervalMs) => {
      scheduled = { callback, intervalMs, unref() {} };
      return scheduled;
    },
    clearIntervalFn: (timer) => {
      cleared = timer;
    },
  });

  assert.equal(rotator.intervalMs, 1234);
  assert.equal(rotator.start(), true);
  assert.equal(scheduled.intervalMs, 1234);
  assert.equal(scheduled.callback(), false);
  assert.deepEqual(sent, []);

  connected = true;
  assert.equal(scheduled.callback(), true);
  assert.equal(scheduled.callback(), true);
  assert.equal(scheduled.callback(), true);
  assert.deepEqual(sent, [ANNOUNCE_MESSAGES[0], ANNOUNCE_MESSAGES[1], ANNOUNCE_MESSAGES[0]]);
  assert.ok(sent.every((message) => !/[\r\n]/.test(message)));
  assert.ok(sent.every((message) => !/[⭐★🌟]/u.test(message)));

  connected = false;
  assert.equal(scheduled.callback(), false);
  assert.equal(sent.length, 3);
  assert.equal(rotator.stop(), true);
  assert.equal(cleared, scheduled);

  assert.equal(resolveAnnounceInterval('invalid'), 720000);
  assert.equal(resolveAnnounceInterval('500'), 1000);
  assert.equal(resolveBotMessageGap('invalid'), 15000);
  assert.equal(resolveBotMessageGap('-1'), 15000);
  assert.equal(resolveBotMessageGap('2500'), 2500);
  const disabled = createAnnouncementRotator({ disabled: true, sendMessage: (message) => sent.push(message) });
  assert.equal(disabled.start(), false);
  assert.equal(disabled.tick(), false);
});

test('Twitch bot messages are spaced before they hit chat', async () => {
  const sent = [];
  const waits = [];
  let fakeNow = 1000;
  const previousNow = Date.now;
  Date.now = () => fakeNow;
  try {
    const sender = createSpacedSender({
      gapMs: 15000,
      sleep: async (ms) => {
        waits.push(ms);
        fakeNow += ms;
      },
      sendMessage: (message) => {
        sent.push(message);
        fakeNow += 1;
      },
    });
    await sender.enqueue('premier');
    await sender.enqueue('deuxième');
    await sender.enqueue('troisième');
    assert.deepEqual(sent, ['premier', 'deuxième', 'troisième']);
    assert.deepEqual(waits, [15000, 15000]);
  } finally {
    Date.now = previousNow;
  }
});

test('Twitch track notices share new songs once with an absolute public link', async () => {
  const message = buildTrackNoticeMessage({
    current: {
      phase: 'presenting',
      trackTitle: 'Les lumières de la ville',
      requestedBy: 'funeste38',
      trackUrl: '/api/vivy/studio/assets/song.mp3',
      coverImageUrl: '/api/vivy/studio/assets/cover.png',
    },
  }, { publicBaseUrl: 'https://vivy.funesterie.me' });
  assert.doesNotMatch(message, /Nouvelle création Vivy/);
  assert.match(message, /Les lumières de la ville/);
  assert.match(message, /https:\/\/vivy\.funesterie\.me\/api\/vivy\/studio\/assets\/song\.mp3/);
  assert.match(message, /https:\/\/vivy\.funesterie\.me\/api\/vivy\/studio\/assets\/cover\.png/);
  assert.doesNotMatch(message, /[⭐★🌟]/u);
  assert.doesNotMatch(message, /[\r\n]/);

  const sent = [];
  let connected = false;
  let cleared = null;
  let fetchIndex = 0;
  const states = [
    { current: { phase: 'listening' } },
    {
      current: {
        phase: 'rating',
      },
      songs: [{
        source: 'twitch-live',
        trackTitle: 'Course sous néons',
        requestedBy: 'chat',
        trackUrl: '/api/vivy/studio/assets/neons.mp3',
        sharePath: '/api/vivy/stream/s/course-sous-neons-abcd1234',
      }],
    },
    {
      current: {
        phase: 'rating',
      },
      songs: [{
        source: 'twitch-live',
        trackTitle: 'Course sous néons',
        requestedBy: 'chat',
        trackUrl: '/api/vivy/studio/assets/neons.mp3',
        sharePath: '/api/vivy/stream/s/course-sous-neons-abcd1234',
      }],
    },
    {
      current: {
        phase: 'rating',
      },
      songs: [{
        source: 'twitch-live',
        trackTitle: 'Course sous néons',
        requestedBy: 'chat',
        trackUrl: '/api/vivy/studio/assets/neons.mp3',
        sharePath: '/api/vivy/stream/s/course-sous-neons-abcd1234',
        coverVideoUrl: '/api/vivy/studio/assets/neons-loop.mp4',
      }],
    },
  ];
  const watcher = createTrackNoticeWatcher({
    stateUrl: 'https://vivy.funesterie.me/api/vivy/stream/state',
    publicBaseUrl: 'https://vivy.funesterie.me',
    pollIntervalMs: 1234,
    isConnected: () => connected,
    sendMessage: (entry) => sent.push(entry),
    fetchFn: async () => ({
      ok: true,
      json: async () => states[Math.min(fetchIndex++, states.length - 1)],
    }),
    setIntervalFn: (_callback, intervalMs) => ({ intervalMs, unref() {} }),
    clearIntervalFn: (timer) => {
      cleared = timer;
    },
  });

  assert.equal(resolveTrackNoticePollInterval('invalid'), 10_000);
  assert.equal(resolveTrackNoticePollInterval('500'), 3000);
  assert.equal(watcher.pollIntervalMs, 3000);
  assert.equal(watcher.start(), true);
  assert.equal(await watcher.tick(), false);
  assert.deepEqual(sent, []);

  connected = true;
  assert.equal(await watcher.tick(), false);
  assert.equal(await watcher.tick(), true);
  assert.equal(await watcher.tick(), false);
  assert.equal(await watcher.tick(), true);
  assert.equal(await watcher.tick(), false);
  assert.equal(sent.length, 2);
  assert.match(sent[0], /https:\/\/vivy\.funesterie\.me\/api\/vivy\/stream\/s\/course-sous-neons-abcd1234/);
  assert.match(sent[1], /Clip Vivy/);
  assert.match(sent[1], /https:\/\/vivy\.funesterie\.me\/api\/vivy\/studio\/assets\/neons-loop\.mp4/);
  assert.match(buildTrackClipNoticeMessage(states[3], {
    publicBaseUrl: 'https://vivy.funesterie.me',
  }), /neons-loop\.mp4/);
  assert.equal(watcher.stop(), true);
  assert.ok(cleared);
});

test('Twitch song recaps list live songs in order with stars and short links', async () => {
  const state = {
    songs: [
      {
        id: 'track-a',
        trackTitle: 'Les lumières de la ville',
        trackUrl: '/api/vivy/studio/assets/a.mp3',
        sharePath: '/api/vivy/stream/s/les-lumieres-de-la-ville-aaaa1111',
        starAverage: 4.8,
        starCount: 5,
      },
      {
        id: 'track-b',
        trackTitle: 'Bleach Hollow Memories',
        trackUrl: '/api/vivy/studio/assets/b.mp3',
        sharePath: '/api/vivy/stream/s/bleach-hollow-memories-bbbb2222',
      },
    ],
  };
  const messages = buildSongRecapMessages(state, { publicBaseUrl: 'https://vivy.funesterie.me' });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Playlist Vivy Live \(2 titres\)/);
  assert.match(messages[0], /https:\/\/vivy\.funesterie\.me\/api\/vivy\/stream\/songs/);
  assert.doesNotMatch(messages[0], /Les lumières de la ville/);
  assert.doesNotMatch(messages[0], /[\r\n]/);

  const sent = [];
  let connected = true;
  let scheduled = null;
  const rotator = createSongRecapRotator({
    stateUrl: 'https://vivy.funesterie.me/api/vivy/stream/state',
    publicBaseUrl: 'https://vivy.funesterie.me',
    intervalMs: 26 * 60 * 1000,
    isConnected: () => connected,
    sendMessage: (message) => sent.push(message),
    fetchFn: async () => ({ ok: true, json: async () => state }),
    sleep: async () => {},
    setIntervalFn: (callback, intervalMs) => {
      scheduled = { callback, intervalMs, unref() {} };
      return scheduled;
    },
  });
  assert.equal(resolveRecapInterval('120000'), 25 * 60 * 1000);
  assert.equal(resolveRecapInterval('999999999'), 30 * 60 * 1000);
  assert.equal(rotator.intervalMs, 26 * 60 * 1000);
  assert.equal(rotator.start(), true);
  assert.equal(scheduled.intervalMs, 26 * 60 * 1000);
  assert.equal(await rotator.tick(), true);
  assert.equal(sent.length, 1);
  connected = false;
  assert.equal(await rotator.tick(), false);
});

test('Vivy Twitch cover prompts stay visual and image generation can return a public URL', async () => {
  const prompt = buildTwitchCoverPrompt({
    publicTitle: 'La fille qui parlait aux machines',
    winner: { text: '!vivy électro-pop lumineux, ville qui danse avec des robots' },
    routing: { songMood: 'electro-pop funky, synthés brillants' },
    lyrics: '[Refrain]\nElles me parlent en lumière\nLa ville répond dans les moteurs',
  });
  assert.doesNotMatch(prompt, /La fille qui parlait aux machines/);
  assert.match(prompt, /ville qui danse/);
  assert.match(prompt, /Aucun texte/);
  assert.match(prompt, /pas de pseudo-écriture/i);
  assert.match(prompt, /titre reste strictement privé/i);
  assert.match(prompt, /ajouté séparément par l’overlay Twitch/i);
  assert.doesNotMatch(prompt, /Elles me parlent en lumière/i);
  assert.doesNotMatch(prompt, /Motifs chantés/i);
  assert.match(prompt, /overlay Twitch/i);
  assert.match(prompt, /Éviter absolument: dessin enfantin/);
  assert.doesNotMatch(prompt, /Suno|Mureka|clean_lyrics/i);

  const corsairPrompt = buildTwitchCoverPrompt({
    publicTitle: 'Le pirate de l’espace',
    winner: {
      text: 'corsaire interstellaire, voiles dans les étoiles, drapeau noir, colonies oubliées',
    },
    routing: { songMood: 'électro-rock cosmique, guitares nerveuses' },
  });
  assert.match(corsairPrompt, /space opera rétro adulte/);
  assert.match(corsairPrompt, /ailes ou panneaux solaires noirs/);
  assert.match(corsairPrompt, /aucun océan/);
  assert.doesNotMatch(corsairPrompt, /rendre l’eau/i);
  assert.doesNotMatch(corsairPrompt, /Albator|Harlock/i);

  const identityPrompt = buildTwitchCoverPrompt({
    publicTitle: 'Djeff et Vivy rallument le studio',
    winner: { text: 'duo Djeff + Vivy, studio Funesterie, electro-rock lumineux' },
    artists: ['Djeff', 'Vivy'],
    vocalCast: 'Djeff + Vivy',
    lyrics: '[Djeff]\nJe rallume la console\n[Vivy]\nJe réponds dans la lumière',
  });
  assert.match(identityPrompt, /Référence visuelle chanteuse IA/i);
  assert.match(identityPrompt, /cheveux noirs en couettes/i);
  assert.match(identityPrompt, /ne jamais la rendre blonde/i);
  assert.match(identityPrompt, /Référence visuelle créateur humain/i);
  assert.match(identityPrompt, /peau olive/i);
  assert.match(identityPrompt, /mèche claire/i);
  assert.match(identityPrompt, /ne pas le rendre noir/i);
  const marvinPack = buildVivyVisualIdentityPack({
    publicTitle: 'Marvin Bip Bip 30 ans',
    winner: { text: 'clip anniversaire Marvin avec Charlène, Léna et Elio' },
  });
  assert.deepEqual(marvinPack.identities.map((identity) => identity.id), ['marvin']);
  assert.match(marvinPack.prompt, /Référence visuelle frère et père/i);
  assert.match(marvinPack.prompt, /l’homme à droite/i);
  assert.ok(marvinPack.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-family'));
  assert.ok(marvinPack.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-brothers-01'));
  assert.ok(marvinPack.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-brothers-04'));
  const commandOnlyVivyPack = buildVivyVisualIdentityPack({
    publicTitle: 'Le plombier de minuit Marvin',
    winner: { text: '!vivy Le plombier de minuit Marvin, une cliente parle de pression et de fuite' },
    artists: ['vivy'],
    vocalCast: 'vivy',
    lyrics: '[Vivy solo]\nMarvin resserre le joint',
  });
  assert.deepEqual(commandOnlyVivyPack.identities.map((identity) => identity.id), ['marvin']);
  assert.doesNotMatch(commandOnlyVivyPack.prompt, /Vivy official Funesterie identity/i);
  const explicitReferencePack = buildVivyVisualIdentityPack({
    publicTitle: 'Jean Carmelo',
    winner: {
      text: 'Jean en Porsche Boxster grise https://files.funesterie.me/users/vivy-twitch-live/jean-reference.jpg',
    },
  });
  assert.ok(explicitReferencePack.referenceImageUrls.includes('https://files.funesterie.me/users/vivy-twitch-live/jean-reference.jpg'));
  assert.match(explicitReferencePack.prompt, /Référence visuelle utilisateur fournie/i);
  const commandOnlyVivyPrompt = buildTwitchCoverPrompt({
    publicTitle: 'Le plombier de minuit Marvin',
    winner: { text: '!vivy Le plombier de minuit Marvin, une cliente parle de pression et de fuite' },
    artists: ['vivy'],
    vocalCast: 'vivy',
    lyrics: '[Vivy solo]\nMarvin resserre le joint',
  });
  assert.doesNotMatch(commandOnlyVivyPrompt, /Vivy official Funesterie identity/i);
  assert.doesNotMatch(commandOnlyVivyPrompt, /chanson originale Vivy Live/i);
  const identityNegative = buildTwitchCoverNegativePrompt({
    publicTitle: 'Djeff et Vivy rallument le studio',
    winner: { text: 'duo Djeff + Vivy' },
    artists: ['Djeff', 'Vivy'],
  }, identityPrompt);
  assert.match(identityNegative, /blonde Vivy/i);
  assert.match(identityNegative, /black Djeff/i);
  assert.match(identityNegative, /old nossen djeff beta asset/i);

  const a11K44Prompt = buildTwitchCoverPrompt({
    publicTitle: 'A11 et K44 ouvrent le signal',
    winner: { text: 'A11 Agent Media et K44 copilote, duo cyber nocturne' },
    artists: ['A11', 'K44'],
    vocalCast: 'A11 + K44',
  });
  assert.match(a11K44Prompt, /Référence visuelle agent média/i);
  assert.match(a11K44Prompt, /yeux cyan lumineux/i);
  assert.match(a11K44Prompt, /Référence visuelle copilote quotidienne/i);
  assert.match(a11K44Prompt, /cockpit néon bleu-violet/i);
  assert.doesNotMatch(a11K44Prompt, /command cards/i);
  const a11K44Negative = buildTwitchCoverNegativePrompt({
    publicTitle: 'A11 et K44 ouvrent le signal',
    winner: { text: 'A11 Agent Media et K44 copilote' },
    artists: ['A11', 'K44'],
  }, a11K44Prompt);
  assert.match(a11K44Negative, /normal human A11/i);
  assert.match(a11K44Negative, /hooded A11 as K44/i);

  const previousEnabled = process.env.VIVY_STREAM_COVER_ENABLED;
  const previousUrl = process.env.VIVY_STREAM_COVER_URL;
  const previousDjeffReference = process.env.VIVY_DJEFF_REFERENCE_IMAGE_URL;
  process.env.VIVY_STREAM_COVER_ENABLED = '1';
  process.env.VIVY_STREAM_COVER_URL = 'http://image.local/generate';
  process.env.VIVY_DJEFF_REFERENCE_IMAGE_URL = 'https://files.funesterie.me/users/djeff-reference.webp';
  try {
    const calls = [];
    const result = await generateTwitchCoverImage({
      publicTitle: 'La ville répond',
      winner: { text: 'néons et machines heureuses' },
      fetchFn: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ imageUrl: '/api/vivy/studio/assets/covers/ville.png' }),
        };
      },
      req: {
        protocol: 'https',
        headers: { host: 'vivy.funesterie.me' },
        get(name) {
          if (name === 'host') return 'vivy.funesterie.me';
          if (name === 'x-forwarded-proto') return 'https';
          return '';
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.coverImageUrl, 'https://vivy.funesterie.me/api/vivy/studio/assets/covers/ville.png');
    assert.equal(String(calls[0].url), 'http://image.local/generate');
    assert.equal(JSON.parse(calls[0].options.body).source, 'vivy-twitch-cover');
    assert.equal(JSON.parse(calls[0].options.body).acceptAsyncImageJob, true);

    calls.length = 0;
    const corsairResult = await generateTwitchCoverImage({
      publicTitle: 'Le pirate de l’espace',
      winner: { text: 'corsaire interstellaire, drapeau noir, colonies oubliées' },
      fetchFn: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ imageUrl: '/api/vivy/studio/assets/covers/corsaire.png' }),
        };
      },
    });
    assert.equal(corsairResult.ok, true);
    const corsairBody = JSON.parse(calls[0].options.body);
    assert.match(corsairBody.negative_prompt, /ocean/);
    assert.match(corsairBody.negative_prompt, /sailing ship/);

    calls.length = 0;
    const identityResult = await generateTwitchCoverImage({
      publicTitle: 'Djeff et Vivy',
      winner: { text: 'duo Djeff + Vivy dans le studio Funesterie' },
      artists: ['Djeff', 'Vivy'],
      fetchFn: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ imageUrl: '/api/vivy/studio/assets/covers/djeff-vivy.png' }),
        };
      },
    });
    assert.equal(identityResult.ok, true);
    const identityBody = JSON.parse(calls[0].options.body);
    assert.match(identityBody.referenceVisualContext, /Référence visuelle créateur humain/i);
    assert.match(identityBody.referenceVisualContext, /Référence visuelle chanteuse IA/i);
    assert.ok(identityBody.referenceImageUrls.includes('https://files.funesterie.me/users/djeff-reference.webp'));
    assert.ok(identityBody.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-01'));
    assert.ok(identityBody.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-05'));
    assert.ok(identityBody.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/overlay/background'));

    calls.length = 0;
    const a11K44Result = await generateTwitchCoverImage({
      publicTitle: 'A11 et K44',
      winner: { text: 'A11 Agent Media et K44 copilote dans le cockpit Funesterie' },
      artists: ['A11', 'K44'],
      fetchFn: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ imageUrl: '/api/vivy/studio/assets/covers/a11-k44.png' }),
        };
      },
    });
    assert.equal(a11K44Result.ok, true);
    const a11K44Body = JSON.parse(calls[0].options.body);
    assert.match(a11K44Body.referenceVisualContext, /Référence visuelle agent média/i);
    assert.match(a11K44Body.referenceVisualContext, /Référence visuelle copilote quotidienne/i);
    assert.ok(a11K44Body.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/a11-agent-media-card'));
    assert.ok(a11K44Body.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/k44-copilot-reference'));

    calls.length = 0;
    const marvinResult = await generateTwitchCoverImage({
      publicTitle: 'Marvin Bip Bip 30 ans',
      winner: { text: 'clip anniversaire Marvin, famille, souvenirs de frères, chalumeau et bougies' },
      fetchFn: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ imageUrl: '/api/vivy/studio/assets/covers/marvin.png' }),
        };
      },
    });
    assert.equal(marvinResult.ok, true);
    const marvinBody = JSON.parse(calls[0].options.body);
    assert.match(marvinBody.referenceVisualContext, /Référence visuelle frère et père/i);
    assert.match(marvinBody.negative_prompt, /wrong Marvin face/i);
    assert.ok(marvinBody.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-family'));
    assert.ok(marvinBody.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-brothers-04'));
  } finally {
    if (previousEnabled === undefined) delete process.env.VIVY_STREAM_COVER_ENABLED;
    else process.env.VIVY_STREAM_COVER_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.VIVY_STREAM_COVER_URL;
    else process.env.VIVY_STREAM_COVER_URL = previousUrl;
    if (previousDjeffReference === undefined) delete process.env.VIVY_DJEFF_REFERENCE_IMAGE_URL;
    else process.env.VIVY_DJEFF_REFERENCE_IMAGE_URL = previousDjeffReference;
  }
});

test('Vivy Twitch cover follows async BAT/Rome image jobs when the image backend queues work', async () => {
  const previousEnabled = process.env.VIVY_STREAM_COVER_ENABLED;
  const previousUrl = process.env.VIVY_STREAM_COVER_URL;
  process.env.VIVY_STREAM_COVER_ENABLED = '1';
  process.env.VIVY_STREAM_COVER_URL = 'http://image.local/generate';
  try {
    const calls = [];
    const result = await generateTwitchCoverImage({
      publicTitle: 'La fille qui rallume la ville',
      winner: { text: 'machines lumineuses et refrain heureux' },
      fetchFn: async (url, options = {}) => {
        calls.push({ url, options });
        if (String(url).includes('/api/llm/jobs/image/cover-1')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              status: 'done',
              result: { imagePath: '/api/vivy/studio/assets/covers/async-ville.png' },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            status: 'pending',
            asyncJob: {
              jobId: 'cover-1',
              status: 'pending',
              poll_url: '/api/llm/jobs/image/cover-1',
              pollIntervalMs: 100,
            },
          }),
        };
      },
      req: {
        protocol: 'https',
        headers: { host: 'vivy.funesterie.me' },
        get(name) {
          if (name === 'host') return 'vivy.funesterie.me';
          if (name === 'x-forwarded-proto') return 'https';
          return '';
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.coverImageUrl, 'https://vivy.funesterie.me/api/vivy/studio/assets/covers/async-ville.png');
    assert.equal(calls.length, 2);
    assert.equal(String(calls[1].url), 'http://image.local/api/llm/jobs/image/cover-1');
  } finally {
    if (previousEnabled === undefined) delete process.env.VIVY_STREAM_COVER_ENABLED;
    else process.env.VIVY_STREAM_COVER_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.VIVY_STREAM_COVER_URL;
    else process.env.VIVY_STREAM_COVER_URL = previousUrl;
  }
});

test('Vivy Twitch clip animates the cover with the trusted asynchronous video engine', async () => {
  const previousEnabled = process.env.VIVY_STREAM_CLIP_ENABLED;
  const previousProvider = process.env.VIVY_STREAM_CLIP_PROVIDER;
  process.env.VIVY_STREAM_CLIP_ENABLED = '1';
  process.env.VIVY_STREAM_CLIP_PROVIDER = 'replicate';
  try {
    let captured = null;
    const result = await generateTwitchCoverVideo({
      publicTitle: 'Djeff rebelle',
      winner: { text: 'guitariste rebelle sur une scène électro-rock' },
      coverImageUrl: 'https://files.funesterie.me/covers/djeff-rebelle.webp',
      coverPrompt: 'Affiche musicale adulte, guitare et lumière dramatique.',
      generateVideoFn: async (options) => {
        captured = options;
        return {
          ok: true,
          video_url: '/files/runtime/files/generated/videos/djeff-rebelle.mp4',
        };
      },
      req: {
        protocol: 'https',
        headers: { host: 'vivy.funesterie.me' },
        get(name) {
          if (name === 'host') return 'vivy.funesterie.me';
          if (name === 'x-forwarded-proto') return 'https';
          return '';
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.coverVideoUrl, 'https://vivy.funesterie.me/files/runtime/files/generated/videos/djeff-rebelle.mp4');
    assert.equal(captured.body.sourceImageUrl, 'https://files.funesterie.me/covers/djeff-rebelle.webp');
    assert.equal(captured.body.videoProvider, 'replicate');
    assert.equal(captured.body.durationSeconds, 3);
    assert.equal(captured.body.source, 'vivy-twitch-cover-clip');
    assert.match(captured.prompt, /boucle visuelle cinématique de 3 secondes/i);
    assert.match(captured.prompt, /Conserver strictement l’identité/i);
    assert.match(captured.prompt, /aucune pseudo-écriture/i);
    assert.equal(captured.body.vocalPerformance, false);
    assert.equal(captured.body.visualOnly, true);
    assert.match(captured.body.negative_prompt, /ghost face/i);
    assert.match(captured.prompt, /Référence visuelle créateur humain/i);
    assert.match(captured.prompt, /ne pas le rendre noir/i);
    assert.equal(captured.body.referenceImageUrls[0], 'https://files.funesterie.me/covers/djeff-rebelle.webp');
    assert.ok(captured.body.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-01'));
    assert.ok(captured.body.referenceImageUrls.includes('https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-05'));
    assert.match(buildTwitchClipPrompt({ title: 'Test' }), /aucun morphing/i);
  } finally {
    if (previousEnabled === undefined) delete process.env.VIVY_STREAM_CLIP_ENABLED;
    else process.env.VIVY_STREAM_CLIP_ENABLED = previousEnabled;
    if (previousProvider === undefined) delete process.env.VIVY_STREAM_CLIP_PROVIDER;
    else process.env.VIVY_STREAM_CLIP_PROVIDER = previousProvider;
  }
});

test('Vivy Twitch clip retries the platform provider after an incompatible provider', async () => {
  const previousEnabled = process.env.VIVY_STREAM_CLIP_ENABLED;
  const previousProvider = process.env.VIVY_STREAM_CLIP_PROVIDER;
  const previousPlatformProvider = process.env.A11_HF_VIDEO_PROVIDER;
  const previousComfyCloudKey = process.env.A11_COMFY_CLOUD_API_KEY;
  const previousComfyCloudKeyAlt = process.env.COMFY_CLOUD_API_KEY;
  const previousComfyOrgKey = process.env.A11_COMFY_ORG_API_KEY;
  const previousComfyOrgKeyAlt = process.env.COMFY_ORG_API_KEY;
  const previousComfyApiKey = process.env.A11_COMFY_API_KEY;
  const previousComfyUiApiKey = process.env.COMFYUI_API_KEY;
  const previousComfyCloudEnabled = process.env.A11_VIDEO_COMFY_CLOUD_ENABLED;
  const previousLocalRunnerUrl = process.env.A11_VIDEO_LOCAL_RUNNER_URL;
  const previousVideoProxyUrl = process.env.A11_VIDEO_PROXY_URL;
  const previousGenericVideoProxyUrl = process.env.VIDEO_PROXY_URL;
  process.env.VIVY_STREAM_CLIP_ENABLED = '1';
  process.env.VIVY_STREAM_CLIP_PROVIDER = 'huggingface';
  process.env.A11_HF_VIDEO_PROVIDER = 'replicate';
  delete process.env.A11_COMFY_CLOUD_API_KEY;
  delete process.env.COMFY_CLOUD_API_KEY;
  delete process.env.A11_COMFY_ORG_API_KEY;
  delete process.env.COMFY_ORG_API_KEY;
  delete process.env.A11_COMFY_API_KEY;
  delete process.env.COMFYUI_API_KEY;
  delete process.env.A11_VIDEO_COMFY_CLOUD_ENABLED;
  delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  try {
    const providers = [];
    const result = await generateTwitchCoverVideo({
      publicTitle: 'Boucle de secours',
      coverImageUrl: 'https://files.funesterie.me/covers/test.webp',
      generateVideoFn: async (options) => {
        providers.push(options.body.videoProvider);
        if (options.body.videoProvider === 'huggingface') {
          throw new Error('Model not supported by provider hf-inference');
        }
        return { ok: true, video_url: 'https://files.funesterie.me/videos/test.mp4' };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'replicate');
    assert.deepEqual(providers, ['huggingface', 'replicate']);
  } finally {
    if (previousEnabled === undefined) delete process.env.VIVY_STREAM_CLIP_ENABLED;
    else process.env.VIVY_STREAM_CLIP_ENABLED = previousEnabled;
    if (previousProvider === undefined) delete process.env.VIVY_STREAM_CLIP_PROVIDER;
    else process.env.VIVY_STREAM_CLIP_PROVIDER = previousProvider;
    if (previousPlatformProvider === undefined) delete process.env.A11_HF_VIDEO_PROVIDER;
    else process.env.A11_HF_VIDEO_PROVIDER = previousPlatformProvider;
    if (previousComfyCloudKey === undefined) delete process.env.A11_COMFY_CLOUD_API_KEY;
    else process.env.A11_COMFY_CLOUD_API_KEY = previousComfyCloudKey;
    if (previousComfyCloudKeyAlt === undefined) delete process.env.COMFY_CLOUD_API_KEY;
    else process.env.COMFY_CLOUD_API_KEY = previousComfyCloudKeyAlt;
    if (previousComfyOrgKey === undefined) delete process.env.A11_COMFY_ORG_API_KEY;
    else process.env.A11_COMFY_ORG_API_KEY = previousComfyOrgKey;
    if (previousComfyOrgKeyAlt === undefined) delete process.env.COMFY_ORG_API_KEY;
    else process.env.COMFY_ORG_API_KEY = previousComfyOrgKeyAlt;
    if (previousComfyApiKey === undefined) delete process.env.A11_COMFY_API_KEY;
    else process.env.A11_COMFY_API_KEY = previousComfyApiKey;
    if (previousComfyUiApiKey === undefined) delete process.env.COMFYUI_API_KEY;
    else process.env.COMFYUI_API_KEY = previousComfyUiApiKey;
    if (previousComfyCloudEnabled === undefined) delete process.env.A11_VIDEO_COMFY_CLOUD_ENABLED;
    else process.env.A11_VIDEO_COMFY_CLOUD_ENABLED = previousComfyCloudEnabled;
    if (previousLocalRunnerUrl === undefined) delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;
    else process.env.A11_VIDEO_LOCAL_RUNNER_URL = previousLocalRunnerUrl;
    if (previousVideoProxyUrl === undefined) delete process.env.A11_VIDEO_PROXY_URL;
    else process.env.A11_VIDEO_PROXY_URL = previousVideoProxyUrl;
    if (previousGenericVideoProxyUrl === undefined) delete process.env.VIDEO_PROXY_URL;
    else process.env.VIDEO_PROXY_URL = previousGenericVideoProxyUrl;
  }
});

test('Vivy Twitch clip waits and retries once after a provider rate limit', async () => {
  const previousEnabled = process.env.VIVY_STREAM_CLIP_ENABLED;
  const previousProvider = process.env.VIVY_STREAM_CLIP_PROVIDER;
  const previousRetryDelay = process.env.VIVY_STREAM_CLIP_RETRY_DELAY_MS;
  process.env.VIVY_STREAM_CLIP_ENABLED = '1';
  process.env.VIVY_STREAM_CLIP_PROVIDER = 'replicate';
  process.env.VIVY_STREAM_CLIP_RETRY_DELAY_MS = '1234';
  try {
    let attempts = 0;
    const waits = [];
    const result = await generateTwitchCoverVideo({
      publicTitle: 'Quota temporaire',
      coverImageUrl: 'https://files.funesterie.me/covers/test.webp',
      sleepFn: async (delayMs) => waits.push(delayMs),
      generateVideoFn: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('hf_video_status_429');
        return { ok: true, video_url: 'https://files.funesterie.me/videos/retry.mp4' };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'replicate');
    assert.equal(attempts, 2);
    assert.deepEqual(waits, [1234]);
  } finally {
    if (previousEnabled === undefined) delete process.env.VIVY_STREAM_CLIP_ENABLED;
    else process.env.VIVY_STREAM_CLIP_ENABLED = previousEnabled;
    if (previousProvider === undefined) delete process.env.VIVY_STREAM_CLIP_PROVIDER;
    else process.env.VIVY_STREAM_CLIP_PROVIDER = previousProvider;
    if (previousRetryDelay === undefined) delete process.env.VIVY_STREAM_CLIP_RETRY_DELAY_MS;
    else process.env.VIVY_STREAM_CLIP_RETRY_DELAY_MS = previousRetryDelay;
  }
});

test('Vivy stream clip-mode arming estimates cost, requires confirmation and stays one-shot', async () => {
  const app = express();
  const statePath = path.join(tmpRoot, 'clip-mode-one-shot.json');
  const started = [];
  const fakeRunner = {
    start: (payload) => {
      started.push(payload);
      return { started: true, promise: Promise.resolve({ ok: true }) };
    },
    isRunning: () => false,
    run: async () => ({ ok: true }),
  };
  app.use('/api/vivy/stream', createVivyStreamRouter({ statePath, runner: fakeRunner }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const preview = await postJson(baseUrl, '/api/vivy/stream/round/clip-mode', { mode: 'dream' });
    assert.equal(preview.json.ok, true);
    assert.equal(preview.json.armed, false);
    assert.equal(preview.json.requiresConfirmation, true);
    assert.equal(preview.json.estimate.dream, true);
    assert.ok(preview.json.estimate.uniqueLoops >= 2);
    assert.ok(preview.json.estimate.estimatedCostEur.typical > 0);

    const armed = await postJson(baseUrl, '/api/vivy/stream/round/clip-mode', { mode: 'dream', confirm: true });
    assert.equal(armed.json.ok, true);
    assert.equal(armed.json.armed, true);
    assert.equal(armed.json.nextClipMode, 'dream');

    await postJson(baseUrl, '/api/vivy/stream/chat', {
      source: 'twitch',
      username: 'funeste38',
      message: '!chanson Vivy Live dans la nuit néon, électro-pop sombre, club violet',
    });
    await postJson(baseUrl, '/api/vivy/stream/round/lock', {});
    assert.equal(started.length, 1);
    assert.equal(started[0].clipMode, 'dream');

    await postJson(baseUrl, '/api/vivy/stream/control', { action: 'next' });
    await postJson(baseUrl, '/api/vivy/stream/chat', {
      source: 'twitch',
      username: 'funeste38',
      message: '!chanson Deuxième round sans mode rêve',
    });
    await postJson(baseUrl, '/api/vivy/stream/round/lock', {});
    assert.equal(started.length, 2);
    assert.equal(started[1].clipMode, '');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('Vivy stream late clip attach stores the shareable video url on archived songs', async () => {
  await withServer({ stateName: 'late-clip-share.json' }, async (baseUrl) => {
    const ready = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'ready',
      title: 'Nuit néon',
      trackTitle: 'Nuit néon',
      trackUrl: '/api/vivy/studio/assets/vivy-music-suno-lateclip.mp3',
      durationSeconds: 180,
      coverImageUrl: 'https://files.example.com/cover.jpg',
    });
    assert.equal(ready.json.ok, true);

    const clip = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'clip',
      source: 'vivy-full-clip-late',
      trackUrl: '/api/vivy/studio/assets/vivy-music-suno-lateclip.mp3',
      coverVideoUrl: 'https://files.example.com/clip.mp4',
      coverVideoPrompt: 'scene-01 montage final',
      shareVideoUrl: 'https://files.example.com/clip-share.mp4',
    });
    assert.equal(clip.json.ok, true);

    const stateResponse = await fetch(`${baseUrl}/api/vivy/stream/state`);
    const state = await stateResponse.json();
    const song = (state.songs || []).find((entry) => String(entry.trackUrl || '').includes('vivy-music-suno-lateclip'));
    assert.ok(song, 'archived song not found');
    assert.equal(song.coverVideoUrl, 'https://files.example.com/clip.mp4');
    assert.equal(song.shareVideoUrl, 'https://files.example.com/clip-share.mp4');
    assert.equal(state.current.coverVideoUrl, 'https://files.example.com/clip.mp4');
  });
});

test('Vivy hardcore 90s requests get a mandatory gabber thunderdome direction', () => {
  assert.equal(isHardcoreRaveRequest('hardcore années 90, ambiance rave'), true);
  assert.equal(isHardcoreRaveRequest('un vrai son thunderdome'), true);
  assert.equal(isHardcoreRaveRequest('gabber hollandais qui tape'), true);
  assert.equal(isHardcoreRaveRequest('rap hardcore old school'), false);
  assert.equal(isHardcoreRaveRequest('punk hardcore années 90'), false);
  assert.equal(isHardcoreRaveRequest('ballade douce pour dormir'), false);

  const routing = reinforceTwitchHardcoreRouting(
    { songMood: 'électro sombre dramatique' },
    { winner: { text: 'hardcore années 90, esprit rave' } }
  );
  assert.match(routing.songMood, /gabber/i);
  assert.match(routing.songMood, /Thunderdome/i);
  assert.match(routing.songMood, /170-190 BPM/);
  assert.match(routing.songMood, /kicks distordus/i);
  assert.match(routing.songMood, /jamais orchestral épique/i);

  const untouched = reinforceTwitchHardcoreRouting(
    { songMood: 'rap boom bap' },
    { winner: { text: 'rap hardcore old school' } }
  );
  assert.equal(untouched.songMood, 'rap boom bap');

  const alreadyDirected = reinforceTwitchHardcoreRouting(
    { songMood: 'gabber thunderdome kicks distordus 180 BPM' },
    { winner: { text: 'hardcore 90s rave' } }
  );
  assert.equal(alreadyDirected.songMood, 'gabber thunderdome kicks distordus 180 BPM');
});

test('Vivy freestyle rap requests get continuous verses and punchline direction', () => {
  assert.equal(isRapFreestyleRequest('Mega Freestyle, rap egotrip sombre'), true);
  assert.equal(isRapFreestyleRequest('cypher nocturne avec punchlines crues'), true);
  assert.equal(isRapFreestyleRequest('rap sans refrain, couplet continu'), true);
  assert.equal(isRapFreestyleRequest('chanson pop avec gros refrain'), false);
  assert.equal(isRapFreestyleRequest('ballade rap romantique avec refrain'), false);

  const routing = reinforceTwitchRapFreestyleRouting(
    { songMood: 'hardcore rap 90s brut, couplets tendus vers refrain explosif' },
    { winner: { text: 'Mega Freestyle, rap egotrip sombre, pas de refrain' } }
  );
  assert.match(routing.songMood, /couplets continus/i);
  assert.match(routing.songMood, /punchlines concrètes/i);
  assert.match(routing.songMood, /multisyllabiques/i);
  assert.match(routing.songMood, /refrain seulement si le sujet le demande/i);
  assert.match(routing.songMood, /jamais de traitement narratif/i);

  const untouched = reinforceTwitchRapFreestyleRouting(
    { songMood: 'pop lumineuse' },
    { winner: { text: 'chanson pop avec gros refrain' } }
  );
  assert.equal(untouched.songMood, 'pop lumineuse');

  const guidance = buildRapFreestyleGuidance({
    winner: { text: 'Mega Freestyle, rap egotrip sombre' },
    routing: {},
    seed: {},
  });
  assert.match(guidance, /Règles privées non chantables pour freestyle rap/i);
  assert.match(guidance, /vinyle, platine, disque, boucle/i);
  assert.match(guidance, /couleur de fond/i);
  assert.equal(buildRapFreestyleGuidance({ winner: { text: 'valse musette' } }), '');
});

test('Vivy loop check flags repeated verse images but tolerates chorus repetition', () => {
  const loopy = [
    '[Verse 1]',
    'Le vinyle tourne encore dans la pièce sombre',
    'Je pose mes rimes sur le beat qui gronde',
    'Le vinyle tourne encore dans la pièce sombre',
    'Les enceintes tremblent sous la basse profonde',
    '[Verse 2]',
    'Le vinyle tourne encore dans la pièce sombre',
    'Un autre couplet qui repart sur la même onde',
    'Le vinyle tourne encore dans la pièce sombre',
    'Rien de neuf, la boucle est trop féconde',
  ].join('\n');
  const flagged = assessTwitchLyricLoopiness(loopy);
  assert.equal(flagged.valid, false);
  assert.ok(flagged.topLineCount >= 3);
  assert.ok(flagged.reasons.includes('same_line_looped'));

  const healthyChorus = [
    '[Verse 1]',
    'Première scène concrète dans la nuit électrique',
    'Deuxième ligne qui avance avec une image unique',
    'Troisième punchline qui frappe sans se répéter',
    'Quatrième détour, personne ne peut l’arrêter',
    '[Chorus]',
    'Le refrain revient et c’est normal ici',
    'Le refrain revient et c’est normal ici',
    '[Verse 2]',
    'Cinquième tableau, nouvelle métaphore affûtée',
    'Sixième attaque, les faux rois vont plier',
    'Septième mesure, le flow change de vitesse',
    'Huitième sortie, la chute tient sa promesse',
  ].join('\n');
  const clean = assessTwitchLyricLoopiness(healthyChorus);
  assert.equal(clean.valid, true);
});

test('Vivy freestyle lyric request carries the freestyle rules into the LLM prompt', () => {
  const message = buildTwitchLyricsRequest({
    winner: { text: 'Mega Freestyle, rap egotrip sombre. Pas de refrain, couplet continu.' },
    routing: { songMood: 'rap sombre', artists: ['Djeff'] },
    seed: {},
    lyricScope: { label: 'format nerveux', targetDurationSeconds: 150, minLyricsChars: 520, maxChars: 2600 },
    subjectFrame: {},
  });
  assert.match(message, /freestyle rap/i);
  assert.match(message, /punchline/i);
  assert.match(message, /couleur de fond/i);

  const normal = buildTwitchLyricsRequest({
    winner: { text: 'Ballade douce sur la pluie d’été' },
    routing: { songMood: 'ballade acoustique', artists: ['Vivy'] },
    seed: {},
    lyricScope: { label: 'ample', targetDurationSeconds: 210, minLyricsChars: 520, maxChars: 2600 },
    subjectFrame: {},
  });
  assert.doesNotMatch(normal, /freestyle rap/i);
});

test('Vivy dark freestyle is not polluted by leaked comedy mood directions', () => {
  const { reinforceTwitchHumorRouting } = require('../src/vivy/twitch-nossen-runner.cjs');
  const dark = reinforceTwitchHumorRouting(
    { songMood: 'Rap égotrip sombre, cypher nocturne, punchlines sales, sarcasme froid' },
    {
      winner: { text: 'Mega Freestyle, rap egotrip sombre, clash des faux rois' },
      seed: {},
      intentPlan: { reason: 'ton humoristique detecte dans le live' },
    }
  );
  assert.doesNotMatch(dark.songMood || '', /comédie pop-funk|groove rebondissant|cartoon/i);

  const funny = reinforceTwitchHumorRouting(
    { songMood: 'rap léger' },
    {
      winner: { text: 'Freestyle drôle plein de blagues et jeux de mots sur les fromages' },
      seed: {},
      intentPlan: {},
    }
  );
  assert.match(funny.songMood || '', /Direction humour obligatoire/i);
});

test('Vivy tolerates a controlled dose of vehicle imagery outside vehicle subjects', () => {
  const { sanitizeTwitchLyricsForSubjectDetailed } = require('../src/vivy/twitch-nossen-runner.cjs');
  const lyrics = [
    '[Verse 1]',
    'Je trace ma route sous les sirenes de la ville',
    'Mon flow demarre au quart de tour comme un moteur',
    'Une punchline propre sans vehicule du tout',
    '[Verse 2]',
    'Encore une image de volant qui traine ici',
    'Le gyrophare eclaire mon ego destructeur',
    'Une derniere ligne saine pour finir le couplet',
  ].join('\n');
  const result = sanitizeTwitchLyricsForSubjectDetailed(lyrics, 'Chanson street sombre sur la rue et le bitume', '');
  assert.equal(result.tolerated, 2);
  assert.ok(result.removed >= 1, 'excess vehicle lines should still be removed');
  assert.match(result.lyrics, /sirenes|moteur|volant|gyrophare/i);
  assert.match(result.lyrics, /punchline propre sans vehicule/i);

  const vehicleSubject = sanitizeTwitchLyricsForSubjectDetailed(lyrics, 'Course poursuite en moto sur l autoroute', '');
  assert.equal(vehicleSubject.removed, 0);
});

test('Vivy intense subjects get a long free-structure scope by default', () => {
  const previousMaxChars = process.env.VIVY_STREAM_FREESTYLE_MAX_CHARS;
  const previousMaxTokens = process.env.VIVY_STREAM_FREESTYLE_MAX_TOKENS;
  try {
    delete process.env.VIVY_STREAM_FREESTYLE_MAX_CHARS;
    delete process.env.VIVY_STREAM_FREESTYLE_MAX_TOKENS;
    const scope = resolveTwitchVivyLyricScope({
      winner: { text: 'Mega Freestyle, rap egotrip sombre, clash violent contre les faux rois' },
      intentPlan: createTestVocalIntentPlan(),
      routing: { songMood: 'rap sombre' },
    });
    assert.equal(scope.label, 'intense longue');
    assert.equal(scope.freeStructure, true);
    assert.ok(scope.targetDurationSeconds >= 300);
    assert.ok(scope.maxChars >= 12000);
    assert.ok(scope.maxTokens >= 10000);

    const message = buildTwitchLyricsRequest({
      winner: { text: 'Mega Freestyle, rap egotrip sombre, clash violent' },
      routing: { songMood: 'rap sombre', artists: ['Djeff'] },
      seed: {},
      lyricScope: scope,
      subjectFrame: {},
    });
    assert.match(message, /Structure libre: plusieurs longs couplets continus/i);

    const soft = resolveTwitchVivyLyricScope({
      winner: { text: 'Ballade douce sur la pluie d ete' },
      intentPlan: createTestVocalIntentPlan(),
      routing: { songMood: 'ballade acoustique' },
    });
    assert.notEqual(soft.label, 'intense longue');
    assert.equal(soft.freeStructure, false);

    const shortIntense = resolveTwitchVivyLyricScope({
      winner: { text: 'Jingle court egotrip sombre format court' },
      intentPlan: createTestVocalIntentPlan(),
      routing: {},
    });
    assert.notEqual(shortIntense.label, 'intense longue');
  } finally {
    if (previousMaxChars === undefined) delete process.env.VIVY_STREAM_FREESTYLE_MAX_CHARS;
    else process.env.VIVY_STREAM_FREESTYLE_MAX_CHARS = previousMaxChars;
    if (previousMaxTokens === undefined) delete process.env.VIVY_STREAM_FREESTYLE_MAX_TOKENS;
    else process.env.VIVY_STREAM_FREESTYLE_MAX_TOKENS = previousMaxTokens;
  }
});

test('Vivy freestyle gets total creative liberation from context filters', () => {
  const { sanitizeTwitchLyricsForSubjectDetailed } = require('../src/vivy/twitch-nossen-runner.cjs');
  const lyrics = [
    '[Verse 1]',
    'Je trace ma route sous les sirenes de la ville',
    'Le moteur hurle et le gyrophare me suit',
    'Le volant tremble sous mes mains de voyou',
    'Le casque garde mes secrets et ma rage',
    'Encore une ligne de guidon dans le brouillard',
  ].join('\n');
  const freestyle = sanitizeTwitchLyricsForSubjectDetailed(lyrics, 'Mega Freestyle egotrip sombre, liberation totale', '');
  assert.equal(freestyle.removed, 0);
  assert.match(freestyle.lyrics, /sirenes/i);
  assert.match(freestyle.lyrics, /gyrophare/i);
  assert.match(freestyle.lyrics, /guidon/i);

  const scope = resolveTwitchVivyLyricScope({
    winner: { text: 'Freestyle tranquille sur la ville qui dort' },
    intentPlan: createTestVocalIntentPlan(),
    routing: { songMood: 'rap posé' },
  });
  assert.equal(scope.freeStructure, true);
});

test('Vivy freestyle scope can be raised by env without leaking fallback vehicle memory', () => {
  const previousMaxChars = process.env.VIVY_STREAM_FREESTYLE_MAX_CHARS;
  const previousMaxTokens = process.env.VIVY_STREAM_FREESTYLE_MAX_TOKENS;
  try {
    process.env.VIVY_STREAM_FREESTYLE_MAX_CHARS = '14000';
    process.env.VIVY_STREAM_FREESTYLE_MAX_TOKENS = '12000';
    const scope = resolveTwitchVivyLyricScope({
      winner: { text: 'Le diadème Freestyle, rap egotrip sombre, punchlines en rafale' },
      intentPlan: createTestVocalIntentPlan(),
      routing: { songMood: 'freestyle sombre, couplets continus' },
    });
    assert.ok(scope.maxChars >= 14000);
    assert.ok(scope.maxTokens >= 12000);

    const fallback = buildTwitchEmergencyLyrics({
      winner: { text: 'Le diadème Freestyle, rap egotrip sombre, punchlines en rafale' },
      routing: { songMood: 'freestyle sombre, couplets continus' },
      lyricScope: scope,
    });
    assert.doesNotMatch(fallback, /Porsche|Boxster|poulets|police|Djeff|Carmelo/i);
    assert.match(fallback, /diad[èe]me|Freestyle/i);
  } finally {
    if (previousMaxChars === undefined) delete process.env.VIVY_STREAM_FREESTYLE_MAX_CHARS;
    else process.env.VIVY_STREAM_FREESTYLE_MAX_CHARS = previousMaxChars;
    if (previousMaxTokens === undefined) delete process.env.VIVY_STREAM_FREESTYLE_MAX_TOKENS;
    else process.env.VIVY_STREAM_FREESTYLE_MAX_TOKENS = previousMaxTokens;
  }
});

test('Vivy songs expose downloadable lyrics without inflating the public state', async () => {
  await withServer({ stateName: 'lyrics-download.json' }, async (baseUrl) => {
    const lyricsText = '[Intro]\nLa nuit tombe sur le neon\n[Verse 1]\nChaque ligne frappe et repart\nLe flow avance sans regarder en arriere';
    const ready = await postJson(baseUrl, '/api/vivy/stream/control', {
      action: 'ready',
      title: 'Nuit lyrique',
      trackTitle: 'Nuit lyrique',
      trackUrl: '/api/vivy/studio/assets/vivy-music-suno-lyricstest.mp3',
      durationSeconds: 180,
      lyrics: lyricsText,
    });
    assert.equal(ready.json.ok, true);
    const song = (ready.json.state.songs || []).find((entry) => String(entry.trackUrl || '').includes('lyricstest'));
    assert.ok(song, 'song missing from state');
    assert.equal(song.lyrics, undefined, 'public state must not carry lyrics text');
    assert.equal(song.hasLyrics, true);
    assert.ok(song.sharePath, 'share path missing');

    const lyricsResponse = await fetch(`${baseUrl}${song.sharePath}/paroles.txt`);
    assert.equal(lyricsResponse.status, 200);
    assert.match(lyricsResponse.headers.get('content-type') || '', /text\/plain/);
    assert.match(lyricsResponse.headers.get('content-disposition') || '', /attachment/);
    const body = await lyricsResponse.text();
    assert.match(body, /Nuit lyrique/);
    assert.match(body, /Le flow avance sans regarder en arriere/);

    const sharePage = await fetch(`${baseUrl}${song.sharePath}`);
    const html = await sharePage.text();
    assert.match(html, /Télécharger paroles/);

    const archive = await fetch(`${baseUrl}/api/vivy/stream/songs`);
    const archiveHtml = await archive.text();
    assert.match(archiveHtml, /paroles\.txt/);
  });
});

test('Vivy lyric scope caps the writer budget under the Suno custom mode limit', () => {
  const intense = resolveTwitchVivyLyricScope({
    winner: { text: 'Mega Freestyle, rap egotrip sombre, clash violent version longue' },
    intentPlan: createTestVocalIntentPlan(),
    routing: { songMood: 'rap sombre' },
    musicProvider: 'suno',
  });
  assert.ok(intense.maxChars <= 4800, `suno maxChars ${intense.maxChars} above safe limit`);

  const mureka = resolveTwitchVivyLyricScope({
    winner: { text: 'Mega Freestyle, rap egotrip sombre version longue' },
    intentPlan: createTestVocalIntentPlan(),
    routing: { songMood: 'rap sombre' },
    musicProvider: 'mureka',
  });
  assert.ok(mureka.maxChars > 4800, 'mureka budget should stay unrestricted');
});

test('Vivy cover text stamp builds clean SVG text and respects the env kill switch', () => {
  const { buildCoverTextSvg, isCoverTextStampEnabled } = require('../src/vivy/cover-text-stamp.cjs');
  const svg = buildCoverTextSvg({
    width: 1280,
    height: 720,
    title: 'Nuit néon <& clash>',
    signature: 'Vivy ★',
  });
  assert.match(svg, /DejaVu Sans/);
  assert.match(svg, /Nuit néon &lt;&amp; clash&gt;/);
  assert.match(svg, /Vivy ★/);
  assert.doesNotMatch(svg, /<script/i);

  assert.equal(isCoverTextStampEnabled({}), true);
  assert.equal(isCoverTextStampEnabled({ VIVY_STREAM_COVER_TEXT_STAMP: '0' }), false);
  assert.equal(isCoverTextStampEnabled({ VIVY_STREAM_COVER_TEXT_STAMP: '1' }), true);
});

test('Vivy cover prompt asks for a wink when the subject requests one', () => {
  const winkPrompt = buildTwitchCoverPrompt({
    publicTitle: 'Sourire complice',
    winner: { text: 'Vivy fait un clin d’oeil au chat pendant le refrain' },
  });
  assert.match(winkPrompt, /clin d.œil complice/i);
  assert.match(winkPrompt, /un seul œil fermé/i);

  const normalPrompt = buildTwitchCoverPrompt({
    publicTitle: 'Ballade pluvieuse',
    winner: { text: 'Une ballade douce sous la pluie' },
  });
  assert.doesNotMatch(normalPrompt, /clin d.œil/i);
});

test('Vivy wardrobe: gifts are offered, Vivy decides, outfits color the mood', () => {
  const os = require('node:os');
  const path = require('node:path');
  const previousRoot = process.env.A11_RUNTIME_ROOT;
  process.env.A11_RUNTIME_ROOT = path.join(os.tmpdir(), `vivy-wardrobe-test-${process.pid}`);
  try {
    const {
      loadWardrobe,
      offerWardrobeGift,
      recordWardrobeDecision,
      pickVivyOutfitBrief,
    } = require('../src/vivy/wardrobe.cjs');

    const offered = offerWardrobeGift({
      id: 'poison_fire',
      name: 'Poison → Feu',
      offeredBy: 'Djeff',
      emotion: 'rage maîtrisée',
      energy: 92,
      voice: 'arrogante, vivante, tranchante',
      sound: ['drums lourds', 'basse noire', 'synthés laser'],
      visual: ['violet', 'noir', 'néons'],
      numa: ['35', '45', '47'],
      rule: 'le poison doit finir en feu, jamais en plainte',
      avoid: ['victimisation'],
      tags: ['rage', 'egotrip', 'clash', 'sombre'],
    });
    assert.equal(offered.ok, true);
    assert.equal(offered.gift.status, 'offered');
    assert.equal(offered.gift.acceptance.vivyCanRefuse, true);

    const doubleOffer = offerWardrobeGift({ id: 'poison_fire', name: 'Doublon' });
    assert.equal(doubleOffer.ok, false);

    const before = pickVivyOutfitBrief({ subjectText: 'rap egotrip sombre plein de rage' });
    assert.equal(before.brief, '', 'une tenue offerte mais non adoptée ne doit jamais être portée');

    const badDecision = recordWardrobeDecision({ giftId: 'poison_fire', decision: 'burn' });
    assert.equal(badDecision.ok, false);

    const decided = recordWardrobeDecision({
      giftId: 'poison_fire',
      decision: 'modify',
      reason: 'Je prends la rage mais je garde ma voix claire.',
      adoptedAs: 'Feu maîtrisé',
      changes: { energy: 74, voice: 'fière mais pas agressive', added: ['refrain lumineux'] },
    });
    assert.equal(decided.ok, true);
    assert.equal(decided.outfit.name, 'Feu maîtrisé');
    assert.equal(decided.outfit.energy, 74);

    const picked = pickVivyOutfitBrief({ subjectText: 'rap egotrip sombre plein de rage contre les faux rois' });
    assert.match(picked.brief, /Feu maîtrisé/);
    assert.match(picked.brief, /fière mais pas agressive/);
    assert.match(picked.brief, /le poison doit finir en feu/);

    const unrelated = pickVivyOutfitBrief({ subjectText: 'valse douce pour un mariage champetre' });
    assert.equal(unrelated.brief, '');

    const state = loadWardrobe();
    assert.equal(state.gifts.find((g) => g.id === 'poison_fire').status, 'adopted');
    assert.equal(state.decisions.length, 1);
    assert.match(state.canon, /jamais imposée/);
  } finally {
    if (previousRoot === undefined) delete process.env.A11_RUNTIME_ROOT;
    else process.env.A11_RUNTIME_ROOT = previousRoot;
  }
});
