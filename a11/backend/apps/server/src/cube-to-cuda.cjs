'use strict';

/**
 * Cube -> CUDA atoms — "prepare the terrain for GPU".
 *
 * The QFlush/Shiryu RGBA cube is a set of packets, each carrying an RGBA quad.
 * Each quad is a **4-byte atom** (the @nossen/morphing primitive shared across
 * RGBA pixels, OC8 payloads, QFlush memory and A11 state). That is the natural
 * unit for a GPU: N atoms x 4 uint8 = a flat device buffer, one thread per atom.
 *
 * There is NO GPU here (cudaAvailable is false by default): the same per-atom op
 * runs deterministically on CPU, and the module emits the kernel PLAN
 * (grid / blocks / op) that a real CUDA backend will consume later. When a GPU
 * shows up, swap the CPU kernel for a device kernel — the encoding and the plan
 * do not change.
 *
 * Pipeline: zen (Shiryu) -> cube (QFlush RGBA) -> atoms (morphing 4B) -> [CUDA].
 */

const { buildShiryuZenRgba, buildControlledNoiseVector } = require('./qflush-rgba-cube.cjs');
const { execFileSync } = require('node:child_process');

const BYTES_PER_ATOM = 4; // r, g, b, a — the morphing quad
const DEFAULT_THREADS_PER_BLOCK = 256;
const SUPPORTED_OPS = Object.freeze(['identity', 'sculpt', 'threshold', 'reduce_mean']);

function flagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function parseNvidiaSmiCsv(value = '') {
  const line = String(value || '').split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean)[0] || '';
  if (!line) return null;
  const parts = line.split(',').map((entry) => entry.trim());
  if (!parts[0]) return null;
  return {
    name: parts[0],
    driverVersion: parts[1] || '',
    memoryTotalMiB: Number.parseInt(parts[2] || '', 10) || null,
  };
}

function detectNvidiaGpu(options = {}) {
  const run = options.execFileSync || execFileSync;
  try {
    const output = run('nvidia-smi', [
      '--query-gpu=name,driver_version,memory.total',
      '--format=csv,noheader,nounits',
    ], {
      encoding: 'utf8',
      timeout: Math.max(500, Math.min(8000, Number(options.timeoutMs || 1500) || 1500)),
      windowsHide: true,
    });
    const parsed = parseNvidiaSmiCsv(output);
    return parsed ? { ok: true, source: 'nvidia-smi', ...parsed } : { ok: false, source: 'nvidia-smi', error: 'empty_output' };
  } catch (err) {
    return { ok: false, source: 'nvidia-smi', error: err && err.code ? String(err.code) : 'unavailable' };
  }
}

/** CUDA is only "available" when explicitly enabled AND a device is declared. */
function isCudaAvailable(env = process.env) {
  if (!flagEnabled(env.A11_CUDA_ENABLED)) return false;
  const declared = String(env.CUDA_VISIBLE_DEVICES || '').trim();
  const count = Number(env.A11_CUDA_DEVICE_COUNT || 0) || 0;
  return count > 0 || (declared !== '' && declared !== '-1');
}

function resolveCudaRuntimeStatus(env = process.env, options = {}) {
  const declared = isCudaAvailable(env);
  const autoDetect = options.autoDetect === true
    || flagEnabled(env.SHIRYU_V3_GPU_AUTODETECT)
    || flagEnabled(env.A11_CUDA_AUTODETECT);
  const detected = autoDetect ? detectNvidiaGpu(options) : { ok: false, source: 'disabled', error: 'autodetect_off' };
  const configuredDevice = String(env.CUDA_VISIBLE_DEVICES || env.SHIRYU_V3_GPU_DEVICE || '').trim();
  const enabled = declared || detected.ok || flagEnabled(env.SHIRYU_V3_GPU_ENABLED);
  return {
    ok: true,
    schema: 'nossen.shiryu.v3_gpu_status.v1',
    gpuEnabled: enabled,
    cudaAvailable: declared || detected.ok,
    executionMode: declared || detected.ok ? 'gpu-ready' : 'cpu-fallback',
    configuredDevice: configuredDevice || null,
    declaredCuda: declared,
    autoDetect,
    detectedGpu: detected.ok ? {
      source: detected.source,
      name: detected.name,
      driverVersion: detected.driverVersion,
      memoryTotalMiB: detected.memoryTotalMiB,
    } : null,
    detectionError: detected.ok ? null : detected.error,
    backend: String(env.SHIRYU_V3_CUDA_BACKEND || env.A11_CUDA_BACKEND || 'planned-cuda-kernel').trim(),
  };
}

