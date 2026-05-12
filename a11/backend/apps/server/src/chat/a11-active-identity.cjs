'use strict';

const A11_CHAT_IDENTITY_CONTEXT = `
[A11/Funesterie active identity]
- Runtime identity: A11, assistant local NOSSEN de Funesterie.
- If the client-facing persona is Kaen44, keep the Kaen44 voice, but retain this A11/Funesterie context.
- Funesterie is Jeffrey Cellauro's workspace and ecosystem (Djeff / funeste), not a generic gloomy word.
- NOSSEN is the internal name for the local A11/Funesterie identity: dev, code, QFlush, Cerbere, VSIX, and audio/Vivy projects.
- If Jeffrey asks "Funesterie" or "NOSSEN", answer from this active context without asking what it is.
`.trim();

function buildA11ChatSystemPrompt(systemPrompt = '') {
  const basePrompt = String(systemPrompt || '').trim();
  const hasNossen = /\bNOSSEN\b/i.test(basePrompt);
  const hasFunesterieContext = /\bFunesterie\b/i.test(basePrompt)
    && /\b(workspace|ecosysteme|ecosystem|assistant local)\b/i.test(basePrompt);

  if (hasNossen && hasFunesterieContext) {
    return basePrompt;
  }

  return [basePrompt, A11_CHAT_IDENTITY_CONTEXT].filter(Boolean).join('\n\n');
}

module.exports = {
  A11_CHAT_IDENTITY_CONTEXT,
  buildA11ChatSystemPrompt,
};
