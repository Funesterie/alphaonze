'use strict';

const crypto = require('node:crypto');

const SCHEMA = 'funesterie.ecosystem-briefing.v1';

function buildEcosystemBriefing(scope, corpus, options = {}) {
  if (!scope || typeof scope !== 'object') throw new Error('scope object is required');
  if (!corpus || typeof corpus !== 'object') throw new Error('corpus object is required');

  const generatedAt = options.generatedAt || new Date().toISOString();
  const domainStats = buildDomainStats(corpus);
  const repoMatrix = buildRepoMatrix(corpus);
  const boundaryMatrix = buildBoundaryMatrix(corpus);
  const identityMatrix = buildIdentityMatrix(scope, corpus);
  const moduleInventory = buildModuleInventory(scope, options.runtimeHooks || null);
  const architecturePages = buildArchitecturePages({ scope, corpus, domainStats, repoMatrix, boundaryMatrix, identityMatrix });

  const briefing = {
    ok: true,
    schema: SCHEMA,
    id: 'funesterie-ecosystem-briefing',
    label: 'Briefing executif et architecture de l ecosysteme Funesterie',
    mode: 'shareable-metadata-only-briefing',
    generatedAt,
    sourceScopeId: scope.id || 'funesterie-ecosystem-scope',
    sourceCorpusId: corpus.id || 'funesterie-ecosystem-corpus',
    sourcePolicy: {
      noSecrets: true,
      noRawPrivateSource: true,
      noRawLocalPaths: true,
      metadataOnly: true,
      publicUse: 'Les syntheses executives et architecture peuvent etre partagees apres relecture humaine.',
    },
    executive: {
      title: 'Vue executive de l ecosysteme Funesterie',
      oneLine: 'Funesterie est maintenant cartographie comme un systeme lisible par les agents : scope, hooks runtime, cartes Corpus, boundaries et liens Neo4j travaillent ensemble.',
      metrics: buildMetrics(scope, corpus),
      layers: [
        ['ecosystem-scope', 'Ce qui existe, ou cela vit, et quel role chaque brique joue.'],
        ['identity-hashtags', 'Le langage commun qui relie routing, visuel, prompts, UI, source cards et Neo4j.'],
        ['runtime-hooks', 'Comment les briques tournent, se synchronisent et se coordonnent via A11/QFlush.'],
        ['ecosystem-corpus', 'Ce que les agents doivent comprendre, resumer, retrouver et ne pas exposer.'],
      ],
      strongestSignals: [
        'La visibilite GitHub/org est indexee sans ouvrir le code source prive.',
        'Les cartes Corpus separent les resumes publics, les metadonnees privees et les zones restreintes.',
        'Les hashtags identitaires stabilisent les archetypes sans transformer les modules techniques en personnages.',
        'Neo4j local et Aura peuvent recevoir la meme topologie pour la navigation multi-agents.',
        'MCP expose les statuts et cartes en lecture seule tout en gardant shell et secrets hors des profils publics.',
      ],
      nextMoves: [
        'Produire une presentation Google/PDF propre a partir de ce briefing.',
        'Curater les repos encore peu fiables au lieu de laisser les agents deviner.',
        'Relier les cartes Corpus aux contenus educatifs et domaines de A11, K44 et Vivy.',
        'Utiliser la matrice identity-hashtags pour les prochaines affiches, prompts image, UI et source cards.',
        'Ajouter de petits hooks Neo4j pour les nouveaux livrables de briefing et exports de presentation.',
      ],
    },
    architecture: {
      title: 'Vue architecture Funesterie',
      pageCount: architecturePages.length,
      pages: architecturePages,
    },
    domainStats,
    repoMatrix,
    boundaryMatrix,
    identityMatrix,
    moduleInventory,
    summary: {
      scopeRepos: scope.summary?.repos || scope.github?.repoCount || 0,
      sourceCards: corpus.summary?.sourceCards || 0,
      repoBriefs: corpus.summary?.repoBriefs || 0,
      domains: corpus.summary?.domains || 0,
      boundaries: corpus.summary?.boundaries || 0,
      corpusLinks: corpus.summary?.links || 0,
      identityProfiles: identityMatrix.length,
      identityHashtags: Array.from(new Set(identityMatrix.flatMap((item) => item.hashtags || []))).length,
      architecturePages: architecturePages.length,
      totalModuleEntries: moduleInventory.summary.total,
      hash: hashText(JSON.stringify({
        scopeGeneratedAt: scope.generatedAt,
        corpusGeneratedAt: corpus.generatedAt,
        sourceCards: corpus.summary?.sourceCards || 0,
        links: corpus.summary?.links || 0,
        identityProfiles: identityMatrix.length,
        moduleEntries: moduleInventory.summary.total,
      })),
    },
  };

  assertNoSecretLeak(JSON.stringify(briefing));
  return briefing;
}

