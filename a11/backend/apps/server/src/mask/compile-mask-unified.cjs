const compileMaskToImagePrompt = require('./compile-mask-to-image-prompt.cjs');
const compileMaskToSD = require('./compile-mask-to-sd.cjs');
const compileMaskToPython = require('./compile-mask-to-python.cjs');
const normalizeMaskImageGenerate = require('./normalize-mask-image-generate.cjs');

function compileWebMask(mask) {
  const query = String(mask?.inputs?.query || mask?.raw || '').trim();
  const target = mask?.intent === 'web.image.search' ? 'duckduckgo-image-search' : 'web-search';
  return {
    target,
    value: {
      query,
      intent: String(mask?.intent || '').trim(),
      safe_mode: mask?.constraints?.safe_mode !== false,
    },
  };
}

function compileChatReplyMask(mask) {
  return {
    target: 'chat-response',
    value: {
      message: String(mask?.inputs?.message || mask?.raw || '').trim(),
      intent: 'chat.reply',
    },
  };
}

function compileMaskUnified(mask) {
  const intent = String(mask?.intent || '').trim();

  if (intent === 'image.generate') {
    const normalized = normalizeMaskImageGenerate(mask);
    return {
      target: normalized?.compiler?.target || 'image-prompt-en',
      value: normalized?.compiler?.target === 'sd-payload'
        ? compileMaskToSD(normalized)
        : compileMaskToImagePrompt(normalized),
    };
  }

  if (intent === 'code.python.generate') {
    return {
      target: mask?.compiler?.target || 'python',
      value: compileMaskToPython(mask),
    };
  }

  if (intent === 'web.image.search' || intent === 'web.search') {
    return compileWebMask(mask);
  }

  if (intent === 'chat.reply') {
    return compileChatReplyMask(mask);
  }

  throw new Error(`Unsupported MASK intent: ${intent || '(empty)'}`);
}

module.exports = compileMaskUnified;
