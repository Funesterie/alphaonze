const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const express = require('express');

const videoGenerateModule = require('../src/routes/video-generate.cjs');
const { resolveXaiVideoConfig } = require('../lib/xai-video.cjs');

test('xAI video config ignores Groq gsk server keys', () => {
  const config = resolveXaiVideoConfig({
    GROQ_API_KEY: 'gsk_test_groq_key_not_xai',
  });

  assert.equal(config.token, '');
  assert.equal(config.enabled, false);
});

test('video generate router proxies requests when A11_VIDEO_LOCAL_RUNNER_URL is configured', async () => {
  const previousEnv = {
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
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
  process.env.A11_VIDEO_LOCAL_RUNNER_URL = `http://127.0.0.1:${address.port}/api/tools/generate_video`;
  delete process.env.A11_VIDEO_PROXY_URL;
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
      throw new Error('local generator should not be called when local runner is configured');
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

test('video generate router forwards personal session provider tokens to the proxy without leaking them', async () => {
  const previousEnv = {
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    A11_VIDEO_PROXY_TIMEOUT_MS: process.env.A11_VIDEO_PROXY_TIMEOUT_MS,
    A11_VIDEO_PROXY_TOKEN: process.env.A11_VIDEO_PROXY_TOKEN,
    A11_VIDEO_BRIDGE_TOKEN: process.env.A11_VIDEO_BRIDGE_TOKEN,
    VIDEO_PROXY_TOKEN: process.env.VIDEO_PROXY_TOKEN,
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
        video_url: 'https://video.example.com/session-provider.mp4',
      }));
    });
  });

  await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  const address = proxyServer.address();
  delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;
  process.env.A11_VIDEO_PROXY_URL = `http://127.0.0.1:${address.port}/api/tools/generate_video`;
  process.env.A11_VIDEO_PROXY_TIMEOUT_MS = '30000';

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
        'X-A11-Video-Provider': 'runcomfy',
        'X-A11-RunComfy-Key': 'session-runcomfy-secret',
        'X-A11-HF-Video-Key': 'session-hf-secret',
      },
      body: JSON.stringify({
        prompt: 'vivy roule dans une cite cyberpunk magenta',
        durationSeconds: 6,
      }),
    });
    const payload = await response.json();
    const serializedPayload = JSON.stringify(payload);

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(receivedHeaders?.['x-a11-runcomfy-key'], 'session-runcomfy-secret');
    assert.equal(receivedHeaders?.['x-runcomfy-api-key'], 'session-runcomfy-secret');
    assert.equal(receivedHeaders?.['x-a11-hf-video-key'], 'session-hf-secret');
    assert.equal(receivedHeaders?.['x-huggingface-token'], 'session-hf-secret');
    assert.doesNotMatch(serializedPayload, /session-runcomfy-secret/);
    assert.doesNotMatch(serializedPayload, /session-hf-secret/);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => proxyServer.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router can use Grok Imagine xAI with a personal session key', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_XAI_BASE_URL: process.env.A11_XAI_BASE_URL,
    A11_XAI_VIDEO_MODEL: process.env.A11_XAI_VIDEO_MODEL,
    A11_XAI_VIDEO_TIMEOUT_MS: process.env.A11_XAI_VIDEO_TIMEOUT_MS,
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_ENABLE_HF_VIDEO: process.env.A11_ENABLE_HF_VIDEO,
    A11_ENABLE_HUGGINGFACE_VIDEO: process.env.A11_ENABLE_HUGGINGFACE_VIDEO,
    A11_HF_VIDEO_TOKEN: process.env.A11_HF_VIDEO_TOKEN,
    HF_TOKEN: process.env.HF_TOKEN,
  };
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'a11-xai-video-'));
  const calls = [];
  process.env.A11_RUNTIME_ROOT = tempRoot;
  process.env.A11_XAI_BASE_URL = 'https://api.x.ai/v1';
  process.env.A11_XAI_VIDEO_MODEL = 'grok-imagine-video';
  process.env.A11_XAI_VIDEO_TIMEOUT_MS = '30000';
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;
  delete process.env.A11_ENABLE_HF_VIDEO;
  delete process.env.A11_ENABLE_HUGGINGFACE_VIDEO;
  delete process.env.A11_HF_VIDEO_TOKEN;
  delete process.env.HF_TOKEN;

  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/videos/generations')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        arrayBuffer: async () => Buffer.from(JSON.stringify({
          video_url: 'https://cdn.x.ai/demo-vivy.mp4',
        })),
      };
    }
    if (String(url) === 'https://cdn.x.ai/demo-vivy.mp4') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'video/mp4' },
        arrayBuffer: async () => Buffer.from('fake-mp4-payload'),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: fakeFetch,
    uploadBufferToR2: async ({ filename, buffer }) => ({
      filename,
      storageKey: `tests/${filename}`,
      url: `https://r2.example.com/tests/${filename}`,
      sizeBytes: buffer.length,
    }),
    generateVideo: async () => {
      throw new Error('local generator should not be called for xAI session video');
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
        'X-A11-Video-Provider': 'xai',
        'X-A11-XAI-Key': 'session-xai-secret',
      },
      body: JSON.stringify({
        prompt: 'Vivy passe en hypervitesse dans une cite cyberpunk magenta.',
        durationSeconds: 6,
      }),
    });
    const payload = await response.json();
    const serializedPayload = JSON.stringify(payload);
    const generationCall = calls.find((call) => call.url.endsWith('/videos/generations'));
    const postedBody = JSON.parse(generationCall?.init?.body || '{}');

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.backend, 'xai-video');
    assert.equal(payload.provider, 'xai');
    assert.match(payload.video_url, /^https:\/\/r2\.example\.com\/tests\/a11-xai-video-/);
    assert.equal(generationCall?.init?.headers?.Authorization, 'Bearer session-xai-secret');
    assert.equal(postedBody.model, 'grok-imagine-video');
    assert.equal(postedBody.duration, 6);
    assert.doesNotMatch(serializedPayload, /session-xai-secret/);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await fsp.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router does not let implicit xAI session auth steal visual-reference jobs from image-aware runners', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_XAI_BASE_URL: process.env.A11_XAI_BASE_URL,
    A11_XAI_VIDEO_MODEL: process.env.A11_XAI_VIDEO_MODEL,
  };
  const calls = [];
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  process.env.A11_VIDEO_LOCAL_RUNNER_URL = 'https://runner.example.com/api/tools/generate_video';
  process.env.A11_XAI_BASE_URL = 'https://api.x.ai/v1';
  process.env.A11_XAI_VIDEO_MODEL = 'grok-imagine-video';

  const fakeFetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      headers: init.headers || {},
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (String(url).includes('/videos/generations')) {
      throw new Error('xAI should not be called for implicit visual-reference routing');
    }
    return new Response(JSON.stringify({
      ok: true,
      tool: 'generate_video',
      video_url: 'https://video.example.com/image-aware-runner.mp4',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: fakeFetch,
    generateVideo: async () => {
      throw new Error('local generator should not be called when local runner is configured');
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
        'X-A11-XAI-Key': 'session-xai-secret',
      },
      body: JSON.stringify({
        prompt: 'genere une video du karateka dans le meme dojo',
        sourceImageUrl: 'https://files.example.com/karateka.png',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.video_url, 'https://video.example.com/image-aware-runner.mp4');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://runner.example.com/api/tools/generate_video');
    assert.equal(calls[0].body.sourceImageUrl, 'https://files.example.com/karateka.png');
    assert.equal(calls[0].headers['x-a11-xai-key'], 'session-xai-secret');
    assert.equal(calls.some((call) => call.url.includes('/videos/generations')), false);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router does not treat Groq gsk keys as xAI video tokens', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
  };
  const calls = [];
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  process.env.A11_VIDEO_LOCAL_RUNNER_URL = 'https://runner.example.com/api/tools/generate_video';

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: async (url, init = {}) => {
      calls.push({
        url: String(url),
        headers: init.headers || {},
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({
        ok: true,
        tool: 'generate_video',
        video_url: 'https://video.example.com/groq-not-xai.mp4',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    generateVideo: async () => {
      throw new Error('local generator should not be called when local runner is configured');
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
        'X-A11-Grok-Key': 'gsk_test_groq_key_not_xai',
      },
      body: JSON.stringify({
        prompt: 'clip test avec une image',
        sourceImageUrl: 'https://files.example.com/ref.png',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['x-a11-xai-key'], undefined);
    assert.equal(calls[0].headers['x-a11-grok-key'], undefined);
    assert.equal(calls[0].headers['x-xai-api-key'], undefined);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router blocks server-paid xAI video without an authenticated premium tier', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_ENABLE_XAI_VIDEO: process.env.A11_ENABLE_XAI_VIDEO,
    A11_XAI_VIDEO_TOKEN: process.env.A11_XAI_VIDEO_TOKEN,
    A11_XAI_BASE_URL: process.env.A11_XAI_BASE_URL,
  };
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;
  process.env.A11_ENABLE_XAI_VIDEO = '1';
  process.env.A11_XAI_VIDEO_TOKEN = 'server-paid-xai-secret';
  process.env.A11_XAI_BASE_URL = 'https://api.x.ai/v1';
  let fetchCalled = false;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: async () => {
      fetchCalled = true;
      throw new Error('xAI server credit should not be called without an authenticated premium tier');
    },
    generateVideo: async () => {
      throw new Error('local generator should not be called for a strict xAI provider request');
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
        'X-A11-Video-Provider': 'xai',
      },
      body: JSON.stringify({
        prompt: 'Vivy roule en hypervitesse dans la cite magenta.',
        durationSeconds: 6,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 402);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, 'paid_video_demo_required');
    assert.equal(payload.provider, 'xai');
    assert.equal(fetchCalled, false);
    assert.doesNotMatch(JSON.stringify(payload), /server-paid-xai-secret/);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('video generate router can prefer server-paid xAI for premium prompt-only jobs', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_ENABLE_HF_VIDEO: process.env.A11_ENABLE_HF_VIDEO,
    A11_ENABLE_HUGGINGFACE_VIDEO: process.env.A11_ENABLE_HUGGINGFACE_VIDEO,
    A11_HF_VIDEO_TOKEN: process.env.A11_HF_VIDEO_TOKEN,
    HF_TOKEN: process.env.HF_TOKEN,
    A11_ENABLE_XAI_VIDEO: process.env.A11_ENABLE_XAI_VIDEO,
    A11_VIDEO_PREFER_XAI: process.env.A11_VIDEO_PREFER_XAI,
    A11_XAI_VIDEO_TOKEN: process.env.A11_XAI_VIDEO_TOKEN,
    A11_XAI_BASE_URL: process.env.A11_XAI_BASE_URL,
    A11_XAI_VIDEO_MODEL: process.env.A11_XAI_VIDEO_MODEL,
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
  };
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'a11-xai-server-video-'));
  const calls = [];
  process.env.A11_RUNTIME_ROOT = tempRoot;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;
  delete process.env.A11_ENABLE_HF_VIDEO;
  delete process.env.A11_ENABLE_HUGGINGFACE_VIDEO;
  delete process.env.A11_HF_VIDEO_TOKEN;
  delete process.env.HF_TOKEN;
  process.env.A11_ENABLE_XAI_VIDEO = '1';
  process.env.A11_VIDEO_PREFER_XAI = '1';
  process.env.A11_XAI_VIDEO_TOKEN = 'server-paid-xai-secret';
  process.env.A11_XAI_BASE_URL = 'https://api.x.ai/v1';
  process.env.A11_XAI_VIDEO_MODEL = 'grok-imagine-video';

  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/videos/generations')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        arrayBuffer: async () => Buffer.from(JSON.stringify({
          video_url: 'https://cdn.x.ai/server-demo.mp4',
        })),
      };
    }
    if (String(url) === 'https://cdn.x.ai/server-demo.mp4') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'video/mp4' },
        arrayBuffer: async () => Buffer.from('fake-server-mp4-payload'),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((req, _res, next) => {
    req.user = { id: 'premium-xai-test', email: 'premium-xai@example.com', tier: 'premium' };
    next();
  });
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: fakeFetch,
    uploadBufferToR2: async ({ filename, buffer }) => ({
      filename,
      storageKey: `tests/${filename}`,
      url: `https://r2.example.com/tests/${filename}`,
      sizeBytes: buffer.length,
    }),
    generateVideo: async () => {
      throw new Error('local generator should not be called when server xAI is preferred');
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
        prompt: 'Vivy traverse un ciel de neon en plan large.',
        durationSeconds: 6,
      }),
    });
    const payload = await response.json();
    const generationCall = calls.find((call) => call.url.endsWith('/videos/generations'));
    const serializedPayload = JSON.stringify(payload);

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.backend, 'xai-video');
    assert.equal(payload.provider, 'xai');
    assert.equal(payload.providerUsed, 'platform_cloud');
    assert.equal(payload.chargedCredits, 'platform');
    assert.equal(generationCall?.init?.headers?.Authorization, 'Bearer server-paid-xai-secret');
    assert.doesNotMatch(serializedPayload, /server-paid-xai-secret/);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await fsp.rm(tempRoot, { recursive: true, force: true });
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
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
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
  process.env.A11_VIDEO_LOCAL_RUNNER_URL = `http://127.0.0.1:${address.port}/api/tools/generate_video`;
  delete process.env.A11_VIDEO_PROXY_URL;
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
      throw new Error('local generator should not be called when local runner is configured');
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

