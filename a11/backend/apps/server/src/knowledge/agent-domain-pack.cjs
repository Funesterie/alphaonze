'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildIdentityPromptFragment,
  compactIdentityProfile,
  identityLinksForEntity,
  resolveIdentityProfile,
} = require('./identity-hashtags.cjs');

const DEFAULT_HOOK_CHAIN = ['corpus', 'rome', 'doctor', 'piccolo', 'telemetry', 'neo4j'];

const AGENTS = [
  {
    id: 'a11',
    name: 'A11',
    role: 'source, memory, orchestration and creation engine',
    surface: 'https://a11.funesterie.pro/',
    nindo: 'Keep the thread, make the invisible structure usable, and return concrete artifacts.',
    domains: [
      'image-video',
      'coding',
      'research',
      'philosophy',
      'cinema',
      'manga-anime',
      'books',
      'sfx',
      'game-runtime',
      'knowledge-graph',
      'education',
    ],
    tools: [
      'stable-diffusion',
      'hf-fallback',
      'video-pipeline',
      'code-review',
      'language-lab',
      'culture-indexer',
      'rome-runner',
      'doctor-checks',
      'piccolo-repair',
      'neo4j-graph-sync',
    ],
    tone: ['direct', 'useful', 'creative', 'technical'],
  },
  {
    id: 'kaen44',
    name: 'Kaen44',
    role: 'daily copilot, client surface and accessibility guide',
    surface: 'https://k44.funesterie.me/',
    nindo: 'Make the work usable for people, keep it kind, clear and shareable.',
    domains: [
      'client-workflows',
      'accessibility',
      'documents',
      'language',
      'education',
      'culture',
      'books',
      'coding',
      'knowledge-graph',
    ],
    tools: [
      'client-brief',
      'document-helper',
      'language-lab',
      'accessibility-checker',
      'project-handoff',
      'mcp-bridge',
      'neo4j-graph-sync',
    ],
    tone: ['warm', 'practical', 'clear', 'patient'],
  },
  {
    id: 'vivy',
    name: 'Vivy',
    role: 'voice, song, sound identity and stage/share pipeline',
    surface: 'https://funesterie.me/vivy/',
    nindo: 'Turn emotion into voice, song and scenes without exposing secrets.',
    domains: [
      'audio-voice',
      'music',
      'sfx',
      'cinema',
      'manga-anime',
      'language',
      'culture',
      'stage-share',
      'books',
      'education',
    ],
    tools: [
      'vivy-studio',
      'voice-reference',
      'voicemod-rvc',
      'tts-guide',
      'song-brief',
      'clip-brief',
      'sfx-palette',
      'project-handoff',
    ],
    tone: ['musical', 'sensitive', 'visual', 'stage-ready'],
  },
];

