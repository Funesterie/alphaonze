const validateMaskImageGenerate = require('./validate-mask-image-generate.cjs');
const validateMaskCode = require('./validate-mask.cjs');

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message, path = '') {
  return { valid: false, errors: [{ path, message }], error: message };
}

function validateWebMask(mask) {
  const errors = [];
  if (!isObject(mask)) {
    return invalid('MASK must be an object');
  }

  if (mask.version !== 'mask-1') {
    errors.push({ path: 'version', message: 'version must be mask-1' });
  }

  const intent = String(mask.intent || '').trim();
  if (!['web.image.search', 'web.search'].includes(intent)) {
    errors.push({ path: 'intent', message: 'intent must be web.image.search or web.search' });
  }

  const expectedAction = intent === 'web.image.search' ? 'image.search' : 'search';
  const expectedTarget = intent === 'web.image.search' ? 'duckduckgo-image-search' : 'web-search';
  if (!isObject(mask.task) || mask.task.domain !== 'web' || mask.task.action !== expectedAction) {
    errors.push({ path: 'task', message: `task.domain/action must be web/${expectedAction}` });
  }
  if (!isObject(mask.compiler) || mask.compiler.target !== expectedTarget || mask.compiler.version !== '1.0') {
    errors.push({ path: 'compiler', message: `compiler.target/version must be ${expectedTarget}/1.0` });
  }
  if (!isObject(mask.inputs) || typeof mask.inputs.query !== 'string' || !mask.inputs.query.trim()) {
    errors.push({ path: 'inputs.query', message: 'inputs.query must be a non-empty string' });
  }
  if (mask.raw !== undefined && (typeof mask.raw !== 'string' || !mask.raw.trim())) {
    errors.push({ path: 'raw', message: 'raw must be a non-empty string when provided' });
  }

  return errors.length ? { valid: false, errors, error: errors[0].message } : { valid: true };
}

function validateChatReplyMask(mask) {
  if (!isObject(mask)) return invalid('MASK must be an object');
  const errors = [];
  if (mask.version !== 'mask-1') {
    errors.push({ path: 'version', message: 'version must be mask-1' });
  }
  if (mask.intent !== 'chat.reply') {
    errors.push({ path: 'intent', message: 'intent must be chat.reply' });
  }
  if (!isObject(mask.task) || mask.task.domain !== 'chat' || mask.task.action !== 'reply') {
    errors.push({ path: 'task', message: 'task.domain/action must be chat/reply' });
  }
  if (!isObject(mask.compiler) || mask.compiler.target !== 'chat-response' || mask.compiler.version !== '1.0') {
    errors.push({ path: 'compiler', message: 'compiler.target/version must be chat-response/1.0' });
  }
  if (!isObject(mask.inputs) || typeof mask.inputs.message !== 'string' || !mask.inputs.message.trim()) {
    errors.push({ path: 'inputs.message', message: 'inputs.message must be a non-empty string' });
  }
  return errors.length ? { valid: false, errors, error: errors[0].message } : { valid: true };
}

function validateMaskUnified(mask) {
  const intent = String(mask?.intent || '').trim();

  if (intent === 'image.generate') {
    const result = validateMaskImageGenerate(mask);
    return result.valid ? result : { ...result, error: result.errors?.[0]?.message || 'invalid_image_mask' };
  }

  if (intent === 'code.python.generate') {
    return validateMaskCode(mask);
  }

  if (intent === 'web.image.search' || intent === 'web.search') {
    return validateWebMask(mask);
  }

  if (intent === 'chat.reply') {
    return validateChatReplyMask(mask);
  }

  return invalid(`Unsupported MASK intent: ${intent || '(empty)'}`, 'intent');
}

module.exports = validateMaskUnified;
