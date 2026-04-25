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

function buildJanusVisualScan(overrides = {}) {
  return {
    scene: {
      decor: ['torch-lit stone hall', 'stone floor'],
      cameraFraming: ['low angle framing', 'medium full body'],
      lighting: ['warm torch light on the right side'],
    },
    subjects: [
      {
        label: 'knight in dark armor',
        pose: 'bending toward the sword',
        anatomy: ['right gauntleted hand extended', 'torso leaning forward'],
        accessories: ['dark armor', 'cape'],
        props: ['golden sword'],
        bbox: [0.14, 0.18, 0.32, 0.56],
      },
    ],
    props: [
      {
        label: 'golden sword',
        details: ['ornate hilt'],
        bbox: [0.58, 0.38, 0.2, 0.36],
      },
    ],
    continuityAnchors: ['same knight', 'same golden sword', 'same torch-lit hall'],
    continuityRisks: ['keep the sword fully visible near the right edge'],
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

test('buildJanusVisualScanPrompt emits english visual scan instructions and keeps reference size context', async () => {
  await withPlannerStubs({}, async ({ buildJanusVisualScanPrompt }) => {
    const prompt = buildJanusVisualScanPrompt({
      request: {
        prompt: 'genere une video de James Bond marchant',
        frameCount: 8,
        sourceImageWidth: 1152,
        sourceImageHeight: 1344,
      },
      compiledBasePrompt: 'James Bond walking, coherent decor matching the requested scene',
    });

    assert.match(String(prompt || ''), /You are a visual continuity analyst/i);
    assert.match(String(prompt || ''), /Reference image size:\s+1152x1344/i);
    assert.match(String(prompt || ''), /approximate normalized regions/i);
    assert.doesNotMatch(String(prompt || ''), /Tu es un planner|Taille de l image de reference|Plan heuristique de depart/i);
  });
});

test('planVideoSequence keeps heuristic mode local and never calls Janus', async () => {
  let janusCalls = 0;
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusVisionText: async () => {
        janusCalls += 1;
        return { text: '{}' };
      },
    },
    prompter: {
      isLlmFramePrompterEnabled: () => false,
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

test('planVideoSequence auto keeps the LLM as prompt writer and uses Janus only as visual scan context', async () => {
  let janusTextCalls = 0;
  let janusVisionCalls = 0;
  let shutdownCalls = 0;
  let capturedPrompterArgs = null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-janus-scan-'));
  const sourceImagePath = path.join(tempDir, 'source.png');
  fs.writeFileSync(sourceImagePath, TINY_PNG);

  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusText: async () => {
        janusTextCalls += 1;
        return { text: JSON.stringify(buildJanusPlan()) };
      },
      callJanusVisionText: async () => {
        janusVisionCalls += 1;
        return { text: JSON.stringify(buildJanusVisualScan()) };
      },
      shutdownJanusVisionWorker: () => {
        shutdownCalls += 1;
      },
    },
    prompter: {
      isLlmFramePrompterEnabled: () => true,
      generateFramePromptsWithLlm: async (args) => {
        capturedPrompterArgs = args;
        return {
          ok: true,
          subjectType: 'humanoid',
          motionDescription: 'the knight reaches for the sword',
          sceneContext: 'low angle camera in a torch-lit stone hall',
          continuityLocks: ['same knight', 'same golden sword', 'same torch-lit hall'],
          soundCues: ['metallic ring'],
          beats: [
            {
              label: 'reach',
              structuralState: 'The knight in dark armor leans toward the golden sword with one gauntleted hand reaching for the hilt',
              variation: 'The knight in dark armor bends lower toward the golden sword as the blade catches warm light',
              checkpoint: true,
              rendererFocus: ['golden sword hilt clearly visible'],
              soundCues: ['metallic ring'],
            },
          ],
        };
      },
    },
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: {
        ...buildRequest({ sequencePlanner: 'auto', sequencePlannerImageAware: true }),
        prompt: 'the knight in dark armor bends toward the golden sword',
      },
      compiledBasePrompt: 'the knight in dark armor bends toward the golden sword in a torch-lit stone hall',
      sourceImagePath,
    });
    assert.equal(plan.providerRequested, 'auto');
    assert.equal(plan.providerUsed, 'llm_prompter');
    assert.equal(plan.imageAwareUsed, true);
    assert.equal(janusTextCalls, 0);
    assert.equal(janusVisionCalls, 1);
    assert.equal(shutdownCalls, 1);
    assert.equal(capturedPrompterArgs?.visualAnalysis?.subjects?.[0]?.label, 'knight in dark armor');
    assert.deepEqual(capturedPrompterArgs?.visualAnalysis?.props?.[0]?.bbox, [0.58, 0.38, 0.2, 0.36]);
    assert.match(String(capturedPrompterArgs?.visualContext || ''), /golden sword/i);
    assert.match(String(plan.beats[0]?.variation || ''), /knight in dark armor/i);
    assert.match(String(plan.beats[0]?.variation || ''), /golden sword/i);
    assert.deepEqual(plan.continuityLocks, ['same knight', 'same golden sword', 'same torch-lit hall']);
    assert.deepEqual(plan.soundCues, ['metallic ring']);
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('planVideoSequence explicit janus mode keeps Janus as a visual analyst while the LLM owns the beats', async () => {
  let janusTextCalls = 0;
  let janusVisionCalls = 0;
  let llmCalls = 0;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-janus-only-'));
  const sourceImagePath = path.join(tempDir, 'source.png');
  fs.writeFileSync(sourceImagePath, TINY_PNG);
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusText: async () => {
        janusTextCalls += 1;
        return { text: JSON.stringify(buildJanusPlan()) };
      },
      callJanusVisionText: async () => {
        janusVisionCalls += 1;
        return { text: JSON.stringify(buildJanusVisualScan()) };
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
      request: {
        ...buildRequest({ sequencePlanner: 'janus', sequencePlannerImageAware: true }),
        prompt: 'the knight in dark armor bends toward the golden sword',
      },
      compiledBasePrompt: 'the knight in dark armor bends toward the golden sword in a torch-lit stone hall',
      sourceImagePath,
    });

    assert.equal(plan.providerRequested, 'janus');
    assert.equal(plan.providerUsed, 'llm_prompter');
    assert.equal(plan.imageAwareUsed, true);
    assert.equal(janusTextCalls, 0);
    assert.equal(janusVisionCalls, 1);
    assert.equal(llmCalls, 1);
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('planVideoSequence explicit llm_prompter mode uses the LLM planner without calling Janus', async () => {
  let janusTextCalls = 0;
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusText: async () => {
        janusTextCalls += 1;
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
    assert.equal(janusTextCalls, 0);
  });
});

test('planVideoSequence forwards reference image dimensions into the LLM planner context', async () => {
  let capturedArgs = null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-janus-visual-'));
  const sourceImagePath = path.join(tempDir, 'source.png');
  fs.writeFileSync(sourceImagePath, TINY_PNG);
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusVisionText: async () => ({
        text: JSON.stringify(buildJanusVisualScan()),
      }),
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
        ...buildRequest({ sequencePlanner: 'llm_prompter', sequencePlannerImageAware: true }),
        prompt: 'genere une video de James Bond marchant',
        sourceImageWidth: 1152,
        sourceImageHeight: 1344,
      },
      compiledBasePrompt: 'James Bond walking, coherent decor matching the requested scene',
      sourceImagePath,
    });

    assert.equal(plan.providerUsed, 'llm_prompter');
    assert.equal(capturedArgs?.referenceImageWidth, 1152);
    assert.equal(capturedArgs?.referenceImageHeight, 1344);
    assert.match(String(capturedArgs?.visualContext || ''), /1152x1344/i);
    assert.equal(capturedArgs?.visualAnalysis?.subjects?.[0]?.label, 'knight in dark armor');
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('planVideoSequence keeps the LLM as planner when Janus visual scan returns invalid JSON', async () => {
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusVisionText: async () => ({ text: 'ceci nest pas du json' }),
    },
    prompter: {
      isLlmFramePrompterEnabled: () => true,
      generateFramePromptsWithLlm: async () => ({
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
      }),
    },
  }, async ({ planVideoSequence }) => {
    const plan = await planVideoSequence({
      request: {
        ...buildRequest({ sequencePlanner: 'llm_prompter', sequencePlannerImageAware: true }),
        prompt: 'genere une video de James Bond marchant',
      },
      compiledBasePrompt: 'James Bond walking, coherent decor matching the requested scene',
      sourceImageUrl: 'https://files.example.com/source-image.png',
      fetchImpl: async () => ({
        ok: true,
        headers: {
          get(name) {
            return String(name).toLowerCase() === 'content-type' ? 'image/png' : '';
          },
        },
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
    });
    assert.equal(plan.providerRequested, 'llm_prompter');
    assert.equal(plan.providerUsed, 'llm_prompter');
    assert.equal(plan.imageAwareUsed, false);
    assert.match(String(plan.imageAwareError || ''), /janus_invalid_visual_scan_payload/i);
    assert.match(String(plan.beats[0]?.variation || ''), /James Bond/i);
  });
});

test('planVideoSequence reuses compiled stable identity hints in heuristic fallback plans', async () => {
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'none',
    },
    prompter: {
      isLlmFramePrompterEnabled: () => false,
    },
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
    assert.equal(plan.fallbackReason, 'llm_prompter_disabled');
    assert.match(String(plan.sceneLocks.join(', ') || ''), /tenue orange et bleue lisible/i);
    assert.doesNotMatch(String(plan.sceneLocks.join(', ') || ''), /illustration anime de combat nette/i);
  });
});

