#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const INPUT_DEFAULT = 'C:\\Users\\Djeff\\Downloads\\music V3\\RADWIMPS.mp3';
const OUT_DIR_DEFAULT = 'C:\\Users\\Djeff\\Downloads\\music V3\\test V7 spiral closure';

const GRAIN_LOW = 0.3694777356929151;
const MG_PHASE = 0.001554497790530303;
const TARGET_0005_PI = 0.0005 * Math.PI;
const SPECTRAL_REMAINDER = TARGET_0005_PI - MG_PHASE;
const HIGH_BASE = 0.0248383741560778;
const LOW_BASE = 0.022078554805402485;

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function numArg(name, fallback) {
  const raw = arg(name, String(fallback));
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function run(label, args) {
  console.log(`\n${label}`);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
}

function numberText(value) {
  return Number(value).toPrecision(17).replace(/\.?0+$/, '');
}

function grainFromQ(q, grainLow = GRAIN_LOW, a = 0.3) {
  const grainDelta = 1 - ((a + 3 * q) / 18);
  const grainHigh = grainLow + grainDelta;
  const twoD = 1 + grainLow;
  const threeD = (3 * grainHigh * twoD + 2) / 2;
  const lowPitch = twoD / 2;
  const highPitch = threeD / 2;
  const slots = 100 / (grainLow * grainHigh * MG_PHASE * 40.0005 * Math.PI);
  return {
    q,
    a,
    grainLow,
    grainDelta,
    grainHigh,
    product: grainLow * grainHigh,
    slots,
    twoD,
    threeD,
    lowPitch,
    highPitch,
  };
}

function grainFromPair(grainLow, grainHigh, extra = {}) {
  const grainDelta = grainHigh - grainLow;
  const twoD = 1 + grainLow;
  const threeD = (3 * grainHigh * twoD + 2) / 2;
  const lowPitch = twoD / 2;
  const highPitch = threeD / 2;
  const slots = 100 / (grainLow * grainHigh * MG_PHASE * 40.0005 * Math.PI);
  return {
    ...extra,
    grainLow,
    grainDelta,
    grainHigh,
    product: grainLow * grainHigh,
    slots,
    twoD,
    threeD,
    lowPitch,
    highPitch,
  };
}

function grainLowForTargetProduct({ q, targetProduct = 0.5, a = 0.3 } = {}) {
  const grainDelta = 1 - ((a + 3 * q) / 18);
  return (-grainDelta + Math.sqrt((grainDelta ** 2) + 4 * targetProduct)) / 2;
}

function dimensionScaleForFiveD({ grainLow = GRAIN_LOW, fiveD = 28, a = 0.3 } = {}) {
  const twoD = 1 + grainLow;
  const baseHigh = grainLow + 1 - (a / 18);
  const baseThreeD = (3 * twoD * baseHigh + 2) / 2;
  const scaleToThreeD = (3 * twoD * (SPECTRAL_REMAINDER / 6)) / 2;
  return (twoD * fiveD * baseThreeD) / (1 - (twoD * fiveD * scaleToThreeD));
}

function dimensionLogScale({ slots = 1024 } = {}) {
  const add2D = 2 + 2;
  const pow3D = 3 ** 2;
  const log5D = Math.exp(Math.log(slots) / 5);
  return (add2D * pow3D * log5D) + 1;
}

function renderVariant({ input, out, start, duration, weightScale, variant }) {
  const rubberband =
    'transients=crisp:detector=compound:phase=laminar:window=short:smoothing=on:formant=preserved:pitchq=consistency:channels=together';
  const highWeight = HIGH_BASE * weightScale;
  const lowWeight = LOW_BASE * weightScale;
  const filter = [
    '[0:a]aresample=44100,aformat=channel_layouts=stereo,asplit=3[dry][h][l]',
    `[h]rubberband=pitch=${numberText(variant.highPitch)}:${rubberband},volume=${numberText(highWeight)}:eval=frame[hb]`,
    `[l]rubberband=pitch=${numberText(variant.lowPitch)}:${rubberband},volume=${numberText(lowWeight)}:eval=frame[lb]`,
    "[dry][hb][lb]amix=inputs=3:weights='1 1 1':normalize=0[out]",
  ].join(';');

  run(`render ${path.basename(out)}`, [
    '-y',
    '-hide_banner',
    '-ss',
    String(start),
    '-t',
    String(duration),
    '-i',
    input,
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-vn',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '320k',
    out,
  ]);
}

function renderOriginal({ input, out, start, duration }) {
  run(`trim ${path.basename(out)}`, [
    '-y',
    '-hide_banner',
    '-ss',
    String(start),
    '-t',
    String(duration),
    '-i',
    input,
    '-vn',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '320k',
    out,
  ]);
}

function main() {
  const input = arg('input', INPUT_DEFAULT);
  const outDir = arg('outDir', OUT_DIR_DEFAULT);
  const start = numArg('start', 45);
  const duration = numArg('duration', 35);
  const weightScale = numArg('weightScale', 4);

  if (!fs.existsSync(input)) {
    throw new Error(`input_not_found: ${input}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const q30 = 30 * SPECTRAL_REMAINDER;
  const qMinus25Pi = -25 * Math.PI * SPECTRAL_REMAINDER;
  const qStructural139 = -(2 + 2 + (3 ** 2) * 15) * SPECTRAL_REMAINDER;
  const qStructural145 = -dimensionLogScale({ slots: 1024 }) * SPECTRAL_REMAINDER;
  const qStructural540 = -(((2 + 2) * (3 ** 2)) * (5 * 3)) * SPECTRAL_REMAINDER;
  const dimensionFiveD = (2 + 2) + (3 ** 2) + (5 * 3);
  const qDimension2D3D5D = -dimensionScaleForFiveD({ grainLow: GRAIN_LOW, fiveD: dimensionFiveD }) * SPECTRAL_REMAINDER;
  const dimensionFiveDProduct = ((2 + 2) + (3 ** 2)) * (5 * 3);
  const qDimension2D3D5DProduct = -dimensionScaleForFiveD({
    grainLow: GRAIN_LOW,
    fiveD: dimensionFiveDProduct,
  }) * SPECTRAL_REMAINDER;
  const qExactScale = -0.0012938104196139795;
  const grainLowExact = 0.36954147832416295;
  const grainLow145Half = grainLowForTargetProduct({ q: qStructural145, targetProduct: 0.5 });
  const grainLow145Slots1024 = grainLowForTargetProduct({
    q: qStructural145,
    targetProduct: 100 / (1024 * MG_PHASE * 40.0005 * Math.PI),
  });
  const pivotA145Exact = 0.292 - (3 * qStructural145);
  const grainLow145Pivot292Slots1024 = grainLowForTargetProduct({
    q: qStructural145,
    targetProduct: 100 / (1024 * MG_PHASE * 40.0005 * Math.PI),
    a: pivotA145Exact,
  });
  const grainLow145AQHalf = grainLowForTargetProduct({
    q: qStructural145,
    targetProduct: 0.5,
    a: qStructural145,
  });
  const qStructural145Mirror = -qStructural145;
  const grainLow145AQHalfMirror = grainLowForTargetProduct({
    q: qStructural145Mirror,
    targetProduct: 0.5,
    a: qStructural145Mirror,
  });
  const grainHighHalf = 0.5 / GRAIN_LOW;
  const grainHighHalfMinus7DE = grainHighHalf - (SPECTRAL_REMAINDER / Math.E);
  const grainHighHalfMinus7DExact = GRAIN_LOW + (1 - 0.292 / 18);

  const variants = [
    ['01-v71-current-q30-x4.mp3', grainFromQ(q30)],
    ['02-v72-spiral-minus25pi-x4.mp3', grainFromQ(qMinus25Pi)],
    ['03-v72-exact1024-scale-x4.mp3', grainFromQ(qExactScale)],
    ['04-v72-exact1024-grainlow-x4.mp3', grainFromQ(q30, grainLowExact)],
    ['05-v72-spiral-2plus2-3sq15-x4.mp3', grainFromQ(qStructural139)],
    ['06-v72-spiral-145-x4.mp3', grainFromQ(qStructural145)],
    ['07-v72-spiral-raw-parentheses-540-x4.mp3', grainFromQ(qStructural540)],
    ['08-v72-spiral-145-grainlow-half-x4.mp3', grainFromQ(qStructural145, grainLow145Half)],
    ['09-v72-dim-2d3d5d-fixed28-x4.mp3', grainFromQ(qDimension2D3D5D)],
    ['10-v72-dim-2d3d5d-product195-x4.mp3', grainFromQ(qDimension2D3D5DProduct)],
    ['11-v72-scale145-slots1024-x4.mp3', grainFromQ(qStructural145, grainLow145Slots1024)],
    ['12-v72-scale145-pivot292-slots1024-x4.mp3', grainFromQ(qStructural145, grainLow145Pivot292Slots1024, pivotA145Exact)],
    ['13-v72-scale145-aeq-q-half-x4.mp3', grainFromQ(qStructural145, grainLow145AQHalf, qStructural145)],
    ['14-v72-scale145-aeq-q-half-mirror-x4.mp3', grainFromQ(qStructural145Mirror, grainLow145AQHalfMirror, qStructural145Mirror)],
    ['15-v72-historical-half-7d-inv-e-x4.mp3', grainFromPair(GRAIN_LOW, grainHighHalfMinus7DE, {
      q: null,
      a: null,
      sevenD: SPECTRAL_REMAINDER / Math.E,
      note: '2D historical, 3D=0.5/2D, 5D corrected by spectralRemainder/e',
    })],
    ['16-v72-historical-half-7d-exact-pivot-x4.mp3', grainFromPair(GRAIN_LOW, grainHighHalfMinus7DExact, {
      q: null,
      a: null,
      sevenD: grainHighHalf - grainHighHalfMinus7DExact,
      note: '2D historical, pivot exactly 0.292 via exact 7D correction',
    })],
  ];

  const original = path.join(outDir, '00-original-radwimps-extrait.mp3');
  renderOriginal({ input, out: original, start, duration });

  for (const [name, variant] of variants) {
    renderVariant({
      input,
      out: path.join(outDir, name),
      start,
      duration,
      weightScale,
      variant,
    });
  }

  const report = [
    'Funesterie D40 V7 spiral closure music test',
    `input=${input}`,
    `start=${start}`,
    `duration=${duration}`,
    `weightScale=${weightScale}`,
    `grainLow=${GRAIN_LOW}`,
    `mgPhase=${MG_PHASE}`,
    `target0005Pi=${TARGET_0005_PI}`,
    `spectralRemainder=${SPECTRAL_REMAINDER}`,
    'preferred=16-v72-historical-half-7d-exact-pivot-x4.mp3',
    'preferredReason=listening validation: exact 0.292 pivot felt better than spectralRemainder/e witness',
    '',
    ...variants.map(([name, v]) => [
      name,
      `  q=${v.q}`,
      `  grainLow=${v.grainLow}`,
      `  grainHigh=${v.grainHigh}`,
      `  product=${v.product}`,
      `  slots=${v.slots}`,
      `  lowPitch=${v.lowPitch}`,
      `  highPitch=${v.highPitch}`,
      v.sevenD == null ? null : `  sevenD=${v.sevenD}`,
      v.note == null ? null : `  note=${v.note}`,
    ].filter(Boolean).join('\n')),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'README.txt'), report, 'utf8');
  console.log(`\nDone: ${outDir}`);
}

main();
