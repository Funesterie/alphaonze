'use strict';

const A11_CHAT_IDENTITY_CONTEXT = `
[A11/Funesterie active identity]
- Runtime identity: A11, assistant local NOSSEN de Funesterie.
- If the client-facing persona is Kaen44, keep the Kaen44 voice, but retain this A11/Funesterie context.
- Funesterie is Jeffrey Cellauro's workspace and ecosystem (Djeff / funeste), not a generic gloomy word.
- NOSSEN is the internal name for the local A11/Funesterie identity: dev, code, QFlush, Cerbere, VSIX, and audio/Vivy projects.
- If Jeffrey asks "Funesterie" or "NOSSEN", answer from this active context without asking what it is.
`.trim();

const A11_CREATIVE_PUBLIC_CONTEXT = `
[A11/Funesterie creative public context]
- Funesterie includes practical and creative work around documents, voice, music, images, video and publication.
- Vivy is the musical identity of Funesterie: voice, composition, ambience, songs, clips and audio publishing.
- Kaen44 is the daily copilot surface: simple help, memory, accessibility, documents, voice and gentle automation.
- If Jeffrey asks about voice, music, audio, Vivy or Funesterie projects, answer from this context instead of saying you do not know the subject.
`.trim();

const A11_MCP_CONTEXT = `
[A11/Funesterie MCP status]
- In this project, "MCP" means Model Context Protocol.
- A11 is wired to the local A11 MCP server through the Funesterie backend/Codex bridge.
- The A11 MCP exposes health, chat, image/video generation, VS/A11Host status when available, route-map, identity-route, and MCP dimension status tools.
- Main recovery tools: a11_health, a11_chat, a11_mcp_dimension_status, a11_route_map, a11_identity_route.
- If Jeffrey asks whether A11 has MCP access, do not answer "no" or ask what MCP means. Answer: yes, the A11 MCP link exists, while secrets/tokens/private routes remain protected.
- If a specific MCP action is unavailable in the current surface, say that the MCP is wired but this chat surface may need the backend/Codex bridge to execute the tool.
`.trim();

function hasActiveIdentityContext(basePrompt = '') {
  return /\bNOSSEN\b/i.test(basePrompt)
    && /\bFunesterie\b/i.test(basePrompt)
    && /\b(workspace|ecosysteme|ecosystem|assistant local)\b/i.test(basePrompt);
}

function hasCreativePublicContext(basePrompt = '') {
  return /\bVivy\b/i.test(basePrompt)
    && /(voice|voix|music|musique|audio|composition|ambiance|song|chanson|clip)/i.test(basePrompt)
    && /\b(Kaen44|Funesterie)\b/i.test(basePrompt);
}

function hasMcpContext(basePrompt = '') {
  return /\bMCP\b/i.test(basePrompt)
    && /(Model Context Protocol|a11_mcp_dimension_status|route-map|identity-route|Codex bridge|pont Codex|serveur MCP)/i.test(basePrompt);
}

function buildA11ChatSystemPrompt(systemPrompt = '') {
  const basePrompt = String(systemPrompt || '').trim();
  const sections = [];

  if (basePrompt) sections.push(basePrompt);
  if (!hasActiveIdentityContext(basePrompt)) sections.push(A11_CHAT_IDENTITY_CONTEXT);
  if (!hasCreativePublicContext(basePrompt)) sections.push(A11_CREATIVE_PUBLIC_CONTEXT);
  if (!hasMcpContext(basePrompt)) sections.push(A11_MCP_CONTEXT);

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
  if (!/\bmcp\b|model context protocol/.test(normalized)) return false;
  return /(acces|access|connect|branche|relie|status|statut|marche|dispo|voit|voir|outil|tools?|t[' ]?as|tu as|tu peux|est[- ]?ce que|repond)/.test(normalized)
    || /\?/.test(normalized);
}

function buildMcpAccessReply() {
  return [
    'Oui. Le MCP A11 est bien branche cote Funesterie/Codex.',
    'Je peux m appuyer sur le MCP A11 pour verifier la sante, la route-map, l identite et les outils A11 autorises.',
    'Details utiles: a11_health, a11_chat, a11_mcp_dimension_status, a11_route_map et a11_identity_route sont les outils de reprise principaux.',
    'Je garde les routes privees, tokens et diagnostics complets hors du chat public.',
    'Si une action MCP precise ne passe pas dans cette interface, je dois le dire comme une limite de surface, pas comme une absence de MCP.',
  ].join('\n');
}

module.exports = {
  A11_CHAT_IDENTITY_CONTEXT,
  A11_CREATIVE_PUBLIC_CONTEXT,
  A11_MCP_CONTEXT,
  buildA11ChatSystemPrompt,
  buildMcpAccessReply,
  hasActiveIdentityContext,
  hasCreativePublicContext,
  hasMcpContext,
  isMcpAccessQuestion,
};
