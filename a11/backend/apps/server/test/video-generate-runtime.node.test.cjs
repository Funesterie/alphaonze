const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const {
  buildFfmpegAssemblyArgs,
  createGenerateVideoHandler,
  ensureFfmpegAvailable,
  fitRenderDimensionsWithinLimits,
  normalizeVideoRequest,
} = require('../src/video/video-generate-runtime.cjs');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=',
  'base64'
);

// These runtime behavior tests lock the historical heuristic prompts.
process.env.A11_VIDEO_SEQUENCE_PLANNER = 'heuristic';

test('normalizeVideoRequest clamps duration, fps, frame count and format', () => {
  const previousEnv = {
    A11_VIDEO_MAX_DURATION_SEC: process.env.A11_VIDEO_MAX_DURATION_SEC,
    A11_VIDEO_MAX_FPS: process.env.A11_VIDEO_MAX_FPS,
    A11_VIDEO_MAX_RENDER_FRAMES: process.env.A11_VIDEO_MAX_RENDER_FRAMES,
    A11_VIDEO_MIN_RENDER_SIDE: process.env.A11_VIDEO_MIN_RENDER_SIDE,
  };

  process.env.A11_VIDEO_MAX_DURATION_SEC = '5';
  process.env.A11_VIDEO_MAX_FPS = '10';
  process.env.A11_VIDEO_MAX_RENDER_FRAMES = '12';
  process.env.A11_VIDEO_MIN_RENDER_SIDE = '768';

  try {
    const request = normalizeVideoRequest({
      prompt: 'genere une video de dragon',
      durationSeconds: 30,
      fps: 24,
      format: 'gif',
    });

    assert.equal(request.durationSeconds, 5);
    assert.equal(request.fps, 10);
    assert.equal(request.frameCount, 12);
    assert.equal(request.format, 'gif');
    assert.equal(request.width, 768);
    assert.equal(request.height, 768);
  } finally {
    process.env.A11_VIDEO_MAX_DURATION_SEC = previousEnv.A11_VIDEO_MAX_DURATION_SEC;
    process.env.A11_VIDEO_MAX_FPS = previousEnv.A11_VIDEO_MAX_FPS;
    process.env.A11_VIDEO_MAX_RENDER_FRAMES = previousEnv.A11_VIDEO_MAX_RENDER_FRAMES;
    process.env.A11_VIDEO_MIN_RENDER_SIDE = previousEnv.A11_VIDEO_MIN_RENDER_SIDE;
  }
});

test('normalizeVideoRequest upgrades suspiciously low video dimensions to a safe minimum', () => {
  const previousEnv = {
    A11_VIDEO_MIN_RENDER_SIDE: process.env.A11_VIDEO_MIN_RENDER_SIDE,
  };

  process.env.A11_VIDEO_MIN_RENDER_SIDE = '768';

  try {
    const request = normalizeVideoRequest({
      prompt: 'genere une video de goku',
      width: 256,
      height: 320,
    });

    assert.equal(request.width, 768);
    assert.equal(request.height, 768);
  } finally {
    process.env.A11_VIDEO_MIN_RENDER_SIDE = previousEnv.A11_VIDEO_MIN_RENDER_SIDE;
  }
});

test('fitRenderDimensionsWithinLimits keeps video frames compatible with SD latent dimensions', () => {
  const fitted = fitRenderDimensionsWithinLimits({
    width: 682,
    height: 1024,
    minSide: 64,
    maxSide: 1024,
    maxPixels: 1024 * 1024,
  });

  assert.equal(fitted.width, 680);
  assert.equal(fitted.height, 1024);
});

test('normalizeVideoRequest defaults to the maximum render size in local runtime mode', () => {
  const previousEnv = {
    A11_LOCAL_MODE: process.env.A11_LOCAL_MODE,
    A11_RUNTIME_PROFILE: process.env.A11_RUNTIME_PROFILE,
    A11_VIDEO_DEFAULT_WIDTH: process.env.A11_VIDEO_DEFAULT_WIDTH,
    A11_VIDEO_DEFAULT_HEIGHT: process.env.A11_VIDEO_DEFAULT_HEIGHT,
    A11_VIDEO_MAX_RENDER_SIDE: process.env.A11_VIDEO_MAX_RENDER_SIDE,
  };

  process.env.A11_LOCAL_MODE = '1';
  process.env.A11_RUNTIME_PROFILE = 'local';
  delete process.env.A11_VIDEO_DEFAULT_WIDTH;
  delete process.env.A11_VIDEO_DEFAULT_HEIGHT;
  process.env.A11_VIDEO_MAX_RENDER_SIDE = '2048';

  try {
    const request = normalizeVideoRequest({
      prompt: 'genere une video de goku',
    });

    assert.equal(request.width, 2048);
    assert.equal(request.height, 2048);
    assert.equal(request.config.localRuntime, true);
  } finally {
    if (previousEnv.A11_LOCAL_MODE === undefined) delete process.env.A11_LOCAL_MODE;
    else process.env.A11_LOCAL_MODE = previousEnv.A11_LOCAL_MODE;
    if (previousEnv.A11_RUNTIME_PROFILE === undefined) delete process.env.A11_RUNTIME_PROFILE;
    else process.env.A11_RUNTIME_PROFILE = previousEnv.A11_RUNTIME_PROFILE;
    if (previousEnv.A11_VIDEO_DEFAULT_WIDTH === undefined) delete process.env.A11_VIDEO_DEFAULT_WIDTH;
    else process.env.A11_VIDEO_DEFAULT_WIDTH = previousEnv.A11_VIDEO_DEFAULT_WIDTH;
    if (previousEnv.A11_VIDEO_DEFAULT_HEIGHT === undefined) delete process.env.A11_VIDEO_DEFAULT_HEIGHT;
    else process.env.A11_VIDEO_DEFAULT_HEIGHT = previousEnv.A11_VIDEO_DEFAULT_HEIGHT;
    if (previousEnv.A11_VIDEO_MAX_RENDER_SIDE === undefined) delete process.env.A11_VIDEO_MAX_RENDER_SIDE;
    else process.env.A11_VIDEO_MAX_RENDER_SIDE = previousEnv.A11_VIDEO_MAX_RENDER_SIDE;
  }
});

