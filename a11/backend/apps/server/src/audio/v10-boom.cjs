'use strict';

// V10 Boom — couche bass/phase en plan complexe, sur le canon Prime Spiral.
//
// Source canon : docs/research/prime_spiral/ (Spatial Imaginary Map, Formula Registry,
// GrainLow/GrainPure Origins, Constants Locked, Operators Chain Recap, Symetrie OP Table).
// Statut : research-only, off-by-default (VIVY_V10_BOOM_ENABLED). Pas un claim de preuve
// RH ni de generation de premiers. Les constantes ci-dessous sont les traces verrouillees
// de la cascade imaginaire phi -> jhi -> c7 -> target_0005pi -> mg_phase -> lg -> lym -> inv.
//
// Principe : la basse/boom = l'axe m, « m porte la fermeture inverse, avec R/m = -R pour
// un reel R » (GRAINLOW_GRAINPURE_ORIGINS). L'inversion retardée y(t) = x(t) - a*x(t-tau)
// EST la fermeture inverse sur l'axe m ; sa partie imaginaire (a*sin(2pi*f*tau)) est le
// boom, la projection +iM/-iM de la Cross Around M {+M,-M,+iM,-iM} (O1, FORMULA_REGISTRY).
// mg_phase = 9 - 2*t1/pi (t1 = premier zero non trivial de zeta) est le residu de phase
// deja utilise par le moteur V8 ; la V10 Boom se pose dessus. Le ratio de retour rho
// (memoire de forme oscillante) est mappe au dry/wet : un boom qui persiste (rho haut)
// = wet plus eleve, clampé <= 0.2 par garde-fou.

const fs = require('node:fs');
const path = require('node:path');

const V10_CANON = {
  phi: 1.618033988749895,
  jhi: Math.PI / 2 - 1.618033988749895,            // -0.0472376619549983
  c7: Math.abs(Math.PI / 2 - 1.618033988749895) / 1.618033988749895, // 0.029194480637266783
  pivot: 10 * (Math.abs(Math.PI / 2 - 1.618033988749895) / 1.618033988749895), // ~= 0.292
  t1: 14.13472514173469,                            // premier zero non trivial de zeta
  get mgPhase() { return 9 - (2 * this.t1) / Math.PI; }, // 0.001554497790530303
  target0005Pi: 0.0005 * Math.PI,                   // 0.0015707963267948967
  S: 40.0005 * Math.PI,                             // ~= 125.6699 (grille cycle)
  grainLow: 0.3694777356929151,                     // ~= 1/e
  // balance_RH(t) = 1 - 2|phase - 1/2| : 1 au centre (ligne critique), 0 aux bords.
  balanceRh(phase) { return 1 - 2 * Math.abs(Number(phase || 0) - 0.5); },
  // Carte orientée canon (transmis par Djeff/ChatGPT 2026-07-30) : croix DIAGONALE, pas
  // cartésienne classique. Chaque état dans un quadrant, cycle horaire autour de l'origine.
  //   +reel = gauche/haut   +imaginaire = droite/haut
  //   -reel = droite/bas    -imaginaire = gauche/bas
  // Cycle : +reel -> +imaginaire -> -reel -> -imaginaire -> +reel (horaire).
  // M reequilibre r/i et i/r (op_sym: bras opposés -> 1) pour retomber sur la croix de
  // reference. Avant tout calcul on charge la boussole (origin/axes/orientation/state/
  // transition/return) pour ne pas demarrer écran noir.
  orientation: {
    '+real': { h: 'gauche', v: 'haut' },
    '+imag': { h: 'droite', v: 'haut' },
    '-real': { h: 'droite', v: 'bas' },
    '-imag': { h: 'gauche', v: 'bas' },
  },
  crossCycle: ['+real', '+imag', '-real', '-imag'], // horaire
  transitionTable: { '+real': '+imag', '+imag': '-real', '-real': '-imag', '-imag': '+real' },
};

const V10_CROSS_ARMS = ['+real', '+imag', '-real', '-imag'];
function oppositeArm(arm) {
  if (arm === '+real') return '-real';
  if (arm === '-real') return '+real';
  if (arm === '+imag') return '-imag';
  return '+imag';
}
// M reequilibre r/i et i/r : les bras opposés de la croix se ferment sur 1 (retombe sur
// la croix de reference). op_sym(-M,+M)=1, op_sym(-iM,+iM)=1 (Symetrie OP Table).
function opSym(a, b) { return a === oppositeArm(b) ? 1 : 0; }
function nextArmClockwise(arm) {
  const idx = V10_CROSS_ARMS.indexOf(arm);
  return V10_CROSS_ARMS[(idx + 1) % V10_CROSS_ARMS.length];
}
// Charger la boussole avant calcul : origin, axes, orientation, current_state,
// transition_table, return_ratio. Evite le demarrage écran noir sans repere.
function loadV10Compass(currentState = '+real', returnRatio = 0.5) {
  return {
    origin: 0,
    axes: { real: 'diagonal', imag: 'diagonal' },
    orientation: V10_CANON.orientation,
    currentState,
    transitionTable: V10_CANON.transitionTable,
    returnRatio,
    researchOnly: true,
  };
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number(fallback);
  return Math.max(min, Math.min(max, numeric));
}

