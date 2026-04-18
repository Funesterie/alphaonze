const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  buildFfmpegAssemblyArgs,
  createGenerateVideoHandler,
  ensureFfmpegAvailable,
  normalizeVideoRequest,
} = require('../src/video/video-generate-runtime.cjs');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=',
  'base64'
);

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

test('createGenerateVideoHandler reuses compiled SD prompts and assembles a video artifact', async () => {
  const calls = [];
  let ffmpegInvocation = null;

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
    compileMaskImageGenerateRuntime: async () => ({
      mask: { intent: 'image.generate' },
      compiled: { target: 'image-prompt-fr' },
      sdBody: {
        prompt: 'compiled dragon prompt',
        negative_prompt: 'blurry, duplicate',
        seed: 11,
      },
    }),
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
});

test('createGenerateVideoHandler can bootstrap the first frame from an existing image url', async () => {
  const calls = [];

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
    compileMaskImageGenerateRuntime: async () => ({
      sdBody: {
        prompt: 'compiled monkey prompt',
        negative_prompt: 'blurry',
      },
    }),
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