test('normalizeVideoRequest keeps explicit large dimensions when they fit within the shared image budget', () => {
  const previousEnv = {
    A11_VIDEO_FRAME_MAX_SIZE: process.env.A11_VIDEO_FRAME_MAX_SIZE,
    A11_VIDEO_MAX_RENDER_SIDE: process.env.A11_VIDEO_MAX_RENDER_SIDE,
    A11_IMAGE_MAX_SIZE: process.env.A11_IMAGE_MAX_SIZE,
  };

  delete process.env.A11_VIDEO_FRAME_MAX_SIZE;
  delete process.env.A11_VIDEO_MAX_RENDER_SIDE;
  process.env.A11_IMAGE_MAX_SIZE = '2048';

  try {
    const request = normalizeVideoRequest({
      prompt: 'genere une video de luffy',
      width: 1920,
      height: 1472,
    });

    assert.equal(request.width, 1920);
    assert.equal(request.height, 1472);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('normalizeVideoRequest scales oversized explicit dimensions proportionally instead of forcing a square clamp', () => {
  const previousEnv = {
    A11_VIDEO_FRAME_MAX_SIZE: process.env.A11_VIDEO_FRAME_MAX_SIZE,
    A11_VIDEO_MAX_RENDER_SIDE: process.env.A11_VIDEO_MAX_RENDER_SIDE,
  };

  process.env.A11_VIDEO_FRAME_MAX_SIZE = '1536';
  delete process.env.A11_VIDEO_MAX_RENDER_SIDE;

  try {
    const request = normalizeVideoRequest({
      prompt: 'genere une video de luffy',
      width: 1920,
      height: 1472,
    });

    assert.equal(request.width, 1536);
    assert.equal(request.height, 1176);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('normalizeVideoRequest upgrades implicit default timing to a full walk cycle for locomotion prompts', () => {
  const previousEnv = {
    A11_VIDEO_DEFAULT_DURATION_SEC: process.env.A11_VIDEO_DEFAULT_DURATION_SEC,
    A11_VIDEO_DEFAULT_FPS: process.env.A11_VIDEO_DEFAULT_FPS,
    A11_VIDEO_MAX_RENDER_FRAMES: process.env.A11_VIDEO_MAX_RENDER_FRAMES,
  };

  process.env.A11_VIDEO_DEFAULT_DURATION_SEC = '3';
  process.env.A11_VIDEO_DEFAULT_FPS = '1';
  process.env.A11_VIDEO_MAX_RENDER_FRAMES = '24';

  try {
    const request = normalizeVideoRequest({
      prompt: 'mario avancant sur le chemin un pas devant l autre',
      durationSeconds: 3,
      fps: 1,
    });

    assert.equal(request.durationSeconds, 2);
    assert.equal(request.fps, 4);
    assert.equal(request.frameCount, 8);
    assert.equal(request.explicitDuration, false);
    assert.equal(request.explicitFps, false);
    assert.equal(request.timingPlan?.motionProfile, 'walk_cycle');
    assert.equal(request.timingPlan?.source, 'auto_motion_profile');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('normalizeVideoRequest respects explicit timing written in the prompt even for locomotion prompts', () => {
  const previousEnv = {
    A11_VIDEO_DEFAULT_DURATION_SEC: process.env.A11_VIDEO_DEFAULT_DURATION_SEC,
    A11_VIDEO_DEFAULT_FPS: process.env.A11_VIDEO_DEFAULT_FPS,
  };

  process.env.A11_VIDEO_DEFAULT_DURATION_SEC = '3';
  process.env.A11_VIDEO_DEFAULT_FPS = '1';

  try {
    const request = normalizeVideoRequest({
      prompt: 'genere une video de mario marchant pendant 3 secondes a 1 fps',
    });

    assert.equal(request.durationSeconds, 3);
    assert.equal(request.fps, 1);
    assert.equal(request.frameCount, 3);
    assert.equal(request.explicitDuration, true);
    assert.equal(request.explicitFps, true);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('normalizeVideoRequest derives duration from explicit frame count and fps in strict mode', () => {
  const previousEnv = {
    A11_VIDEO_DEFAULT_DURATION_SEC: process.env.A11_VIDEO_DEFAULT_DURATION_SEC,
    A11_VIDEO_DEFAULT_FPS: process.env.A11_VIDEO_DEFAULT_FPS,
  };

  process.env.A11_VIDEO_DEFAULT_DURATION_SEC = '2';
  process.env.A11_VIDEO_DEFAULT_FPS = '4';

  try {
    const request = normalizeVideoRequest({
      prompt: 'simple red circle pulsing',
      frameCount: 2,
      fps: 2,
      strictTiming: true,
    });

    assert.equal(request.durationSeconds, 1);
    assert.equal(request.fps, 2);
    assert.equal(request.frameCount, 2);
    assert.equal(request.explicitDuration, false);
    assert.equal(request.explicitFps, true);
    assert.equal(request.explicitFrameCount, true);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('normalizeVideoRequest detects power-up stance prompts as a staged aura loop', () => {
  const request = normalizeVideoRequest({
    prompt: 'luffy de face posture menacante poings fermes aura haki rouge',
  });

  assert.equal(request.timingPlan?.motionProfile, 'power_up_loop');
  assert.equal(request.timingPlan?.motionReason, 'power_up_motion_detected');
});

test('normalizeVideoRequest detects transformation prompts as a staged transformation rise', () => {
  const request = normalizeVideoRequest({
    prompt: 'gogeta se transformant en super saiyan divin',
  });

  assert.equal(request.timingPlan?.motionProfile, 'transformation_rise');
  assert.equal(request.timingPlan?.motionReason, 'transformation_motion_detected');
  assert.equal(request.frameCount, 10);
});

test('normalizeVideoRequest detects mounted archery prompts as a dedicated mounted archery plan', () => {
  const request = normalizeVideoRequest({
    prompt: 'zelda tirant une fleche avec un arc sur un cheval',
  });

  assert.equal(request.timingPlan?.motionProfile, 'mounted_archery');
  assert.equal(request.timingPlan?.motionReason, 'mounted_archery_motion_detected');
  assert.equal(request.frameCount, 8);
});

test('createGenerateVideoHandler reuses compiled SD prompts and assembles a video artifact', async () => {
  const calls = [];
  let ffmpegInvocation = null;
  let compileOptions = null;

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, contentType, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      contentType,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'dragon bleu',
      },
    }),
    compileMaskImageGenerateRuntime: async (_rawMask, options) => {
      compileOptions = options;
      return {
      mask: { intent: 'image.generate' },
      compiled: { target: 'image-prompt-fr' },
      sdBody: {
        prompt: 'compiled dragon prompt',
        negative_prompt: 'blurry, duplicate',
        seed: 11,
      },
      };
    },
    runFfmpeg: async ({ fps, format, framesDir, outputPath }) => {
      ffmpegInvocation = { fps, format, framesDir, outputPath };
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'genere une video de dragon bleu',
    body: {
      prompt: 'genere une video de dragon bleu',
      durationSeconds: 2,
      fps: 2,
      format: 'mp4',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.artifact_type, 'video');
  assert.equal(result.format, 'mp4');
  assert.equal(result.frameCount, 4);
  assert.equal(result.video_url, `https://files.example.com/${result.filename}`);
  assert.equal(calls.length, 4);
  assert.match(String(calls[0].prompt || ''), /compiled dragon prompt/i);
  assert.equal(calls[0].prompt_prebuilt, true);
  assert.match(String(calls[1].init_image_url || ''), /frame-0000\.png$/i);
  assert.equal(calls[0].num_inference_steps, 24);
  assert.equal(calls[0].guidance_scale, 6.5);
  assert.equal(typeof ffmpegInvocation?.outputPath, 'string');
  assert.equal(compileOptions?.imageRequestMode, undefined);
  assert.equal(typeof compileOptions?.resolveImageWebDraft, 'function');
  assert.equal(typeof compileOptions?.resolveImageReferencePack, 'function');
});

test('createGenerateVideoHandler can synthesize and mux a requested audio track', async () => {
  const calls = [];
  const fetchCalls = [];
  let ffmpegInvocation = null;

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (String(url).endsWith('/api/tts')) {
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              audio_url: 'https://files.example.com/voice.wav',
              gif_url: 'https://files.example.com/voice.gif',
            });
          },
        };
      }
      return {
        ok: true,
        headers: {
          get(name) {
            return String(name).toLowerCase() === 'content-type' ? 'audio/wav' : '';
          },
        },
        async arrayBuffer() {
          return String(url).endsWith('/voice.wav')
            ? Buffer.from('RIFFfake-wave')
            : TINY_PNG;
        },
      };
    },
    uploadBufferToR2: async ({ filename, contentType, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      contentType,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'cercle rouge pulse',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'cercle rouge sur fond blanc',
      },
    }),
    runFfmpeg: async ({ outputPath, audioPath }) => {
      ffmpegInvocation = { outputPath, audioPath };
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'cercle rouge pulse',
    body: {
      prompt: 'cercle rouge pulse',
      frameCount: 2,
      fps: 2,
      audioText: 'Test audio video',
      format: 'mp4',
      strictTiming: true,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.hasAudio, true);
  assert.equal(result.audio_url, 'https://files.example.com/voice.wav');
  assert.equal(result.audioText, 'Test audio video');
  assert.equal(result.durationSeconds, 1);
  assert.equal(calls.length, 2);
  assert.match(String(calls[0].prompt || ''), /main subject pose continuity: circle red/i);
  assert.match(String(calls[0].prompt_2 || ''), /white background/i);
  assert.doesNotMatch(String(calls[0].prompt || ''), /\bcercle\b|\bfond\b|\bsur\b/i);
  assert.doesNotMatch(String(calls[0].prompt_2 || ''), /\bfond\b|\bsur\b|\bblanc\b/i);
  assert.match(String(ffmpegInvocation?.audioPath || ''), /audio\.wav$/i);
  assert.equal(fs.existsSync(ffmpegInvocation.audioPath), true);
  assert.ok(fetchCalls.some((url) => url.endsWith('/api/tts')));
  assert.ok(fetchCalls.some((url) => url.endsWith('/voice.wav')));
});

test('createGenerateVideoHandler does not expose loopback audio URLs to HTTPS clients', async () => {
  const previousWorkspaceRoot = process.env.A11_WORKSPACE_ROOT;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-video-audio-public-'));
  process.env.A11_WORKSPACE_ROOT = tempRoot;

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => ({
      ok: true,
      image_url: `https://files.example.com/frame-${body.width}x${body.height}.png`,
    }),
    fetch: async (url) => {
      const normalizedUrl = String(url);
      if (normalizedUrl.endsWith('/api/tts')) {
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              audio_url: 'http://127.0.0.1:5002/out/local-voice.wav',
            });
          },
        };
      }
      if (normalizedUrl === 'http://127.0.0.1:5002/out/local-voice.wav') {
        return {
          ok: true,
          headers: {
            get(name) {
              return String(name).toLowerCase() === 'content-type' ? 'audio/wav' : '';
            },
          },
          async arrayBuffer() {
            return Buffer.from('RIFFfake-wave');
          },
        };
      }
      return {
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      };
    },
    uploadBufferToR2: async ({ filename, contentType, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      contentType,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'cercle rouge pulse',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'red circle on white background',
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  try {
    const result = await generateVideo({
      req: {
        headers: {
          host: 'alphaonze.funesterie.pro',
          'x-forwarded-proto': 'https',
        },
        body: {},
      },
      prompt: 'red circle pulse',
      body: {
        prompt: 'red circle pulse',
        frameCount: 2,
        fps: 2,
        audioText: 'Test audio video',
        format: 'mp4',
        strictTiming: true,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.hasAudio, true);
    assert.match(String(result.audio_url || ''), /^https:\/\/alphaonze\.funesterie\.pro\/files\//i);
    assert.doesNotMatch(String(result.audio_url || ''), /127\.0\.0\.1|http:\/\/127/i);
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.A11_WORKSPACE_ROOT;
    else process.env.A11_WORKSPACE_ROOT = previousWorkspaceRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('createGenerateVideoHandler builds a stable french walk cycle plan with concrete pose prompts', async () => {
  const calls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'mario avancant sur le chemin un pas devant l autre',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'mario heroique sur un sentier fantastique',
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'mario avancant sur le chemin un pas devant l autre',
    body: {
      prompt: 'mario avancant sur le chemin un pas devant l autre',
      sourceImageUrl: 'https://files.example.com/source-image.png',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.frameCount, 8);
  assert.equal(calls.length, 8);
  assert.match(String(calls[0].prompt || ''), /main subject pose continuity:/i);
  assert.match(String(calls[0].prompt_3 || ''), /visible frame delta anatomy prop detail:/i);
  assert.match(String(calls[0].prompt_3 || ''), /neutral walking pose|posture neutre de marche/i);
  assert.match(String(calls[1].prompt || ''), /left leg moves forward|jambe gauche avance devant/i);
  assert.match(String(calls[1].prompt_3 || ''), /left leg moves forward|jambe gauche avance devant/i);
  assert.match(String(calls[1].prompt_3 || ''), /clear anatomy:|anatomie lisible:/i);
  assert.match(String(calls[4].prompt_3 || ''), /right leg moves forward|jambe droite avance devant/i);
  assert.match(String(calls[7].prompt_3 || ''), /pose stable after the progression|posture stable apres (la|the) progression/i);
  assert.doesNotMatch(String(calls[0].prompt || ''), /profil|sequence :|methode :|frame 1 sur 8|palier actuel/i);
  assert.doesNotMatch(String(calls[0].prompt_2 || ''), /camera fixe|pas de rotation de camera/i);
  assert.doesNotMatch(String(calls[0].prompt || ''), /\bheroique\b|\bsentier\b|\bfantastique\b|\bsur\b/i);
  assert.doesNotMatch(String(calls[0].prompt_2 || ''), /\bsentier\b|\bfantastique\b|\bsur\b/i);
  assert.equal(result.frames[0].initSource, 'reference_anchor');
  assert.ok(result.frames.slice(1).every((frame) => frame.initSource === 'previous_frame'));
  assert.equal(calls[0].init_image_url, 'https://files.example.com/source-image.png');
  assert.equal(calls[1].strength_profile, 'balanced');
  assert.match(String(calls[1].init_image_url || ''), /frame-0000\.png$/i);
  assert.match(String(calls[7].init_image_url || ''), /frame-0006\.png$/i);
});

test('createGenerateVideoHandler adapts walk prompts to a ten-frame storyboard', async () => {
  const calls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'luffy marchant dans un port',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'luffy marchant dans un port',
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'luffy marchant dans un port',
    body: {
      prompt: 'luffy marchant dans un port',
      frameCount: 10,
      sourceImageUrl: 'https://files.example.com/source-image.png',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.frameCount, 10);
  assert.equal(calls.length, 10);
  assert.match(String(calls[0].prompt_3 || ''), /neutral walking pose|posture neutre de marche/i);
  assert.match(String(calls[1].prompt || ''), /left leg moves forward|weight distributed across both legs|jambe gauche avance devant|poids reparti sur les deux jambes/i);
  assert.match(String(calls[1].prompt_3 || ''), /left leg moves forward|weight distributed across both legs|jambe gauche avance devant|poids reparti sur les deux jambes/i);
  assert.match(String(calls[4].prompt_3 || ''), /right leg moves forward|right leg passes under the body|jambe droite avance devant|jambe droite passe sous le corps/i);
  assert.match(String(calls[9].prompt_3 || ''), /walking motion still readable|pose stable after the progression|sortie de marche|posture stable apres (la|the) progression/i);
  assert.doesNotMatch(String(calls[0].prompt || ''), /profil|sequence :|methode :|palier actuel|preparer la prochaine frame/i);
  assert.equal(calls[1].strength_profile, 'balanced');
});

test('createGenerateVideoHandler uses an action burst plan for kamehameha prompts without rigid camera locks', async () => {
  const calls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'goku faisant un kamehameha contre broly',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'goku faisant un kamehameha contre broly',
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'goku faisant un kamehameha contre broly',
    body: {
      prompt: 'goku faisant un kamehameha contre broly',
      durationSeconds: 1,
      fps: 4,
      sourceImageUrl: 'https://files.example.com/source-image.png',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 4);
  assert.match(String(calls[0].prompt || ''), /main subject pose continuity: goku/i);
  assert.match(String(calls[0].prompt || ''), /stable starting pose, gesture still (restrained|held back)|posture de depart stable, geste encore retenu/i);
  assert.match(String(calls[0].prompt_2 || ''), /scene camera decor continuity:/i);
  assert.match(String(calls[0].prompt_3 || ''), /visible frame delta anatomy prop detail: .*low energy/i);
  assert.match(String(calls[1].prompt_3 || ''), /denser energy|visible weight transfer|energie plus dense|transfert de poids visible/i);
  assert.match(String(calls[2].prompt_3 || ''), /readable energy projection|projection d energie lisible/i);
  assert.match(String(calls[3].prompt || ''), /gesture settles down|energy dissipates|retombee du geste|energie se dissipe/i);
  assert.match(String(calls[3].prompt_3 || ''), /pose remains readable|posture reste lisible/i);
  assert.doesNotMatch(String(calls[0].prompt || ''), /profil|sequence :|methode :/i);
  assert.doesNotMatch(String(calls[0].prompt_2 || ''), /camera fixe|pas de rotation de camera/i);
  assert.equal(result.frames[0].initSource, 'reference_anchor');
  assert.ok(result.frames.slice(1).every((frame) => ['previous_frame', 'checkpoint_chain'].includes(frame.initSource)));
  assert.ok(result.frames.some((frame) => frame.initSource === 'checkpoint_chain'));
  assert.notEqual(String(calls[1].prompt_3 || ''), String(calls[2].prompt_3 || ''));
  assert.equal(calls[1].strength, 'auto');
  assert.equal(calls[1].strength_profile, 'balanced');
  assert.match(String(calls[1].strength_reason || ''), /video_pose_shift_from_previous_frame/i);
  assert.ok(Number(calls[1].strength_value || 0) >= 0.2);
  assert.match(String(calls[1].init_image_url || ''), /frame-0000\.png$/i);
  assert.match(String(calls[2].init_image_url || ''), /frame-0001\.png$/i);
  assert.match(String(calls[3].init_image_url || ''), /frame-0002\.png$/i);
});

test('createGenerateVideoHandler builds a staged power-up plan for threatening aura prompts', async () => {
  const calls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'luffy de face posture menacante poings fermes aura haki rouge',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'luffy de face posture menacante poings fermes aura haki rouge',
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'luffy de face posture menacante poings fermes aura haki rouge',
    body: {
      prompt: 'luffy de face posture menacante poings fermes aura haki rouge',
      durationSeconds: 2,
      fps: 4,
      sourceImageUrl: 'https://files.example.com/source-image.png',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 8);
  assert.match(String(calls[0].prompt || ''), /main subject pose continuity: luffy de face/i);
  assert.match(String(calls[0].prompt || ''), /stable threatening stance|posture menacante stable/i);
  assert.match(String(calls[0].prompt_3 || ''), /visible frame delta anatomy prop detail: .*aura still faint/i);
  assert.match(String(calls[1].prompt_3 || ''), /clenched fists|more visible aura|poings serres|aura plus visible/i);
  assert.match(String(calls[4].prompt_3 || ''), /aura spreads further|aura intense|face and identity remain consistent|aura se deploie davantage|visage et identite coherents/i);
  assert.match(String(calls[7].prompt || ''), /posture puissante stabilisee/i);
  assert.doesNotMatch(String(calls[0].prompt || ''), /profil|sequence :|methode :|palier actuel/i);
  assert.equal(result.frames[0].initSource, 'reference_anchor');
  assert.ok(result.frames.slice(1).every((frame) => ['previous_frame', 'checkpoint_chain'].includes(frame.initSource)));
  assert.ok(result.frames.some((frame) => frame.initSource === 'checkpoint_chain'));
  assert.notEqual(String(calls[3].prompt || ''), String(calls[0].prompt || ''));
  assert.equal(calls[1].strength, 'auto');
  assert.equal(calls[1].strength_profile, 'balanced');
  assert.ok(Number(calls[1].strength_value || 0) >= 0.2);
  assert.match(String(calls[1].init_image_url || ''), /frame-0000\.png$/i);
  assert.match(String(calls[5].init_image_url || ''), /frame-0004\.png$/i);
});

test('createGenerateVideoHandler builds a staged transformation storyboard without recursive variation prompts', async () => {
  const calls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'gogeta se transformant en super saiyan divin',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'gogeta se transformant en super saiyan divin',
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'gogeta se transformant en super saiyan divin',
    body: {
      prompt: 'gogeta se transformant en super saiyan divin',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.frameCount, 10);
  assert.equal(calls.length, 10);
  assert.match(String(calls[0].prompt || ''), /main subject pose continuity: gogeta/i);
  assert.match(String(calls[0].prompt || ''), /stable upright pose|posture droite stable/i);
  assert.match(String(calls[0].prompt_3 || ''), /visible frame delta anatomy prop detail: .*hair still normal/i);
  assert.match(String(calls[2].prompt_3 || ''), /hair rises further|first glow of energy|cheveux se dressent davantage|premiere lueur d energie/i);
  assert.match(String(calls[5].prompt || ''), /divine red hair clearly visible|cheveux rouges divins|hair .*red|aura .*divine/i);
  assert.match(String(calls[5].prompt_3 || ''), /transformation clearly underway|transformation clairement engagee/i);
  assert.match(String(calls[9].prompt || ''), /form[e]? super saiyan divin stabilisee|energy maitrisee autour du corps|energy .*around the body|energie maitrisee autour du corps/i);
  assert.match(String(calls[6].prompt || ''), /arms raised higher and open|torso projected forward|arms ouverts plus haut|torse projete vers l avant/i);
  assert.match(String(calls[7].prompt || ''), /arms thrown open with force|chest projected forward|bras ouverts avec force|poitrine projetee/i);
  assert.doesNotMatch(String(calls[0].prompt || ''), /transformation vers super saiyan divin/i);
  assert.doesNotMatch(String(calls[1].prompt_3 || ''), /vers .* vers|posture de depart stable, posture de depart stable/i);
  assert.doesNotMatch(String(calls[1].prompt_2 || ''), /priorite a|faire evoluer|garder visage/i);
  assert.equal(result.frames[0].initSource, 'prompt_only');
  assert.ok(result.frames.slice(1).every((frame) => ['previous_frame', 'checkpoint_chain'].includes(frame.initSource)));
  assert.ok(result.frames.some((frame) => frame.initSource === 'checkpoint_chain'));
  assert.notEqual(String(result.frames[1].prompt_3 || ''), String(result.frames[2].prompt_3 || ''));
  assert.match(String(result.frames[5].structuralPrompt || ''), /divine red hair clearly visible|hair red divins bien visibles|cheveux rouges divins bien visibles/i);
  assert.equal(calls[1].strength, 'auto');
  assert.equal(calls[1].strength_profile, 'balanced');
  assert.ok(Number(calls[1].strength_value || 0) >= 0.2);
  assert.match(String(calls[1].init_image_url || ''), /frame-0000\.png$/i);
  assert.match(String(calls[4].init_image_url || ''), /frame-0003\.png$/i);
  assert.match(String(calls[6].init_image_url || ''), /frame-0005\.png$/i);
  assert.match(String(calls[8].init_image_url || ''), /frame-0007\.png$/i);
});

test('createGenerateVideoHandler keeps compiled character identity hints in the stable transformation prompt', async () => {
  const calls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'goku se transformant en super saiyan divin',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'goku se transformant en super saiyan divin, illustration anime de combat nette, tenue orange et bleue lisible, fond simple cohérent avec le personnage',
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'goku se transformant en super saiyan divin',
    body: {
      prompt: 'goku se transformant en super saiyan divin',
      durationSeconds: 1,
      fps: 2,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(String(calls[0].prompt_2 || ''), /readable orange and blue outfit|tenue orange et bleue lisible/i);
  assert.match(String(calls[0].prompt || ''), /main subject pose continuity: goku/i);
});

test('createGenerateVideoHandler keeps base negative prompt on the main layer and adds video text guards', async () => {
  const calls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'mario levant le bras gauche',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'mario levant le bras gauche',
        negative_prompt: 'bad anatomy',
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'mario levant le bras gauche',
    body: {
      prompt: 'mario levant le bras gauche',
      durationSeconds: 1,
      fps: 2,
      sourceImageUrl: 'https://files.example.com/source-image.png',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(String(calls[0].negative_prompt || ''), /^bad anatomy, text, watermark/i);
  assert.equal(calls[0].negative_prompt_2, undefined);
  assert.equal(calls[0].negative_prompt_3, undefined);
  assert.match(String(calls[1].negative_prompt || ''), /^bad anatomy, text, watermark/i);
  assert.equal(calls[1].negative_prompt_2, undefined);
  assert.equal(calls[1].negative_prompt_3, undefined);
});

test('createGenerateVideoHandler accepts a trusted implicit subject web reference pack when no explicit source is provided', async () => {
  const calls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'Sanji donnant un coup de pied enflamme',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      mask: {
        meta: {
          webReferencePack: {
            references: [
              {
                role: 'subject',
                imageUrl: 'https://images.example.com/sanji-ref.png',
              },
            ],
          },
        },
      },
      sdBody: {
        prompt: 'compiled sanji prompt',
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'genere une video de sanji',
    body: {
      prompt: 'genere une video de sanji',
      durationSeconds: 1,
      fps: 2,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceMode, 'web_reference_subject');
  assert.equal(calls[0].init_image_url, 'https://images.example.com/sanji-ref.png');
  assert.equal(result.frames[0].initSource, 'reference_anchor');
});

test('createGenerateVideoHandler can opt into an implicit web draft when explicitly enabled', async () => {
  const previousFlag = process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT = '1';
  const calls = [];

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'heroine fantasy dans un chateau',
        },
      }),
      compileMaskImageGenerateRuntime: async () => ({
        mask: {
          meta: {
            webImageDraft: {
              mode: 'web-image-draft',
              reason: 'automatic_web_anchor',
              initImageUrl: 'https://images.example.com/heroine-ref.png',
              strength: 0.22,
            },
          },
        },
        sdBody: {
          prompt: 'compiled heroine prompt',
          init_image_url: 'https://images.example.com/heroine-ref.png',
          strength: 0.22,
        },
      }),
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'genere une video de heroine fantasy',
      body: {
        prompt: 'genere une video de heroine fantasy',
        durationSeconds: 1,
        fps: 2,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sourceMode, 'web-image-draft');
    assert.equal(calls[0].init_image_url, 'https://images.example.com/heroine-ref.png');
  } finally {
    if (previousFlag === undefined) delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
    else process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT = previousFlag;
  }
});

test('createGenerateVideoHandler bootstraps canonical characters from a forced subject-only web reference even when implicit web init is disabled', async () => {
  const previousFlag = process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  const calls = [];
  const referencePackCalls = [];

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'goku se transforme',
          meta: {
            canonicalSubject: 'Goku',
            subjectProfile: {
              type: 'reference_character',
              canonicalSubject: 'Goku',
            },
            imageScratchpad: {
              canonicalSubject: 'Goku',
              universe: 'Dragon Ball',
              subjectProfileType: 'reference_character',
            },
          },
        },
      }),
      compileMaskImageGenerateRuntime: async (rawMask) => ({
        mask: rawMask,
        sdBody: {
          prompt: 'compiled goku prompt',
        },
      }),
      resolveImageReferencePack: async ({
        forceSubjectLookup,
        subjectOnly,
      }) => {
        referencePackCalls.push({
          forceSubjectLookup: Boolean(forceSubjectLookup),
          subjectOnly: Boolean(subjectOnly),
        });
        if (!(forceSubjectLookup && subjectOnly)) return null;
        return {
          references: [
            {
              role: 'subject',
              imageUrl: 'https://images.example.com/goku-ref.png',
            },
          ],
        };
      },
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'genere une video de goku',
      body: {
        prompt: 'genere une video de goku',
        durationSeconds: 1,
        fps: 2,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sourceMode, 'web_reference_subject');
    assert.equal(calls[0].init_image_url, 'https://images.example.com/goku-ref.png');
    assert.deepEqual(referencePackCalls, [
      {
        forceSubjectLookup: true,
        subjectOnly: true,
      },
    ]);
  } finally {
    if (previousFlag === undefined) delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
    else process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT = previousFlag;
  }
});

test('createGenerateVideoHandler falls back to prompt-only when a strict Mario bootstrap resolves to an unrelated rider image', async () => {
  const { resolveImageReferencePack } = require('../src/knowledge/image-reference-pack.cjs');
  const previousFlag = process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  const calls = [];

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'mario marchant devant un chateau',
          meta: {
            canonicalSubject: 'Mario',
            subjectProfile: {
              type: 'reference_character',
              canonicalSubject: 'Mario',
            },
          },
          inputs: {
            subject: ['Mario'],
          },
        },
      }),
      compileMaskImageGenerateRuntime: async (rawMask) => ({
        mask: rawMask,
        sdBody: {
          prompt: 'compiled mario walk prompt',
        },
      }),
      resolveImageReferencePack: async (args) => resolveImageReferencePack({
        ...args,
        duckduckgoImageSearch: async () => ({
          title: 'Historical rider full body pose illustration with horse',
          image_url: 'https://images.example.com/historical-rider.png',
          source_url: 'https://example.org/historical-rider',
          source_domain: 'example.org',
          selection_score: 13,
          width: 1024,
          height: 1024,
        }),
      }),
      ensureFfmpegAvailable: () => true,
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'genere une video de mario marchant devant un chateau',
      body: {
        prompt: 'genere une video de mario marchant devant un chateau',
        durationSeconds: 1,
        fps: 2,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sourceMode, 'prompt_only');
    assert.equal(calls[0].init_image_url, undefined);
    assert.equal(result.frames[0].initSource, 'prompt_only');
  } finally {
    if (previousFlag === undefined) delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
    else process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT = previousFlag;
  }
});

test('createGenerateVideoHandler keeps a trusted implicit Zelda subject reference for locomotion prompts', async () => {
  const previousFlag = process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  const calls = [];
  const referencePackCalls = [];

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'zelda marchant sur un sentier dans la foret',
          meta: {
            canonicalSubject: 'Princesse Zelda',
            subjectProfile: {
              type: 'reference_character',
              canonicalSubject: 'Princesse Zelda',
            },
          },
          inputs: {
            subject: ['Princesse Zelda'],
          },
        },
      }),
      compileMaskImageGenerateRuntime: async (rawMask) => ({
        mask: {
          ...rawMask,
          meta: {
            ...(rawMask.meta || {}),
            webReferencePack: {
              references: [
                {
                  role: 'subject',
                  imageUrl: 'https://images.example.com/zelda-ref.png',
                },
              ],
            },
          },
        },
        sdBody: {
          prompt: 'Princesse Zelda marchant sur un sentier dans la foret',
        },
      }),
      resolveImageReferencePack: async () => {
        referencePackCalls.push(true);
        return {
          references: [
            {
              role: 'subject',
              imageUrl: 'https://images.example.com/zelda-ref.png',
            },
          ],
        };
      },
      ensureFfmpegAvailable: () => true,
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'genere une video de zelda marchant sur un sentier dans la foret',
      body: {
        prompt: 'genere une video de zelda marchant sur un sentier dans la foret',
        durationSeconds: 1,
        fps: 2,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sourceMode, 'web_reference_subject');
    assert.equal(calls[0].init_image_url, 'https://images.example.com/zelda-ref.png');
    assert.deepEqual(referencePackCalls, []);
  } finally {
    if (previousFlag === undefined) delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
    else process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT = previousFlag;
  }
});

