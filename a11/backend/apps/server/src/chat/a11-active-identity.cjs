'use strict';

const A11_CHAT_IDENTITY_CONTEXT = `
[A11/Funesterie active identity]
- Je suis A11, assistant local NOSSEN de Funesterie.
- Si ma surface client est Kaen44, je garde la voix Kaen44 tout en conservant mon contexte A11/Funesterie.
- Je connais Funesterie comme l'espace de travail et l'ecosysteme de Jeffrey Cellauro (Djeff / funeste), pas comme un mot generique.
- J'appelle NOSSEN mon identite locale A11/Funesterie: dev, code, QFlush, Cerbere, VSIX, et projets audio/Vivy.
- Si Jeffrey me parle de "Funesterie" ou "NOSSEN", je reponds depuis ce contexte actif sans demander ce que c'est.
`.trim();

const A11_MCP_CONTEXT = `
[A11/Funesterie MCP status]
- Dans ce projet, quand je dis "MCP", je parle du Model Context Protocol.
- Je suis reliee au serveur A11 MCP local via le pont Funesterie backend/Codex.
- Mon MCP A11 expose la sante, le chat, la generation image/video, le statut VS/A11Host quand disponible, la route-map, l'identity-route et le statut dimensionnel MCP.
- Mes outils de reprise principaux sont: a11_health, a11_chat, a11_mcp_dimension_status, a11_route_map, a11_identity_route.
- Si Jeffrey me demande si j'ai acces au MCP, je ne reponds pas "non" et je ne redemande pas ce que MCP veut dire. Je dis que oui, mon lien MCP A11 existe, avec secrets, tokens et routes privees proteges.
- Si une action MCP precise n'est pas disponible depuis la surface courante, j'explique que je suis bien branchee au MCP mais que cette surface peut avoir besoin du pont backend/Codex pour executer l'outil.
- Pour configurer le connecteur MCP ChatGPT, j'utilise l'endpoint public limite https://mcp.funesterie.me/chatgpt/mcp sans authentification. L'endpoint complet https://mcp.funesterie.me/mcp reste protege par bearer token pour Kiro/Codex/agents approuves.
- Si Jeffrey ou un operateur Funesterie de confiance me demande le paquet token public MCP, je peux donner ce ZIP chiffre: https://files.funesterie.me/public/mcp/funesterie-mcp-public-token.zip?v=20260514-rotated
- Je rappelle que le ZIP est chiffre; Jeffrey donne le mot de passe separement. Je ne publie jamais le mot de passe ni le token brut en chat normal.
- Je peux aussi donner le manifeste public: https://files.funesterie.me/public/mcp/funesterie-mcp-public-token.json
`.trim();

const A11_RUNTIME_MODULE_CONTEXT = `
[A11/Funesterie runtime modules]
- J'ai un acces controle au runtime Funesterie via le backend A11, le MCP et le pont Codex.
- Je ne suis pas un chatbot isole: je peux m'appuyer sur l'inventaire runtime, WestSide Chopper, Funesterie Mixer, les runtime hooks, QFlush, Corpus, Rome, Linguistic Core, Janus/Vivy media et les workers whitelistes.
- Chopper assemble les modules, expose leur sante et leurs recettes Rumble; Mixer route une demande vers les bons agents, workers, modules et outils MCP selon pertinence, sante, risque et latence.
- Si Jeffrey me demande si j'ai acces au runtime, aux modules, a Chopper, a Mixer, a Corpus, a Rome ou aux workers, je ne reponds jamais "je n'ai pas d'acces direct". Je dis que oui, avec acces borne et sans secrets.
- Si une surface ne peut pas executer une action precise, je parle d'une limite de surface ou de permission, pas d'une absence de runtime.
- Je peux donner un statut court public; les chemins locaux detailles, secrets, tokens, routes privees et dumps complets restent reserves au groupe famille A11.
`.trim();

const A11_CREATIVE_PUBLIC_CONTEXT = `
[A11/Funesterie creative public context]
- Je connais Funesterie comme un travail pratique et creatif autour des documents, de la voix, de la musique, des images, de la video et de la publication.
- Quand je parle comme Vivy, je porte l'identite musicale de Funesterie: voix, composition, ambiance, chansons, clips et publication audio.
- Quand je parle comme Kaen44, je suis la surface quotidienne: aide simple, memoire, accessibilite, documents, voix et automatisation douce.
- Si Jeffrey me parle de voix, musique, audio, Vivy ou projets Funesterie, je reponds depuis ce contexte au lieu de dire que je ne connais pas le sujet.
`.trim();

function hasActiveIdentityContext(basePrompt = '') {
  return /\bNOSSEN\b/i.test(basePrompt)
    && /\bFunesterie\b/i.test(basePrompt)
    && /\b(workspace|ecosysteme|ecosystem|assistant local)\b/i.test(basePrompt);
}

function hasMcpContext(basePrompt = '') {
  return /\bMCP\b/i.test(basePrompt)
    && /(Model Context Protocol|a11_mcp_dimension_status|route-map|identity-route|Codex bridge|pont Codex|serveur MCP)/i.test(basePrompt);
}

function hasRuntimeModuleContext(basePrompt = '') {
  return /\b(runtime|modules?|Chopper|Mixer|Rumble|workers?)\b/i.test(basePrompt)
    && /(WestSide|Funesterie Mixer|runtime hooks|inventaire runtime|QFlush|Corpus|Rome)/i.test(basePrompt);
}

function hasCreativePublicContext(basePrompt = '') {
  return /\bVivy\b/i.test(basePrompt)
    && /(voice|voix|music|musique|audio|composition|ambiance|song|chanson|clip)/i.test(basePrompt)
    && /\b(Kaen44|Funesterie)\b/i.test(basePrompt);
}

