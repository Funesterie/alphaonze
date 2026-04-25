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

test('generateFramePromptsWithLlm accepts structured frame beats, continuity locks, and sound cues', async () => {
  const restoreEnv = withEnv('A11_VIDEO_LLM_PROMPTER', 'true');
  try {
    const { generateFramePromptsWithLlm } = loadPrompterModule();
    const result = await generateFramePromptsWithLlm({
      subject: 'the knight in dark armor',
      motionProfile: 'action_burst',
      frameCount: 2,
      prompt: 'the knight in dark armor bends toward the golden sword in a torch-lit stone hall',
      identityLocks: ['same knight', 'same golden sword'],
      visualContext: 'torch-lit stone hall, low angle camera, golden sword on the right',
      visualAnalysis: {
        subjects: [
          {
            label: 'knight in dark armor',
            bbox: [0.14, 0.18, 0.32, 0.56],
          },
        ],
        props: [
          {
            label: 'golden sword',
            bbox: [0.58, 0.38, 0.2, 0.36],
          },
        ],
      },
      callLlm: async () => ({
        subject_type: 'humanoid',
        motion_description: 'the knight reaches for the sword',
        scene_context: 'low angle view inside a torch-lit stone hall',
        continuity_locks: ['same knight', 'same golden sword', 'same stone hall'],
        sound_cues: ['metallic ring'],
        frame_beats: [
          {
            label: 'reach',
            prompt: 'The knight in dark armor bends toward the golden sword with one gauntleted hand reaching for the hilt',
            sound_cues: ['metallic ring'],
          },
        ],
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.frameCount, 2);
    assert.match(String(result.sceneContext || ''), /torch-lit stone hall/i);
    assert.deepEqual(result.continuityLocks, ['same knight', 'same golden sword', 'same stone hall']);
    assert.deepEqual(result.soundCues, ['metallic ring']);
    assert.deepEqual(result.beats[0].soundCues, ['metallic ring']);
    assert.match(String(result.beats[0].variation || ''), /knight in dark armor/i);
    assert.match(String(result.beats[0].variation || ''), /golden sword/i);
  } finally {
    restoreEnv();
  }
});

test('generateFramePromptsWithLlm accepts structured frame beats and keeps the subject concrete', async () => {
  const restoreEnv = withEnv('A11_VIDEO_LLM_PROMPTER', 'true');
  try {
    const { generateFramePromptsWithLlm } = loadPrompterModule();
    const result = await generateFramePromptsWithLlm({
      subject: 'the knight in dark armor with a golden sword',
      motionProfile: 'action_burst',
      frameCount: 2,
      prompt: 'the knight in dark armor bends toward the golden sword in a torchlit stone hall',
      identityLocks: ['same knight', 'same dark armor', 'same golden sword'],
      visualContext: 'torchlit stone hall, low angle framing',
      callLlm: async () => ({
        subject_type: 'humanoid',
        motion_description: 'measured kneeling approach',
        scene_context: 'torchlit stone hall, low angle frame, drifting dust',
        continuity_locks: ['same knight', 'same dark armor', 'same golden sword'],
        sound_cues: ['metal clang', 'armor rattle'],
        frame_beats: [
          {
            label: 'approach',
            beat: 'structure bends toward the golden sword',
            sound_cue: 'metal clang',
          },
          {
            label: 'grip',
            prompt: 'the knight in dark armor grips the golden sword with both hands',
            sound_cue: 'armor rattle',
          },
        ],
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.frameCount, 2);
    assert.match(String(result.sceneContext || ''), /torchlit stone hall/i);
    assert.deepEqual(result.continuityLocks, ['same knight', 'same dark armor', 'same golden sword']);
    assert.deepEqual(result.soundCues, ['metal clang', 'armor rattle']);
    assert.match(String(result.beats[0]?.variation || ''), /knight/i);
    assert.match(String(result.beats[0]?.variation || ''), /golden sword/i);
    assert.doesNotMatch(String(result.beats[0]?.variation || ''), /\bstructure\b/i);
    assert.equal(result.beats[0]?.soundCue, 'metal clang');
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

test('generateFramePromptsWithLlm rejects generic frame prompts that do not name the main subject concretely', async () => {
  const restoreEnv = withEnv('A11_VIDEO_LLM_PROMPTER', 'true');
  try {
    const { generateFramePromptsWithLlm } = loadPrompterModule();
    const result = await generateFramePromptsWithLlm({
      subject: 'the knight in dark armor',
      motionProfile: 'action_burst',
      frameCount: 2,
      prompt: 'the knight in dark armor bends toward the golden sword',
      callLlm: async () => ({
        subject_type: 'humanoid',
        frame_beats: [
          {
            label: 'broken',
            prompt: 'The structure changes a little while the scene stays stable',
          },
        ],
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

test('generateFramePromptsWithLlm retries once on invalid response and succeeds on second call', async () => {
  const restoreEnv = withEnv('A11_VIDEO_LLM_PROMPTER', 'true');
  try {
    const { generateFramePromptsWithLlm } = loadPrompterModule();
    let callCount = 0;
    const result = await generateFramePromptsWithLlm({
      subject: 'Mario with red cap and blue overalls',
      motionProfile: 'walk_cycle',
      frameCount: 2,
      prompt: 'mario walks forward on a side view platform stage',
      callLlm: async () => {
        callCount += 1;
        if (callCount === 1) {
          // Premier appel : réponse invalide (frames vides)
          return {
            subject_type: 'humanoid',
            motion_description: 'walk cycle',
            scene_context: 'side view platform stage',
            frame_beats: [],
          };
        }
        // Deuxième appel (retry compact) : réponse valide
        return {
          subject_type: 'humanoid',
          motion_description: 'walk cycle',
          scene_context: 'side view colorful platform stage',
          frame_beats: [
            {
              label: 'start',
              prompt: 'Mario with red cap and blue overalls shifts his weight forward',
            },
            {
              label: 'step',
              prompt: 'Mario with red cap and blue overalls lifts one leg and swings the opposite arm',
            },
          ],
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.frameCount, 2);
    assert.equal(result.beats.length, 2);
    assert.equal(callCount, 2);
    assert.match(String(result.sceneContext || ''), /side view colorful platform stage/i);
  } finally {
    restoreEnv();
  }
});

test('generateFramePromptsWithLlm returns invalid_llm_response after two failed attempts', async () => {
  const restoreEnv = withEnv('A11_VIDEO_LLM_PROMPTER', 'true');
  try {
    const { generateFramePromptsWithLlm } = loadPrompterModule();
    let callCount = 0;
    const result = await generateFramePromptsWithLlm({
      subject: 'Mario with red cap and blue overalls',
      motionProfile: 'walk_cycle',
      frameCount: 2,
      prompt: 'mario walks forward on a side view platform stage',
      callLlm: async () => {
        callCount += 1;
        // Toujours invalide (frames vides)
        return {
          subject_type: 'humanoid',
          motion_description: 'walk cycle',
          scene_context: 'side view platform stage',
          frame_beats: [],
        };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_llm_response');
    assert.equal(result.beats, null);
    assert.equal(callCount, 2); // initial + 1 retry
  } finally {
    restoreEnv();
  }
});

test('generateFramePromptsWithLlm splits 8 frames into chunks of 4 and merges beats', async () => {
  const restoreEnv = withEnv('A11_VIDEO_LLM_PROMPTER', 'true');
  const restoreChunk = withEnv('A11_VIDEO_LLM_PROMPTER_CHUNK_SIZE', '4');
  try {
    const { generateFramePromptsWithLlm } = loadPrompterModule();
    let callCount = 0;
    const result = await generateFramePromptsWithLlm({
      subject: 'Mario with red cap and blue overalls',
      motionProfile: 'walk_cycle',
      frameCount: 8,
      prompt: 'mario walks forward on a side view platform stage',
      callLlm: async () => {
        callCount += 1;
        return {
          subject_type: 'humanoid',
          motion_description: 'walk cycle',
          scene_context: 'side view colorful platform stage',
          frame_beats: [
            { label: `chunk${callCount}-a`, prompt: `Mario with red cap and blue overalls step ${callCount}a` },
            { label: `chunk${callCount}-b`, prompt: `Mario with red cap and blue overalls step ${callCount}b` },
            { label: `chunk${callCount}-c`, prompt: `Mario with red cap and blue overalls step ${callCount}c` },
            { label: `chunk${callCount}-d`, prompt: `Mario with red cap and blue overalls step ${callCount}d` },
          ],
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.frameCount, 8);
    assert.equal(result.beats.length, 8);
    assert.equal(callCount, 2); // 8 frames / 4 par chunk = 2 appels LLM
  } finally {
    restoreEnv();
    restoreChunk();
  }
});
