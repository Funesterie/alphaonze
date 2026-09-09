'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-generator-'));

const {
  extractComfyJobStatus,
  extractComfyOutputUrl,
  extractComfyPromptId,
  generateClip,
  generateOneVideo,
  postJson,
  sanitizeDiagnostic,
} = require('../src/clips/clip-generator-v2.cjs');

process.env.MCP_BRIDGE_INTERNAL_KEY = 'test-internal-key-32-characters-minimum';

function bridge(structuredContent, text = '') {
  return {
    ok: true,
    result: {
      content: text ? [{ type: 'text', text }] : [],
      structuredContent,
    },
  };
}

test('les réponses Comfy structurées priment sur le texte décoratif', () => {
  const signed = 'https://storage.googleapis.com/comfy-cloud-assets/hash.mp4?X-Goog-Signature=secret';
  const response = bridge({
    help_url: 'https://docs.comfy.org/help',
    prompt_id: '5097f8f3-4c78-498e-a417-b2b562862887',
    job_status: 'completed',
    result: { status: 'succeeded' },
    results: [{ class_type: 'SaveVideo', url: signed, inline_url: signed + '&inline=1' }],
  }, 'Documentation: https://docs.comfy.org/help');
  assert.equal(extractComfyPromptId(response), '5097f8f3-4c78-498e-a417-b2b562862887');
  assert.equal(extractComfyJobStatus(response), 'completed');
  assert.equal(extractComfyOutputUrl(response), signed);
});

test('un segment fait exactement une soumission payante et lit status/output structurés', async () => {
  const calls = [];
  const promptId = '5097f8f3-4c78-498e-a417-b2b562862887';
  const signed = 'https://storage.googleapis.com/comfy-cloud-assets/hash.mp4?X-Goog-Signature=secret';
  const responses = [
    bridge({ prompt_id: promptId }),
    bridge({ job_status: 'completed', result: { status: 'succeeded' } }),
    bridge({ results: [{ class_type: 'SaveVideo', url: signed }] }),
  ];
  const result = await generateOneVideo('A cinematic scene', 0, 1000, null, {
    postJsonImpl: async (_url, body) => { calls.push(body.tool); return responses.shift(); },
    sleepImpl: async () => {},
    pollIntervalMs: 1,
  });
  assert.equal(result, signed);
  assert.deepEqual(calls, ['comfy__partner_generate', 'comfy__get_job_status', 'comfy__get_output']);
  assert.equal(calls.filter((tool) => tool === 'comfy__partner_generate').length, 1);
});

test('une erreur auth i2v ne déclenche aucun repli ou second débit', async () => {
  let submissions = 0;
  await assert.rejects(
    generateOneVideo('A portrait', 0, 1000, {
      referenceImageUrls: ['https://images.example/reference.png'],
      negativePrompt: '',
    }, {
      postJsonImpl: async () => {
        submissions += 1;
        return {
          ok: true,
          result: { isError: true, content: [{ type: 'text', text: 'API key: sk-secret rejected (401)' }] },
        };
      },
    }),
    /API key=\[masqué\].*401/,
  );
  assert.equal(submissions, 1);
});

test('une réponse réseau ambiguë ne resoumet jamais le segment', async () => {
  let submissions = 0;
  await assert.rejects(
    generateOneVideo('A scene', 0, 1000, null, {
      postJsonImpl: async () => {
        submissions += 1;
        const error = new Error('socket fermé');
        error.ambiguous = true;
        throw error;
      },
    }),
    /clip_video_submission_ambiguous/,
  );
  assert.equal(submissions, 1);
});

test('le préflight audio précède Director et toute vidéo payante', async () => {
  const order = [];
  await assert.rejects(
    generateClip({ songUrl: '/api/vivy/studio/assets/missing.mp3', title: 'Absent' }, {
      materializeMedia: async () => { order.push('audio'); throw new Error('clip_media_local_file_missing'); },
      loadDirectorImpl: () => ({ directClip: async () => { order.push('director'); return { scenes: [] }; } }),
      generateVideoImpl: async () => { order.push('video'); return ''; },
    }),
    /clip_audio_preflight_failed: clip_media_local_file_missing/,
  );
  assert.deepEqual(order, ['audio']);
});