function buildMetrics(scope, corpus) {
  return [
    ['GitHub repos', scope.summary?.repos || scope.github?.repoCount || 0],
    ['Repos prives', scope.summary?.privateRepos || 0],
    ['Modules locaux', scope.summary?.localModules || 0],
    ['Packages', scope.summary?.packages || 0],
    ['Contrats', scope.summary?.contracts || 0],
    ['Cartes source', corpus.summary?.sourceCards || 0],
    ['Briefs repo', corpus.summary?.repoBriefs || 0],
    ['Liens Neo4j', corpus.summary?.links || 0],
    ['Domaines', corpus.summary?.domains || 0],
    ['Boundaries', corpus.summary?.boundaries || 0],
    ['Identites', corpus.summary?.identityProfiles || scope.summary?.identityProfiles || 0],
  ];
}

function buildDomainStats(corpus) {
  const domains = new Map((corpus.domains || []).map((domain) => [domain.id, {
    id: domain.id,
    label: domain.label || domain.id,
    summary: domain.summary || '',
    sourceCards: 0,
    repos: 0,
    examples: [],
  }]));

  for (const card of corpus.sourceCards || []) {
    for (const domainId of card.domains || []) {
      if (!domains.has(domainId)) domains.set(domainId, {
        id: domainId,
        label: domainId,
        summary: '',
        sourceCards: 0,
        repos: 0,
        examples: [],
      });
      const stat = domains.get(domainId);
      stat.sourceCards += 1;
      if (card.kind === 'repo') stat.repos += 1;
      if (stat.examples.length < 5) stat.examples.push(card.name || card.subjectId || card.id);
    }
  }

  return Array.from(domains.values()).sort((a, b) => b.sourceCards - a.sourceCards || a.id.localeCompare(b.id));
}