test('planVideoSequence only enables Janus visual scan when a real source image exists', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-janus-seq-'));
  const sourceImagePath = path.join(tempDir, 'source.png');
  fs.writeFileSync(sourceImagePath, TINY_PNG);

  let imageAwareCalls = 0;
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
      callJanusVisionText: async () => {
        imageAwareCalls += 1;
        return {
          text: JSON.stringify(buildJanusVisualScan({
            continuityAnchors: ['same knight', 'same golden sword', 'same torch-lit hall'],
          })),
        };
      },
    },
    prompter: {
      isLlmFramePrompterEnabled: () => true,
      generateFramePromptsWithLlm: async () => ({
        ok: true,
        subjectType: 'humanoid',
        motionDescription: 'walk cycle',
        sceneContext: 'low angle torch-lit stone hall',
        beats: [
          {
            label: 'reach',
            structuralState: 'The knight in dark armor leans toward the golden sword',
            variation: 'The knight in dark armor bends lower toward the golden sword',
            checkpoint: true,
            rendererFocus: [],
          },
        ],
      }),
    },
  }, async ({ planVideoSequence }) => {
    const withoutImage = await planVideoSequence({
      request: {
        ...buildRequest({ sequencePlanner: 'auto', sequencePlannerImageAware: true }),
        prompt: 'the knight in dark armor bends toward the golden sword',
      },
      compiledBasePrompt: 'the knight in dark armor bends toward the golden sword in a torch-lit stone hall',
      sourceImagePath: path.join(tempDir, 'missing.png'),
    });
    assert.equal(withoutImage.imageAwareUsed, false);

    const withImage = await planVideoSequence({
      request: {
        ...buildRequest({ sequencePlanner: 'auto', sequencePlannerImageAware: true }),
        prompt: 'the knight in dark armor bends toward the golden sword',
      },
      compiledBasePrompt: 'the knight in dark armor bends toward the golden sword in a torch-lit stone hall',
      sourceImagePath,
    });
    assert.equal(withImage.providerUsed, 'llm_prompter');
    assert.equal(withImage.imageAwareUsed, true);
    assert.match(String(withImage.visualAnalysis?.continuityAnchors?.join(', ') || ''), /same golden sword/i);
    assert.equal(imageAwareCalls, 1);
  });
});

test('planVideoSequence records invalid image-aware source errors explicitly without making Janus the prompt writer', async () => {
  await withPlannerStubs({
    janus: {
      resolveVisionProvider: () => 'janus',
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

    assert.equal(plan.providerUsed, 'heuristic');
    assert.equal(plan.imageAwareUsed, false);
    assert.equal(plan.imageAwareError, 'janus_image_source_url_not_allowed');
  });
});