test('createGenerateVideoHandler prefers a canonical subject web bootstrap over an implicit compiled web draft', async () => {
  const previousFlag = process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT = '1';
  const calls = [];

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'goku se transforme',
          meta: {
            canonicalSubject: 'Goku',
            subjectProfile: {
              type: 'reference_character',
              canonicalSubject: 'Goku',
            },
            imageScratchpad: {
              canonicalSubject: 'Goku',
              universe: 'Dragon Ball',
              subjectProfileType: 'reference_character',
            },
          },
        },
      }),
      compileMaskImageGenerateRuntime: async (rawMask) => ({
        mask: {
          ...rawMask,
          meta: {
            ...(rawMask.meta || {}),
            webImageDraft: {
              mode: 'web-image-draft',
              reason: 'automatic_web_anchor',
              initImageUrl: 'https://images.example.com/goku-draft.png',
              strength: 0.22,
            },
          },
        },
        sdBody: {
          prompt: 'compiled goku prompt',
          init_image_url: 'https://images.example.com/goku-draft.png',
          strength: 0.22,
        },
      }),
      resolveImageReferencePack: async ({
        forceSubjectLookup,
        subjectOnly,
      }) => {
        if (!(forceSubjectLookup && subjectOnly)) return null;
        return {
          references: [
            {
              role: 'subject',
              imageUrl: 'https://images.example.com/goku-ref.png',
            },
          ],
        };
      },
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'genere une video de goku',
      body: {
        prompt: 'genere une video de goku',
        durationSeconds: 1,
        fps: 2,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sourceMode, 'web_reference_subject');
    assert.equal(calls[0].init_image_url, 'https://images.example.com/goku-ref.png');
  } finally {
    if (previousFlag === undefined) delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
    else process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT = previousFlag;
  }
});