test('un arrêt après un segment assemble un clip explicitement partiel sans resoumission', async () => {
  const order = [];
  let videoSubmissions = 0;
  const materializeMedia = async (_value, destination, options) => {
    order.push(options.kind);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, options.kind === 'audio' ? 'ID3audio' : 'video');
  };
  const execFileSyncImpl = (command, args) => {
    if (command === 'ffprobe') return Buffer.from(args.includes('stream=codec_type') ? 'video\n' : '16.0\n');
    if (command === 'ffmpeg') {
      fs.writeFileSync(args.at(-1), 'assembled');
      return Buffer.alloc(0);
    }
    throw new Error(`commande inattendue ${command}`);
  };
  const result = await generateClip({ songUrl: '/audio.mp3', title: 'Partiel' }, {
    materializeMedia,
    loadDirectorImpl: () => ({
      directClip: async (cfg) => {
        order.push(cfg.audioPath && fs.existsSync(cfg.audioPath) ? 'director-after-audio' : 'director-too-soon');
        return { scenes: [{ name: 'Plan', visual: 'A precise cinematic visual' }] };
      },
    }),
    generateVideoImpl: async (_prompt, index) => {
      videoSubmissions += 1;
      if (index === 1) throw new Error('provider_failed');
      return 'https://cloud.comfy.org/api/s/first';
    },
    execFileSyncImpl,
    sleepImpl: async () => {},
  });
  assert.equal(result.partial, true);
  assert.equal(result.segments, 1);
  assert.equal(result.requestedSegments, 2);
  assert.match(result.warning, /clip_partial: 1\/2.*provider_failed/);
  assert.equal(videoSubmissions, 2, 'un seul appel par segment, arrêt immédiat après l’échec');
  assert.deepEqual(order.slice(0, 2), ['audio', 'director-after-audio']);
});

test('deux clips simultanés du même titre gardent des sorties distinctes et vérifiées', async () => {
  let nonce = 0;
  const deps = {
    nowImpl: () => 123456,
    randomBytesImpl: () => Buffer.from((++nonce).toString(16).padStart(8, '0'), 'hex'),
    materializeMedia: async (_value, destination) => fs.writeFileSync(destination, 'media'),
    loadDirectorImpl: () => ({ directClip: async () => ({ scenes: [{ visual: 'A scene' }] }) }),
    generateVideoImpl: async () => 'https://cloud.comfy.org/video.mp4',
    execFileSyncImpl: (command, args) => {
      if (command === 'ffprobe') return Buffer.from(args.includes('stream=codec_type') ? 'video\n' : '8\n');
      fs.writeFileSync(args.at(-1), 'assembled');
      return Buffer.alloc(0);
    },
  };
  const [a, b] = await Promise.all([generateClip({ title: 'Même titre', songUrl: '/audio.mp3' }, deps), generateClip({ title: 'Même titre', songUrl: '/audio.mp3' }, deps)]);
  assert.notEqual(a.filename, b.filename);
  assert.ok(fs.statSync(a.path).size > 0);
  assert.ok(fs.statSync(b.path).size > 0);
  await assert.rejects(generateClip({ title: 'Vide', songUrl: '/audio.mp3' }, {
    ...deps,
    execFileSyncImpl: (command) => command === 'ffprobe' ? Buffer.from('8\n') : Buffer.alloc(0),
  }), /clip_output_missing_or_empty/);
});

test('une scène Director sans visual bloque avant la génération vidéo', async () => {
  let videoCalled = false;
  await assert.rejects(
    generateClip({ songUrl: '/audio.mp3', title: 'Plan cassé' }, {
      materializeMedia: async (_value, destination) => {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, 'ID3audio');
      },
      loadDirectorImpl: () => ({ directClip: async () => ({ scenes: [{ name: 'vide', visual: '   ' }] }) }),
      generateVideoImpl: async () => { videoCalled = true; },
    }),
    /clip_director_scene_visual_missing/,
  );
  assert.equal(videoCalled, false);
});

test('les diagnostics retirent query signée et secrets', () => {
  const safe = sanitizeDiagnostic('GET https://storage.googleapis.com/comfy-cloud-assets/a.mp4?X-Goog-Signature=SECRET api_key=abcd Bearer xyz');
  assert.doesNotMatch(safe, /X-Goog|SECRET|abcd|xyz/);
  assert.match(safe, /comfy-cloud-assets\/a\.mp4/);
});

test('postJson borne les attentes et masque le corps des erreurs HTTP', async (t) => {
  const server = http.createServer((req, res) => {
    req.resume();
    res.statusCode = 503;
    res.end('api_key=TOPSECRET https://storage.googleapis.com/comfy-cloud-assets/a.mp4?X-Goog-Signature=SECRET');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  await assert.rejects(
    postJson(`http://127.0.0.1:${address.port}/bridge`, { tool: 'test' }, { timeoutMs: 1000 }),
    (error) => {
      assert.match(error.message, /mcp_bridge_http_503/);
      assert.doesNotMatch(error.message, /TOPSECRET|X-Goog|SECRET/);
      return true;
    },
  );
});

test('postJson coupe une réponse locale bloquée avec une erreur ambiguë', async (t) => {
  const sockets = new Set();
  const server = http.createServer((req) => { req.resume(); });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const address = server.address();
  await assert.rejects(
    postJson(`http://127.0.0.1:${address.port}/bridge`, { tool: 'test' }, { timeoutMs: 40 }),
    (error) => error.code === 'mcp_bridge_timeout' && error.ambiguous === true,
  );
});