test('video generate router polls async local video proxy jobs', async () => {
  const previousEnv = {
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    A11_VIDEO_PROXY_TIMEOUT_MS: process.env.A11_VIDEO_PROXY_TIMEOUT_MS,
    A11_VIDEO_PROXY_TOKEN: process.env.A11_VIDEO_PROXY_TOKEN,
    A11_VIDEO_PROXY_FORCE_ASYNC: process.env.A11_VIDEO_PROXY_FORCE_ASYNC,
    A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL: process.env.A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL,
    A11_VIDEO_PUBLIC_FILE_BASE_URL: process.env.A11_VIDEO_PUBLIC_FILE_BASE_URL,
    PUBLIC_API_URL: process.env.PUBLIC_API_URL,
    API_URL: process.env.API_URL,
    A11_SERVER_URL: process.env.A11_SERVER_URL,
  };

  const requests = [];
  let pollCount = 0;
  const proxyServer = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers || {},
    });
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const parsedBody = body ? JSON.parse(body) : null;
        requests[requests.length - 1].body = parsedBody;
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          status: 'pending',
          jobId: 'lvjob-test-1',
          poll_url: '/api/video/jobs/lvjob-test-1',
          pollIntervalMs: 1000,
        }));
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/video/jobs/lvjob-test-1') {
      pollCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (pollCount === 1) {
        res.end(JSON.stringify({
          ok: true,
          status: 'running',
          jobId: 'lvjob-test-1',
          poll_url: '/api/video/jobs/lvjob-test-1',
          pollIntervalMs: 1000,
        }));
        return;
      }
      res.end(JSON.stringify({
        ok: true,
        status: 'done',
        jobId: 'lvjob-test-1',
        result: {
          ok: true,
          provider: 'comfyui-mochi',
          video_path: 'D:\\projets\\funesterie\\a11\\backend\\apps\\server\\runtime\\files\\generated\\videos\\comfy\\20260603\\demo.mp4',
        },
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });

  await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  const address = proxyServer.address();
  process.env.A11_VIDEO_LOCAL_RUNNER_URL = `http://127.0.0.1:${address.port}/api/tools/generate_video`;
  delete process.env.A11_VIDEO_PROXY_URL;
  process.env.A11_VIDEO_PROXY_TIMEOUT_MS = '30000';
  process.env.A11_VIDEO_PROXY_TOKEN = 'video-bridge-token';
  process.env.A11_VIDEO_PROXY_FORCE_ASYNC = 'true';
  process.env.A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL = 'https://sd.funesterie.me/files/generated/videos';
  delete process.env.A11_VIDEO_PUBLIC_FILE_BASE_URL;
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'clip vivy async',
        durationSeconds: 1,
        fps: 2,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.video_url, 'https://sd.funesterie.me/files/generated/videos/20260603/demo.mp4');
    assert.equal(requests[0]?.body?.acceptAsyncVideoJob, true);
    assert.equal(requests[0]?.headers?.['x-a11-video-token'], 'video-bridge-token');
    assert.equal(requests.find((entry) => entry.method === 'GET')?.headers?.['x-a11-video-token'], 'video-bridge-token');
    assert.equal(pollCount, 2);
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
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_VIDEO_PROXY_FORCE_ASYNC: process.env.A11_VIDEO_PROXY_FORCE_ASYNC,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_BACKEND: process.env.A11_VIDEO_BACKEND,
    VIDEO_BACKEND: process.env.VIDEO_BACKEND,
    A11_ENABLE_XAI_VIDEO: process.env.A11_ENABLE_XAI_VIDEO,
    A11_VIDEO_PREFER_XAI: process.env.A11_VIDEO_PREFER_XAI,
    A11_XAI_VIDEO_TOKEN: process.env.A11_XAI_VIDEO_TOKEN,
    XAI_API_KEY: process.env.XAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
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
  delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;
  delete process.env.A11_VIDEO_PROXY_FORCE_ASYNC;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  delete process.env.A11_VIDEO_BACKEND;
  delete process.env.VIDEO_BACKEND;
  delete process.env.A11_ENABLE_XAI_VIDEO;
  delete process.env.A11_VIDEO_PREFER_XAI;
  delete process.env.A11_XAI_VIDEO_TOKEN;
  delete process.env.XAI_API_KEY;
  delete process.env.GROQ_API_KEY;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((req, _res, next) => {
    req.user = { id: 'premium-video-test', email: 'premium-video@example.com', tier: 'premium' };
    next();
  });
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
    assert.match(calls[0].body.prompt, /Riding forward|neon-lit Tokyo|moto/i);
    assert.equal(calls[0].body.num_frames, 64);
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
    A11_REPLICATE_VIDEO_TOKEN: process.env.A11_REPLICATE_VIDEO_TOKEN,
    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
    A11_HF_VIDEO_FRAMES: process.env.A11_HF_VIDEO_FRAMES,
    A11_HF_VIDEO_STEPS: process.env.A11_HF_VIDEO_STEPS,
    A11_HF_VIDEO_POLL_INTERVAL_MS: process.env.A11_HF_VIDEO_POLL_INTERVAL_MS,
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_VIDEO_PROXY_FORCE_ASYNC: process.env.A11_VIDEO_PROXY_FORCE_ASYNC,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_BACKEND: process.env.A11_VIDEO_BACKEND,
    VIDEO_BACKEND: process.env.VIDEO_BACKEND,
    A11_ENABLE_XAI_VIDEO: process.env.A11_ENABLE_XAI_VIDEO,
    A11_VIDEO_PREFER_XAI: process.env.A11_VIDEO_PREFER_XAI,
    A11_XAI_VIDEO_TOKEN: process.env.A11_XAI_VIDEO_TOKEN,
    XAI_API_KEY: process.env.XAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
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
  delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;
  delete process.env.A11_VIDEO_PROXY_FORCE_ASYNC;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  delete process.env.A11_VIDEO_BACKEND;
  delete process.env.VIDEO_BACKEND;
  delete process.env.A11_ENABLE_XAI_VIDEO;
  delete process.env.A11_VIDEO_PREFER_XAI;
  delete process.env.A11_XAI_VIDEO_TOKEN;
  delete process.env.XAI_API_KEY;
  delete process.env.GROQ_API_KEY;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((req, _res, next) => {
    req.user = { id: 'premium-video-test', email: 'premium-video@example.com', tier: 'premium' };
    next();
  });
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
    assert.match(calls[0].body.prompt, /gothique|cinematic motion/i);
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
    A11_REPLICATE_VIDEO_TOKEN: process.env.A11_REPLICATE_VIDEO_TOKEN,
    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
    A11_HF_VIDEO_FRAMES: process.env.A11_HF_VIDEO_FRAMES,
    A11_HF_VIDEO_STEPS: process.env.A11_HF_VIDEO_STEPS,
    A11_HF_VIDEO_POLL_INTERVAL_MS: process.env.A11_HF_VIDEO_POLL_INTERVAL_MS,
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_VIDEO_PROXY_FORCE_ASYNC: process.env.A11_VIDEO_PROXY_FORCE_ASYNC,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_BACKEND: process.env.A11_VIDEO_BACKEND,
    VIDEO_BACKEND: process.env.VIDEO_BACKEND,
    A11_ENABLE_XAI_VIDEO: process.env.A11_ENABLE_XAI_VIDEO,
    A11_VIDEO_PREFER_XAI: process.env.A11_VIDEO_PREFER_XAI,
    A11_XAI_VIDEO_TOKEN: process.env.A11_XAI_VIDEO_TOKEN,
    XAI_API_KEY: process.env.XAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
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
  delete process.env.A11_REPLICATE_VIDEO_TOKEN;
  delete process.env.REPLICATE_API_TOKEN;
  process.env.A11_HF_VIDEO_FRAMES = '16';
  process.env.A11_HF_VIDEO_STEPS = '2';
  process.env.A11_HF_VIDEO_POLL_INTERVAL_MS = '10';
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;
  delete process.env.A11_VIDEO_PROXY_FORCE_ASYNC;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  delete process.env.A11_VIDEO_BACKEND;
  delete process.env.VIDEO_BACKEND;
  delete process.env.A11_ENABLE_XAI_VIDEO;
  delete process.env.A11_VIDEO_PREFER_XAI;
  delete process.env.A11_XAI_VIDEO_TOKEN;
  delete process.env.XAI_API_KEY;
  delete process.env.GROQ_API_KEY;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((req, _res, next) => {
    req.user = { id: 'premium-video-test', email: 'premium-video@example.com', tier: 'premium' };
    next();
  });
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
        sourceImageUrl: 'https://files.example.com/vivy-cover.png',
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
    assert.match(calls[0].body.input.prompt, /sombre|reference subject|cinematic motion/i);
    assert.equal(calls[0].body.input.image, 'https://files.example.com/vivy-cover.png');
    assert.equal(calls[0].body.input.num_frames, 81);
    assert.equal(calls[0].body.input.num_inference_steps, 2);
    assert.match(calls[0].body.input.negative_prompt, /floating limbs/);
    assert.match(calls[0].body.input.negative_prompt, /face covered by glow/);
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