function clampByte(value) {
  const n = Math.round(Number(value) || 0);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/** Pull the RGBA packets out of whatever cube-ish thing we were handed. */
function extractPackets(cube) {
  if (!cube) return [];
  if (Array.isArray(cube)) return cube;
  if (Array.isArray(cube.packets)) return cube.packets;
  if (cube.plan && Array.isArray(cube.plan.packets)) return cube.plan.packets;
  return [];
}

/**
 * Encode a cube into a flat atom buffer.
 * @returns {{ atoms: Uint8Array, count: number, bytesPerAtom: number, index: Array }}
 */
function encodeCubeToAtoms(cube) {
  const packets = extractPackets(cube);
  const count = packets.length;
  const atoms = new Uint8Array(count * BYTES_PER_ATOM);
  const index = [];
  for (let i = 0; i < count; i += 1) {
    const p = packets[i] || {};
    const rgba = p.rgba || p;
    const off = i * BYTES_PER_ATOM;
    atoms[off] = clampByte(rgba.r);
    atoms[off + 1] = clampByte(rgba.g);
    atoms[off + 2] = clampByte(rgba.b);
    atoms[off + 3] = clampByte(rgba.a);
    index.push({ i, offset: off, id: p.id || null, face: p.face || null, kind: p.kind || null });
  }
  return { atoms, count, bytesPerAtom: BYTES_PER_ATOM, index };
}

/**
 * Kernel plan a CUDA backend would launch (grid/blocks). Purely descriptive here.
 */
function planKernel(atomCount, op = 'identity', options = {}) {
  const normalizedOp = SUPPORTED_OPS.includes(op) ? op : 'identity';
  const threadsPerBlock = Math.max(1, Math.min(1024, Number(options.threadsPerBlock) || DEFAULT_THREADS_PER_BLOCK));
  const blocks = Math.max(1, Math.ceil(atomCount / threadsPerBlock));
  return {
    op: normalizedOp,
    atomCount,
    bytesPerAtom: BYTES_PER_ATOM,
    totalBytes: atomCount * BYTES_PER_ATOM,
    grid: { threadsPerBlock, blocks, threads: blocks * threadsPerBlock },
    // reductions need a multi-pass tree kernel; per-atom ops are a single map pass
    kernelShape: normalizedOp === 'reduce_mean' ? 'reduction-tree' : 'map-per-atom',
  };
}

/** Deterministic per-atom CPU kernel (stands in for the future device kernel). */
function runCpuKernel(atoms, op, options = {}) {
  const count = Math.floor(atoms.length / BYTES_PER_ATOM);
  if (op === 'reduce_mean') {
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < count; i += 1) {
      const off = i * BYTES_PER_ATOM;
      sum[0] += atoms[off]; sum[1] += atoms[off + 1]; sum[2] += atoms[off + 2]; sum[3] += atoms[off + 3];
    }
    const divisor = Math.max(1, count);
    return {
      reduced: true,
      atom: {
        r: Math.round(sum[0] / divisor),
        g: Math.round(sum[1] / divisor),
        b: Math.round(sum[2] / divisor),
        a: Math.round(sum[3] / divisor),
      },
    };
  }

  const out = new Uint8Array(atoms.length);
  const threshold = clampByte(options.threshold != null ? options.threshold : 128);
  for (let i = 0; i < count; i += 1) {
    const off = i * BYTES_PER_ATOM;
    const r = atoms[off]; const g = atoms[off + 1]; const b = atoms[off + 2]; const a = atoms[off + 3];
    if (op === 'identity') {
      out[off] = r; out[off + 1] = g; out[off + 2] = b; out[off + 3] = a;
    } else if (op === 'threshold') {
      // gate: atoms below the priority threshold (a) collapse to zero
      const keep = a >= threshold;
      out[off] = keep ? r : 0; out[off + 1] = keep ? g : 0; out[off + 2] = keep ? b : 0; out[off + 3] = keep ? a : 0;
    } else { // sculpt: add bounded deterministic noise derived from the atom itself
      const noise = buildControlledNoiseVector(`${r.toString(16)}${g.toString(16)}${b.toString(16)}${a.toString(16)}`.padStart(8, '0'));
      out[off] = clampByte(r + noise.r); out[off + 1] = clampByte(g + noise.g);
      out[off + 2] = clampByte(b + noise.b); out[off + 3] = clampByte(a + noise.a);
    }
  }
  return { reduced: false, atoms: out };
}

/**
 * Full pipeline: (raw Shiryu input OR a cube) -> atoms -> kernel plan -> run.
 * @param {object} input   raw {currentMessage, payload, ...} (→ zen cube) or a cube/packets
 * @param {object} [options] { op?, threshold?, threadsPerBlock?, env?, includeAtoms? }
 */
function prepareCubeCuda(input = {}, options = {}) {
  const env = options.env || process.env;
  const op = SUPPORTED_OPS.includes(options.op) ? options.op : 'identity';

  // If it already looks like a cube/packets, use it; otherwise slice via Shiryu V1.
  const looksLikeCube = Array.isArray(input) || Array.isArray(input.packets) || (input.plan && Array.isArray(input.plan.packets));
  const cube = looksLikeCube ? input : buildShiryuZenRgba(input, options);

  const encoded = encodeCubeToAtoms(cube);
  const plan = planKernel(encoded.count, op, options);
  const gpuStatus = resolveCudaRuntimeStatus(env, { autoDetect: options.autoDetectGpu === true });
  const cudaAvailable = gpuStatus.cudaAvailable;
  const result = runCpuKernel(encoded.atoms, op, options); // CPU stand-in; swap for device kernel when GPU exists

  return {
    ok: true,
    schema: 'nossen.cube_to_cuda.v1',
    pipeline: 'zen -> cube -> atoms(morphing 4B) -> [cuda]',
    cudaAvailable,
    executedOn: cudaAvailable ? 'gpu' : 'cpu-fallback',
    gpuStatus,
    op: plan.op,
    atomCount: encoded.count,
    kernel: plan,
    ...(result.reduced ? { reducedAtom: result.atom } : {}),
    ...(options.includeAtoms === true
      ? { atomsIn: Array.from(encoded.atoms), atomsOut: result.reduced ? null : Array.from(result.atoms) }
      : {}),
    index: encoded.index,
    createdAt: String(options.now || new Date().toISOString()),
  };
}

module.exports = {
  BYTES_PER_ATOM,
  SUPPORTED_OPS,
  detectNvidiaGpu,
  isCudaAvailable,
  parseNvidiaSmiCsv,
  resolveCudaRuntimeStatus,
  encodeCubeToAtoms,
  planKernel,
  runCpuKernel,
  prepareCubeCuda,
};
