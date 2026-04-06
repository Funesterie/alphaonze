// apps/server/utils/tokenizer.js
// Simple approximate tokenizer for OpenAI/LLM context window management

function countTokens(text) {
  // Approximate: 1 token ≈ 4 chars (English), 1 token ≈ 3 chars (French)
  if (!text) return 0;
  return Math.ceil(String(text).length / 3.5);
}

function countMessageTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, msg) => sum + countTokens(msg.content || ''), 0);
}

module.exports = { countTokens, countMessageTokens };