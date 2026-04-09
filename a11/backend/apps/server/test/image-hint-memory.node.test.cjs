const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildImageHintMemorySignature,
  readPreferredImageHintMemory,
  recordSuccessfulImageHintMemory,
} = require('../src/image/image-hint-memory.cjs');

function buildMask() {
  return {
    version: 'mask-1',
    intent: 'image.generate',
    inputs: {
      subject: ['lapin'],
      composition: ['un seul animal complet'],
      environment: ['décor naturel simple'],
      style: ['haute qualité'],
      palette: [],
    },
    meta: {
      subjectProfile: { type: 'single_animal' },
      semantic: {
        accessories: [{ key: 'carotte', label: 'carotte' }],
        elements: [],
        metiers: [],
        scenes: [],
      },
    },
    raw: 'genere une image d un lapin avec une carotte dans la bouche',
  };
}

test('image hint memory persists and replays top hints for the same semantic signature', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'a11-image-hint-memory-'));
  const storePath = path.join(tempDir, 'image-hint-memory.json');
  const mask = buildMask();

  const signature = buildImageHintMemorySignature(mask);
  assert.match(signature.signature, /profile:single_animal/i);
  assert.match(signature.signature, /accessories:carotte/i);

  await recordSuccessfulImageHintMemory({
    mask,
    workingHints: {
      composition_hints: ['accessoire bien visible'],
      environment_hints: ['décor simple et lisible'],
      style_hints: ['illustration nette'],
      prompt_instructions: ['Montrer clairement une carotte dans la bouche du sujet principal.'],
    },
    judgeResult: {
      decision: {
        reason: 'ok',
      },
    },
  }, { storePath });

  await recordSuccessfulImageHintMemory({
    mask,
    workingHints: {
      composition_hints: ['accessoire bien visible'],
      environment_hints: ['décor simple et lisible'],
      style_hints: [],
      prompt_instructions: [],
    },
    judgeResult: {
      decision: {
        reason: 'ok',
      },
    },
  }, { storePath });

  const preferred = await readPreferredImageHintMemory(mask, { storePath });
  assert.equal(preferred.available, true);
  assert.deepEqual(preferred.hints.composition_hints, ['accessoire bien visible']);
  assert.deepEqual(preferred.hints.environment_hints, ['décor simple et lisible']);
  assert.deepEqual(preferred.hints.style_hints, ['illustration nette']);
  assert.deepEqual(preferred.hints.prompt_instructions, ['Montrer clairement une carotte dans la bouche du sujet principal.']);
});