test('createGenerateVideoHandler bypasses a cached generic subject reference when the video needs an action-specific bootstrap', async () => {
  const previousFlag = process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
  const calls = [];
  const referencePackCalls = [];

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'zelda tirant une fleche avec son arc',
          meta: {
            canonicalSubject: 'Princesse Zelda',
            subjectProfile: {
              type: 'reference_character',
              canonicalSubject: 'Princesse Zelda',
            },
            imageScratchpad: {
              canonicalSubject: 'Princesse Zelda',
              subjectProfileType: 'reference_character',
            },
            webReferencePack: {
              references: [
                {
                  role: 'subject',
                  query: 'Princesse Zelda solo character art',
                  imageUrl: 'https://images.example.com/zelda-generic-ref.png',
                },
              ],
            },
          },
        },
      }),
      compileMaskImageGenerateRuntime: async (rawMask) => ({
        mask: rawMask,
        sdBody: {
          prompt: 'compiled zelda prompt',
        },
      }),
      resolveImageReferencePack: async ({
        forceSubjectLookup,
        subjectOnly,
        motionProfile,
      }) => {
        referencePackCalls.push({
          forceSubjectLookup: Boolean(forceSubjectLookup),
          subjectOnly: Boolean(subjectOnly),
          motionProfile: String(motionProfile || ''),
        });
        if (!(forceSubjectLookup && subjectOnly && motionProfile === 'archery_shot')) return null;
        return {
          references: [
            {
              role: 'subject',
              query: 'Princesse Zelda archer pose full body character art',
              imageUrl: 'https://images.example.com/zelda-archer-ref.png',
            },
          ],
        };
      },
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'zelda tirant une fleche avec son arc',
      body: {
        prompt: 'zelda tirant une fleche avec son arc',
        durationSeconds: 2,
        fps: 4,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sourceMode, 'web_reference_subject');
    assert.equal(calls[0].init_image_url, 'https://images.example.com/zelda-archer-ref.png');
    assert.deepEqual(referencePackCalls, [
      {
        forceSubjectLookup: true,
        subjectOnly: true,
        motionProfile: 'archery_shot',
      },
    ]);
  } finally {
    if (previousFlag === undefined) delete process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT;
    else process.env.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT = previousFlag;
  }
});

