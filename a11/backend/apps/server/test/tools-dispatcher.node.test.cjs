const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const {
  t_generate_png,
  t_generate_pdf,
  t_send_email,
  t_share_file,
  t_schedule_email,
  t_list_resources,
  t_get_latest_resource,
} = require('../src/a11/tools-dispatcher.cjs');

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withInternalApiServer(handler, callback) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    let bodyJson = null;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      bodyJson = null;
    }
    await handler({
      req,
      res,
      bodyText,
      bodyJson,
      url: new URL(req.url, `http://${req.headers.host}`),
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const previous = {
    A11_INTERNAL_API_BASE_URL: process.env.A11_INTERNAL_API_BASE_URL,
    PORT: process.env.PORT,
  };

  process.env.A11_INTERNAL_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.PORT = String(port);

  try {
    await callback({ port });
  } finally {
    await new Promise((resolve, reject) => server.close((error_) => (error_ ? reject(error_) : resolve())));
    restoreEnv(previous);
  }
}

function createWorkspaceTempFile(filename, content) {
  const fullPath = path.join(__dirname, filename);
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
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
    assert.match(String(capturedBody?.prompt || ''), /lapin violet/i);
    assert.match(String(capturedBody?.prompt || ''), /chapeau de magicien/i);
    assert.match(String(capturedBody?.prompt || ''), /un seul sujet principal|personnage complet et reconnaissable/i);
    assert.doesNotMatch(String(capturedBody?.prompt || ''), /purple rabbit|magician hat|literal interpretation/i);
    assert.match(String(capturedBody?.negative_prompt || ''), /plusieurs sujets/i);
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

test('t_generate_png prefers a portrait canvas for single human figure prompts without explicit size', async () => {
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
      prompt: 'genere une image de angelina jolie en maillot de bain',
      outputPath: 'tests/angelina-jolie-portrait-proxy.png',
    });

    createdPath = String(result.outputPath || '');
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'stable-diffusion-proxy');
    assert.equal(fs.existsSync(createdPath), true);
    assert.equal(capturedBody?.width, 768);
    assert.equal(capturedBody?.height, 1024);
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

test('t_generate_pdf creates a readable PDF without images', async () => {
  let outputPath = '';

  try {
    const result = await t_generate_pdf({
      outputPath: 'tests/dispatcher-generate-pdf.pdf',
      title: 'Rapport A11',
      author: 'Test Suite',
      sections: [
        {
          heading: 'Introduction',
          text: 'Contenu de verification du generateur PDF.',
        },
      ],
    });

    outputPath = String(result.outputPath || '');
    assert.equal(result.ok, true);
    assert.equal(result.imageCount, 0);
    assert.deepEqual(result.missingAssets, []);
    assert.equal(fs.existsSync(outputPath), true);
    assert.equal(fs.readFileSync(outputPath).subarray(0, 4).toString('utf8'), '%PDF');
  } finally {
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }
});

test('t_send_email posts attachments to the internal mail API', async () => {
  const attachmentPath = createWorkspaceTempFile('tmp-send-email.txt', 'piece jointe dispatcher');
  let capturedRequest = null;

  try {
    await withInternalApiServer(async ({ req, res, bodyJson }) => {
      if (req.method === 'POST' && req.url === '/api/mail/send') {
        capturedRequest = {
          token: req.headers['x-nez-token'],
          body: bodyJson,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, mail: { id: 'mail-1' } }));
        return;
      }

      res.writeHead(404);
      res.end();
    }, async () => {
      const result = await t_send_email({
        _context: { authToken: 'token-mail' },
        to: 'dest@example.com',
        subject: 'Sujet test',
        message: 'Bonjour depuis le test',
        path: attachmentPath,
      });

      assert.equal(result.ok, true);
      assert.equal(result.attachmentCount, 1);
      assert.equal(result.mail.id, 'mail-1');
    });

    assert.equal(capturedRequest.token, 'token-mail');
    assert.deepEqual(capturedRequest.body.to, ['dest@example.com']);
    assert.equal(capturedRequest.body.subject, 'Sujet test');
    assert.equal(capturedRequest.body.message, 'Bonjour depuis le test');
    assert.equal(Array.isArray(capturedRequest.body.attachments), true);
    assert.equal(capturedRequest.body.attachments.length, 1);
    assert.equal(capturedRequest.body.attachments[0].filename, path.basename(attachmentPath));
    assert.equal(Buffer.from(capturedRequest.body.attachments[0].contentBase64, 'base64').toString('utf8'), 'piece jointe dispatcher');
  } finally {
    if (fs.existsSync(attachmentPath)) {
      fs.unlinkSync(attachmentPath);
    }
  }
});

