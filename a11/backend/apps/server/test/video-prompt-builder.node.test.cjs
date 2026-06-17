'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildVideoPrompt,
  sanitizeVideoNegativePrompt,
  shouldUseVideoPromptLlm,
} = require('../src/video/video-prompt-builder.cjs');

function withEnv(values, fn) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value == null) delete process.env[key];
      else process.env[key] = String(value);
    }
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('video prompt builder stays heuristic by default to avoid extra LLM quota', async () => {
  await withEnv({
    A11_VIDEO_PROMPT_BUILDER_LLM: null,
    A11_VIDEO_PROMPT_LLM: null,
  }, async () => {
    assert.equal(shouldUseVideoPromptLlm(), false);
    const result = await buildVideoPrompt({
      userMessage: 'je marche dans tokyo la nuit',
      hasReferenceImage: true,
      callStructuredLlmJson: async () => {
        throw new Error('LLM should not be called by default');
      },
    });

    assert.equal(result.source, 'heuristic');
    assert.equal(result.motionType, 'walk');
    assert.equal(result.hasReferenceSubject, true);
    assert.match(result.prompt, /Tokyo streets at night/i);
  });
});

test('video prompt builder can use the LLM when explicitly enabled', async () => {
  await withEnv({
    A11_VIDEO_PROMPT_BUILDER_LLM: '1',
  }, async () => {
    const calls = [];
    const result = await buildVideoPrompt({
      userMessage: 'mets-moi dans le far west',
      hasReferenceImage: true,
      referenceImageUrls: [
        'https://files.example.com/identity.png',
        'https://files.example.com/desert-style.png',
      ],
      referenceAudioUrls: [
        'https://files.example.com/sync.wav',
      ],
      referenceVideoUrls: [
        'https://files.example.com/motion-ref.mp4',
      ],
      callStructuredLlmJson: async (payload) => {
        calls.push(payload);
        return {
          prompt: 'Walking through a dusty western town at sunset, cinematic first-person motion',
          has_reference_subject: true,
          motion_type: 'walk',
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].stage, 'video_prompt_builder');
    const llmInput = JSON.parse(calls[0].text);
    assert.equal(llmInput.has_reference_image, true);
    assert.equal(llmInput.reference_count, 2);
    assert.deepEqual(llmInput.reference_image_urls, [
      'https://files.example.com/identity.png',
      'https://files.example.com/desert-style.png',
    ]);
    assert.deepEqual(llmInput.reference_audio_urls, [
      'https://files.example.com/sync.wav',
    ]);
    assert.deepEqual(llmInput.reference_video_urls, [
      'https://files.example.com/motion-ref.mp4',
    ]);
    assert.equal(result.source, 'llm');
    assert.match(result.prompt, /western town/);
  });
});

test('video prompt builder keeps energy effects off the face without orientation inversion bans', async () => {
  await withEnv({
    A11_VIDEO_PROMPT_BUILDER_LLM: null,
    A11_VIDEO_PROMPT_LLM: null,
    A11_VIDEO_PROMPT_GROQ_ENABLED: null,
  }, async () => {
    const result = await buildVideoPrompt({
      userMessage: 'génère une vidéo du karatéka qui lance un hadouken',
      hasReferenceImage: true,
      referenceImageUrls: ['https://files.example.com/karateka.png'],
      referenceVideoUrls: ['https://files.example.com/hadouken-ref.mp4'],
      callStructuredLlmJson: async () => {
        throw new Error('LLM should not be called in heuristic test');
      },
    });

    assert.equal(result.source, 'heuristic');
    assert.equal(result.motionType, 'fight');
    assert.match(result.prompt, /reference camera angle/i);
    assert.match(result.prompt, /facial likeness/i);
    assert.match(result.prompt, /face remains visible/i);
    assert.match(result.prompt, /reference video/i);
    assert.match(result.negativePrompt, /face covered by glow/i);
    assert.doesNotMatch(result.negativePrompt, /mirror|flipped|horizontal flip/i);
  });
});

test('video prompt negative prompt sanitizer strips orientation inversion terms', () => {
  const clean = sanitizeVideoNegativePrompt('blur, mirrored, horizontally flipped, floating limbs');
  assert.equal(clean, 'blur, floating limbs');
});
