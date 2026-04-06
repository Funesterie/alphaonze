// validate-mask.cjs
// Validation stricte du schéma MASK pour A11

const REQUIRED_FIELDS = ['version', 'intent', 'task', 'compiler'];

function isObject(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj);
}

function validateMask(mask) {
  if (!isObject(mask)) {
    return { valid: false, error: 'MASK must be an object' };
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in mask)) {
      return { valid: false, error: `MASK missing required field: ${field}` };
    }
  }
  if (!isObject(mask.task) || !mask.task.domain || !mask.task.action) {
    return { valid: false, error: 'MASK.task must have domain and action' };
  }
  if (!isObject(mask.compiler) || !mask.compiler.target || !mask.compiler.version) {
    return { valid: false, error: 'MASK.compiler must have target and version' };
  }
  if (mask.intent !== 'code.python.generate') {
    return { valid: false, error: 'Only intent "code.python.generate" is supported in V1' };
  }
  // Optionally: check version, allowed domains/actions, etc.
  return { valid: true };
}

module.exports = validateMask;