function buildRepoMatrix(corpus) {
  return (corpus.sourceCards || [])
    .filter((card) => card.kind === 'repo')
    .map((card) => ({
      name: card.name,
      role: card.role,
      status: card.status,
      confidence: card.confidence,
      boundary: card.boundary,
      domains: card.domains || [],
      identityHashtags: card.identityHashtags || [],
      visualStyle: card.visualIdentity?.style || '',
      publicSummary: card.publicSummary || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildIdentityMatrix(scope, corpus) {
  const fromScope = scope.identityLayer?.profiles || [];
  const fromCards = (corpus.sourceCards || []).map((card) => card.identity).filter(Boolean);
  const byId = new Map();
  for (const identity of [...fromScope, ...fromCards]) {
    if (!identity?.id) continue;
    const existing = byId.get(identity.id) || {
      id: identity.id,
      label: identity.label,
      identityType: identity.identityType,
      hashtags: [],
      visualStyle: identity.visualIdentity?.style || '',
      representation: identity.visualIdentity?.representation || '',
      humanRepresentationAllowed: identity.visualIdentity?.humanRepresentationAllowed === true,
      sourceCards: 0,
      examples: [],
    };
    existing.hashtags = Array.from(new Set([...existing.hashtags, ...(identity.hashtags || [])])).sort();
    if (!existing.visualStyle && identity.visualIdentity?.style) existing.visualStyle = identity.visualIdentity.style;
    if (!existing.representation && identity.visualIdentity?.representation) existing.representation = identity.visualIdentity.representation;
    byId.set(identity.id, existing);
  }
  for (const card of corpus.sourceCards || []) {
    if (!card.identity?.id || !byId.has(card.identity.id)) continue;
    const row = byId.get(card.identity.id);
    row.sourceCards += 1;
    if (row.examples.length < 5) row.examples.push(card.name || card.subjectId || card.id);
  }
  return Array.from(byId.values()).sort((a, b) => {
    if (a.identityType !== b.identityType) return a.identityType.localeCompare(b.identityType);
    return a.label.localeCompare(b.label);
  });
}

function buildBoundaryMatrix(corpus) {
  const boundaries = new Map((corpus.boundaries || []).map((boundary) => [boundary.id, {
    id: boundary.id,
    label: boundary.label || boundary.id,
    corpusMode: boundary.corpusMode || '',
    rule: boundary.rule || '',
    sourceCards: 0,
    repos: 0,
    canGoToGooglePresentation: Boolean(boundary.canGoToGooglePresentation),
    canGoToPublicMcp: Boolean(boundary.canGoToPublicMcp),
  }]));

  for (const card of corpus.sourceCards || []) {
    if (!boundaries.has(card.boundary)) boundaries.set(card.boundary, {
      id: card.boundary,
      label: card.boundary,
      corpusMode: '',
      rule: '',
      sourceCards: 0,
      repos: 0,
      canGoToGooglePresentation: false,
      canGoToPublicMcp: false,
    });
    const row = boundaries.get(card.boundary);
    row.sourceCards += 1;
    if (card.kind === 'repo') row.repos += 1;
  }

  return Array.from(boundaries.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function buildModuleInventory(scope, runtimeHooks) {
  const localModules = (scope.localModules || []).map((item) => ({
    id: item.id,
    name: item.name,
    type: 'module-local',
    kind: item.kind,
    role: inferRoleFromKind(item.kind),
    summary: item.summary,
    status: item.status?.exists ? 'present' : 'manquant',
    capabilities: [],
  }));

  const runtimeModules = (runtimeHooks?.modules || []).map((item) => ({
    id: item.id,
    name: item.name,
    type: 'hook-runtime',
    kind: item.kind,
    role: item.role,
    summary: item.summary,
    status: 'present',
    capabilities: item.capabilities || [],
  }));

  const semanticTools = (scope.semanticTools || []).map((item) => ({
    id: item.id,
    name: item.name,
    type: 'outil-semantique',
    kind: item.kind,
    role: item.kind,
    summary: item.summary,
    status: 'indexe',
    capabilities: [],
  }));

  const sharedRuntimes = (scope.sharedRuntimes || []).map((item) => ({
    id: item.id,
    name: item.name,
    type: 'runtime-partage',
    kind: item.kind,
    role: item.kind,
    summary: item.summary,
    status: 'indexe',
    capabilities: [],
  }));

  return {
    localModules,
    runtimeModules,
    semanticTools,
    sharedRuntimes,
    summary: {
      localModules: localModules.length,
      runtimeModules: runtimeModules.length,
      semanticTools: semanticTools.length,
      sharedRuntimes: sharedRuntimes.length,
      total: localModules.length + runtimeModules.length + semanticTools.length + sharedRuntimes.length,
    },
  };
}

function inferRoleFromKind(kind) {
  const value = String(kind || '').trim();
  if (!value) return 'module';
  return value.replace(/-/g, ' ');
}

function buildArchitecturePages({ scope, corpus, domainStats, repoMatrix, boundaryMatrix, identityMatrix }) {
  const topDomains = domainStats.slice(0, 6).map((domain) => `${domain.label}: ${domain.sourceCards} cartes`);
  const topIdentities = identityMatrix
    .slice(0, 8)
    .map((identity) => `${identity.label}: ${identity.hashtags.slice(0, 5).join(' ')}`);
  const curatedRepos = repoMatrix.filter((repo) => repo.status === 'curated').slice(0, 8).map((repo) => `${repo.name}: ${repo.role}`);
  const needsCuration = repoMatrix.filter((repo) => repo.status === 'needs-curation').map((repo) => repo.name);
  const boundaries = boundaryMatrix.map((boundary) => `${boundary.id}: ${boundary.sourceCards} cartes, ${boundary.repos} repos`);

  return [
    page(1, 'Carte executive', [
      'Funesterie est indexe comme un graphe, pas comme une simple liste de repos.',
      `Le scope actuel suit ${scope.summary?.repos || 0} repos, ${scope.summary?.localModules || 0} modules locaux et ${scope.summary?.packages || 0} packages.`,
      `La couche Corpus ajoute ${corpus.summary?.sourceCards || 0} cartes source et ${corpus.summary?.links || 0} liens de graphe.`,
      `La couche identity-hashtags stabilise ${identityMatrix.length} profils pour le routing, les prompts et les visuels.`,
    ], [
      ['Ce qui a change', ['Les agents peuvent inspecter les roles, domaines et boundaries avant d agir.', 'La carte reste utile meme sans exposer le code source prive brut.']],
      ['Meilleur usage', ['Commencer par ce briefing, puis descendre dans les JSON scope/corpus seulement si necessaire.']],
    ]),
    page(2, 'Modele en trois couches', [
      'ecosystem-scope repond a : qu est-ce qui existe ?',
      'runtime-hooks repond a : comment cela tourne ?',
      'ecosystem-corpus repond a : que doivent comprendre et retrouver les agents ?',
      'identity-hashtags repond a : quelle forme, quel role et quelle archetype garder partout ?',
    ], [
      ['Contrat de couche', ['Scope reste metadata-only.', 'Runtime hooks reste operationnel et oriente statut.', 'Les cartes Corpus restent concises et respectent les boundaries.']],
    ]),
    page(3, 'Acces MCP et GitHub', [
      'Les profils locaux de confiance peuvent utiliser GitHub CLI et le scope org pour construire le graphe prive.',
      'Les outils publics compatibles ChatGPT doivent exposer seulement health, status, resumes et cartes en lecture seule.',
      'Le shell et les outils sensibles restent locaux/prives.',
    ], [
      ['Profils d acces', (scope.accessProfiles || []).map((profile) => `${profile.label}: ${profile.kind}`)],
    ]),
    page(4, 'Hooks runtime', [
      'Les hooks runtime relient les modules A11/QFlush a Neo4j et aux fallbacks JSON locaux.',
      'Ils rendent Cortex, Spyder, Rome, Corpus, Doctor et Piccolo decouvrables comme briques vivantes.',
      'Les hooks forment la couche operationnelle entre la documentation et le comportement reel des agents.',
    ], [
      ['Runtimes partages', (scope.sharedRuntimes || []).map((runtime) => `${runtime.name}: ${runtime.kind}`)],
    ]),
    page(5, 'Cartes source Corpus', [
      'Les cartes source sont des fiches de lecture compactes pour agents.',
      'Chaque carte possede un role, une confiance, des domaines, une boundary, des preuves et une consigne d usage.',
      'Les briefs repo sont assez courts pour aider les agents sans livrer le code source prive.',
    ], [
      ['Compteurs Corpus', [`${corpus.summary?.sourceCards || 0} cartes source`, `${corpus.summary?.repoBriefs || 0} briefs repo`, `${corpus.summary?.restrictedCards || 0} cartes restreintes`]],
      ['Identites', topIdentities],
    ]),
    page(6, 'Carte des domaines', [
      'Les domaines aident les agents a choisir le bon rayon mental avant d utiliser les outils.',
      'Les domaines les plus forts doivent guider les prochains enrichissements Corpus et les requetes Neo4j.',
    ], [
      ['Domaines principaux', topDomains],
    ]),
    page(7, 'Matrice repos et modules', [
      'Les noms de repos ont maintenant des roles techniques au lieu de libelles vagues.',
      'Les repos peu fiables restent marques a curater au lieu d etre devines.',
      'Modules et packages sont relies aux repos par metadonnees relatives.',
    ], [
      ['Exemples de repos curates', curatedRepos],
      ['A curater', needsCuration.length ? needsCuration : ['Aucun dans cette vue']],
    ]),
    page(8, 'Modele graphe Neo4j', [
      'Scope, Corpus et runtime hooks ecrivent chacun des noeuds et des types de relations explicites.',
      'Les profils identitaires ajoutent des noeuds FunesterieIdentityProfile et des hashtags traversables.',
      'Neo4j local et Aura peuvent recevoir la meme topologie semantique.',
      'Les exports JSON et Markdown restent disponibles si l auth graphe ou le reseau tombe.',
    ], [
      ['Ancres graphe', ['FunesterieEcosystemScope', 'FunesterieCorpusPack', 'FunesterieSourceCard', 'FunesterieIdentityProfile', 'FunesterieRuntimeHooks']],
    ]),
    page(9, 'Boundary public/prive', [
      'Le modele de boundaries est le mecanisme principal de securite.',
      'Les zones restricted vault restent metadata-only et ne nourrissent jamais les reponses MCP publiques.',
      'Les resumes publics doivent rester courts, relisibles et attribuables a une source.',
    ], [
      ['Boundaries', boundaries],
    ]),
    page(10, 'Prochaine passe implementation', [
      'Generer une presentation Google/PDF a partir de ce briefing.',
      'Curater les cartes repo vides et ajouter le contexte manquant seulement avec des preuves.',
      'Attacher les cartes Corpus educatives/culturelles de A11, K44 et Vivy par domaine.',
      'Faire remonter les outputs briefing dans la carte runtime via hooks Neo4j.',
    ], [
      ['Checklist immediate', ['Publier le briefing en interne.', 'L utiliser comme point d entree pour la navigation Kiro/Codex.', 'Garder les cartes restricted-vault hors des resumes publics.']],
    ]),
  ];
}

function page(number, title, bullets, sections = []) {
  return { number, title, bullets, sections };
}

function toExecutiveMarkdown(briefing, options = {}) {
  const visuals = Array.isArray(options.visuals) ? options.visuals : [];
  const lines = [
    '# Funesterie - Vue executive',
    '',
    `Genere: ${briefing.generatedAt}`,
    '',
    briefing.executive.oneLine,
    '',
    ...(visuals.length ? [
      '## Visuels',
      '',
      ...visuals.map((visual) => `![${visual.title}](${visual.markdownPath || visual.path})`),
      '',
    ] : []),
    '## Chiffres cles',
    '',
    ...briefing.executive.metrics.map(([label, value]) => `- ${label}: ${value}`),
    '',
    '## Modele',
    '',
    ...briefing.executive.layers.map(([id, summary]) => `- ${id}: ${summary}`),
    '',
    '## Signaux solides',
    '',
    ...briefing.executive.strongestSignals.map((item) => `- ${item}`),
    '',
    '## Langage identitaire',
    '',
    ...briefing.identityMatrix.slice(0, 10).map((item) => `- ${item.label}: ${item.hashtags.slice(0, 6).join(' ')}`),
    '',
    '## Prochaine passe',
    '',
    ...briefing.executive.nextMoves.map((item) => `- ${item}`),
    '',
    '## Boundary rapide',
    '',
    ...briefing.boundaryMatrix.map((row) => `- ${row.id}: ${row.sourceCards} cartes, MCP public=${row.canGoToPublicMcp ? 'oui' : 'non'}, Google=${row.canGoToGooglePresentation ? 'oui' : 'relecture'}`),
    '',
    '## Inventaire modules',
    '',
    `- Modules locaux: ${briefing.moduleInventory.summary.localModules}`,
    `- Hooks runtime: ${briefing.moduleInventory.summary.runtimeModules}`,
    `- Outils semantiques: ${briefing.moduleInventory.summary.semanticTools}`,
    `- Runtimes partages: ${briefing.moduleInventory.summary.sharedRuntimes}`,
  ];
  const text = `${lines.join('\n')}\n`;
  assertNoSecretLeak(text);
  return text;
}

function toArchitectureMarkdown(briefing, options = {}) {
  const visuals = Array.isArray(options.visuals) ? options.visuals : [];
  const lines = [
    '# Funesterie - Vue architecture',
    '',
    `Genere: ${briefing.generatedAt}`,
    `Pages: ${briefing.architecture.pageCount}`,
    '',
  ];

  if (visuals.length) {
    lines.push('## Visuels identitaires', '');
    for (const visual of visuals) {
      lines.push(`### ${visual.title}`, '');
      lines.push(visual.description || '', '');
      lines.push(`![${visual.title}](${visual.markdownPath || visual.path})`, '');
    }
  }

  for (const item of briefing.architecture.pages) {
    lines.push(`## Page ${item.number} - ${item.title}`, '');
    for (const bullet of item.bullets) lines.push(`- ${bullet}`);
    for (const [sectionTitle, sectionItems] of item.sections || []) {
      lines.push('', `### ${sectionTitle}`, '');
      for (const sectionItem of sectionItems || []) lines.push(`- ${sectionItem}`);
    }
    lines.push('');
  }

  lines.push('## Matrice repos', '');
  lines.push('| Repo | Statut | Boundary | Domaines | Identite | Role |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const repo of briefing.repoMatrix) {
    lines.push(`| ${mdCell(repo.name)} | ${mdCell(repo.status)} | ${mdCell(repo.boundary)} | ${mdCell(repo.domains.join(', '))} | ${mdCell((repo.identityHashtags || []).slice(0, 4).join(' '))} | ${mdCell(shorten(repo.role, 140))} |`);
  }

  lines.push('', '## Matrice identites', '');
  lines.push('| Identite | Type | Hashtags | Visuel | Cartes |');
  lines.push('| --- | --- | --- | --- | ---: |');
  for (const identity of briefing.identityMatrix) {
    lines.push(`| ${mdCell(identity.label)} | ${mdCell(identity.identityType)} | ${mdCell(identity.hashtags.join(' '))} | ${mdCell(identity.visualStyle)} | ${identity.sourceCards} |`);
  }

  lines.push('', '## Matrice domaines', '');
  lines.push('| Domaine | Cartes | Repos | Exemples |');
  lines.push('| --- | ---: | ---: | --- |');
  for (const domain of briefing.domainStats) {
    lines.push(`| ${mdCell(domain.label)} | ${domain.sourceCards} | ${domain.repos} | ${mdCell(domain.examples.join(', '))} |`);
  }

  appendModuleInventoryMarkdown(lines, briefing.moduleInventory);

  const text = `${lines.join('\n')}\n`;
  assertNoSecretLeak(text);
  return text;
}

function toBriefingHtml(briefing, options = {}) {
  const visuals = Array.isArray(options.visuals) ? options.visuals : [];
  const metricCards = briefing.executive.metrics.map(([label, value]) => (
    `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`
  )).join('');
  const visualPages = visuals.length ? `<article class="page visual-page">
      <p class="eyebrow">Identites visuelles MCP</p>
      <h2>A11 et Funesterie</h2>
      <div class="visual-grid">
        ${visuals.map((visual) => `<figure><img src="${escapeHtml(visual.fileUrl || visual.path)}" alt="${escapeHtml(visual.title)}"><figcaption><strong>${escapeHtml(visual.title)}</strong><span>${escapeHtml(visual.description || '')}</span></figcaption></figure>`).join('')}
      </div>
    </article>` : '';
  const pages = briefing.architecture.pages.map((item) => {
    const sections = (item.sections || []).map(([title, values]) => (
      `<section><h3>${escapeHtml(title)}</h3><ul>${(values || []).map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>`
    )).join('');
    return `<article class="page"><p class="eyebrow">Page ${item.number}</p><h2>${escapeHtml(item.title)}</h2><ul>${item.bullets.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>${sections}</article>`;
  }).join('');
  const boundaryRows = briefing.boundaryMatrix.map((row) => (
    `<tr><td>${escapeHtml(row.id)}</td><td>${row.sourceCards}</td><td>${row.repos}</td><td>${escapeHtml(row.corpusMode)}</td></tr>`
  )).join('');
  const moduleSections = moduleInventoryToHtml(briefing.moduleInventory);

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Briefing ecosysteme Funesterie</title>
  <style>
    :root { color-scheme: light; --ink: #111827; --muted: #4b5563; --line: #d8c7ae; --gold: #b7832f; --aqua: #0f766e; --paper: #fbf7ef; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--paper); }
    main { max-width: 1080px; margin: 0 auto; padding: 48px 32px; }
    h1 { font-size: 56px; line-height: 0.94; margin: 0 0 18px; letter-spacing: 0; }
    h2 { font-size: 30px; margin: 0 0 16px; letter-spacing: 0; }
    h3 { font-size: 15px; text-transform: uppercase; margin: 22px 0 8px; letter-spacing: 0.08em; color: var(--aqua); }
    p, li, td { font-size: 15px; line-height: 1.55; }
    .hero { min-height: 92vh; display: grid; align-content: center; border-bottom: 1px solid var(--line); }
    .eyebrow { color: var(--aqua); text-transform: uppercase; font-weight: 800; font-size: 12px; letter-spacing: 0.12em; margin-bottom: 12px; }
    .lead { max-width: 780px; font-size: 22px; line-height: 1.42; color: var(--muted); }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin: 28px 0; }
    .metric { border: 1px solid var(--line); padding: 14px; background: #fffaf2; min-height: 86px; }
    .metric strong { display: block; font-size: 28px; }
    .metric span { color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 800; }
    .page { min-height: 92vh; padding: 48px 0; border-bottom: 1px solid var(--line); break-after: page; }
    .page ul { max-width: 780px; padding-left: 22px; }
    .visual-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 24px; }
    figure { margin: 0; border: 1px solid var(--line); background: #fffaf2; padding: 12px; }
    figure img { display: block; width: 100%; border: 1px solid rgba(17, 24, 39, 0.16); }
    figcaption { display: grid; gap: 4px; padding: 12px 4px 2px; }
    figcaption strong { font-size: 18px; }
    figcaption span { color: var(--muted); font-size: 13px; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; background: #fffaf2; }
    th, td { text-align: left; border: 1px solid var(--line); padding: 10px; vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; color: var(--muted); }
    @media print {
      body { background: white; }
      main { max-width: none; padding: 24mm 18mm; }
      .hero, .page { min-height: auto; }
      .visual-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <p class="eyebrow">Ecosysteme Funesterie</p>
      <h1>Carte executive<br>et architecture agents</h1>
      <p class="lead">${escapeHtml(briefing.executive.oneLine)}</p>
      <div class="metrics">${metricCards}</div>
      <p class="eyebrow">Genere ${escapeHtml(briefing.generatedAt)}</p>
    </section>
    ${visualPages}
    ${pages}
    <article class="page">
      <p class="eyebrow">Matrice boundaries</p>
      <h2>Public, prive, restricted</h2>
      <table>
        <thead><tr><th>Boundary</th><th>Cartes</th><th>Repos</th><th>Mode Corpus</th></tr></thead>
        <tbody>${boundaryRows}</tbody>
      </table>
    </article>
    ${moduleSections}
  </main>
</body>
</html>`;
  assertNoSecretLeak(html);
  return html;
}

function summarizeBriefing(briefing) {
  return {
    id: briefing.id,
    generatedAt: briefing.generatedAt,
    mode: briefing.mode,
    sourceScopeId: briefing.sourceScopeId,
    sourceCorpusId: briefing.sourceCorpusId,
    architecturePages: briefing.summary.architecturePages,
    identityProfiles: briefing.summary.identityProfiles,
    identityHashtags: briefing.summary.identityHashtags,
    scopeRepos: briefing.summary.scopeRepos,
    sourceCards: briefing.summary.sourceCards,
    repoBriefs: briefing.summary.repoBriefs,
    corpusLinks: briefing.summary.corpusLinks,
    totalModuleEntries: briefing.summary.totalModuleEntries,
    hash: briefing.summary.hash,
  };
}

function appendModuleInventoryMarkdown(lines, inventory) {
  const groups = [
    ['Modules locaux', inventory.localModules],
    ['Hooks runtime', inventory.runtimeModules],
    ['Outils semantiques', inventory.semanticTools],
    ['Runtimes partages', inventory.sharedRuntimes],
  ];

  lines.push('', '## Inventaire complet des modules', '');
  for (const [title, items] of groups) {
    lines.push(`### ${title}`, '');
    lines.push('| Nom | Type | Role | Description |');
    lines.push('| --- | --- | --- | --- |');
    for (const item of items) {
      lines.push(`| ${mdCell(item.name)} | ${mdCell(item.kind)} | ${mdCell(item.role)} | ${mdCell(item.summary)} |`);
    }
    lines.push('');
  }
}

function moduleInventoryToHtml(inventory) {
  const groups = [
    ['Modules locaux', inventory.localModules],
    ['Hooks runtime', inventory.runtimeModules],
    ['Outils semantiques', inventory.semanticTools],
    ['Runtimes partages', inventory.sharedRuntimes],
  ];

  return groups.map(([title, items]) => `<article class="page">
      <p class="eyebrow">Inventaire modules</p>
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead><tr><th>Nom</th><th>Type</th><th>Role</th><th>Description</th></tr></thead>
        <tbody>
          ${items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.summary)}</td></tr>`).join('')}
        </tbody>
      </table>
    </article>`).join('');
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function shorten(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertNoSecretLeak(text) {
  const secretPattern = /(bearer\s+[a-z0-9._~+/=-]{16,}|hf_[a-z0-9]{16,}|sk-[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9_]{20,}|api[_-]?key\s*[:=]|token\s*[:=]|password\s*[:=]|mot de passe\s*[:=])/i;
  if (secretPattern.test(String(text || ''))) {
    throw new Error('briefing contains secret-looking text');
  }
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

module.exports = {
  SCHEMA,
  buildEcosystemBriefing,
  summarizeBriefing,
  toArchitectureMarkdown,
  toBriefingHtml,
  toExecutiveMarkdown,
};