test('t_share_file uploads a file and returns the public download URL', async () => {
  const attachmentPath = createWorkspaceTempFile('tmp-share-file.txt', 'partage dispatcher');
  let capturedRequest = null;

  try {
    await withInternalApiServer(async ({ req, res, bodyJson }) => {
      if (req.method === 'POST' && req.url === '/api/files/upload') {
        capturedRequest = {
          token: req.headers['x-nez-token'],
          body: bodyJson,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          file: {
            id: 42,
            downloadUrl: 'https://files.example.test/download/42',
            expiresAt: '2026-04-17T12:00:00.000Z',
          },
        }));
        return;
      }

      res.writeHead(404);
      res.end();
    }, async () => {
      const result = await t_share_file({
        _context: { authToken: 'token-share', conversationId: 'conv-42' },
        path: attachmentPath,
        to: 'friend@example.com',
        subject: 'Partage',
        message: 'Voici le fichier',
      });

      assert.equal(result.ok, true);
      assert.equal(result.url, 'https://files.example.test/download/42');
      assert.equal(result.file.id, 42);
    });

    assert.equal(capturedRequest.token, 'token-share');
    assert.equal(capturedRequest.body.filename, path.basename(attachmentPath));
    assert.equal(capturedRequest.body.conversationId, 'conv-42');
    assert.deepEqual(capturedRequest.body.emailTo, ['friend@example.com']);
    assert.equal(capturedRequest.body.attachToEmail, true);
    assert.equal(Buffer.from(capturedRequest.body.contentBase64, 'base64').toString('utf8'), 'partage dispatcher');
  } finally {
    if (fs.existsSync(attachmentPath)) {
      fs.unlinkSync(attachmentPath);
    }
  }
});

test('t_schedule_email posts the schedule request with attachments', async () => {
  const attachmentPath = createWorkspaceTempFile('tmp-schedule-email.txt', 'email planifie');
  let capturedRequest = null;

  try {
    await withInternalApiServer(async ({ req, res, bodyJson }) => {
      if (req.method === 'POST' && req.url === '/api/mail/schedule') {
        capturedRequest = {
          token: req.headers['x-nez-token'],
          body: bodyJson,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, job: { id: 'job-1', status: 'scheduled' } }));
        return;
      }

      res.writeHead(404);
      res.end();
    }, async () => {
      const result = await t_schedule_email({
        _context: { authToken: 'token-schedule' },
        to: 'later@example.com',
        subject: 'Mail plus tard',
        message: 'Planifie',
        path: attachmentPath,
        sendAt: '2026-04-17T10:30:00.000Z',
      });

      assert.equal(result.ok, true);
      assert.equal(result.job.id, 'job-1');
    });

    assert.equal(capturedRequest.token, 'token-schedule');
    assert.equal(capturedRequest.body.kind, 'email');
    assert.deepEqual(capturedRequest.body.to, ['later@example.com']);
    assert.equal(capturedRequest.body.sendAt, '2026-04-17T10:30:00.000Z');
    assert.equal(capturedRequest.body.attachments.length, 1);
    assert.equal(Buffer.from(capturedRequest.body.attachments[0].contentBase64, 'base64').toString('utf8'), 'email planifie');
  } finally {
    if (fs.existsSync(attachmentPath)) {
      fs.unlinkSync(attachmentPath);
    }
  }
});

test('resource listing helpers call the expected internal API routes', async () => {
  const seen = [];

  await withInternalApiServer(async ({ req, res, url }) => {
    seen.push({
      method: req.method,
      pathname: url.pathname,
      search: url.searchParams.toString(),
      token: req.headers['x-nez-token'],
    });

    if (req.method === 'GET' && url.pathname === '/api/resources/my') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, resources: [{ id: 1, kind: 'image' }] }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/resources/latest') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, resource: { id: 9, kind: 'pdf' } }));
      return;
    }

    res.writeHead(404);
    res.end();
  }, async () => {
    const listResult = await t_list_resources({
      _context: { authToken: 'token-resources' },
      conversationId: 'conv-list',
      kind: 'image',
      limit: 7,
    });
    const latestResult = await t_get_latest_resource({
      _context: { authToken: 'token-resources' },
      conversationId: 'conv-list',
      kind: 'pdf',
    });

    assert.equal(listResult.ok, true);
    assert.equal(listResult.resources.length, 1);
    assert.equal(latestResult.ok, true);
    assert.equal(latestResult.resource.id, 9);
  });

  assert.deepEqual(seen, [
    {
      method: 'GET',
      pathname: '/api/resources/my',
      search: 'limit=7&conversationId=conv-list&kind=image',
      token: 'token-resources',
    },
    {
      method: 'GET',
      pathname: '/api/resources/latest',
      search: 'conversationId=conv-list&kind=pdf',
      token: 'token-resources',
    },
  ]);
});