test('createGenerateVideoHandler strips an implicit compiled web draft init image when no explicit source is provided', async () => {
  const calls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'heroine fantasy dans un chateau',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      mask: {
        meta: {
          webImageDraft: {
            mode: 'web-image-draft',
            reason: 'automatic_web_anchor',
            initImageUrl: 'https://images.example.com/heroine-ref.png',
            strength: 0.22,
          },
        },
      },
      sdBody: {
        prompt: 'compiled heroine prompt',
        init_image_url: 'https://images.example.com/heroine-ref.png',
        strength: 0.22,
      },
    }),
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'genere une video de heroine fantasy',
    body: {
      prompt: 'genere une video de heroine fantasy',
      durationSeconds: 1,
      fps: 2,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceMode, 'prompt_only');
  assert.equal(calls[0].init_image_url, undefined);
  assert.equal(calls[0].strength, undefined);
});

test('createGenerateVideoHandler can bootstrap the first frame from an existing image url', async () => {
  const calls = [];
  let compileOptions = null;

  const generateVideo = createGenerateVideoHandler({
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: `https://files.example.com/frame-${calls.length}.png`,
      };
    },
    fetch: async (url) => ({
      ok: true,
      async arrayBuffer() {
        return String(url).includes('source-image')
          ? TINY_PNG
          : TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'singe qui danse',
      },
    }),
    compileMaskImageGenerateRuntime: async (_rawMask, options) => {
      compileOptions = options;
      return {
      sdBody: {
        prompt: 'compiled monkey prompt',
        negative_prompt: 'blurry',
      },
      };
    },
    runFfmpeg: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'anime ce singe',
    body: {
      prompt: 'anime ce singe',
      durationSeconds: 1,
      fps: 2,
      sourceImageUrl: 'https://files.example.com/source-image.png',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceMode, 'image_url');
  assert.equal(calls[0].init_image_url, 'https://files.example.com/source-image.png');
  assert.equal(compileOptions?.imageRequestMode, 'raw');
});

