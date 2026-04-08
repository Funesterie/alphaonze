const compileMaskToSD = require('./compile-mask-to-sd.cjs');

const DEFAULT_SD_ENTRYPOINT = 'tools/sd/generate_sd_image.py';

function shellQuote(value = '') {
  const text = String(value ?? '');
  if (!text) return "''";
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

function pushArg(args, flag, value) {
  if (value === undefined || value === null || value === '') return;
  args.push(flag, String(value));
}

function buildPythonArgv(sdPayload = {}, outputPlaceholder = '$OUTPUT_PNG') {
  const argv = [DEFAULT_SD_ENTRYPOINT];
  pushArg(argv, '--prompt', sdPayload.prompt);
  pushArg(argv, '--num_inference_steps', sdPayload.steps);
  pushArg(argv, '--guidance_scale', sdPayload.guidance_scale);
  pushArg(argv, '--width', sdPayload.width);
  pushArg(argv, '--height', sdPayload.height);
  if (sdPayload.seed !== undefined) {
    pushArg(argv, '--seed', sdPayload.seed);
  }
  pushArg(argv, '--output', outputPlaceholder);
  return argv;
}

function buildCommandPreview(argv = []) {
  return ['python', ...argv.map((entry) => shellQuote(entry))].join(' ');
}

function compileMaskImageToPython(mask) {
  if (mask?.intent !== 'image.generate') {
    throw new Error('MASK intent must be image.generate');
  }

  const sdPayload = compileMaskToSD(mask);
  const argv = buildPythonArgv(sdPayload);

  return {
    kind: 'image.generate',
    state: 'ready',
    value: {
      runtime: 'python.sd.generate',
      command: 'python',
      entrypoint: DEFAULT_SD_ENTRYPOINT,
      argv,
      commandPreview: buildCommandPreview(argv),
      payload: sdPayload,
      outputPlaceholder: '$OUTPUT_PNG',
    },
    meta: {
      maskVersion: mask?.version || 'mask-1',
      compilerTarget: 'python',
      compilerVersion: mask?.compiler?.version || '1.0',
      sourceCompilerTarget: 'sd-payload',
      createdAt: new Date().toISOString(),
    },
  };
}

module.exports = compileMaskImageToPython;
