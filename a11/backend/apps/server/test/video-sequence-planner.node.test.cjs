const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=',
  'base64'
);

const plannerModulePath = require.resolve('../src/video/video-sequence-planner.cjs');
const janusRuntimeModulePath = require.resolve('../lib/janus-vision-runtime.cjs');
const prompterModulePath = require.resolve('../src/video/video-frame-prompter.cjs');

async function withPlannerStubs(stubs, fn) {
  const janusRuntime = require(janusRuntimeModulePath);
  const prompterModule = require(prompterModulePath);
  const janusStubs = stubs?.janus && typeof stubs.janus === 'object'
    ? stubs.janus
    : (stubs || {});
  const prompterStubs = stubs?.prompter && typeof stubs.prompter === 'object'
    ? stubs.prompter
    : {};
  const previousJanus = {};
  const previousPrompter = {};
  for (const [key, value] of Object.entries(janusStubs)) {
    previousJanus[key] = janusRuntime[key];
    janusRuntime[key] = value;
  }
  for (const [key, value] of Object.entries(prompterStubs)) {
    previousPrompter[key] = prompterModule[key];
    prompterModule[key] = value;
  }
  delete require.cache[plannerModulePath];
  const planner = require(plannerModulePath);
  try {
    return await fn(planner);
  } finally {
    delete require.cache[plannerModulePath];
    for (const [key, value] of Object.entries(previousJanus)) {
      janusRuntime[key] = value;
    }
    for (const [key, value] of Object.entries(previousPrompter)) {
      prompterModule[key] = value;
    }
  }
}

function buildRequest(config = {}) {
  return {
    prompt: 'mario avancant sur le chemin un pas devant l autre',
    frameCount: 8,
    timingPlan: {
      motionProfile: 'walk_cycle',
    },
    config: {
      sequencePlanner: 'auto',
      sequencePlannerImageAware: true,
      sequencePlannerTimeoutMs: 15_000,
      frameReanchorEvery: 6,
      ...config,
    },
  };
}

function buildJanusPlan(overrides = {}) {
  return {
    motionProfile: 'walk_cycle',
    globalObjective: 'faire progresser une marche claire et lisible',
    frameProgressionRule: 'chaque beat fait avancer les appuis et le balancier',
    compositionHints: ['corps entier lisible', 'progression de marche claire'],
    identityLocks: ['le meme visage', 'la meme tenue'],
    sceneLocks: ['chemin stable', 'fond simple'],
    beats: [
      {
        label: 'depart',
        structuralState: 'posture neutre de marche, poids reparti sur les deux jambes',
        variation: 'jambe gauche avance devant, bras droit vient legerement devant',
        checkpoint: true,
        rendererFocus: ['balancier naturel des bras'],
      },
      {
        label: 'passage',
        structuralState: 'buste stable, bassin lisible',
        variation: 'jambe droite passe sous le corps, marche continue',
        checkpoint: false,
        rendererFocus: ['silhouette propre'],
      },
    ],
    ...overrides,
  };
}

test('resolveSequencePlanningEnvConfig parses planner-specific env vars', () => {
  withPlannerStubs({}, ({ resolveSequencePlanningEnvConfig }) => {
    const config = resolveSequencePlanningEnvConfig({
      A11_VIDEO_SEQUENCE_PLANNER: 'janus',
      A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE: 'false',
      A11_VIDEO_SEQUENCE_PLANNER_TIMEOUT_MS: '120000',
    });
    assert.equal(config.sequencePlanner, 'janus');
    assert.equal(config.sequencePlannerImageAware, false);
    assert.equal(config.sequencePlannerTimeoutMs, 120000);
  });
});

test('resolveSequencePlanningEnvConfig defaults to a shorter Janus timeout', () => {
  withPlannerStubs({}, ({ resolveSequencePlanningEnvConfig }) => {
    const config = resolveSequencePlanningEnvConfig({});
    assert.equal(config.sequencePlannerTimeoutMs, 20000);
  });
});

test('buildJanusSequencePlannerPrompt emits english planner instructions and keeps reference size context', async () => {
  await withPlannerStubs({}, async ({ buildJanusSequencePlannerPrompt }) => {
    const prompt = buildJanusSequencePlannerPrompt({
      request: {
        prompt: 'genere une video de James Bond marchant',
        frameCount: 8,
        sourceImageWidth: 1152,
        sourceImageHeight: 1344,
      },
      compiledBasePrompt: 'James Bond walking, coherent decor matching the requested scene',
      heuristicPlan: buildJanusPlan(),
    });

    assert.match(String(prompt || ''), /You are a video sequence planner/i);
    assert.match(String(prompt || ''), /Reference image size:\s+1152x1344/i);
    assert.match(String(prompt || ''), /Heuristic baseline plan:/i);
    assert.doesNotMatch(String(prompt || ''), /Tu es un planner|Taille de l image de reference|Plan heuristique de depart/i);
  });
});