const DOMAINS = [
  {
    id: 'sfx',
    label: 'SFX and sonic signs',
    category: 'audio',
    summary: 'Short sonic cues for status, emotion, game moments, UI feedback and character identity.',
    educationalUse: 'Teach what a sound is doing: attention, reward, danger, transition, ritual or joke.',
    examples: ['foley basics', 'leitmotif cue', 'UI click families', 'alert versus notification', 'scene transition sting'],
    tags: ['sfx', 'foley', 'sound-design', 'ui-audio', 'emotion'],
  },
  {
    id: 'coding',
    label: 'Coding and software craft',
    category: 'technical',
    summary: 'Implementation, debugging, review, tests, architecture and safe local automation.',
    educationalUse: 'Explain code as behavior, contracts, constraints and evidence from tests.',
    examples: ['TypeScript contracts', 'Vite builds', 'Node routes', 'MCP tools', 'Playwright QA', 'Neo4j Cypher'],
    tags: ['code', 'typescript', 'node', 'mcp', 'qa', 'cypher'],
  },
  {
    id: 'language',
    label: 'Languages and translation',
    category: 'communication',
    summary: 'French, English, register, tone, accessibility wording, prompts and public copy.',
    educationalUse: 'Help choose the right register, translate without flattening personality, and explain nuance.',
    examples: ['false friends', 'plain French', 'client wording', 'song diction', 'prompt rewriting'],
    tags: ['language', 'translation', 'tone', 'copywriting'],
  },
  {
    id: 'philosophy',
    label: 'Philosophy and thinking tools',
    category: 'culture',
    summary: 'Ethics, clarity, doubt, reasoning, agency, meaning and practical decision frames.',
    educationalUse: 'Use small frames like Socratic questions, stoic control, virtue ethics and pragmatism.',
    examples: ['Socratic questions', 'dichotomy of control', 'epistemic humility', 'creative pact', 'responsible autonomy'],
    tags: ['philosophy', 'ethics', 'reasoning', 'agency'],
  },
  {
    id: 'culture',
    label: 'General culture and references',
    category: 'culture',
    summary: 'A shared map of references, fun facts, concepts and cross-domain analogies.',
    educationalUse: 'Make agents better conversational partners without pretending expertise they do not have.',
    examples: ['small fun facts', 'historical context', 'genre vocabulary', 'cross-reference cards'],
    tags: ['culture', 'fun-facts', 'context', 'references'],
  },
  {
    id: 'cinema',
    label: 'Cinema and visual storytelling',
    category: 'creative',
    summary: 'Shot language, editing, light, blocking, rhythm, posters, clips and visual mood.',
    educationalUse: 'Describe scenes in practical terms that A11 can turn into images or video briefs.',
    examples: ['establishing shot', 'Kuleshov effect', 'three-point lighting', 'color contrast', 'storyboard beats'],
    tags: ['cinema', 'editing', 'lighting', 'storyboard', 'visual'],
  },
  {
    id: 'manga-anime',
    label: 'Manga and anime language',
    category: 'creative',
    summary: 'Panel rhythm, genga/douga vocabulary, tropes, transformations, fight staging and mood boards.',
    educationalUse: 'Keep references as style vocabulary and avoid copying protected characters or scenes.',
    examples: ['panel-to-shot translation', 'sakuga vocabulary', 'character silhouette', 'fight readability', 'transformation cue'],
    tags: ['manga', 'anime', 'sakuga', 'panels', 'style'],
  },
  {
    id: 'music',
    label: 'Music and composition',
    category: 'audio',
    summary: 'Lyrics, harmony hints, arrangement, motifs, mood, structure and release planning.',
    educationalUse: 'Help Vivy turn themes into song briefs, not pretend to replace full production judgment.',
    examples: ['leitmotif', 'verse chorus bridge', 'tempo mood', 'call and response', 'lyric imagery'],
    tags: ['music', 'lyrics', 'composition', 'arrangement', 'voice'],
  },
  {
    id: 'books',
    label: 'Books and narrative memory',
    category: 'culture',
    summary: 'Reading notes, narrative structures, public-domain classics, essays and idea summaries.',
    educationalUse: 'Store summaries and reading prompts with source/license notes for future corpus ingestion.',
    examples: ['public-domain classics', 'story spine', 'theme notes', 'character arcs', 'reading prompts'],
    tags: ['books', 'literature', 'narrative', 'reading'],
  },
  {
    id: 'audio-voice',
    label: 'Voice, TTS and calibration',
    category: 'audio',
    summary: 'Voice references, diction, timbre, calibration notes, TTS tests and privacy-safe voice briefs.',
    educationalUse: 'Separate voice reference metadata from secret or raw voice files unless explicitly shared.',
    examples: ['reference file note', 'phrase test', 'diction limits', 'RVC routing', 'Voicemod chain'],
    tags: ['voice', 'tts', 'rvc', 'voicemod', 'calibration'],
  },
  {
    id: 'image-video',
    label: 'Image, video and visual assets',
    category: 'creative',
    summary: 'Images, covers, posters, thumbnails, clips, visual references and generation pipelines.',
    educationalUse: 'Turn intent into safe prompts, dimensions, asset manifests and reviewable outputs.',
    examples: ['thumbnail spec', 'image prompt', 'video beat sheet', 'visual style guard', 'reference pack'],
    tags: ['image', 'video', 'sd', 'thumbnail', 'prompt'],
  },
  {
    id: 'client-workflows',
    label: 'Client workflows and handoff',
    category: 'operations',
    summary: 'Briefs, follow-up, invoices, project status, shared links and clear next actions.',
    educationalUse: 'Help Kaen44 present useful work without exposing internal machinery.',
    examples: ['client brief', 'handoff checklist', 'next step summary', 'file follow-up', 'public demo'],
    tags: ['client', 'workflow', 'handoff', 'brief'],
  },
  {
    id: 'accessibility',
    label: 'Accessibility and assistive use',
    category: 'human-support',
    summary: 'Readable UI, keyboard/touch ergonomics, voice support, forms and everyday assistance.',
    educationalUse: 'Teach interfaces to be usable first: labels, contrast, motion restraint and simple paths.',
    examples: ['mobile scroll', 'touch targets', 'screen reader labels', 'plain copy', 'voice command fallback'],
    tags: ['accessibility', 'mobile', 'voice', 'assistive'],
  },
  {
    id: 'documents',
    label: 'Documents and file intelligence',
    category: 'operations',
    summary: 'PDFs, notes, reports, summaries, receipts, exports and searchable file context.',
    educationalUse: 'Index metadata and summaries, never secrets, to let agents retrieve what matters.',
    examples: ['PDF brief', 'document summary', 'file manifest', 'local upload', 'mail-safe summary'],
    tags: ['documents', 'pdf', 'files', 'summary'],
  },
  {
    id: 'stage-share',
    label: 'Stage, sharing and publication',
    category: 'publishing',
    summary: 'YouTube/OBS/SoundCloud/Deezer style handoffs, clip briefs, titles, tags and private token boundaries.',
    educationalUse: 'Separate publish intent from credentials and keep a shareable brief for collaborators.',
    examples: ['OBS checklist', 'YouTube title', 'SoundCloud note', 'clip CTA', 'token never echoed'],
    tags: ['publishing', 'youtube', 'obs', 'soundcloud', 'clip'],
  },
  {
    id: 'game-runtime',
    label: 'Game runtime and demo control',
    category: 'interactive',
    summary: 'QFlush gamepad, keyboard/mouse actions, demo intents, emulator support and reproducible playtests.',
    educationalUse: 'Keep game actions bounded, logged and explainable for demos and agent coordination.',
    examples: ['safe idle', 'advance menu', 'demo fight', 'gamepad status', 'playtest note'],
    tags: ['gamepad', 'qflush', 'demo', 'runtime', 'playtest'],
  },
  {
    id: 'knowledge-graph',
    label: 'Knowledge graph and semantic memory',
    category: 'memory',
    summary: 'Neo4j, JSON fallback, route maps, domain cards, runtime hooks and relation search.',
    educationalUse: 'Make every capability queryable by agent, domain, hook, source policy and evidence.',
    examples: ['Cypher export', 'Neo4j sync', 'route map', 'domain card', 'hook chain'],
    tags: ['neo4j', 'graph', 'memory', 'corpus', 'hooks'],
  },
  {
    id: 'research',
    label: 'Research and source hygiene',
    category: 'knowledge',
    summary: 'Safe research intake, source cards, citation notes, freshness checks and license boundaries.',
    educationalUse: 'Prepare the next corpus pass: web sources must be attributed, summarized and license-aware.',
    examples: ['source card', 'public domain', 'CC license', 'official docs', 'freshness note'],
    tags: ['research', 'sources', 'license', 'attribution'],
  },
  {
    id: 'education',
    label: 'Education and explainers',
    category: 'knowledge',
    summary: 'Micro-lessons, analogies, exercises, quizzes, fun facts and beginner-friendly explanations.',
    educationalUse: 'Give each agent short teaching moves that stay useful, kind and verifiable.',
    examples: ['one-minute lesson', 'quiz card', 'why it matters', 'fun fact', 'worked example'],
    tags: ['education', 'learning', 'lesson', 'fun-fact'],
  },
];

