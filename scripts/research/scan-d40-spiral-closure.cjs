#!/usr/bin/env node
'use strict';

const DEFAULTS = {
  grainLow: 0.3694777356929151,
  mgPhase: 0.001554497790530303,
  sourceN: 40.0005,
  targetSlots: 1024,
  baseA: 0.3,
  maxRows: 24,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const item of argv) {
    const [rawKey, rawValue] = String(item || '').split('=');
    const key = rawKey.replace(/^--/, '');
    if (!key || rawValue == null) continue;
    const value = Number(rawValue);
    if (Number.isFinite(value) && key in args) args[key] = value;
  }
  return args;
}

function round(value, digits = 15) {
  return Number(Number(value).toFixed(digits));
}

function metrics({ name, grainLow, q, a, qFactor = 3, mgPhase, sourceN, targetSlots, family }) {
  const grainDelta = 1 - ((a + qFactor * q) / 18);
  const grainHigh = grainLow + grainDelta;
  const product = grainLow * grainHigh;
  const slots = 100 / (product * mgPhase * sourceN * Math.PI);
  const twoD = 1 + grainLow;
  const threeD = ((3 * grainHigh * twoD) + 2) / 2;
  return {
    family,
    name,
    score: Math.abs(slots - targetSlots),
    slots,
    gap: slots - targetSlots,
    grainLow,
    grainHigh,
    grainDelta,
    product,
    a,
    q,
    qFactor,
    twoD,
    threeD,
    v6Low: twoD / 2,
    v6High: threeD / 2,
    ratio: Math.log(threeD / twoD),
  };
}

function solveClosure(args) {
  const targetProduct = 100 / (args.targetSlots * args.mgPhase * args.sourceN * Math.PI);
  const targetHigh = targetProduct / args.grainLow;
  const targetDelta = targetHigh - args.grainLow;
  return { targetProduct, targetHigh, targetDelta };
}

function addCandidate(rows, candidate, args) {
  rows.push(metrics({ ...args, ...candidate }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const spectralRemainder = 0.0005 * Math.PI - args.mgPhase;
  const closure = solveClosure(args);
  const qNeeded = (18 * (1 - closure.targetDelta) - args.baseA) / 3;
  const qSpectral30 = 30 * spectralRemainder;
  const scaleNeeded = qNeeded / spectralRemainder;
  const kForMinus25Pi = (0.0005 + qNeeded / (25 * Math.PI)) / args.mgPhase;
  const exactGrainLow = (() => {
    const delta = 1 - ((args.baseA + 3 * qSpectral30) / 18);
    return (-delta + Math.sqrt(delta * delta + 4 * closure.targetProduct)) / 2;
  })();
  const aForCurrentLow = 18 * (1 - closure.targetDelta) - 3 * qSpectral30;

  const rows = [];
  addCandidate(rows, {
    family: 'baseline',
    name: 'current q=30*(0.0005pi-mg), a=0.3',
    a: args.baseA,
    q: qSpectral30,
  }, args);
  addCandidate(rows, {
    family: 'scale',
    name: 'q=scaleExact*(0.0005pi-mg)',
    a: args.baseA,
    q: qNeeded,
  }, args);
  addCandidate(rows, {
    family: 'scale',
    name: 'q=-25pi*(0.0005pi-mg)',
    a: args.baseA,
    q: -25 * Math.PI * spectralRemainder,
  }, args);
  addCandidate(rows, {
    family: 'decimal-phase',
    name: 'q=-25pi*(0.0005-kExact*mg)',
    a: args.baseA,
    q: -25 * Math.PI * (0.0005 - kForMinus25Pi * args.mgPhase),
  }, args);
  addCandidate(rows, {
    family: 'pivot-a',
    name: 'a exact, q=30*(0.0005pi-mg)',
    a: aForCurrentLow,
    q: qSpectral30,
  }, args);
  addCandidate(rows, {
    family: 'grain-low',
    name: 'grainLow exact, a=0.3, q=30*(0.0005pi-mg)',
    grainLow: exactGrainLow,
    a: args.baseA,
    q: qSpectral30,
  }, args);
  for (const a of [0.292, 0.2946517004773446, 0.2958251950883954, 0.2989824, 0.299, 0.3]) {
    addCandidate(rows, {
      family: 'pivot-sweep',
      name: `a=${a}`,
      a,
      q: qSpectral30,
    }, args);
  }
  for (const scale of [-80, -25 * Math.PI, scaleNeeded, -30, 30]) {
    addCandidate(rows, {
      family: 'spiral-scale',
      name: `scale=${scale}`,
      a: args.baseA,
      q: scale * spectralRemainder,
    }, args);
  }

  const sorted = rows
    .map((row) => ({
      ...row,
      score: round(row.score, 12),
      slots: round(row.slots, 12),
      gap: round(row.gap, 12),
      grainLow: round(row.grainLow),
      grainHigh: round(row.grainHigh),
      product: round(row.product),
      a: round(row.a),
      q: round(row.q),
      v6Low: round(row.v6Low),
      v6High: round(row.v6High),
      ratio: round(row.ratio),
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, args.maxRows);

  const summary = {
    schema: 'funesterie.research.d40-spiral-closure.v1',
    inputs: args,
    constants: {
      spectralRemainder,
      target0005Pi: 0.0005 * Math.PI,
      qSpectral30,
      qNeeded,
      scaleNeeded,
      kForMinus25Pi,
      exactGrainLow,
      aForCurrentLow,
      targetProduct: closure.targetProduct,
      targetDelta: closure.targetDelta,
    },
    best: sorted,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
