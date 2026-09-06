'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_STATUS_PATH = 'D:\\agent-bus\\voice\\local-gpu-worker-status.json';
let cachedGpuStatus = null;
let cachedGpuStatusAt = 0;

function env(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readToken() {
  const candidates = [
    env('A11_LOCAL_GPU_WORKER_TOKEN_FILE'),
    env('A11_TTS_LOCAL_WORKER_TOKEN_FILE'),
    'D:\\projets\\funesterie\\secrets\\local-gpu-worker-token.txt',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const value = fs.readFileSync(path.resolve(candidate), 'utf8').trim();
      if (value) return value;
    } catch {
      // Optional local secret file.
    }
  }
  return env('A11_LOCAL_GPU_WORKER_TOKEN') || env('A11_TTS_LOCAL_WORKER_TOKEN');
}

function readGpuStatus() {
  if (String(env('A11_LOCAL_GPU_WORKER_GPU_STATUS', 'true')).toLowerCase() === 'false') return null;
  const now = Date.now();
  if (cachedGpuStatusAt && now - cachedGpuStatusAt < 5000) return cachedGpuStatus;
  cachedGpuStatusAt = now;
  try {
    const probe = spawnSync('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total',
      '--format=csv,noheader,nounits',
    ], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
    });
    if (probe.status !== 0 || !String(probe.stdout || '').trim()) {
      cachedGpuStatus = null;
      return cachedGpuStatus;
    }
    const [name, utilization, memoryUsed, memoryTotal] = String(probe.stdout || '').split(/\r?\n/)[0]
      .split(',')
      .map((part) => part.trim());
    const used = Number(memoryUsed);
    const total = Number(memoryTotal);
    cachedGpuStatus = {
      name: name || null,
      utilizationGpuPercent: Number(utilization),
      memoryUsedMiB: used,
      memoryTotalMiB: total,
      memoryUsedPercent: Number.isFinite(used) && Number.isFinite(total) && total > 0
        ? Math.round((used / total) * 1000) / 10
        : null,
    };
    return cachedGpuStatus;
  } catch {
    cachedGpuStatus = null;
    return cachedGpuStatus;
  }
}

function writeStatus(status) {
  const statusPath = env('A11_LOCAL_GPU_WORKER_STATUS_PATH', DEFAULT_STATUS_PATH);
  const gpu = readGpuStatus();
  try {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify({
      schema: 'funesterie.local-gpu-voice-worker.v1',
      updatedAt: new Date().toISOString(),
      ...(gpu ? { gpu } : {}),
      ...status,
    }, null, 2), 'utf8');
  } catch {
    // Status is best effort.
  }
}

function buildUrl(baseUrl, route) {
  return new URL(route, `${String(baseUrl || '').replace(/\/$/, '')}/`).toString();
}

function parseRemoteBaseUrls() {
  const raw = env(
    'A11_LOCAL_GPU_WORKER_REMOTE_URLS',
    env('A11_LOCAL_GPU_WORKER_REMOTE_URL', env('A11_LOCAL_GPU_WORKER_BASE_URL', 'https://a11.funesterie.me'))
  );
  const urls = raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(urls.length ? urls : ['https://a11.funesterie.me']));
}

function normalizePersona(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'k44' || raw === 'kaen' || raw === 'kaen44') return 'kaen44';
  if (raw === 'vivy' || raw === 'vivi') return 'vivy';
  return 'a11';
}

function defaultVoiceStyle(persona) {
  const normalized = normalizePersona(persona);
  if (normalized === 'kaen44') return 'kaen44-official-french-narrator';
  if (normalized === 'vivy') return 'vivy';
  return 'a11-official-stern-french';
}