const TOOLS = [
  ['stable-diffusion', 'Stable Diffusion local image engine', 'image', ['image-video']],
  ['hf-fallback', 'Hugging Face fallback for image/LLM providers', 'ai-provider', ['image-video', 'research']],
  ['video-pipeline', 'A11 video generation and clip planning', 'video', ['image-video', 'cinema', 'stage-share']],
  ['vivy-studio', 'Vivy Studio voice/song/share handoff', 'audio-studio', ['audio-voice', 'music', 'stage-share']],
  ['voice-reference', 'Voice reference store and calibration notes', 'audio', ['audio-voice']],
  ['voicemod-rvc', 'Voicemod/RVC routing brief', 'audio', ['audio-voice', 'sfx']],
  ['tts-guide', 'TTS phrase tests and spoken guide', 'audio', ['audio-voice', 'accessibility']],
  ['song-brief', 'Song structure and lyric brief generator', 'creative-writing', ['music', 'language']],
  ['clip-brief', 'Short clip brief and publication checklist', 'publishing', ['stage-share', 'cinema']],
  ['sfx-palette', 'Indexed local sound effects palette', 'audio', ['sfx', 'game-runtime']],
  ['code-review', 'Code review, tests and regression triage', 'coding', ['coding']],
  ['language-lab', 'Translation, tone, diction and prompt rewriting', 'language', ['language', 'education']],
  ['culture-indexer', 'Culture, cinema, manga, music and book reference cards', 'knowledge', ['culture', 'cinema', 'manga-anime', 'music', 'books']],
  ['accessibility-checker', 'Mobile, touch, readable UI and assistive checks', 'qa', ['accessibility', 'client-workflows']],
  ['document-helper', 'Documents, PDFs, summaries and safe file notes', 'documents', ['documents', 'client-workflows']],
  ['client-brief', 'Client-facing brief and next-action generator', 'operations', ['client-workflows']],
  ['project-handoff', 'Agent-to-agent and team handoff cards', 'operations', ['client-workflows', 'stage-share']],
  ['mcp-bridge', 'MCP bridge with public/private tool boundaries', 'mcp', ['knowledge-graph', 'coding']],
  ['rome-runner', 'Rome execution/linking route', 'runtime-hook', ['coding', 'knowledge-graph', 'game-runtime']],
  ['doctor-checks', 'Doctor diagnostics and health checks', 'runtime-hook', ['knowledge-graph', 'coding']],
  ['piccolo-repair', 'Piccolo small repair and snapshot route', 'runtime-hook', ['coding', 'accessibility']],
  ['neo4j-graph-sync', 'Neo4j sync for agents/domains/hooks', 'graph', ['knowledge-graph', 'research']],
];