test('createGenerateVideoHandler regularly reanchors frames on the original source reference', async () => {
  const calls = [];
  const previousReanchorEvery = process.env.A11_VIDEO_FRAME_REANCHOR_EVERY;

  process.env.A11_VIDEO_FRAME_REANCHOR_EVERY = '2';

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'heroine en mouvement',
        },
      }),
      compileMaskImageGenerateRuntime: async () => ({
        sdBody: {
          prompt: 'compiled heroine prompt',
        },
      }),
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'anime cette heroine',
      body: {
        prompt: 'anime cette heroine',
        durationSeconds: 2,
        fps: 2,
        sourceImageUrl: 'https://files.example.com/source-image.png',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 4);
    assert.equal(calls[0].init_image_url, 'https://files.example.com/source-image.png');
    assert.match(String(calls[1].init_image_url || ''), /frame-0000\.png$/i);
    assert.equal(calls[2].init_image_url, 'https://files.example.com/source-image.png');
    assert.match(String(calls[3].init_image_url || ''), /frame-0002\.png$/i);
    assert.equal(result.frames[0].initSource, 'reference_anchor');
    assert.equal(result.frames[1].initSource, 'previous_frame');
    assert.equal(result.frames[2].initSource, 'reference_reanchor');
    assert.equal(result.frames[3].initSource, 'previous_frame');
  } finally {
    if (previousReanchorEvery === undefined) delete process.env.A11_VIDEO_FRAME_REANCHOR_EVERY;
    else process.env.A11_VIDEO_FRAME_REANCHOR_EVERY = previousReanchorEvery;
  }
});