async function postJson(url, token, payload, timeoutMs = 30000) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-a11-worker-token': token,
    },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { text };
  }
  if (!response.ok) {
    const error = new Error(body?.message || body?.error || `http_${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body || {};
}

async function synthesizeLocalAudio(localBaseUrl, job) {
  const body = job?.body || {};
  const persona = normalizePersona(body.voicePersona || body.ttsPersona || body.persona || body.surface);
  const voiceStyle = String(body.voiceStyle || body.voice_style || defaultVoiceStyle(persona)).trim();
  const synthesize = await fetch(buildUrl(localBaseUrl, '/api/voice/synthesize'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: String(body.text || body.prompt || body.message || '').slice(0, 4096),
      persona,
      surface: body.surface || persona,
      voicePersona: body.voicePersona || persona,
      voiceStyle,
      vocalMode: body.vocalMode || 'adaptive',
      f0Shift: body.f0Shift ?? body.voiceF0Shift ?? undefined,
    }),
    signal: AbortSignal.timeout(Number(env('A11_LOCAL_GPU_SYNTH_TIMEOUT_MS', '300000')) || 300000),
  });
  const synthText = await synthesize.text();
  let synthPayload = null;
  try {
    synthPayload = synthText ? JSON.parse(synthText) : null;
  } catch {
    synthPayload = { text: synthText };
  }
  if (!synthesize.ok || synthPayload?.ok === false) {
    throw new Error(synthPayload?.detail || synthPayload?.message || synthPayload?.error || `local_synthesize_http_${synthesize.status}`);
  }
  const audioPath = synthPayload?.audio_url || synthPayload?.audioUrl || synthPayload?.url;
  if (!audioPath) throw new Error('local_audio_url_missing');
  const audioUrl = /^https?:\/\//i.test(String(audioPath))
    ? String(audioPath)
    : buildUrl(localBaseUrl, String(audioPath).replace(/^\//, ''));
  const audioResponse = await fetch(audioUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(Number(env('A11_LOCAL_GPU_AUDIO_TIMEOUT_MS', '120000')) || 120000),
  });
  if (!audioResponse.ok) throw new Error(`local_audio_http_${audioResponse.status}`);
  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
  if (!audioBuffer.length) throw new Error('local_audio_empty');
  return {
    audioBase64: audioBuffer.toString('base64'),
    contentType: audioResponse.headers.get('content-type') || 'audio/wav',
    engine: synthPayload?.engine || synthPayload?.voiceConversion?.engine || 'local-gpu-xtts-rvc',
    voiceStyle: synthPayload?.voiceStyle || synthPayload?.voiceConversion?.voiceStyle || voiceStyle,
    rvcModel: synthPayload?.voiceConversion?.rvcModel || synthPayload?.providerCapabilities?.rvcModel || null,
    rvcIndex: synthPayload?.voiceConversion?.rvcIndex || synthPayload?.providerCapabilities?.rvcIndex || null,
    attemptedEngines: synthPayload?.voiceConversion?.attemptedEngines || [synthPayload?.engine || 'local-gpu-xtts-rvc'],
  };
}

async function run() {
  const token = readToken();
  if (!token) {
    throw new Error('local_gpu_worker_token_missing');
  }

  const remoteBaseUrls = parseRemoteBaseUrls();
  const localBaseUrl = env('A11_LOCAL_GPU_VOICE_URL', 'http://127.0.0.1:5000');
  const workerId = env('A11_LOCAL_GPU_WORKER_ID', `${os.hostname()}-rtx5070-voice`).slice(0, 120);
  let processed = 0;
  let failed = 0;

  writeStatus({ ok: true, state: 'starting', workerId, remoteBaseUrls, localBaseUrl, processed, failed });

  while (true) {
    try {
      let claim = null;
      let claimedRemoteBaseUrl = null;
      let lastClaimError = null;
      for (const remoteBaseUrl of remoteBaseUrls) {
        let candidate = null;
        try {
          candidate = await postJson(buildUrl(remoteBaseUrl, '/api/tts/local-worker/claim'), token, { workerId }, 30000);
        } catch (error) {
          lastClaimError = error;
          continue;
        }
        if (candidate?.job) {
          claim = candidate;
          claimedRemoteBaseUrl = remoteBaseUrl;
          break;
        }
        if (!claim || (candidate?.enabled && !claim.enabled)) {
          claim = candidate;
          claimedRemoteBaseUrl = remoteBaseUrl;
        }
      }
      if (!claim && lastClaimError) throw lastClaimError;

      if (!claim?.job) {
        writeStatus({
          ok: true,
          state: 'idle',
          workerId,
          remoteBaseUrls,
          localBaseUrl,
          processed,
          failed,
          pollIntervalMs: claim?.pollIntervalMs || 1500,
          remoteQueue: claim ? {
            enabled: claim.enabled ?? null,
            backpressure: Boolean(claim.backpressure),
            reason: claim.reason || null,
            queueDepth: claim.queueDepth ?? null,
            leased: claim.leased ?? null,
            maxActive: claim.maxActive ?? null,
            availableSlots: claim.availableSlots ?? null,
          } : null,
        });
        await sleep(Number(claim?.pollIntervalMs || 1500) || 1500);
        continue;
      }

      const job = claim.job;
      writeStatus({
        ok: true,
        state: 'processing',
        workerId,
        remoteBaseUrls,
        remoteBaseUrl: claimedRemoteBaseUrl,
        localBaseUrl,
        jobId: job.id,
        leaseMs: claim.leaseMs || null,
        processed,
        failed,
      });
      try {
        const result = await synthesizeLocalAudio(localBaseUrl, job);
        await postJson(buildUrl(claimedRemoteBaseUrl, `/api/tts/local-worker/jobs/${encodeURIComponent(job.id)}/complete`), token, {
          workerId,
          ...result,
        }, 90000);
        processed += 1;
        writeStatus({ ok: true, state: 'completed', workerId, remoteBaseUrls, remoteBaseUrl: claimedRemoteBaseUrl, localBaseUrl, jobId: job.id, processed, failed });
      } catch (error) {
        failed += 1;
        await postJson(buildUrl(claimedRemoteBaseUrl, `/api/tts/local-worker/jobs/${encodeURIComponent(job.id)}/fail`), token, {
          workerId,
          error: 'local_gpu_worker_failed',
          message: String(error?.message || error).slice(0, 800),
        }, 30000).catch(() => null);
        writeStatus({ ok: false, state: 'job_failed', workerId, remoteBaseUrls, remoteBaseUrl: claimedRemoteBaseUrl, localBaseUrl, jobId: job.id, error: String(error?.message || error), processed, failed });
      }
    } catch (error) {
      writeStatus({ ok: false, state: 'loop_error', workerId, remoteBaseUrls, localBaseUrl, error: String(error?.message || error), processed, failed });
      await sleep(5000);
    }
  }
}

run().catch((error) => {
  writeStatus({ ok: false, state: 'fatal', error: String(error?.message || error) });
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