test('planVideoSequence keeps heuristic mode local and never calls Janus', async () => {
  let janusCalls = 0;
  await withPlannerStubs({
    resolveVisionProvider: () => 'janus',
    callJanusText: async () => {
      janusCalls += 1;
      return { text: '{}' };
    },
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: buildRequest({ sequencePlanner: 'heuristic' }),
      compiledBasePrompt: 'mario avancant sur le chemin un pas devant l autre',
    });
    assert.equal(plan.providerUsed, 'heuristic');
    assert.equal(plan.providerRequested, 'heuristic');
    assert.equal(plan.fallbackReason, null);
    assert.equal(janusCalls, 0);
  });
});

test('planVideoSequence auto uses Janus when it is available', async () => {
  let janusCalls = 0;
  let shutdownCalls = 0;
  await withPlannerStubs({
    resolveVisionProvider: () => 'janus',
    callJanusText: async () => {
      janusCalls += 1;
      return { text: JSON.stringify(buildJanusPlan()) };
    },
    callJanusVisionText: async () => {
      throw new Error('image-aware should stay inactive without a real source');
    },
    shutdownJanusVisionWorker: () => {
      shutdownCalls += 1;
    },
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: buildRequest({ sequencePlanner: 'auto' }),
      compiledBasePrompt: 'mario avancant sur le chemin un pas devant l autre',
    });
    assert.equal(plan.providerRequested, 'auto');
    assert.equal(plan.providerUsed, 'janus');
    assert.equal(plan.motionProfile, 'walk_cycle');
    assert.equal(plan.imageAwareUsed, false);
    assert.match(String(plan.beats[0]?.variation || ''), /jambe gauche avance devant/i);
    assert.equal(janusCalls, 1);
    assert.equal(shutdownCalls, 1);
  });
});

test('planVideoSequence explicit janus mode skips the LLM prompter even when it could succeed', async () => {
  let janusCalls = 0;
  let llmCalls = 0;
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusText: async () => {
        janusCalls += 1;
        return { text: JSON.stringify(buildJanusPlan()) };
      },
    },
    prompter: {
      isLlmFramePrompterEnabled: () => true,
      generateFramePromptsWithLlm: async () => {
        llmCalls += 1;
        return {
          ok: true,
          subjectType: 'humanoid',
          motionDescription: 'walk cycle',
          sceneContext: 'llm scene',
          beats: [
            { label: 'llm', structuralState: 'llm structure', variation: 'llm variation', checkpoint: true, rendererFocus: [] },
          ],
        };
      },
    },
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: buildRequest({ sequencePlanner: 'janus' }),
      compiledBasePrompt: 'mario avancant sur le chemin un pas devant l autre',
    });

    assert.equal(plan.providerRequested, 'janus');
    assert.equal(plan.providerUsed, 'janus');
    assert.equal(janusCalls, 1);
    assert.equal(llmCalls, 0);
  });
});

test('planVideoSequence explicit llm_prompter mode uses the LLM planner without calling Janus', async () => {
  let janusCalls = 0;
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusText: async () => {
        janusCalls += 1;
        return { text: JSON.stringify(buildJanusPlan()) };
      },
    },
    prompter: {
      isLlmFramePrompterEnabled: () => true,
      generateFramePromptsWithLlm: async () => ({
        ok: true,
        subjectType: 'humanoid',
        motionDescription: 'walk cycle',
        sceneContext: 'side view colorful platform stage',
        beats: [
          {
            label: 'start',
            structuralState: 'Mario stands in a clear side view platform pose',
            variation: 'Mario starts the first visible walking step',
            checkpoint: true,
            rendererFocus: [],
          },
        ],
      }),
    },
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: buildRequest({ sequencePlanner: 'llm_prompter' }),
      compiledBasePrompt: 'mario avancant sur le chemin un pas devant l autre',
    });

    assert.equal(plan.providerRequested, 'llm_prompter');
    assert.equal(plan.providerUsed, 'llm_prompter');
    assert.match(String(plan.sceneContext || ''), /side view colorful platform stage/i);
    assert.equal(janusCalls, 0);
  });
});

test('planVideoSequence forwards reference image dimensions into the LLM planner context', async () => {
  let capturedArgs = null;
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
    },
    prompter: {
      isLlmFramePrompterEnabled: () => true,
      generateFramePromptsWithLlm: async (args) => {
        capturedArgs = args;
        return {
          ok: true,
          subjectType: 'humanoid',
          motionDescription: 'walk cycle',
          sceneContext: 'portrait spy shot',
          beats: [
            {
              label: 'start',
              structuralState: 'James Bond stands in a clear portrait frame',
              variation: 'James Bond starts a visible walking step',
              checkpoint: true,
              rendererFocus: [],
            },
          ],
        };
      },
    },
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: {
        ...buildRequest({ sequencePlanner: 'llm_prompter' }),
        prompt: 'genere une video de James Bond marchant',
        sourceImageWidth: 1152,
        sourceImageHeight: 1344,
      },
      compiledBasePrompt: 'James Bond walking, coherent decor matching the requested scene',
    });

    assert.equal(plan.providerUsed, 'llm_prompter');
    assert.equal(capturedArgs?.referenceImageWidth, 1152);
    assert.equal(capturedArgs?.referenceImageHeight, 1344);
    assert.match(String(capturedArgs?.visualContext || ''), /1152x1344/i);
  });
});

