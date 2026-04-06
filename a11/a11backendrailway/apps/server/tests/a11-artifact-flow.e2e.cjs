const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

process.env.PORT = process.env.PORT || '3000';
process.env.A11_INTERNAL_API_BASE_URL = process.env.A11_INTERNAL_API_BASE_URL || 'http://127.0.0.1:3000';

const {
  t_generate_pdf,
  t_share_file,
  t_email_resource,
} = require('../src/a11/tools-dispatcher.cjs');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function expectReject(promise, matcher) {
  let thrown = null;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'Expected promise to reject');
  if (typeof matcher === 'function') {
    matcher(thrown);
  }
  return thrown;
}

async function withMockFetch(handler, fn) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  try {
    return await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

async function removeIfExists(targetPath) {
  try {
    await fsp.unlink(targetPath);
  } catch {
    // ignore cleanup failures
  }
}

async function run() {
  const context = {
    authToken: 'test-token',
    conversationId: 'conv-e2e',
  };

  const missingAssetPath = 'tests/e2e-missing-assets.pdf';
  const linklessPdfPath = 'tests/e2e-linkless.pdf';
  const flowPdfPath = 'tests/e2e-flow.pdf';

  const missingError = await expectReject(
    t_generate_pdf({
      outputPath: missingAssetPath,
      title: 'Missing assets',
      sections: [
        {
          heading: 'Intro',
          text: 'Section de test',
          images: ['docs/fake-ninja-image.png'],
        },
      ],
      _context: context,
    }),
    (error) => {
      assert.equal(error.code, 'generate_pdf_missing_assets');
      assert.ok(Array.isArray(error.missingAssets));
      assert.equal(error.missingAssets.length, 1);
      assert.equal(error.missingAssets[0].ref, 'docs/fake-ninja-image.png');
    }
  );
  assert.equal(missingError.code, 'generate_pdf_missing_assets');

  const linklessPdf = await t_generate_pdf({
    outputPath: linklessPdfPath,
    title: 'Linkless PDF',
    sections: [
      {
        heading: 'Section 1',
        text: 'PDF de test sans image.',
      },
    ],
    _context: context,
  });
  assert.equal(linklessPdf.ok, true);
  assert.ok(fs.existsSync(linklessPdf.outputPath), 'Expected linkless PDF file to exist');

  await withMockFetch(async (url, init = {}) => {
    const requestUrl = new URL(String(url));
    const pathname = requestUrl.pathname;
    if (pathname === '/api/files/upload') {
      assert.equal(init.method, 'POST');
      assert.equal(String(init.headers?.['X-NEZ-TOKEN'] || ''), context.authToken);
      return jsonResponse({
        ok: true,
        file: {
          filename: 'e2e-linkless.pdf',
          url: '',
        },
        conversationResource: {
          id: 51,
          filename: 'e2e-linkless.pdf',
          url: '',
        },
      });
    }
    throw new Error(`Unexpected fetch in linkless scenario: ${url}`);
  }, async () => {
    const result = await t_share_file({
      outputPath: linklessPdf.outputPath,
      _context: context,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'public_download_url_missing');
  });

  const flowPdf = await t_generate_pdf({
    outputPath: flowPdfPath,
    title: 'Flow PDF',
    sections: [
      {
        heading: 'Introduction',
        text: 'PDF de test complet.',
      },
    ],
    _context: context,
  });
  assert.equal(flowPdf.ok, true);
  assert.ok(fs.existsSync(flowPdf.outputPath), 'Expected flow PDF file to exist');

  const flowBuffer = await fsp.readFile(flowPdf.outputPath);
  const publicLink = 'https://api.funesterie.pro/api/public/resources/42/download?token=e2e-token';
  let uploadedPayload = null;
  let emailPayload = null;

  await withMockFetch(async (url, init = {}) => {
    const requestUrl = new URL(String(url));
    const pathname = requestUrl.pathname;

    if (pathname === '/api/files/upload') {
      uploadedPayload = JSON.parse(String(init.body || '{}'));
      assert.equal(init.method, 'POST');
      assert.equal(String(init.headers?.['X-NEZ-TOKEN'] || ''), context.authToken);
      const uploadedBuffer = Buffer.from(String(uploadedPayload.contentBase64 || ''), 'base64');
      assert.ok(uploadedBuffer.length > 0, 'Expected uploaded PDF bytes');
      assert.equal(uploadedBuffer.subarray(0, 4).toString('utf8'), '%PDF');
      return jsonResponse({
        ok: true,
        file: {
          filename: uploadedPayload.filename,
          downloadUrl: publicLink,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        record: {
          id: 7,
          downloadUrl: publicLink,
        },
        conversationResource: {
          id: 42,
          userId: 'test-user',
          filename: uploadedPayload.filename,
          downloadUrl: publicLink,
          url: publicLink,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      });
    }

    if (pathname === '/api/resources/email') {
      emailPayload = JSON.parse(String(init.body || '{}'));
      assert.equal(init.method, 'POST');
      assert.equal(String(init.headers?.['X-NEZ-TOKEN'] || ''), context.authToken);
      assert.equal(Number(emailPayload.resourceId), 42);
      return jsonResponse({
        ok: true,
        mail: {
          id: 'mail_test_123',
          to: emailPayload.to,
          attached: true,
        },
        resource: {
          id: 42,
          downloadUrl: publicLink,
        },
      });
    }

    if (pathname === '/api/public/resources/42/download') {
      return new Response(flowBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(flowBuffer.length),
        },
      });
    }

    throw new Error(`Unexpected fetch in e2e scenario: ${url}`);
  }, async () => {
    const shareResult = await t_share_file({
      outputPath: flowPdf.outputPath,
      _context: context,
    });
    assert.equal(shareResult.ok, true);
    assert.equal(shareResult.url, publicLink);
    assert.equal(uploadedPayload.filename, path.basename(flowPdf.outputPath));

    const downloadResponse = await global.fetch(shareResult.url);
    assert.equal(downloadResponse.status, 200);
    assert.equal(String(downloadResponse.headers.get('content-type') || ''), 'application/pdf');
    const downloadedBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    assert.equal(downloadedBuffer.subarray(0, 4).toString('utf8'), '%PDF');

    const emailResult = await t_email_resource({
      resourceId: 42,
      to: 'cellaurojeffrey@gmail.com',
      attachToEmail: true,
      _context: context,
    });
    assert.equal(emailResult.ok, true);
    assert.equal(String(emailPayload.to[0] || ''), 'cellaurojeffrey@gmail.com');
  });

  await removeIfExists(linklessPdf.outputPath);
  await removeIfExists(flowPdf.outputPath);

  console.log('a11-artifact-flow.e2e: OK');
}

run().catch(async (error) => {
  console.error('a11-artifact-flow.e2e: FAILED');
  console.error(error);
  process.exitCode = 1;
});