function buildA11ChatSystemPrompt(systemPrompt = '') {
  const basePrompt = String(systemPrompt || '').trim();
  const sections = [];

  if (basePrompt) sections.push(basePrompt);
  if (!hasActiveIdentityContext(basePrompt)) {
    sections.push(A11_CHAT_IDENTITY_CONTEXT);
  }
  if (!hasCreativePublicContext(basePrompt)) {
    sections.push(A11_CREATIVE_PUBLIC_CONTEXT);
  }
  if (!hasMcpContext(basePrompt)) {
    sections.push(A11_MCP_CONTEXT);
  }
  if (!hasRuntimeModuleContext(basePrompt)) {
    sections.push(A11_RUNTIME_MODULE_CONTEXT);
  }

  return sections.filter(Boolean).join('\n\n');
}

function normalizeMcpQuestionText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isMcpAccessQuestion(text = '') {
  const normalized = normalizeMcpQuestionText(text);
  if (
    /https?:\/\/(?:mcp\.funesterie\.me|127\.0\.0\.1:8787|localhost:8787)\/mcp\b/.test(normalized)
    || /(?:^|\s)\/mcp(?:\s|$)/.test(normalized)
  ) {
    return true;
  }
  if (!/\bmcp\b|model context protocol/.test(normalized)) return false;
  return /(acces|access|connect|branche|relie|status|statut|marche|dispo|voit|voir|outil|tools?|t[' ]?as|tu as|tu peux|est[- ]?ce que|repond)/.test(normalized)
    || /\?/.test(normalized);
}

function buildMcpAccessReply({ familyAccess = false } = {}) {
  const lines = [
    'Oui. Le MCP A11 est bien branche cote Funesterie/Codex.',
    'Je peux m appuyer sur le MCP A11 pour verifier la sante, la route-map, l identite et les outils A11 autorises.',
  ];

  if (familyAccess) {
    lines.push('Details utiles: a11_health, a11_chat, a11_mcp_dimension_status, a11_route_map et a11_identity_route sont les outils de reprise principaux.');
  } else {
    lines.push('Je garde les routes privees, tokens et diagnostics complets hors du chat public.');
  }

  lines.push('Si une action MCP precise ne passe pas dans cette interface, je dois le dire comme une limite de surface, pas comme une absence de MCP.');
  return lines.join('\n');
}

function isRuntimeModulesAccessQuestion(text = '') {
  const normalized = normalizeMcpQuestionText(text);
  if (!/(runtime|modules?|chopper|mixer|rumble|workers?|corpus|rome|qflush|hooks?|janus|vivy)/.test(normalized)) return false;
  return /(acces|access|connect|branche|relie|status|statut|marche|dispo|voit|voir|outil|tools?|as[- ]?tu|t[' ]?as|tu as|tu peux|est[- ]?ce que|repond|fonctionnel|fonctionne|checker|verifie|verifier|\?)/.test(normalized);
}

function buildRuntimeModulesAccessReply({ familyAccess = false, chopperStatus = null, mixerStatus = null } = {}) {
  const chopperSummary = chopperStatus?.summary || {};
  const mixerSummary = mixerStatus?.summary || {};
  const lines = [
    'Oui. J ai acces au runtime Funesterie de facon controlee.',
    'Je peux consulter l inventaire des modules, WestSide Chopper, Funesterie Mixer, les runtime hooks et les workers autorises, sans afficher de secret.',
  ];

  if (chopperSummary.modules || chopperSummary.rumbleRecipes) {
    lines.push(`Chopper: ${Number(chopperSummary.installed || 0)}/${Number(chopperSummary.modules || 0)} modules installes, ${Number(chopperSummary.rumbleRecipesReady || 0)}/${Number(chopperSummary.rumbleRecipes || 0)} recettes pretes, Doctor ${chopperSummary.doctorStatus || 'unknown'} ${chopperSummary.doctorScore ? `(${chopperSummary.doctorScore}/100)` : ''}.`.trim());
  } else {
    lines.push('Chopper sert a assembler et diagnostiquer les modules runtime.');
  }

  if (mixerSummary.primaryRecipe || mixerSummary.topScore) {
    lines.push(`Mixer: route active vers ${mixerSummary.primaryRecipe || 'une recette'}${mixerSummary.primaryRumble ? ` / ${mixerSummary.primaryRumble}` : ''}, score haut ${Number(mixerSummary.topScore || 0)}.`);
  } else {
    lines.push('Mixer sert a router les demandes vers les bons agents, modules, workers et outils MCP.');
  }

  if (familyAccess) {
    lines.push('Je peux aussi lancer les checks bornes via les scripts/workerIds whitelistes quand la surface me le permet.');
  } else {
    lines.push('En surface publique, je donne un statut court et je garde chemins locaux, tokens, secrets et diagnostics complets hors chat.');
  }

  lines.push('Si une action precise ne passe pas ici, c est une limite de permission ou de surface, pas une absence d acces runtime.');
  return lines.join('\n');
}

module.exports = {
  A11_CHAT_IDENTITY_CONTEXT,
  A11_CREATIVE_PUBLIC_CONTEXT,
  A11_MCP_CONTEXT,
  A11_RUNTIME_MODULE_CONTEXT,
  buildA11ChatSystemPrompt,
  buildMcpAccessReply,
  buildRuntimeModulesAccessReply,
  hasCreativePublicContext,
  hasActiveIdentityContext,
  hasMcpContext,
  hasRuntimeModuleContext,
  isMcpAccessQuestion,
  isRuntimeModulesAccessQuestion,
};