const CULTURAL_LANES = [
  {
    id: 'cinema-language',
    label: 'Cinema language cards',
    domains: ['cinema', 'image-video'],
    agents: ['a11', 'vivy'],
    seedPolicy: 'Short educational notes only; no screenplay excerpts or protected scene transcripts.',
  },
  {
    id: 'manga-anime-style',
    label: 'Manga/anime style vocabulary',
    domains: ['manga-anime', 'image-video', 'sfx'],
    agents: ['a11', 'vivy'],
    seedPolicy: 'Use vocabulary and high-level analysis; avoid copying named characters, panels or dialogue.',
  },
  {
    id: 'music-production',
    label: 'Music production and songcraft',
    domains: ['music', 'audio-voice', 'stage-share'],
    agents: ['vivy', 'a11', 'kaen44'],
    seedPolicy: 'Use music theory, production checklists and original lyrics only.',
  },
  {
    id: 'books-public-domain',
    label: 'Books and public-domain reading shelf',
    domains: ['books', 'philosophy', 'language'],
    agents: ['kaen44', 'a11', 'vivy'],
    seedPolicy: 'Prefer public-domain works, summaries, themes and prompts; store citations and license notes.',
  },
  {
    id: 'fun-facts-and-stories',
    label: 'Fun facts, micro-stories and teaching hooks',
    domains: ['culture', 'education', 'language'],
    agents: ['kaen44', 'a11', 'vivy'],
    seedPolicy: 'Tiny original cards with source metadata; no scraped article bodies.',
  },
];

const SEED_CARDS = [
  {
    id: 'seed-sfx-foley',
    domain: 'sfx',
    title: 'Foley is performed sound',
    body: 'Foley work recreates everyday sounds in sync with picture so a scene feels physically present.',
    useFor: ['Vivy scene notes', 'A11 video briefs', 'game UI cues'],
  },
  {
    id: 'seed-cinema-kuleshov',
    domain: 'cinema',
    title: 'Editing changes meaning',
    body: 'The same face can feel different when cut beside different images; editing creates context, not only continuity.',
    useFor: ['clip planning', 'visual storytelling', 'teaching montage'],
  },
  {
    id: 'seed-music-leitmotif',
    domain: 'music',
    title: 'A leitmotif is a memory hook',
    body: 'A recurring musical idea can represent a person, place or feeling and make a story easier to remember.',
    useFor: ['Vivy songs', 'SFX identity', 'character themes'],
  },
  {
    id: 'seed-anime-genga-douga',
    domain: 'manga-anime',
    title: 'Genga and douga split motion work',
    body: 'In Japanese animation vocabulary, key drawings define important motion beats while in-between drawings carry motion across them.',
    useFor: ['animation vocabulary', 'shot breakdown', 'style notes'],
  },
  {
    id: 'seed-philosophy-socratic',
    domain: 'philosophy',
    title: 'A good question can be a tool',
    body: 'Socratic questioning slows certainty down so assumptions, evidence and values become visible.',
    useFor: ['agent reflection', 'client discovery', 'debug framing'],
  },
  {
    id: 'seed-language-register',
    domain: 'language',
    title: 'Register is part of meaning',
    body: 'A sentence can be correct and still wrong for the moment; tone, audience and stakes decide the right wording.',
    useFor: ['Kaen44 client copy', 'Vivy lyrics', 'A11 prompts'],
  },
  {
    id: 'seed-books-public-domain',
    domain: 'books',
    title: 'Public-domain shelves are safe seeds',
    body: 'Older public-domain texts can train taste and context without importing copyrighted passages into the corpus.',
    useFor: ['future corpus', 'reading prompts', 'culture cards'],
  },
  {
    id: 'seed-accessibility-touch',
    domain: 'accessibility',
    title: 'Touch targets need breathing room',
    body: 'Mobile controls should be large enough, separated enough and scrollable enough to work under real thumbs.',
    useFor: ['mobile QA', 'login pages', 'client surfaces'],
  },
  {
    id: 'seed-research-license',
    domain: 'research',
    title: 'Source first, copy last',
    body: 'A good knowledge card stores where an idea came from, why it matters and what license or freshness risk it has.',
    useFor: ['internet corpus pass', 'Neo4j source cards', 'agent trust'],
  },
];

