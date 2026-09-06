'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildVideoPrompt,
  sanitizeVideoNegativePrompt,
  resolveVideoPromptMaxDurationSeconds,
  shouldUseVideoPromptLlm,
  VIDEO_PROMPT_SYSTEM_PROMPT,
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
      referenceVisualContext: 'A young man in a white karate gi with a black belt, short dark hair, standing on a sports hall floor with colored court lines.',
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
    assert.equal(llmInput.reference_visual_context, 'A young man in a white karate gi with a black belt, short dark hair, standing on a sports hall floor with colored court lines.');
    assert.equal(result.source, 'llm');
    assert.match(result.prompt, /western town/);
    assert.match(result.prompt, /karate gi|sports hall floor/i);
  });
});

test('video prompt builder lets local models breathe and turns numeric lore into motion', async () => {
  await withEnv({
    A11_VIDEO_PROMPT_BUILDER_LLM: '1',
    A11_VIDEO_PROMPT_TIMEOUT_MS: '240000',
    A11_VIDEO_PROMPT_GROQ_ENABLED: '0',
    A11_IMAGE_DIRECT_GROQ_ENABLED: '1',
    GROQ_API_KEY: 'groq-disabled-for-video',
  }, async () => {
    const calls = [];
    const result = await buildVideoPrompt({
      userMessage: 'clip rêve Shiryu V9 avec triforce 0.06/0.12/0.18 et émotion cible 0.12',
      hasReferenceImage: true,
      callStructuredLlmJson: async (payload) => {
        calls.push(payload);
        return {
          prompt: 'Vivy V9 stands under neon storm light, 0.06/0.12/0.18 pulses orbit around her, emotion target 0.12',
          negative_prompt: '',
          has_reference_subject: true,
          motion_type: 'transform',
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].timeoutMs, 240000);
    assert.equal(result.source, 'llm');
    assert.doesNotMatch(result.prompt, /0\.06|0\.12|0\.18|V9/);
    assert.match(result.prompt, /abstract rhythmic pulses|abstract pulse|evolving energy system/i);
    assert.match(result.prompt, /No readable text/i);
    assert.match(result.prompt, /no digits/i);
  });
});

test('video prompt builder caps WAN 2.6 scene duration from env instead of the old 10s ceiling', async () => {
  await withEnv({
    A11_VIDEO_PROMPT_BUILDER_LLM: '1',
    A11_VIDEO_PROMPT_MAX_DURATION_SECONDS: '15',
    A11_VIDEO_PROMPT_GROQ_ENABLED: '0',
    A11_IMAGE_DIRECT_GROQ_ENABLED: null,
    GROQ_API_KEY: null,
  }, async () => {
    const result = await buildVideoPrompt({
      userMessage: 'clip rêve Vivy performance néon sur 30 secondes',
      hasReferenceImage: true,
      callStructuredLlmJson: async () => ({
        prompt: 'Vivy performs under electric magenta neon, cinematic singing performance',
        negative_prompt: '',
        duration_seconds: 30,
        has_reference_subject: true,
        motion_type: 'dance',
      }),
    });

    assert.equal(resolveVideoPromptMaxDurationSeconds(), 15);
    assert.equal(result.durationSeconds, 15);
    assert.match(result.prompt, /Vivy performs/i);
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
      referenceVisualContext: 'Young dark-haired karateka, white gi, black belt, sports gym floor with red, yellow and blue court lines, high angle camera.',
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
    assert.match(result.prompt, /white gi|black belt|sports gym floor/i);
    assert.match(result.negativePrompt, /face covered by glow/i);
    assert.doesNotMatch(result.negativePrompt, /mirror|flipped|horizontal flip/i);
  });
});

test('video prompt negative prompt sanitizer strips orientation inversion terms', () => {
  const clean = sanitizeVideoNegativePrompt('blur, mirrored, horizontally flipped, floating limbs');
  assert.equal(clean, 'blur, floating limbs');
});

test('video prompt system keeps Funesterie source intent and role-separated references', () => {
  assert.match(VIDEO_PROMPT_SYSTEM_PROMPT, /WAN 2\.6/i);
  assert.match(VIDEO_PROMPT_SYSTEM_PROMPT, /Djeff Cypher is the primary video prompt engineer/i);
  assert.match(VIDEO_PROMPT_SYSTEM_PROMPT, /Vivy is the art director/i);
  assert.match(VIDEO_PROMPT_SYSTEM_PROMPT, /never a generic list of prompt alternatives/i);
  assert.match(VIDEO_PROMPT_SYSTEM_PROMPT, /Funesterie source principle/i);
  assert.match(VIDEO_PROMPT_SYSTEM_PROMPT, /source of intent/i);
  assert.match(VIDEO_PROMPT_SYSTEM_PROMPT, /Keep roles separate/i);
  assert.match(VIDEO_PROMPT_SYSTEM_PROMPT, /references are not decorative/i);
  assert.match(VIDEO_PROMPT_SYSTEM_PROMPT, /identity, setting, rhythm, style, voice, montage/i);
});
