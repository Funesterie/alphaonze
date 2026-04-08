// validate-mask-image-generate.cjs
// Validation stricte du schéma MASK pour image.generate (MASK V1)

function isObject(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj);
}

function isStringArray(arr) {
  return Array.isArray(arr) && arr.every(x => typeof x === 'string');
}


const ALLOWED_TARGETS = ['image-prompt-fr','sd-payload','python','comfy'];
const ALLOWED_VERSION = '1.0';
const MIN_WIDTH = 64, MAX_WIDTH = 1024, MIN_HEIGHT = 64, MAX_HEIGHT = 1024, MIN_STEPS = 1, MAX_STEPS = 100, MIN_GUIDANCE = 1, MAX_GUIDANCE = 30;


function checkCompiler(compiler, errors) {
  if (!isObject(compiler) || typeof compiler.target !== 'string' || typeof compiler.version !== 'string') {
    errors.push({ path: 'compiler', message: 'compiler.target and compiler.version required' });
    return;
  }
  if (!ALLOWED_TARGETS.includes(compiler.target)) {
    errors.push({ path: 'compiler.target', message: `target must be one of ${ALLOWED_TARGETS.join(', ')}` });
  }
  if (compiler.version !== ALLOWED_VERSION) {
    errors.push({ path: 'compiler.version', message: `version must be ${ALLOWED_VERSION}` });
  }
}

function checkInputs(inputs, errors) {
  if (!isObject(inputs)) {
    errors.push({ path: 'inputs', message: 'inputs required' });
    return;
  }
  if (!isStringArray(inputs?.subject) || inputs.subject.length === 0 || inputs.subject.every(value => !String(value || '').trim())) {
    errors.push({ path: 'inputs.subject', message: 'must be non-empty array<string>' });
  }
  const fields = ['environment','style','composition','lighting','palette'];
  for (const f of fields) {
    if (!isStringArray(inputs?.[f])) {
      errors.push({ path: `inputs.${f}`, message: 'must be array<string>' });
    }
  }
}

function checkOptions(options, errors) {
  if (!isObject(options)) {
    errors.push({ path: 'options', message: 'options required' });
    return;
  }
  if (typeof options?.width !== 'number' || typeof options?.height !== 'number') {
    errors.push({ path: 'options.width/height', message: 'width and height must be numbers' });
  } else {
    if (options.width < MIN_WIDTH || options.width > MAX_WIDTH) errors.push({ path: 'options.width', message: `width must be between ${MIN_WIDTH} and ${MAX_WIDTH}` });
    if (options.height < MIN_HEIGHT || options.height > MAX_HEIGHT) errors.push({ path: 'options.height', message: `height must be between ${MIN_HEIGHT} and ${MAX_HEIGHT}` });
  }
  if (typeof options?.steps !== 'number') {
    errors.push({ path: 'options.steps', message: 'steps must be a number' });
  } else if (options.steps < MIN_STEPS || options.steps > MAX_STEPS) {
    errors.push({ path: 'options.steps', message: `steps must be between ${MIN_STEPS} and ${MAX_STEPS}` });
  }
  if (typeof options?.guidance_scale !== 'number') {
    errors.push({ path: 'options.guidance_scale', message: 'guidance_scale must be a number' });
  } else if (options.guidance_scale < MIN_GUIDANCE || options.guidance_scale > MAX_GUIDANCE) {
    errors.push({ path: 'options.guidance_scale', message: `guidance_scale must be between ${MIN_GUIDANCE} and ${MAX_GUIDANCE}` });
  }
}

function checkConstraints(constraints, errors) {
  if (!isObject(constraints)) {
    errors.push({ path: 'constraints', message: 'constraints required' });
    return;
  }
  if (typeof constraints?.safe_mode !== 'boolean' || typeof constraints?.no_text !== 'boolean') {
    errors.push({ path: 'constraints.safe_mode/no_text', message: 'safe_mode and no_text must be boolean' });
  }
}

function validateMaskImageGenerate(mask) {
  const errors = [];
  if (!isObject(mask)) errors.push({ path: '', message: 'MASK must be an object' });
  if (mask.version !== 'mask-1') errors.push({ path: 'version', message: 'version must be mask-1' });
  if (mask.intent !== 'image.generate') errors.push({ path: 'intent', message: 'intent must be image.generate' });
  if (!isObject(mask.task) || mask.task.domain !== 'image' || mask.task.action !== 'generate') {
    errors.push({ path: 'task', message: 'task.domain/action must be image/generate' });
  }
  checkCompiler(mask.compiler, errors);
  checkInputs(mask.inputs, errors);
  checkOptions(mask.options, errors);
  checkConstraints(mask.constraints, errors);
  if (!Array.isArray(mask.ambiguities)) errors.push({ path: 'ambiguities', message: 'ambiguities must be array' });
  if (typeof mask.raw !== 'string' || !mask.raw.trim()) errors.push({ path: 'raw', message: 'raw must be non-empty string' });
  return errors.length ? { valid: false, errors } : { valid: true };
}

module.exports = validateMaskImageGenerate;