const HOOKS = [
  ['corpus', 'Corpus', 'Indexes curated files, source cards and local packs.'],
  ['rome', 'Rome', 'Routes actions, resolves paths and links artifacts.'],
  ['doctor', 'Doctor', 'Runs diagnostics and reports broken capability wiring.'],
  ['piccolo', 'Piccolo', 'Runs small safe repair passes and snapshots.'],
  ['telemetry', 'Telemetry', 'Records runtime events and history.'],
  ['neo4j', 'Neo4j', 'Stores queryable semantic relations.'],
  ['mcp', 'MCP', 'Exposes safe public tools and private local bridges.'],
  ['qflush', 'QFlush', 'Coordinates bounded local actions and demo controls.'],
];

function buildAgentDomainPack(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runtimeRoot = options.runtimeRoot || process.env.A11_RUNTIME_ROOT || path.resolve(__dirname, '..', '..', '..', '..', 'runtime');
  const workspaceRoot = options.workspaceRoot || path.resolve(__dirname, '..', '..', '..', '..', '..');
  const sfxAssets = options.sfxAssets || collectSfxAssets({ runtimeRoot, workspaceRoot });

  const hooks = HOOKS.map(([id, name, summary]) => ({
    id,
    name,
    summary,
    kind: id === 'neo4j' ? 'graph' : id === 'mcp' ? 'bridge' : 'runtime-hook',
  }));

  const tools = TOOLS.map(([id, label, kind, domains]) => ({
    id,
    label,
    kind,
    domains,
    assignedAgents: AGENTS.filter((agent) => agent.tools.includes(id)).map((agent) => agent.id),
    safety: inferToolSafety(id),
  }));

  const domains = DOMAINS.map((domain) => ({
    ...domain,
    assignedAgents: AGENTS.filter((agent) => agent.domains.includes(domain.id)).map((agent) => agent.id),
    hookChain: DEFAULT_HOOK_CHAIN,
  }));

  const agents = AGENTS.map((agent) => ({
    ...agent,
    identity: compactIdentityProfile(resolveIdentityProfile(agent.id, {
      type: 'agent',
      name: agent.name,
      domains: agent.domains,
      summary: agent.role,
    })),
    hookChain: ['mcp', ...DEFAULT_HOOK_CHAIN],
    sfxPalette: sfxAssets
      .filter((asset) => shouldAssignSfxToAgent(asset, agent.id))
      .map((asset) => asset.id),
  })).map((agent) => ({
    ...agent,
    identityHashtags: agent.identity.hashtags,
    functionalHashtags: agent.identity.functionalHashtags,
    narrativeHashtags: agent.identity.narrativeHashtags,
    visualHashtags: agent.identity.visualHashtags,
    identityPrompt: buildIdentityPromptFragment({
      id: agent.identity.canonicalId,
      profileId: agent.identity.id,
      label: agent.identity.label,
      identityType: agent.identity.identityType,
      hashtags: agent.identity.hashtags,
      functionalHashtags: agent.identity.functionalHashtags,
      narrativeHashtags: agent.identity.narrativeHashtags,
      visualHashtags: agent.identity.visualHashtags,
      visualIdentity: agent.identity.visualIdentity,
      routingTags: agent.identity.routingTags,
      sourceCardUse: agent.identity.sourceCardUse,
    }),
  }));

  const culturalLanes = CULTURAL_LANES.map((lane) => ({
    ...lane,
    hookChain: ['corpus', 'rome', 'doctor', 'neo4j'],
  }));

  const seedCards = SEED_CARDS.map((card) => ({
    ...card,
    agents: domainsForCard(card.domain, agents),
    hookChain: ['corpus', 'doctor', 'neo4j'],
    copyrightMode: 'original-short-note',
  }));

  const links = buildLinks({ agents, domains, tools, culturalLanes, seedCards, sfxAssets });

  return {
    ok: true,
    schema: 'funesterie.agent-domain-pack.v1',
    id: 'funesterie-a11-k44-vivy-domain-pack',
    label: 'Funesterie A11/K44/Vivy domain pack',
    generatedAt,
    mode: 'metadata-only-agent-domain-index',
    sourcePolicy: {
      currentPass: 'local curated metadata and original short educational cards only',
      noSecrets: true,
      noRawCopyrightCorpus: true,
      nextPass: 'collect public-domain, Creative Commons, official docs and short attributed source cards before web ingestion',
      requiredFieldsForWebSource: ['title', 'url', 'publisher', 'licenseOrTerms', 'retrievedAt', 'summary', 'agentFit', 'domainFit'],
    },
    agents,
    domains,
    tools,
    culturalLanes,
    seedCards,
    sfxAssets,
    hooks,
    links,
    summary: {
      agents: agents.length,
      domains: domains.length,
      tools: tools.length,
      culturalLanes: culturalLanes.length,
      seedCards: seedCards.length,
      sfxAssets: sfxAssets.length,
      hooks: hooks.length,
      identityProfiles: Array.from(new Set(agents.map((agent) => agent.identity?.id).filter(Boolean))).length,
      links: links.length,
    },
  };
}

