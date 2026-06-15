#!/usr/bin/env node
'use strict';

const DEFAULTS = {
  grainLow: 0.3694777356929151,
  mgPhase: 0.001554497790530303,
  sourceN: 40.0005,
  targetSlots: 1024,
  targetPivot: 0.292,
  targetProduct: 0.5,
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

function scoreMetric(value, target, tolerance) {
  return Math.abs(value - target) / tolerance;
}

function makeRow(args, row) {
  const grainLow = row.grainLow ?? args.grainLow;
  const grainHigh = row.grainHigh;
  const grainDelta = grainHigh - grainLow;
  const product = grainLow * grainHigh;
  const pivot = 18 * (1 - grainDelta);
  const slots = 100 / (product * args.mgPhase * args.sourceN * Math.PI);
  const twoD = grainLow;
  const threeD = grainHigh;
  const fiveD = grainDelta;
  const sevenD = row.sevenD ?? 0;
  const score =
    scoreMetric(product, args.targetProduct, 0.00025)
    + scoreMetric(pivot, args.targetPivot, 0.00025)
    + scoreMetric(slots, args.targetSlots, 0.5)
    + scoreMetric(grainLow, args.grainLow, 0.00025);

  return {
    ...row,
    score,
    twoD,
    threeD,
    fiveD,
    sevenD,
    grainLow,
    grainHigh,
    grainDelta,
    product,
    pivot,
    slots,
    lowPitch: (1 + grainLow) / 2,
    highPitch: ((3 * grainHigh * (1 + grainLow) + 2) / 2) / 2,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target0005Pi = 0.0005 * Math.PI;
  const spectralRemainder = target0005Pi - args.mgPhase;
  const grainHighHalf = args.targetProduct / args.grainLow;
  const deltaHalf = grainHighHalf - args.grainLow;
  const deltaPivot = 1 - args.targetPivot / 18;
  const exactSevenD = deltaHalf - deltaPivot;
  const targetProductSlots = 100 / (args.targetSlots * args.mgPhase * args.sourceN * Math.PI);
  const grainHighSlots = targetProductSlots / args.grainLow;

  const sevenCandidates = [
    ['none', 0],
    ['exact half->pivot', exactSevenD],
    ['spectralRemainder/e', spectralRemainder / Math.E],
    ['spectralRemainder/exp(1)', spectralRemainder / Math.exp(1)],
    ['spectralRemainder/ln(16)', spectralRemainder / Math.log(16)],
    ['spectralRemainder/ln(1024)', spectralRemainder / Math.log(1024)],
    ['spectralRemainder/log2(1024)', spectralRemainder / Math.log2(1024)],
    ['spectralRemainder/e^2', spectralRemainder / Math.E ** 2],
    ['spectralRemainder/pi', spectralRemainder / Math.PI],
    ['mgPhase/256', args.mgPhase / 256],
    ['mgPhase/512', args.mgPhase / 512],
    ['mgPhase/1024', args.mgPhase / 1024],
  ];

  const rows = [
    makeRow(args, {
      family: 'lock-half',
      name: 'historical 2D, 2D*3D=1/2',
      grainHigh: grainHighHalf,
    }),
    makeRow(args, {
      family: 'lock-pivot',
      name: 'historical 2D, pivot=0.292',
      grainHigh: args.grainLow + deltaPivot,
    }),
    makeRow(args, {
      family: 'lock-slots',
      name: 'historical 2D, slots=1024',
      grainHigh: grainHighSlots,
    }),
  ];

  for (const [name, sevenD] of sevenCandidates) {
    rows.push(makeRow(args, {
      family: '7d-correct-half',
      name: `historical 2D, half product, minus 7D ${name}`,
      sevenD,
      grainHigh: args.grainLow + deltaHalf - sevenD,
    }));
  }

  const sorted = rows
    .sort((left, right) => left.score - right.score)
    .slice(0, args.maxRows)
    .map((row) => ({
      ...row,
      score: round(row.score, 9),
      twoD: round(row.twoD),
      threeD: round(row.threeD),
      fiveD: round(row.fiveD),
      sevenD: round(row.sevenD),
      grainLow: round(row.grainLow),
      grainHigh: round(row.grainHigh),
      grainDelta: round(row.grainDelta),
      product: round(row.product),
      productGap: round(row.product - args.targetProduct),
      pivot: round(row.pivot),
      pivotGap: round(row.pivot - args.targetPivot),
      slots: round(row.slots, 12),
      slotsGap: round(row.slots - args.targetSlots, 12),
      lowPitch: round(row.lowPitch),
      highPitch: round(row.highPitch),
    }));

  console.log(JSON.stringify({
    schema: 'funesterie.research.d40-dimensional-7d.v1',
    inputs: args,
    constants: {
      target0005Pi,
      spectralRemainder,
      grainHighHalf,
      deltaHalf,
      deltaPivot,
      exactSevenD,
      spectralRemainderOverE: spectralRemainder / Math.E,
      exactMinusRemainderOverE: exactSevenD - spectralRemainder / Math.E,
      targetProductSlots,
      grainHighSlots,
    },
    best: sorted,
  }, null, 2));
}

main();
