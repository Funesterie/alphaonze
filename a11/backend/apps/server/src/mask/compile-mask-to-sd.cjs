const compileMaskToImagePrompt = require('./compile-mask-to-image-prompt.cjs');

function compileMaskToSD(mask) {
  if (mask?.intent !== 'image.generate') {
    throw new Error('MASK intent must be image.generate');
  }

  const compiled = compileMaskToImagePrompt(mask);
  const sdPayload = {
    prompt: String(compiled?.prompt || '').trim(),
    prompt_language: String(compiled?.prompt_language || 'fr').trim() || 'fr',
    width: Number(compiled?.width || mask?.options?.width || 768),
    height: Number(compiled?.height || mask?.options?.height || 768),
    steps: Number(compiled?.num_inference_steps || mask?.options?.steps || 40),
    guidance_scale: Number(compiled?.guidance_scale || mask?.options?.guidance_scale || 8),
  };

  if (compiled?.seed !== undefined) {
    sdPayload.seed = Number(compiled.seed);
  }
  if (typeof mask?.options?.sampler === 'string' && mask.options.sampler.trim()) {
    sdPayload.sampler = String(mask.options.sampler).trim();
  }

  return sdPayload;
}

module.exports = compileMaskToSD;
