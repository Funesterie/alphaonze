const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const express = require('express');

const videoGenerateModule = require('../src/routes/video-generate.cjs');

test('video generate router proxies requests when A11_VIDEO_PROXY_URL is configured', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    A11_VIDEO_PROXY_TIMEOUT_MS: process.env.A11_VIDEO_PROXY_TIMEOUT_MS,
    A11_VIDEO_PROXY_TOKEN: process.env.A11_VIDEO_PROXY_TOKEN,
    A11_VIDEO_BRIDGE_TOKEN: process.env.A11_VIDEO_BRIDGE_TOKEN,
    VIDEO_PROXY_TOKEN: process.env.VIDEO_PROXY_TOKEN,
    NEZ_ADMIN_TOKEN: process.env.NEZ_ADMIN_TOKEN,
    A11_NEZ_ADMIN_TOKEN: process.env.A11_NEZ_ADMIN_TOKEN,
    NEZ_SERVICE_TOKEN: process.env.NEZ_SERVICE_TOKEN,
    A11_NEZ_SERVICE_TOKEN: process.env.A11_NEZ_SERVICE_TOKEN,
    NEZ_ALLOWED_TOKEN: process.env.NEZ_ALLOWED_TOKEN,
    NEZ_ALLOWED_TOKENS: process.env.NEZ_ALLOWED_TOKENS,
    NEZ_TOKENS: process.env.NEZ_TOKENS,
    NEZ_TOKEN: process.env.NEZ_TOKEN,
    A11_NEZ_TOKEN: process.env.A11_NEZ_TOKEN,
  };

  let receivedBody = null;
  let receivedHeaders = null;
  const proxyServer = http.createServer((req, res) => {
    receivedHeaders = req.headers || {};
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      receivedBody = body ? JSON.parse(body) : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        tool: 'generate_video',
        video_url: 'https://video.example.com/demo.mp4',
        videoCodec: 'h264_nvenc',
        proxied: true,
      }));
    });
  });

  await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  const address = proxyServer.address();
  process.env.A11_VIDEO_PROXY_URL = `http://127.0.0.1:${address.port}/api/tools/generate_video`;
  process.env.A11_VIDEO_PROXY_TIMEOUT_MS = '30000';
  delete process.env.A11_VIDEO_PROXY_TOKEN;
  delete process.env.A11_VIDEO_BRIDGE_TOKEN;
  delete process.env.VIDEO_PROXY_TOKEN;
  process.env.NEZ_ADMIN_TOKEN = 'server-admin-token';
  delete process.env.A11_NEZ_ADMIN_TOKEN;
  delete process.env.NEZ_SERVICE_TOKEN;
  delete process.env.A11_NEZ_SERVICE_TOKEN;
  delete process.env.NEZ_ALLOWED_TOKEN;
  delete process.env.NEZ_ALLOWED_TOKENS;
  delete process.env.NEZ_TOKENS;
  delete process.env.NEZ_TOKEN;
  delete process.env.A11_NEZ_TOKEN;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    generateVideo: async () => {
      throw new Error('local generator should not be called when proxy is configured');
    },
  }).router);

  const appServer = http.createServer(app);
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const appAddress = appServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${appAddress.port}/api/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer user-jwt-token',
      },
      body: JSON.stringify({
        prompt: 'genere une video de mario',
        durationSeconds: 1,
        fps: 2,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.videoCodec, 'h264_nvenc');
    assert.equal(payload.video_url, 'https://video.example.com/demo.mp4');
    assert.equal(receivedBody?.prompt, 'genere une video de mario');
    assert.equal(receivedBody?.fps, 2);
    assert.equal(receivedHeaders?.authorization, undefined);
    assert.equal(receivedHeaders?.['x-nez-token'], 'server-admin-token');
    assert.equal(receivedHeaders?.['x-nez-admin-token'], 'server-admin-token');
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => proxyServer.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router can proxy through the local video runner env', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_VIDEO_PROXY_TOKEN: process.env.A11_VIDEO_PROXY_TOKEN,
    A11_VIDEO_BRIDGE_TOKEN: process.env.A11_VIDEO_BRIDGE_TOKEN,
    VIDEO_PROXY_TOKEN: process.env.VIDEO_PROXY_TOKEN,
  };

  let receivedBody = null;
  const proxyServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      receivedBody = body ? JSON.parse(body) : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        tool: 'generate_video',
        video_url: 'https://video.example.com/local-runner.mp4',
        proxied: true,
      }));
    });
  });

  await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  const address = proxyServer.address();
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  delete process.env.A11_VIDEO_PROXY_TOKEN;
  delete process.env.A11_VIDEO_BRIDGE_TOKEN;
  delete process.env.VIDEO_PROXY_TOKEN;
  process.env.A11_VIDEO_LOCAL_RUNNER_URL = `http://127.0.0.1:${address.port}/api/tools/generate_video`;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    generateVideo: async () => {
      throw new Error('local generator should not be called when a local video runner is configured');
    },
  }).router);

  const appServer = http.createServer(app);
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const appAddress = appServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${appAddress.port}/api/video/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'genere un clip de Vivy',
        durationSeconds: 1,
        fps: 2,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.video_url, 'https://video.example.com/local-runner.mp4');
    assert.equal(receivedBody?.prompt, 'genere un clip de Vivy');
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => proxyServer.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router sends the dedicated video bridge token when configured', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    A11_VIDEO_PROXY_TOKEN: process.env.A11_VIDEO_PROXY_TOKEN,
    A11_VIDEO_BRIDGE_TOKEN: process.env.A11_VIDEO_BRIDGE_TOKEN,
    VIDEO_PROXY_TOKEN: process.env.VIDEO_PROXY_TOKEN,
    NEZ_ADMIN_TOKEN: process.env.NEZ_ADMIN_TOKEN,
    A11_NEZ_ADMIN_TOKEN: process.env.A11_NEZ_ADMIN_TOKEN,
    NEZ_SERVICE_TOKEN: process.env.NEZ_SERVICE_TOKEN,
    A11_NEZ_SERVICE_TOKEN: process.env.A11_NEZ_SERVICE_TOKEN,
    NEZ_ALLOWED_TOKEN: process.env.NEZ_ALLOWED_TOKEN,
    NEZ_ALLOWED_TOKENS: process.env.NEZ_ALLOWED_TOKENS,
    NEZ_TOKENS: process.env.NEZ_TOKENS,
    NEZ_TOKEN: process.env.NEZ_TOKEN,
    A11_NEZ_TOKEN: process.env.A11_NEZ_TOKEN,
  };

  let receivedHeaders = null;
  const proxyServer = http.createServer((req, res) => {
    receivedHeaders = req.headers || {};
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        tool: 'generate_video',
        video_path: 'D:\\projets\\funesterie\\a11\\backend\\apps\\server\\runtime\\files\\generated\\videos\\comfy\\demo.mp4',
      }));
    });
  });

  await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  const address = proxyServer.address();
  process.env.A11_VIDEO_PROXY_URL = `http://127.0.0.1:${address.port}/api/tools/generate_video`;
  process.env.A11_VIDEO_PROXY_TOKEN = 'video-bridge-token';
  delete process.env.A11_VIDEO_BRIDGE_TOKEN;
  delete process.env.VIDEO_PROXY_TOKEN;
  delete process.env.NEZ_ADMIN_TOKEN;
  delete process.env.A11_NEZ_ADMIN_TOKEN;
  delete process.env.NEZ_SERVICE_TOKEN;
  delete process.env.A11_NEZ_SERVICE_TOKEN;
  delete process.env.NEZ_ALLOWED_TOKEN;
  delete process.env.NEZ_ALLOWED_TOKENS;
  delete process.env.NEZ_TOKENS;
  delete process.env.NEZ_TOKEN;
  delete process.env.A11_NEZ_TOKEN;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    generateVideo: async () => {
      throw new Error('local generator should not be called when proxy is configured');
    },
  }).router);

  const appServer = http.createServer(app);
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const appAddress = appServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${appAddress.port}/api/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer user-jwt-token',
      },
      body: JSON.stringify({
        prompt: 'clip test',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(receivedHeaders?.authorization, undefined);
    assert.equal(receivedHeaders?.['x-a11-video-token'], 'video-bridge-token');
    assert.equal(receivedHeaders?.['x-nez-token'], 'video-bridge-token');
    assert.equal(receivedHeaders?.['x-nez-admin-token'], undefined);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => proxyServer.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router uses Hugging Face video when enabled', async () => {
  const previousEnv = {
    A11_ENABLE_HF_VIDEO: process.env.A11_ENABLE_HF_VIDEO,
    A11_HF_VIDEO_PROVIDER: process.env.A11_HF_VIDEO_PROVIDER,
    A11_HF_VIDEO_MODEL: process.env.A11_HF_VIDEO_MODEL,
    A11_HF_VIDEO_TOKEN: process.env.A11_HF_VIDEO_TOKEN,
    A11_HF_VIDEO_FRAMES: process.env.A11_HF_VIDEO_FRAMES,
    A11_HF_VIDEO_STEPS: process.env.A11_HF_VIDEO_STEPS,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
  };
  const runtimeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'a11-hf-video-'));
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      headers: options.headers || {},
      body: options.body ? JSON.parse(String(options.body)) : null,
    });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        video: { url: 'https://cdn.example.com/hf-video.mp4' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(Buffer.from('fake-mp4'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    });
  };

  process.env.A11_ENABLE_HF_VIDEO = 'true';
  process.env.A11_HF_VIDEO_PROVIDER = 'fal-ai';
  process.env.A11_HF_VIDEO_MODEL = 'Wan-AI/Wan2.2-TI2V-5B';
  process.env.A11_HF_VIDEO_TOKEN = 'hf_test_video_token';
  process.env.A11_HF_VIDEO_FRAMES = '8';
  process.env.A11_HF_VIDEO_STEPS = '2';
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: fakeFetch,
    uploadBufferToR2: async () => {
      throw new Error('r2 unavailable in test');
    },
    generateVideo: async () => {
      throw new Error('local generator should not be called when Hugging Face video is configured');
    },
  }).router);

  const appServer = http.createServer(app);
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const appAddress = appServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${appAddress.port}/api/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: 'a11.funesterie.me',
        'x-forwarded-host': 'a11.funesterie.me',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        prompt: 'genere une video neon de moto',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.backend, 'huggingface-video');
    assert.equal(payload.provider, 'fal-ai');
    assert.match(payload.video_url, /^https:\/\/a11\.funesterie\.me\/files\/runtime\/files\/generated\/videos\/a11-hf-video-/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.prompt, 'genere une video neon de moto');
    assert.equal(calls[0].body.num_frames, 8);
    assert.equal(calls[0].body.num_inference_steps, 2);
    assert.equal(calls[0].headers.Authorization, 'Bearer hf_test_video_token');
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router follows Hugging Face fal queue responses', async () => {
  const previousEnv = {
    A11_ENABLE_HF_VIDEO: process.env.A11_ENABLE_HF_VIDEO,
    A11_HF_VIDEO_PROVIDER: process.env.A11_HF_VIDEO_PROVIDER,
    A11_HF_VIDEO_MODEL: process.env.A11_HF_VIDEO_MODEL,
    A11_HF_VIDEO_TOKEN: process.env.A11_HF_VIDEO_TOKEN,
    A11_HF_VIDEO_FRAMES: process.env.A11_HF_VIDEO_FRAMES,
    A11_HF_VIDEO_STEPS: process.env.A11_HF_VIDEO_STEPS,
    A11_HF_VIDEO_POLL_INTERVAL_MS: process.env.A11_HF_VIDEO_POLL_INTERVAL_MS,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
  };
  const runtimeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'a11-hf-fal-video-'));
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      headers: options.headers || {},
      body: options.body ? JSON.parse(String(options.body)) : null,
    });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        request_id: 'fal-request-1',
        status: 'IN_QUEUE',
        status_url: 'https://queue.example.com/status/fal-request-1',
        response_url: 'https://queue.example.com/response/fal-request-1',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).includes('/status/')) {
      return new Response(JSON.stringify({
        status: 'COMPLETED',
        response_url: 'https://queue.example.com/response/fal-request-1',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).includes('/response/')) {
      return new Response(JSON.stringify({
        video: { url: 'https://cdn.example.com/fal-video.mp4' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(Buffer.from('fake-fal-mp4'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    });
  };

  process.env.A11_ENABLE_HF_VIDEO = 'true';
  process.env.A11_HF_VIDEO_PROVIDER = 'fal-ai';
  process.env.A11_HF_VIDEO_MODEL = 'Wan-AI/Wan2.2-TI2V-5B';
  process.env.A11_HF_VIDEO_TOKEN = 'hf_test_video_token';
  process.env.A11_HF_VIDEO_FRAMES = '8';
  process.env.A11_HF_VIDEO_STEPS = '2';
  process.env.A11_HF_VIDEO_POLL_INTERVAL_MS = '10';
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: fakeFetch,
    uploadBufferToR2: async () => {
      throw new Error('r2 unavailable in test');
    },
    generateVideo: async () => {
      throw new Error('local generator should not be called when Hugging Face video is configured');
    },
  }).router);

  const appServer = http.createServer(app);
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const appAddress = appServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${appAddress.port}/api/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: 'a11.funesterie.me',
        'x-forwarded-host': 'a11.funesterie.me',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        prompt: 'genere une video gothique pour vivy',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.backend, 'huggingface-video');
    assert.equal(payload.provider, 'fal-ai');
    assert.match(payload.video_url, /^https:\/\/a11\.funesterie\.me\/files\/runtime\/files\/generated\/videos\/a11-hf-video-/);
    assert.equal(calls.length, 4);
    assert.equal(calls[0].body.prompt, 'genere une video gothique pour vivy');
    assert.equal(calls[1].url, 'https://queue.example.com/status/fal-request-1');
    assert.equal(calls[2].url, 'https://queue.example.com/response/fal-request-1');
    assert.equal(calls[3].url, 'https://cdn.example.com/fal-video.mp4');
    assert.equal(calls[1].headers.Authorization, undefined);
    assert.equal(calls[2].headers.Authorization, undefined);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router follows Hugging Face replicate predictions', async () => {
  const previousEnv = {
    A11_ENABLE_HF_VIDEO: process.env.A11_ENABLE_HF_VIDEO,
    A11_HF_VIDEO_PROVIDER: process.env.A11_HF_VIDEO_PROVIDER,
    A11_HF_VIDEO_MODEL: process.env.A11_HF_VIDEO_MODEL,
    A11_HF_VIDEO_TOKEN: process.env.A11_HF_VIDEO_TOKEN,
    A11_HF_VIDEO_FRAMES: process.env.A11_HF_VIDEO_FRAMES,
    A11_HF_VIDEO_STEPS: process.env.A11_HF_VIDEO_STEPS,
    A11_HF_VIDEO_POLL_INTERVAL_MS: process.env.A11_HF_VIDEO_POLL_INTERVAL_MS,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
  };
  const runtimeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'a11-hf-replicate-video-'));
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      headers: options.headers || {},
      body: options.body ? JSON.parse(String(options.body)) : null,
    });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        status: 'processing',
        urls: { get: 'https://router.huggingface.co/replicate/v1/predictions/replicate-request-1' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).includes('/predictions/')) {
      return new Response(JSON.stringify({
        status: 'succeeded',
        output: ['https://replicate.delivery/video.mp4'],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(Buffer.from('fake-replicate-mp4'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    });
  };

  process.env.A11_ENABLE_HF_VIDEO = 'true';
  process.env.A11_HF_VIDEO_PROVIDER = 'replicate';
  process.env.A11_HF_VIDEO_MODEL = 'Wan-AI/Wan2.2-TI2V-5B';
  process.env.A11_HF_VIDEO_TOKEN = 'hf_test_video_token';
  process.env.A11_HF_VIDEO_FRAMES = '16';
  process.env.A11_HF_VIDEO_STEPS = '2';
  process.env.A11_HF_VIDEO_POLL_INTERVAL_MS = '10';
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: fakeFetch,
    uploadBufferToR2: async () => {
      throw new Error('r2 unavailable in test');
    },
    generateVideo: async () => {
      throw new Error('local generator should not be called when Hugging Face video is configured');
    },
  }).router);

  const appServer = http.createServer(app);
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const appAddress = appServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${appAddress.port}/api/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: 'a11.funesterie.me',
        'x-forwarded-host': 'a11.funesterie.me',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        prompt: 'genere une video sombre pour vivy',
        negative_prompt: ['text', 'watermark'],
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.backend, 'huggingface-video');
    assert.equal(payload.provider, 'replicate');
    assert.match(payload.video_url, /^https:\/\/a11\.funesterie\.me\/files\/runtime\/files\/generated\/videos\/a11-hf-video-/);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].body.input.prompt, 'genere une video sombre pour vivy');
    assert.equal(calls[0].body.input.num_frames, 81);
    assert.equal(calls[0].body.input.num_inference_steps, 2);
    assert.equal(calls[0].body.input.negative_prompt, 'text, watermark');
    assert.equal(calls[1].headers.Authorization, 'Bearer hf_test_video_token');
    assert.equal(calls[2].headers.Authorization, undefined);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router does not use emergency color bars by default in production', async () => {
  const previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_EMERGENCY_MODE: process.env.A11_VIDEO_EMERGENCY_MODE,
    A11_EMERGENCY_MEDIA_MODE: process.env.A11_EMERGENCY_MEDIA_MODE,
    A11_VIDEO_EMERGENCY_FALLBACK: process.env.A11_VIDEO_EMERGENCY_FALLBACK,
  };

  process.env.NODE_ENV = 'production';
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  delete process.env.A11_VIDEO_EMERGENCY_MODE;
  delete process.env.A11_EMERGENCY_MEDIA_MODE;
  delete process.env.A11_VIDEO_EMERGENCY_FALLBACK;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    generateVideo: async () => {
      throw new Error('real_video_unavailable');
    },
  }).router);

  const appServer = http.createServer(app);
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const appAddress = appServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${appAddress.port}/api/video/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'genere une video de test',
        durationSeconds: 1,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, 'video_generation_failed');
    assert.equal(payload.emergencyFallback, undefined);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video proxy rewrites local generated media paths to the public backend origin', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    A11_VIDEO_PROXY_TIMEOUT_MS: process.env.A11_VIDEO_PROXY_TIMEOUT_MS,
    A11_VIDEO_PUBLIC_FILE_BASE_URL: process.env.A11_VIDEO_PUBLIC_FILE_BASE_URL,
    A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL: process.env.A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL,
    A11_SD_PUBLIC_FILE_BASE_URL: process.env.A11_SD_PUBLIC_FILE_BASE_URL,
    PUBLIC_API_URL: process.env.PUBLIC_API_URL,
    API_URL: process.env.API_URL,
    A11_SERVER_URL: process.env.A11_SERVER_URL,
  };

  const proxyServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      tool: 'generate_video',
      outputPath: 'C:\\srv\\a11\\runtime\\files\\generated\\videos\\job-123\\demo.mp4',
      frames: [
        {
          index: 0,
          image_url: 'http://127.0.0.1:3000/files/generated/images/job-123/frame-0000.png',
        },
      ],
    }));
  });

  await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  const address = proxyServer.address();
  process.env.A11_VIDEO_PROXY_URL = `http://127.0.0.1:${address.port}/api/tools/generate_video`;
  process.env.A11_VIDEO_PROXY_TIMEOUT_MS = '30000';
  delete process.env.A11_VIDEO_PUBLIC_FILE_BASE_URL;
  delete process.env.A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL;
  delete process.env.A11_SD_PUBLIC_FILE_BASE_URL;
  delete process.env.PUBLIC_API_URL;
  delete process.env.API_URL;
  delete process.env.A11_SERVER_URL;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    generateVideo: async () => {
      throw new Error('local generator should not be called when proxy is configured');
    },
  }).router);

  const appServer = http.createServer(app);
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const appAddress = appServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${appAddress.port}/api/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: 'a11.funesterie.me',
        'x-forwarded-host': 'a11.funesterie.me',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        prompt: 'genere une video de vivy',
        durationSeconds: 1,
        fps: 2,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.video_url, 'https://a11.funesterie.me/files/runtime/files/generated/videos/job-123/demo.mp4');
    assert.equal(payload.url, payload.video_url);
    assert.equal(payload.frames[0].image_url, 'https://a11.funesterie.me/files/runtime/files/generated/images/job-123/frame-0000.png');
    assert.equal(payload.frames[0].url, payload.frames[0].image_url);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => proxyServer.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
