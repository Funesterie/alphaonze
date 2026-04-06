const { createIntentResolver } = require('./resolve-user-request.cjs');

async function llmIntentToMask(userText) {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText,
    executeRuntime: false,
    executeImage: false,
    executeWebSearch: false,
  });

  if (resolution?.mask) return resolution.mask;
  return {
    error: 'no_mask_match',
    intent: String(resolution?.kind || 'chat.reply').trim() || 'chat.reply',
  };
}

module.exports = llmIntentToMask;