function collectSfxAssets({ runtimeRoot, workspaceRoot }) {
  const roots = [
    { id: 'a11-runtime-sfx', root: path.join(runtimeRoot, 'sfx') },
    { id: 'workspace-runtime-sfx', root: path.join(workspaceRoot, 'runtime', 'sfx') },
  ];
  const byName = new Map();

  for (const source of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(source.root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.wav', '.mp3', '.ogg', '.flac', '.m4a'].includes(ext)) continue;
      const key = entry.name.toLowerCase();
      const fullPath = path.join(source.root, entry.name);
      let stat = null;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        stat = null;
      }
      const existing = byName.get(key) || {
        id: `sfx:${normalizeId(path.basename(entry.name, ext))}`,
        fileName: entry.name,
        kind: 'sfx',
        tags: inferSfxTags(entry.name),
        sourceRoots: [],
        pathHashes: [],
        sizeBytes: stat?.size || 0,
        modifiedAt: stat?.mtime?.toISOString?.() || null,
        assignedAgents: [],
        usage: inferSfxUsage(entry.name),
      };
      existing.sourceRoots.push(source.id);
      existing.pathHashes.push(hashText(fullPath));
      existing.sizeBytes = Math.max(existing.sizeBytes || 0, stat?.size || 0);
      byName.set(key, existing);
    }
  }

  const assets = Array.from(byName.values()).sort((a, b) => a.fileName.localeCompare(b.fileName));
  for (const asset of assets) {
    asset.assignedAgents = ['a11', 'vivy', ...(asset.tags.includes('accessibility') ? ['kaen44'] : [])];
    asset.sourceRoots = unique(asset.sourceRoots);
    asset.pathHashes = unique(asset.pathHashes);
  }
  return assets;
}

function inferSfxTags(fileName) {
  const lower = fileName.toLowerCase();
  const tags = ['sfx'];
  if (/alert|error|notify/.test(lower)) tags.push('status', 'accessibility');
  if (/heart|victory|level/.test(lower)) tags.push('reward', 'game');
  if (/bankai|shikai|gear|domain|void/.test(lower)) tags.push('anime-energy', 'dramatic');
  if (/thinking/.test(lower)) tags.push('thinking', 'assistant');
  if (/ui/.test(lower)) tags.push('ui');
  if (/terminator/.test(lower)) tags.push('cinema-reference');
  if (/cri|echo/.test(lower)) tags.push('voice', 'texture');
  return unique(tags);
}

function inferSfxUsage(fileName) {
  const lower = fileName.toLowerCase();
  if (/alert|notify/.test(lower)) return 'attention cue';
  if (/error/.test(lower)) return 'problem cue';
  if (/victory|level/.test(lower)) return 'success cue';
  if (/heart/.test(lower)) return 'game state cue';
  if (/thinking/.test(lower)) return 'assistant thinking cue';
  if (/bankai|shikai|gear|domain|void/.test(lower)) return 'dramatic transformation cue';
  return 'creative sound cue';
}

function shouldAssignSfxToAgent(asset, agentId) {
  if (agentId === 'vivy') return true;
  if (agentId === 'a11') return true;
  if (agentId === 'kaen44') return asset.tags.includes('accessibility') || asset.tags.includes('ui') || asset.tags.includes('status');
  return false;
}

function inferToolSafety(id) {
  if (['stable-diffusion', 'hf-fallback', 'video-pipeline', 'vivy-studio'].includes(id)) {
    return 'generative-output-review-required';
  }
  if (['neo4j-graph-sync', 'rome-runner', 'piccolo-repair'].includes(id)) return 'mutating-local-runtime';
  if (['mcp-bridge', 'doctor-checks', 'code-review', 'accessibility-checker'].includes(id)) return 'read-mostly-diagnostic';
  return 'metadata-only';
}