test('createGenerateVideoHandler overrides an implicit square default to preserve a portrait source aspect ratio', async () => {
  const previousDefaults = {
    A11_VIDEO_DEFAULT_WIDTH: process.env.A11_VIDEO_DEFAULT_WIDTH,
    A11_VIDEO_DEFAULT_HEIGHT: process.env.A11_VIDEO_DEFAULT_HEIGHT,
    A11_LOCAL_MODE: process.env.A11_LOCAL_MODE,
    A11_RUNTIME_PROFILE: process.env.A11_RUNTIME_PROFILE,
  };
  process.env.A11_VIDEO_DEFAULT_WIDTH = '1024';
  process.env.A11_VIDEO_DEFAULT_HEIGHT = '1024';
  delete process.env.A11_LOCAL_MODE;
  delete process.env.A11_RUNTIME_PROFILE;

  const calls = [];
  const portraitSource = await sharp({
    create: {
      width: 1001,
      height: 1200,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  }).png().toBuffer();

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async (url) => ({
        ok: true,
        async arrayBuffer() {
          return String(url).includes('source-image')
            ? portraitSource
            : TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'zelda avancant',
        },
      }),
      compileMaskImageGenerateRuntime: async () => ({
        sdBody: {
          prompt: 'compiled zelda prompt',
        },
      }),
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'anime cette zelda',
      body: {
        prompt: 'anime cette zelda',
        width: 1024,
        height: 1024,
        durationSeconds: 1,
        fps: 2,
        sourceImageUrl: 'https://files.example.com/source-image.png',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.width, 1152);
    assert.equal(result.height, 1344);
    assert.equal(calls[0].width, 1152);
    assert.equal(calls[0].height, 1344);
  } finally {
    for (const [key, value] of Object.entries(previousDefaults)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('createGenerateVideoHandler adopts compiled portrait render sizing when prompt-only video has no meaningful explicit dimensions', async () => {
  const previousEnv = {
    A11_VIDEO_DEFAULT_WIDTH: process.env.A11_VIDEO_DEFAULT_WIDTH,
    A11_VIDEO_DEFAULT_HEIGHT: process.env.A11_VIDEO_DEFAULT_HEIGHT,
    A11_IMAGE_MAX_SIZE: process.env.A11_IMAGE_MAX_SIZE,
    A11_VIDEO_FRAME_MAX_SIZE: process.env.A11_VIDEO_FRAME_MAX_SIZE,
  };
  process.env.A11_VIDEO_DEFAULT_WIDTH = '1024';
  process.env.A11_VIDEO_DEFAULT_HEIGHT = '1024';
  process.env.A11_IMAGE_MAX_SIZE = '2048';
  delete process.env.A11_VIDEO_FRAME_MAX_SIZE;

  const calls = [];

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'zelda tirant une fleche avec un arc sur un cheval',
        },
      }),
      compileMaskImageGenerateRuntime: async () => ({
        mask: {
          meta: {
            renderSizing: {
              source: 'web_init_image',
              reason: 'preserve_init_image_ratio',
              requestedWidth: 1536,
              requestedHeight: 2048,
              resolvedWidth: 1536,
              resolvedHeight: 2048,
            },
          },
        },
        sdBody: {
          prompt: 'compiled zelda horseback prompt',
          width: 1536,
          height: 2048,
        },
      }),
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'anime cette zelda',
      body: {
        prompt: 'anime cette zelda',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.width, 1536);
    assert.equal(result.height, 2048);
    assert.equal(calls[0].width, 1536);
    assert.equal(calls[0].height, 2048);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('createGenerateVideoHandler falls back to libx264 when NVENC is unavailable at runtime', async () => {
  const ffmpegCalls = [];

  const generateVideo = createGenerateVideoHandler({
    generateSd: async () => ({
      ok: true,
      image_url: 'https://files.example.com/frame-1.png',
    }),
    fetch: async () => ({
      ok: true,
      async arrayBuffer() {
        return TINY_PNG;
      },
    }),
    uploadBufferToR2: async ({ filename, buffer }) => ({
      url: `https://files.example.com/${filename}`,
      filename,
      sizeBytes: buffer.length,
    }),
    buildCanonicalImageMaskFromText: async () => ({
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        raw: 'mario',
      },
    }),
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'compiled mario prompt',
      },
    }),
    runFfmpeg: async ({ outputPath, mp4Codec, mp4Preset, mp4Quality }) => {
      ffmpegCalls.push({ mp4Codec, mp4Preset, mp4Quality });
      if (ffmpegCalls.length === 1) {
        throw new Error('ffmpeg_failed:1:[h264_nvenc] Cannot load libcuda.so.1');
      }
      fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      return {
        ok: true,
        codec: mp4Codec,
      };
    },
  });

  const result = await generateVideo({
    req: { headers: {}, body: {} },
    prompt: 'genere une video de mario',
    body: {
      prompt: 'genere une video de mario',
      durationSeconds: 1,
      fps: 2,
      format: 'mp4',
      width: 256,
      height: 256,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(ffmpegCalls.length, 2);
  assert.equal(ffmpegCalls[0].mp4Codec, 'h264_nvenc');
  assert.equal(ffmpegCalls[1].mp4Codec, 'libx264');
  assert.equal(ffmpegCalls[1].mp4Preset, 'medium');
  assert.equal(result.videoCodec, 'libx264');
});

test('createGenerateVideoHandler reuses a local source image path without republishing between frames', async () => {
  const calls = [];
  const sourceImagePath = 'D:\\funesterie\\a11\\backend\\apps\\server\\tmp\\video-source-test.png';
  fs.mkdirSync('D:\\funesterie\\a11\\backend\\apps\\server\\tmp', { recursive: true });
  fs.writeFileSync(sourceImagePath, TINY_PNG);

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'heroic monkey',
        },
      }),
      compileMaskImageGenerateRuntime: async () => ({
        sdBody: {
          prompt: 'compiled monkey prompt',
        },
      }),
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'anime cette image',
      body: {
        prompt: 'anime cette image',
        durationSeconds: 1,
        fps: 2,
        sourceImagePath,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sourceMode, 'image_path');
    assert.equal(calls[0].init_image_url, sourceImagePath);
    assert.match(String(calls[1].init_image_url || ''), /frame-0000\.png$/i);
  } finally {
    fs.rmSync(sourceImagePath, { force: true });
  }
});