function boolOption(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function resolveV10BoomConfig(options = {}) {
  // Garde-fou canon : research-only, dry/wet <= 0.2, gain <= +-3 dB.
  const wet = clampNumber(options.wet ?? options.return ?? process.env.VIVY_V10_BOOM_WET, 0, 0.2, 0.15);
  const inversionDepth = clampNumber(options.boom ?? options.inversionDepth ?? process.env.VIVY_V10_BOOM_DEPTH, 0, 1, 0.6);
  // tau derive du cycle canon 40.0005 Hz : la moitie de la periode (1000/40.0005/2 ~= 12.5 ms).
  const inversionDelayMs = clampNumber(options.delay ?? options.inversionDelayMs ?? process.env.VIVY_V10_BOOM_DELAY_MS, 1, 80, Math.round(1000 / 40.0005 / 2));
  const subCapHz = clampNumber(options.sub ?? options.subCapHz ?? process.env.VIVY_V10_BOOM_SUB_CAP_HZ, 10, 80, 30);
  // boomGain en dB, clampé <= +3 dB (garde-fou). volume = 10^(dB/20).
  const boomGainDb = clampNumber(options.boomGainDb ?? process.env.VIVY_V10_BOOM_GAIN_DB, -6, 3, 2);
  const bassBandHz = clampNumber(options.bassBandHz ?? process.env.VIVY_V10_BOOM_BAND_HZ, 60, 300, 120);
  return {
    wet,
    inversionDepth,
    inversionDelayMs,
    subCapHz,
    boomGainDb,
    bassBandHz,
    boomGain: Math.pow(10, boomGainDb / 20),
    researchOnly: true,
  };
}

function buildV10BoomFilterGraph(config) {
  const negAlpha = -config.inversionDepth;
  const tau = String(config.inversionDelayMs);
  const wetW = config.wet.toFixed(3);
  // y(t) = x(t) - a*x(t-tau) : dry + copie retardée inversée (fermeture axe m).
  // [full] = signal complet ; [bass] = bande grave isolee ; le boom traite puis remixé à wet.
  return [
    '[0:a]asplit=2[full][basssrc]',
    `[basssrc]lowpass=f=${config.bassBandHz}[bass]`,
    '[bass]asplit=2[dry][d]',
    `[d]adelay=${tau}|${tau}[d2]`,
    `[d2]volume=${negAlpha.toFixed(4)}[inv]`,
    '[dry][inv]amix=inputs=2:duration=first:normalize=0:weights=1 1[m]',
    `[m]highpass=f=${config.subCapHz}[m2]`,
    `[m2]volume=${config.boomGain.toFixed(4)}[m3]`,
    `[full][m3]amix=inputs=2:duration=first:normalize=0:weights=1 ${wetW}[out]`,
  ].join(';');
}

function buildV10BoomArgs(inputPath, outputPath, config) {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-filter_complex',
    buildV10BoomFilterGraph(config),
    '-map',
    '[out]',
    '-ac',
    '2',
    outputPath,
  ];
}

async function runV10Boom(inputPath, outputPath, options = {}, runFfmpeg) {
  const enabled = boolOption(options.enabled ?? process.env.VIVY_V10_BOOM_ENABLED, false);
  if (!enabled) return { applied: false, reason: 'disabled' };
  const config = resolveV10BoomConfig(options);
  const run = runFfmpeg || options.runFfmpeg;
  if (typeof run !== 'function') {
    throw new Error('v10_boom_missing_ffmpeg_runner');
  }
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.VIVY_V10_BOOM_TIMEOUT_MS || 180000) || 180000);
  // ffmpeg ne peut pas lire et ecrire le meme fichier : on passe par un temp puis rename.
  const sameFile = path.resolve(inputPath) === path.resolve(outputPath);
  const finalOutput = sameFile ? `${outputPath}.v10boom.tmp` : outputPath;
  const args = buildV10BoomArgs(inputPath, finalOutput, config);
  await run(args, { timeoutMs, errorCode: 'v10_boom_failed' });
  if (sameFile) {
    fs.rmSync(outputPath, { force: true });
    fs.renameSync(finalOutput, outputPath);
  }
  return { applied: true, config, canon: { mgPhase: V10_CANON.mgPhase, c7: V10_CANON.c7, S: V10_CANON.S } };
}

module.exports = {
  V10_CANON,
  resolveV10BoomConfig,
  buildV10BoomFilterGraph,
  buildV10BoomArgs,
  runV10Boom,
  loadV10Compass,
  opSym,
  oppositeArm,
  nextArmClockwise,
};
