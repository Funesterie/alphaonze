const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../src/video/video-frame-prompter.cjs');

function loadPrompterModule() {
  delete require.cache[modulePath];
  return require(modulePath);
}

function withEnv(name, value) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
    delete require.cache[modulePath];
  };
}

test('generateFramePromptsWithLlm pads incomplete frame lists without changing the active prompter flow', async () => {
  const restoreEnv = withEnv('A11_VIDEO_LLM_PROMPTER', 'true');
  try {
    const { generateFramePromptsWithLlm } = loadPrompterModule();
    const result = await generateFramePromptsWithLlm({
      subject: 'Mario with red cap and blue overalls',
      motionProfile: 'walk_cycle',
      frameCount: 4,
      prompt: 'mario walks forward on a side view platform stage',
      identityLocks: ['same outfit', 'same face'],
      visualContext: 'side view platformer stage',
      callLlm: async () => ({
        subject_type: 'humanoid',
        motion_description: 'walk cycle',
        scene_context: 'side view colorful platform stage',
        frames: [
          {
            label: 'start',
            prompt: 'Mario with red cap and blue overalls shifts his weight forward before the first step',
          },
          {
            label: 'step',
            prompt: 'Mario with red cap and blue overalls lifts one leg and swings the opposite arm',
          },
        ],
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.frameCount, 4);
    assert.equal(result.beats.length, 4);
    assert.deepEqual(
      result.beats.map((beat) => beat.label),
      ['start', 'step', 'step', 'step']
    );
    assert.match(String(result.sceneContext || ''), /side view colorful platform stage/i);
  } finally {
    restoreEnv();
  }
});

test('generateFramePromptsWithLlm rejects invalid frame payloads', async () => {
  const restoreEnv = withEnv('A11_VIDEO_LLM_PROMPTER', 'true');
  try {
    const { generateFramePromptsWithLlm } = loadPrompterModule();
    const result = await generateFramePromptsWithLlm({
      subject: 'Link',
      motionProfile: 'action_burst',
      frameCount: 3,
      prompt: 'link attacks with sword',
      callLlm: async () => ({
        subject_type: 'humanoid',
        frames: [{ label: 'broken', prompt: '   ' }],
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_llm_response');
  } finally {
    restoreEnv();
  }
});

test('isLlmFramePrompterEnabled obeys the environment toggle', () => {
  const restoreEnv = withEnv('A11_VIDEO_LLM_PROMPTER', 'false');
  try {
    const { isLlmFramePrompterEnabled } = loadPrompterModule();
    assert.equal(isLlmFramePrompterEnabled(), false);
  } finally {
    restoreEnv();
  }
});