test('createGenerateVideoHandler prefers remotely accessible frame references when an SD proxy is configured', async () => {
  const previousProxyEnv = process.env.A11_SD_PROXY_URL;
  const calls = [];
  const sourceImagePath = 'D:\\funesterie\\a11\\backend\\apps\\server\\tmp\\video-source-proxy-test.png';
  fs.mkdirSync('D:\\funesterie\\a11\\backend\\apps\\server\\tmp', { recursive: true });
  fs.writeFileSync(sourceImagePath, TINY_PNG);
  process.env.A11_SD_PROXY_URL = 'https://sd.funesterie.me/api/tools/generate_sd';

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => {
        calls.push(body);
        return {
          ok: true,
          image_url: `https://files.example.com/frame-${calls.length}.png`,
        };
      },
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'heroic monkey',
        },
      }),
      compileMaskImageGenerateRuntime: async () => ({
        sdBody: {
          prompt: 'compiled monkey prompt',
        },
      }),
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'anime cette image',
      body: {
        prompt: 'anime cette image',
        durationSeconds: 1,
        fps: 2,
        sourceImagePath,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sourceMode, 'image_path');
    assert.equal(calls[0].init_image_url, 'https://files.example.com/video-source-proxy-test.png');
    assert.equal(calls[1].init_image_url, 'https://files.example.com/frame-1.png');
  } finally {
    process.env.A11_SD_PROXY_URL = previousProxyEnv;
    fs.rmSync(sourceImagePath, { force: true });
  }
});

test('buildFfmpegAssemblyArgs uses NVENC settings for mp4 when requested', () => {
  const args = buildFfmpegAssemblyArgs({
    fps: 8,
    format: 'mp4',
    framesDir: 'D:\\frames',
    outputPath: 'D:\\videos\\demo.mp4',
    mp4Codec: 'h264_nvenc',
    mp4Preset: 'p5',
    mp4Quality: 21,
  });

  assert.ok(args.includes('h264_nvenc'));
  assert.ok(args.includes('-preset'));
  assert.ok(args.includes('p5'));
  assert.ok(args.includes('-cq'));
  assert.ok(args.includes('21'));
  assert.ok(args.includes('-b:v'));
  assert.ok(args.includes('0'));
});

test('ensureFfmpegAvailable throws a tagged error when the binary is missing', () => {
  assert.throws(
    () => ensureFfmpegAvailable('definitely-missing-ffmpeg-binary'),
    /ffmpeg_unavailable:/i
  );
});

test('createGenerateVideoHandler fails fast when ffmpeg is unavailable', async () => {
  let generateSdCalls = 0;

  const generateVideo = createGenerateVideoHandler({
    ensureFfmpegAvailable: () => {
      const error = new Error('ffmpeg_unavailable:spawn ffmpeg ENOENT');
      error.code = 'ffmpeg_unavailable';
      throw error;
    },
    generateSd: async () => {
      generateSdCalls += 1;
      return {
        ok: true,
        image_url: 'https://files.example.com/frame-1.png',
      };
    },
  });

  await assert.rejects(
    () => generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'genere une video de mario',
      body: {
        prompt: 'genere une video de mario',
        durationSeconds: 1,
        fps: 2,
      },
    }),
    (error) => {
      assert.equal(error?.statusCode, 503);
      assert.equal(error?.payload?.error, 'video_ffmpeg_unavailable');
      return true;
    }
  );

  assert.equal(generateSdCalls, 0);
});

test('createGenerateVideoHandler adds sequencePlanning metadata without changing the video contract', async () => {
  const previousPlannerEnv = process.env.A11_VIDEO_SEQUENCE_PLANNER;
  process.env.A11_VIDEO_SEQUENCE_PLANNER = 'heuristic';

  try {
    let uploadedFilename = '';
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => ({
        ok: true,
        image_url: `https://files.example.com/frame-${body.width}x${body.height}.png`,
      }),
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => {
        uploadedFilename = filename;
        return {
          url: `https://files.example.com/${filename}`,
          filename,
          sizeBytes: buffer.length,
        };
      },
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: 'marche heroique',
        },
      }),
      compileMaskImageGenerateRuntime: async () => ({
        sdBody: {
          prompt: 'mario avancant sur le chemin un pas devant l autre',
        },
      }),
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: 'mario avancant sur le chemin un pas devant l autre',
      body: {
        prompt: 'mario avancant sur le chemin un pas devant l autre',
        durationSeconds: 1,
        fps: 2,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.video_url, `https://files.example.com/${uploadedFilename}`);
    assert.equal(result.sequencePlanning.providerRequested, 'heuristic');
    assert.equal(result.sequencePlanning.providerUsed, 'heuristic');
    assert.equal(result.sequencePlanning.motionProfile, 'walk_cycle');
    assert.ok(Array.isArray(result.sequencePlanning.beats) && result.sequencePlanning.beats.length > 0);
  } finally {
    if (previousPlannerEnv === undefined) delete process.env.A11_VIDEO_SEQUENCE_PLANNER;
    else process.env.A11_VIDEO_SEQUENCE_PLANNER = previousPlannerEnv;
  }
});