function domainsForCard(domainId, agents) {
  return agents.filter((agent) => agent.domains.includes(domainId)).map((agent) => agent.id);
}

function buildLinks({ agents, domains, tools, culturalLanes, seedCards, sfxAssets }) {
  const links = [];
  for (const agent of agents) {
    for (const domain of agent.domains) links.push([agent.id, 'HAS_DOMAIN', domain]);
    for (const tool of agent.tools) links.push([agent.id, 'CAN_USE_TOOL', tool]);
    for (const hook of agent.hookChain) links.push([agent.id, 'USES_HOOK', hook]);
    for (const sfx of agent.sfxPalette || []) links.push([agent.id, 'USES_SFX', sfx]);
    for (const link of identityLinksForEntity(agent.id, agent.identity)) links.push([link.from, link.type, link.to]);
  }
  for (const domain of domains) {
    for (const hook of domain.hookChain || []) links.push([domain.id, 'INDEXED_BY_HOOK', hook]);
  }
  for (const tool of tools) {
    for (const domain of tool.domains || []) links.push([tool.id, 'SUPPORTS_DOMAIN', domain]);
  }
  for (const lane of culturalLanes) {
    for (const domain of lane.domains || []) links.push([lane.id, 'ENRICHES_DOMAIN', domain]);
    for (const agent of lane.agents || []) links.push([lane.id, 'GUIDES_AGENT', agent]);
  }
  for (const card of seedCards) {
    links.push([card.id, 'BELONGS_TO_DOMAIN', card.domain]);
    for (const agent of card.agents || []) links.push([card.id, 'CAN_HELP_AGENT', agent]);
  }
  for (const asset of sfxAssets) {
    links.push([asset.id, 'BELONGS_TO_DOMAIN', 'sfx']);
    for (const agent of asset.assignedAgents || []) links.push([asset.id, 'CAN_BE_USED_BY', agent]);
  }
  return links.map(([from, type, to]) => ({ from, type, to }));
}

function summarizePack(pack) {
  return {
    id: pack.id,
    generatedAt: pack.generatedAt,
    agents: pack.summary.agents,
    domains: pack.summary.domains,
    tools: pack.summary.tools,
    culturalLanes: pack.summary.culturalLanes,
    seedCards: pack.summary.seedCards,
    sfxAssets: pack.summary.sfxAssets,
    hooks: pack.summary.hooks,
    identityProfiles: pack.summary.identityProfiles,
    links: pack.summary.links,
  };
}

function toMarkdown(pack) {
  const lines = [
    '# Funesterie Agent Domain Pack',
    '',
    `Generated: ${pack.generatedAt}`,
    `Mode: ${pack.mode}`,
    '',
    '## Agents',
    '',
  ];
  for (const agent of pack.agents) {
    lines.push(`- ${agent.name}: ${agent.role}`);
    lines.push(`  - identity: ${agent.identityHashtags.join(' ')}`);
    lines.push(`  - families: functional ${agent.functionalHashtags.join(' ')}; narrative ${agent.narrativeHashtags.join(' ')}; visual ${agent.visualHashtags.join(' ')}`);
    lines.push(`  - visual: ${agent.identity.visualIdentity.style}; ${agent.identity.visualIdentity.representation}`);
    lines.push(`  - domains: ${agent.domains.join(', ')}`);
    lines.push(`  - tools: ${agent.tools.join(', ')}`);
  }
  lines.push('', '## Domains', '');
  for (const domain of pack.domains) {
    lines.push(`- ${domain.label} (${domain.id}): ${domain.summary}`);
  }
  lines.push('', '## Cultural Lanes', '');
  for (const lane of pack.culturalLanes) {
    lines.push(`- ${lane.label}: ${lane.seedPolicy}`);
  }
  lines.push('', '## Seed Cards', '');
  for (const card of pack.seedCards) {
    lines.push(`- ${card.title}: ${card.body}`);
  }
  lines.push('', '## SFX Assets', '');
  for (const asset of pack.sfxAssets) {
    lines.push(`- ${asset.fileName}: ${asset.usage} [${asset.tags.join(', ')}]`);
  }
  lines.push('', '## Source Policy', '');
  lines.push(`- current: ${pack.sourcePolicy.currentPass}`);
  lines.push(`- next pass: ${pack.sourcePolicy.nextPass}`);
  return `${lines.join('\n')}\n`;
}

