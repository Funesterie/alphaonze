// Validation canonique du schéma MASK pour code.python.generate

const REQUIRED_FIELDS = ['version', 'intent', 'task', 'compiler'];

function isObject(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj);
}

function validateMaskCodePythonGenerate(mask) {
  if (!isObject(mask)) {
    return { valid: false, error: 'MASK must be an object' };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in mask)) {
      return { valid: false, error: `MASK missing required field: ${field}` };
    }
  }

  if (mask.version !== 'mask-1') {
    return { valid: false, error: 'MASK.version must be mask-1' };
  }

  if (mask.intent !== 'code.python.generate') {
    return { valid: false, error: 'Only intent "code.python.generate" is supported in V1' };
  }

  if (!isObject(mask.task) || !mask.task.domain || !mask.task.action) {
    return { valid: false, error: 'MASK.task must have domain and action' };
  }

  if (!isObject(mask.compiler) || !mask.compiler.target || !mask.compiler.version) {
    return { valid: false, error: 'MASK.compiler must have target and version' };
  }

  if (mask.compiler.target !== 'python') {
    return { valid: false, error: 'MASK.compiler.target must be python' };
  }

  if (mask.compiler.version !== '1.0') {
    return { valid: false, error: 'MASK.compiler.version must be 1.0' };
  }

  return { valid: true };
}

module.exports = validateMaskCodePythonGenerate;
