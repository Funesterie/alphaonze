const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');

const { t_generate_png } = require('../src/a11/tools-dispatcher.cjs');

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('t_generate_png fails by default when no real image backend is available', async () => {
  const previous = {
    A11_SD_PROXY_URL: process.env.A11_SD_PROXY_URL,
    SD_PROXY_URL: process.env.SD_PROXY_URL,
    ENABLE_SD: process.env.ENABLE_SD,
    A11_ALLOW_PLACEHOLDER_PNG: process.env.A11_ALLOW_PLACEHOLDER_PNG,
    A11_DEV_ALLOW_PLACEHOLDER_PNG: process.env.A11_DEV_ALLOW_PLACEHOLDER_PNG,
  };

  delete process.env.A11_SD_PROXY_URL;
  delete process.env.SD_PROXY_URL;
  process.env.ENABLE_SD = 'false';
  delete process.env.A11_ALLOW_PLACEHOLDER_PNG;
  delete process.env.A11_DEV_ALLOW_PLACEHOLDER_PNG;

  try {
    const result = await t_generate_png({
      prompt: 'lapin rose de test',
      outputPath: 'tests/lapin-rose-real-required.png',
    });

    assert.equal(result.ok, false);
    assert.match(String(result.error || ''), /sd_unavailable|image_generation_unavailable/);
    assert.equal(fs.existsSync(String(result.outputPath || '')), false);
  } finally {
    restoreEnv(previous);
  }
});

test('t_generate_png still supports explicit placeholder fallback when requested', async () => {
  const previous = {
    A11_SD_PROXY_URL: process.env.A11_SD_PROXY_URL,
    SD_PROXY_URL: process.env.SD_PROXY_URL,
    ENABLE_SD: process.env.ENABLE_SD,
    A11_ALLOW_PLACEHOLDER_PNG: process.env.A11_ALLOW_PLACEHOLDER_PNG,
    A11_DEV_ALLOW_PLACEHOLDER_PNG: process.env.A11_DEV_ALLOW_PLACEHOLDER_PNG,
  };

  delete process.env.A11_SD_PROXY_URL;
  delete process.env.SD_PROXY_URL;
  process.env.ENABLE_SD = 'false';
  delete process.env.A11_ALLOW_PLACEHOLDER_PNG;
  delete process.env.A11_DEV_ALLOW_PLACEHOLDER_PNG;

  let createdPath = '';
  try {
    const result = await t_generate_png({
      prompt: 'lapin rose placeholder',
      outputPath: 'tests/lapin-rose-placeholder.png',
      allowPlaceholder: true,
    });

    createdPath = String(result.outputPath || '');
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'placeholder');
    assert.equal(result.placeholder, true);
    assert.equal(fs.existsSync(createdPath), true);
  } finally {
    if (createdPath && fs.existsSync(createdPath)) {
      fs.unlinkSync(createdPath);
    }
    restoreEnv(previous);
  }
});

test('t_generate_png sends a stronger literal prompt bundle to the SD proxy', async () => {
  const previous = {
    A11_SD_PROXY_URL: process.env.A11_SD_PROXY_URL,
    SD_PROXY_URL: process.env.SD_PROXY_URL,
    ENABLE_SD: process.env.ENABLE_SD,
  };

  const pixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnF9J0AAAAASUVORK5CYII=',
    'base64'
  );

  let createdPath = '';
  let capturedBody = null;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/generate') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, image_url: `http://127.0.0.1:${server.address().port}/image.png` }));
      return;
    }

    if (req.method === 'GET' && req.url === '/image.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(pixelPng);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxyUrl = `http://127.0.0.1:${server.address().port}/generate`;

  process.env.A11_SD_PROXY_URL = proxyUrl;
  delete process.env.SD_PROXY_URL;
  process.env.ENABLE_SD = 'false';

  try {
    const result = await t_generate_png({
      prompt: "genere une image d'un lapin violet sortant d'un chapeau de magicien",
      outputPath: 'tests/lapin-violet-proxy.png',
    });

    createdPath = String(result.outputPath || '');
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'stable-diffusion-proxy');
    assert.equal(fs.existsSync(createdPath), true);
    assert.match(String(capturedBody?.prompt || ''), /purple rabbit/i);
    assert.match(String(capturedBody?.prompt || ''), /magician hat/i);
    assert.match(String(capturedBody?.prompt || ''), /literal interpretation/i);
    assert.match(String(capturedBody?.negative_prompt || ''), /flowers/i);
    assert.equal(capturedBody?.prompt_prebuilt, true);
    assert.equal(capturedBody?.negative_prompt_prebuilt, true);
  } finally {
    if (createdPath && fs.existsSync(createdPath)) {
      fs.unlinkSync(createdPath);
    }
    await new Promise((resolve, reject) => server.close((error_) => (error_ ? reject(error_) : resolve())));
    restoreEnv(previous);
  }
});

test('t_generate_png keeps generated proxy filenames short enough for linux filesystems', async () => {
  const previous = {
    A11_SD_PROXY_URL: process.env.A11_SD_PROXY_URL,
    SD_PROXY_URL: process.env.SD_PROXY_URL,
    ENABLE_SD: process.env.ENABLE_SD,
  };

  const pixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnF9J0AAAAASUVORK5CYII=',
    'base64'
  );

  let createdPath = '';
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/generate') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, image_url: `http://127.0.0.1:${server.address().port}/image.png` }));
      return;
    }

    if (req.method === 'GET' && req.url === '/image.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(pixelPng);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxyUrl = `http://127.0.0.1:${server.address().port}/generate`;

  process.env.A11_SD_PROXY_URL = proxyUrl;
  delete process.env.SD_PROXY_URL;
  process.env.ENABLE_SD = 'false';

  try {
    const result = await t_generate_png({
      prompt: 'red tu peux générer a image of soleil. high quality detailed. single main subject clear centered composition clear subject focus simple clean background. literal interpretation apply the requested colors to the main subject only do not add extra props flowers decorative patterns or extra characters unless requested',
    });

    createdPath = String(result.outputPath || '');
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'stable-diffusion-proxy');
    assert.equal(fs.existsSync(createdPath), true);
    assert.ok(createdPath.length < 220);
    assert.ok(require('node:path').basename(createdPath).length < 110);
  } finally {
    if (createdPath && fs.existsSync(createdPath)) {
      fs.unlinkSync(createdPath);
    }
    await new Promise((resolve, reject) => server.close((error_) => (error_ ? reject(error_) : resolve())));
    restoreEnv(previous);
  }
});
