'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  BYTES_PER_ATOM,
  parseNvidiaSmiCsv,
  resolveCudaRuntimeStatus,
  isCudaAvailable,
  encodeCubeToAtoms,
  planKernel,
  runCpuKernel,
  prepareCubeCuda,
} = require('../src/cube-to-cuda.cjs');

const NOW = '2026-07-07T00:00:00.000Z';
const CUBE = [
  { id: 'a', face: 'R', rgba: { r: 224, g: 32, b: 40, a: 255 } },
  { id: 'b', face: 'B', rgba: { r: 32, g: 32, b: 224, a: 95 } },
];

test('encodeCubeToAtoms produces a flat 4-byte-per-atom buffer', () => {
  const enc = encodeCubeToAtoms(CUBE);
  assert.equal(enc.count, 2);
  assert.equal(enc.bytesPerAtom, BYTES_PER_ATOM);
  assert.equal(enc.atoms.length, 2 * 4);
  assert.deepEqual(Array.from(enc.atoms), [224, 32, 40, 255, 32, 32, 224, 95]);
  assert.equal(enc.index[1].face, 'B');
});

test('planKernel computes grid blocks from atom count', () => {
  const p = planKernel(500, 'sculpt', { threadsPerBlock: 256 });
  assert.equal(p.grid.blocks, 2); // ceil(500/256)
  assert.equal(p.totalBytes, 500 * 4);
  assert.equal(p.kernelShape, 'map-per-atom');
  assert.equal(planKernel(10, 'reduce_mean').kernelShape, 'reduction-tree');
});

test('isCudaAvailable is false unless explicitly enabled with a device', () => {
  assert.equal(isCudaAvailable({}), false);
  assert.equal(isCudaAvailable({ A11_CUDA_ENABLED: '1' }), false); // no device
  assert.equal(isCudaAvailable({ A11_CUDA_ENABLED: '1', A11_CUDA_DEVICE_COUNT: '1' }), true);
});

test('resolveCudaRuntimeStatus can detect an NVIDIA GPU without forcing execution', () => {
  const status = resolveCudaRuntimeStatus({}, {
    autoDetect: true,
    execFileSync: () => 'NVIDIA GeForce RTX 4090, 560.94, 24564\n',
  });
  assert.equal(status.ok, true);
  assert.equal(status.cudaAvailable, true);
  assert.equal(status.executionMode, 'gpu-ready');
  assert.equal(status.detectedGpu.name, 'NVIDIA GeForce RTX 4090');
  assert.equal(status.detectedGpu.memoryTotalMiB, 24564);
});

test('parseNvidiaSmiCsv tolerates empty output', () => {
  assert.equal(parseNvidiaSmiCsv(''), null);
  assert.deepEqual(parseNvidiaSmiCsv('RTX 3060, 555.12, 12288'), {
    name: 'RTX 3060',
    driverVersion: '555.12',
    memoryTotalMiB: 12288,
  });
});

test('identity op returns atoms unchanged', () => {
  const enc = encodeCubeToAtoms(CUBE);
  const r = runCpuKernel(enc.atoms, 'identity');
  assert.equal(r.reduced, false);
  assert.deepEqual(Array.from(r.atoms), Array.from(enc.atoms));
});

test('threshold gates atoms below the priority (alpha) threshold', () => {
  const enc = encodeCubeToAtoms(CUBE);
  const r = runCpuKernel(enc.atoms, 'threshold', { threshold: 128 });
  // atom 0 has a=255 (kept), atom 1 has a=95 (< 128 -> zeroed)
  assert.deepEqual(Array.from(r.atoms), [224, 32, 40, 255, 0, 0, 0, 0]);
});

test('reduce_mean returns the average atom', () => {
  const enc = encodeCubeToAtoms(CUBE);
  const r = runCpuKernel(enc.atoms, 'reduce_mean');
  assert.equal(r.reduced, true);
  assert.deepEqual(r.atom, { r: 128, g: 32, b: 132, a: 175 });
});

test('prepareCubeCuda runs the full pipeline on CPU fallback (no GPU)', () => {
  const out = prepareCubeCuda(
    { currentMessage: 'zen to cube to cuda', payload: { x: 1 }, intent: 'compose' },
    { op: 'sculpt', now: NOW }
  );
  assert.equal(out.ok, true);
  assert.equal(out.schema, 'nossen.cube_to_cuda.v1');
  assert.equal(out.cudaAvailable, false);
  assert.equal(out.executedOn, 'cpu-fallback');
  assert.ok(out.atomCount >= 1);
  assert.equal(out.kernel.bytesPerAtom, 4);
});

test('prepareCubeCuda accepts a ready cube and reduces it', () => {
  const out = prepareCubeCuda(CUBE, { op: 'reduce_mean', now: NOW });
  assert.equal(out.atomCount, 2);
  assert.deepEqual(out.reducedAtom, { r: 128, g: 32, b: 132, a: 175 });
});