test('video generate router uses direct Replicate token for replicate video provider', async () => {
  const previousEnv = {
    A11_ENABLE_HF_VIDEO: process.env.A11_ENABLE_HF_VIDEO,
    A11_HF_VIDEO_PROVIDER: process.env.A11_HF_VIDEO_PROVIDER,
    A11_HF_VIDEO_MODEL: process.env.A11_HF_VIDEO_MODEL,
    A11_HF_VIDEO_TOKEN: process.env.A11_HF_VIDEO_TOKEN,
    A11_REPLICATE_VIDEO_TOKEN: process.env.A11_REPLICATE_VIDEO_TOKEN,
    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
    A11_REPLICATE_VIDEO_MODEL: process.env.A11_REPLICATE_VIDEO_MODEL,
    A11_REPLICATE_BASE_URL: process.env.A11_REPLICATE_BASE_URL,
    A11_HF_VIDEO_FRAMES: process.env.A11_HF_VIDEO_FRAMES,
    A11_HF_VIDEO_STEPS: process.env.A11_HF_VIDEO_STEPS,
    A11_HF_VIDEO_POLL_INTERVAL_MS: process.env.A11_HF_VIDEO_POLL_INTERVAL_MS,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
  };
  const runtimeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'a11-direct-replicate-video-'));
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
        urls: { get: 'https://api.replicate.com/v1/predictions/replicate-direct-1' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).includes('/predictions/')) {
      return new Response(JSON.stringify({
        status: 'succeeded',
        output: ['https://replicate.delivery/direct-video.mp4'],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(Buffer.from('fake-direct-replicate-mp4'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    });
  };

  process.env.A11_ENABLE_HF_VIDEO = 'true';
  process.env.A11_HF_VIDEO_PROVIDER = 'replicate';
  process.env.A11_HF_VIDEO_MODEL = 'Wan-AI/Wan2.2-TI2V-5B';
  process.env.REPLICATE_API_TOKEN = 'r8_test_video_token';
  delete process.env.A11_HF_VIDEO_TOKEN;
  delete process.env.A11_REPLICATE_VIDEO_TOKEN;
  delete process.env.A11_REPLICATE_VIDEO_MODEL;
  delete process.env.A11_REPLICATE_BASE_URL;
  process.env.A11_HF_VIDEO_FRAMES = '16';
  process.env.A11_HF_VIDEO_STEPS = '2';
  process.env.A11_HF_VIDEO_POLL_INTERVAL_MS = '10';
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((req, _res, next) => {
    req.user = { id: 'premium-video-test', email: 'premium-video@example.com', tier: 'premium' };
    next();
  });
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: fakeFetch,
    uploadBufferToR2: async () => {
      throw new Error('r2 unavailable in test');
    },
    generateVideo: async () => {
      throw new Error('local generator should not be called when direct Replicate video is configured');
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
        prompt: 'vivy passe en hypervitesse dans une cite magenta',
        sourceImageUrl: 'https://files.example.com/vivy-cover.png',
        provider: 'replicate',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.backend, 'huggingface-video');
    assert.equal(payload.provider, 'replicate');
    assert.match(payload.video_url, /^https:\/\/a11\.funesterie\.me\/files\/runtime\/files\/generated\/videos\/a11-hf-video-/);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, 'https://api.replicate.com/v1/models/wan-video/wan-2.2-5b-fast/predictions');
    assert.equal(calls[0].headers.Authorization, 'Bearer r8_test_video_token');
    assert.equal(calls[0].headers.Prefer, 'wait=60');
    assert.match(calls[0].body.input.prompt, /hypervitesse|reference subject|cinematic motion/i);
    assert.equal(calls[0].body.input.image, 'https://files.example.com/vivy-cover.png');
    assert.equal(calls[1].headers.Authorization, 'Bearer r8_test_video_token');
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

test('video generate router builds a first-person cloud prompt before Replicate WAN when server cloud is open', async () => {
  const previousEnv = {
    A11_ENABLE_HF_VIDEO: process.env.A11_ENABLE_HF_VIDEO,
    A11_HF_VIDEO_PROVIDER: process.env.A11_HF_VIDEO_PROVIDER,
    A11_HF_VIDEO_MODEL: process.env.A11_HF_VIDEO_MODEL,
    A11_HF_VIDEO_TOKEN: process.env.A11_HF_VIDEO_TOKEN,
    A11_REPLICATE_VIDEO_TOKEN: process.env.A11_REPLICATE_VIDEO_TOKEN,
    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
    A11_REPLICATE_VIDEO_MODEL: process.env.A11_REPLICATE_VIDEO_MODEL,
    A11_REPLICATE_BASE_URL: process.env.A11_REPLICATE_BASE_URL,
    A11_HF_VIDEO_FRAMES: process.env.A11_HF_VIDEO_FRAMES,
    A11_HF_VIDEO_STEPS: process.env.A11_HF_VIDEO_STEPS,
    A11_HF_VIDEO_POLL_INTERVAL_MS: process.env.A11_HF_VIDEO_POLL_INTERVAL_MS,
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    VIDEO_PROXY_URL: process.env.VIDEO_PROXY_URL,
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_VIDEO_SERVER_CLOUD_OPEN: process.env.A11_VIDEO_SERVER_CLOUD_OPEN,
  };
  const runtimeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'a11-replicate-prompt-builder-'));
  const calls = [];
  const promptBuilderCalls = [];
  const fakeFetch = async (url, options = {}) => {
    const parsedBody = options.body ? JSON.parse(String(options.body)) : null;
    calls.push({
      url: String(url),
      headers: options.headers || {},
      body: parsedBody,
    });
    if (/\/refs\/(?:impact|voice)\.(?:mp3|wav)$/i.test(String(url))) {
      return new Response(Buffer.from('fake-audio-reference'), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    }
    if (parsedBody?.input?.prompt) {
      return new Response(JSON.stringify({
        status: 'processing',
        urls: { get: 'https://api.replicate.com/v1/predictions/replicate-built-prompt-1' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).includes('/predictions/')) {
      return new Response(JSON.stringify({
        status: 'succeeded',
        output: ['https://replicate.delivery/built-prompt-video.mp4'],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(Buffer.from('fake-built-prompt-mp4'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    });
  };

  process.env.A11_ENABLE_HF_VIDEO = 'true';
  process.env.A11_HF_VIDEO_PROVIDER = 'replicate';
  process.env.A11_HF_VIDEO_MODEL = 'Wan-AI/Wan2.2-TI2V-5B';
  process.env.REPLICATE_API_TOKEN = 'r8_test_video_token';
  process.env.A11_VIDEO_SERVER_CLOUD_OPEN = '1';
  delete process.env.A11_HF_VIDEO_TOKEN;
  delete process.env.A11_REPLICATE_VIDEO_TOKEN;
  delete process.env.A11_REPLICATE_VIDEO_MODEL;
  delete process.env.A11_REPLICATE_BASE_URL;
  process.env.A11_HF_VIDEO_FRAMES = '16';
  process.env.A11_HF_VIDEO_STEPS = '2';
  process.env.A11_HF_VIDEO_POLL_INTERVAL_MS = '10';
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  delete process.env.A11_VIDEO_PROXY_URL;
  delete process.env.VIDEO_PROXY_URL;
  delete process.env.A11_VIDEO_LOCAL_RUNNER_URL;

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', videoGenerateModule.createVideoGenerateRouter({
    fetch: fakeFetch,
    buildVideoPrompt: async (input) => {
      promptBuilderCalls.push(input);
      return {
        prompt: 'Walking through neon Tokyo streets at night, rain reflecting magenta light, first-person cinematic motion',
        hasReferenceSubject: true,
        motionType: 'walk',
      };
    },
    uploadBufferToR2: async () => {
      throw new Error('r2 unavailable in test');
    },
    generateVideo: async () => {
      throw new Error('local generator should not be called when direct Replicate video is configured');
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
        prompt: 'je marche dans tokyo la nuit',
        sourceImageUrl: 'https://files.example.com/selfie.png',
        referenceImageUrls: [
          'https://files.example.com/selfie.png',
          'https://files.example.com/tokyo-neon-style.png',
        ],
        audioUrl: 'https://files.example.com/refs/impact.mp3',
        referenceAudioUrls: [
          'https://files.example.com/refs/impact.mp3',
          'https://files.example.com/refs/voice.wav',
        ],
        sourceVideoUrl: 'https://files.example.com/refs/action-ref.mp4',
        referenceVideoUrls: [
          'https://files.example.com/refs/action-ref.mp4',
          'https://files.example.com/refs/camera-ref.mp4',
        ],
        provider: 'replicate',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.provider, 'replicate');
    assert.equal(promptBuilderCalls.length, 1);
    assert.equal(promptBuilderCalls[0].userMessage, 'je marche dans tokyo la nuit');
    assert.equal(promptBuilderCalls[0].hasReferenceImage, true);
    assert.deepEqual(promptBuilderCalls[0].referenceImageUrls, [
      'https://files.example.com/selfie.png',
      'https://files.example.com/tokyo-neon-style.png',
    ]);
    assert.deepEqual(promptBuilderCalls[0].referenceAudioUrls, [
      'https://files.example.com/refs/impact.mp3',
      'https://files.example.com/refs/voice.wav',
    ]);
    assert.deepEqual(promptBuilderCalls[0].referenceVideoUrls, [
      'https://files.example.com/refs/action-ref.mp4',
      'https://files.example.com/refs/camera-ref.mp4',
    ]);
    const replicatePredictionCall = calls.find((call) => call.body?.input?.prompt);
    assert.ok(replicatePredictionCall);
    assert.equal(replicatePredictionCall.body.input.prompt, 'Walking through neon Tokyo streets at night, rain reflecting magenta light, first-person cinematic motion');
    assert.equal(replicatePredictionCall.body.input.image, 'https://files.example.com/selfie.png');
    assert.equal(payload.prompt, 'Walking through neon Tokyo streets at night, rain reflecting magenta light, first-person cinematic motion');
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
    A11_VIDEO_LOCAL_RUNNER_URL: process.env.A11_VIDEO_LOCAL_RUNNER_URL,
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
  process.env.A11_VIDEO_LOCAL_RUNNER_URL = `http://127.0.0.1:${address.port}/api/tools/generate_video`;
  delete process.env.A11_VIDEO_PROXY_URL;
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
      throw new Error('local generator should not be called when local runner is configured');
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