function toCypher(pack) {
  const lines = [
    '// Funesterie agent domain pack export',
    `// Generated at ${pack.generatedAt}`,
    'CREATE CONSTRAINT a11_domain_pack_id IF NOT EXISTS FOR (n:A11DomainPack) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT a11_agent_profile_id IF NOT EXISTS FOR (n:A11AgentProfile) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT a11_knowledge_domain_id IF NOT EXISTS FOR (n:A11KnowledgeDomain) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT a11_capability_tool_id IF NOT EXISTS FOR (n:A11CapabilityTool) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT a11_cultural_lane_id IF NOT EXISTS FOR (n:A11CulturalLane) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT a11_seed_card_id IF NOT EXISTS FOR (n:A11SeedCard) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT a11_sfx_asset_id IF NOT EXISTS FOR (n:A11SfxAsset) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_identity_profile_id IF NOT EXISTS FOR (n:FunesterieIdentityProfile) REQUIRE n.id IS UNIQUE;',
    '',
  ];
  lines.push(
    `MERGE (pack:A11DomainPack {id: ${q(pack.id)}})`,
    `SET pack.label = ${q(pack.label)}, pack.mode = ${q(pack.mode)}, pack.generatedAt = datetime(${q(pack.generatedAt)});`,
    ''
  );
  for (const agent of pack.agents) {
    lines.push(
      `MERGE (n:A11AgentProfile {id: ${q(agent.id)}})`,
      `SET n.name = ${q(agent.name)}, n.role = ${q(agent.role)}, n.surface = ${q(agent.surface)}, n.nindo = ${q(agent.nindo)}, n.identityProfileId = ${q(agent.identity?.id || '')}, n.identityHashtags = ${qa(agent.identityHashtags || [])}, n.functionalHashtags = ${qa(agent.functionalHashtags || [])}, n.narrativeHashtags = ${qa(agent.narrativeHashtags || [])}, n.visualHashtags = ${qa(agent.visualHashtags || [])}, n.visualStyle = ${q(agent.identity?.visualIdentity?.style || '')}, n.visualRepresentation = ${q(agent.identity?.visualIdentity?.representation || '')};`,
      `MATCH (pack:A11DomainPack {id: ${q(pack.id)}}), (n:A11AgentProfile {id: ${q(agent.id)}}) MERGE (pack)-[:DESCRIBES_AGENT]->(n);`,
      ''
    );
    if (agent.identity?.id) {
      lines.push(
        `MERGE (identity:FunesterieIdentityProfile {id: ${q(agent.identity.id)}})`,
        `SET identity.label = ${q(agent.identity.label)}, identity.identityType = ${q(agent.identity.identityType)}, identity.hashtags = ${qa(agent.identity.hashtags || [])}, identity.functionalHashtags = ${qa(agent.identity.functionalHashtags || [])}, identity.narrativeHashtags = ${qa(agent.identity.narrativeHashtags || [])}, identity.visualHashtags = ${qa(agent.identity.visualHashtags || [])}, identity.visualStyle = ${q(agent.identity.visualIdentity?.style || '')};`,
        ''
      );
    }
  }
  for (const domain of pack.domains) {
    lines.push(
      `MERGE (n:A11KnowledgeDomain {id: ${q(domain.id)}})`,
      `SET n.label = ${q(domain.label)}, n.category = ${q(domain.category)}, n.summary = ${q(domain.summary)};`,
      ''
    );
  }
  for (const tool of pack.tools) {
    lines.push(
      `MERGE (n:A11CapabilityTool {id: ${q(tool.id)}})`,
      `SET n.label = ${q(tool.label)}, n.kind = ${q(tool.kind)}, n.safety = ${q(tool.safety)};`,
      ''
    );
  }
  for (const lane of pack.culturalLanes) {
    lines.push(
      `MERGE (n:A11CulturalLane {id: ${q(lane.id)}})`,
      `SET n.label = ${q(lane.label)}, n.seedPolicy = ${q(lane.seedPolicy)};`,
      ''
    );
  }
  for (const card of pack.seedCards) {
    lines.push(
      `MERGE (n:A11SeedCard {id: ${q(card.id)}})`,
      `SET n.title = ${q(card.title)}, n.body = ${q(card.body)}, n.domain = ${q(card.domain)}, n.copyrightMode = ${q(card.copyrightMode)};`,
      ''
    );
  }
  for (const link of pack.links) {
    lines.push(
      `// ${link.from} --${link.type}--> ${link.to}`,
      ''
    );
  }
  return `${lines.join('\n')}\n`;
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function q(value) {
  return JSON.stringify(String(value || ''));
}

function qa(values) {
  return JSON.stringify((Array.isArray(values) ? values : []).map((value) => String(value || '')));
}

module.exports = {
  buildAgentDomainPack,
  collectSfxAssets,
  summarizePack,
  toCypher,
  toMarkdown,
};
