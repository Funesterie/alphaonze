'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildVideoPrompt,
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
    assert.equal(result.source, 'llm');
    assert.match(result.prompt, /western town/);
  });
});