test('planVideoSequence falls back to the heuristic planner when Janus returns invalid JSON', async () => {
  await withPlannerStubs({
    resolveVisionProvider: () => 'janus',
    callJanusText: async () => ({ text: 'ceci nest pas du json' }),
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: buildRequest({ sequencePlanner: 'janus' }),
      compiledBasePrompt: 'mario avancant sur le chemin un pas devant l autre',
    });
    assert.equal(plan.providerRequested, 'janus');
    assert.equal(plan.providerUsed, 'heuristic');
    assert.match(String(plan.fallbackReason || ''), /janus_invalid_plan_payload/i);
    assert.equal(plan.motionProfile, 'walk_cycle');
    assert.ok(Array.isArray(plan.beats) && plan.beats.length > 0);
  });
});

test('planVideoSequence reuses compiled stable identity hints in heuristic fallback plans', async () => {
  await withPlannerStubs({
    resolveVisionProvider: () => 'none',
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: {
        prompt: 'goku se transformant en super saiyan divin',
        frameCount: 10,
        timingPlan: {
          motionProfile: 'transformation_rise',
        },
        config: {
          sequencePlanner: 'auto',
          sequencePlannerImageAware: false,
          sequencePlannerTimeoutMs: 15_000,
          frameReanchorEvery: 0,
        },
      },
      compiledBasePrompt: 'goku se transformant en super saiyan divin, illustration anime de combat nette, tenue orange et bleue lisible, fond simple cohérent avec le personnage',
    });

    assert.equal(plan.providerUsed, 'heuristic');
    assert.equal(plan.fallbackReason, 'janus_unavailable');
    assert.match(String(plan.sceneLocks.join(', ') || ''), /tenue orange et bleue lisible/i);
    assert.doesNotMatch(String(plan.sceneLocks.join(', ') || ''), /illustration anime de combat nette/i);
  });
});

test('planVideoSequence only enables image-aware refinement when a real source image exists', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-janus-seq-'));
  const sourceImagePath = path.join(tempDir, 'source.png');
  fs.writeFileSync(sourceImagePath, TINY_PNG);

  let imageAwareCalls = 0;
  await withPlannerStubs({
    resolveVisionProvider: () => 'janus',
    callJanusText: async () => ({ text: JSON.stringify(buildJanusPlan()) }),
    callJanusVisionText: async () => {
      imageAwareCalls += 1;
      return {
        text: JSON.stringify(buildJanusPlan({
          sceneLocks: ['chemin stable', 'fond simple', 'reference visuelle coherente'],
        })),
      };
    },
  }, async ({ planVideoSequence }) => {
    const withoutImage = await planVideoSequence({
      request: buildRequest({ sequencePlanner: 'auto', sequencePlannerImageAware: true }),
      compiledBasePrompt: 'mario avancant sur le chemin un pas devant l autre',
      sourceImagePath: path.join(tempDir, 'missing.png'),
    });
    assert.equal(withoutImage.imageAwareUsed, false);

    const withImage = await planVideoSequence({
      request: buildRequest({ sequencePlanner: 'auto', sequencePlannerImageAware: true }),
      compiledBasePrompt: 'mario avancant sur le chemin un pas devant l autre',
      sourceImagePath,
    });
    assert.equal(withImage.providerUsed, 'janus');
    assert.equal(withImage.imageAwareUsed, true);
    assert.match(String(withImage.sceneLocks.join(', ') || ''), /reference visuelle coherente/i);
    assert.equal(imageAwareCalls, 1);
  });
});

test('planVideoSequence keeps Janus planning but records invalid image-aware source errors explicitly', async () => {
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusText: async () => ({ text: JSON.stringify(buildJanusPlan()) }),
      callJanusVisionText: async () => {
        throw new Error('image-aware should not run with an invalid source url');
      },
    },
    prompter: {
      isLlmFramePrompterEnabled: () => false,
    },
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: buildRequest({ sequencePlanner: 'auto', sequencePlannerImageAware: true }),
      compiledBasePrompt: 'mario avancant sur le chemin un pas devant l autre',
      sourceImageUrl: 'file:///etc/passwd',
    });

    assert.equal(plan.providerUsed, 'janus');
    assert.equal(plan.imageAwareUsed, false);
    assert.equal(plan.imageAwareError, 'janus_image_source_url_not_allowed');
  });
});
