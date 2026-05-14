const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const express = require('express');

const videoGenerateModule = require('../src/routes/video-generate.cjs');

test('video generate router proxies requests when A11_VIDEO_PROXY_URL is configured', async () => {
  const previousEnv = {
    A11_VIDEO_PROXY_URL: process.env.A11_VIDEO_PROXY_URL,
    A11_VIDEO_PROXY_TIMEOUT_MS: process.env.A11_VIDEO_PROXY_TIMEOUT_MS,
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
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => proxyServer.close(resolve));
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
        host: 'a11.funesterie.pro',
        'x-forwarded-host': 'a11.funesterie.pro',
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
    assert.equal(payload.video_url, 'https://a11.funesterie.pro/files/runtime/files/generated/videos/job-123/demo.mp4');
    assert.equal(payload.url, payload.video_url);
    assert.equal(payload.frames[0].image_url, 'https://a11.funesterie.pro/files/runtime/files/generated/images/job-123/frame-0000.png');
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
