'use strict';

// V10 Boom — couche bass/phase en plan complexe, sur le canon Prime Spiral.
//
// Source canon : docs/research/prime_spiral/ (Spatial Imaginary Map, Formula Registry,
// GrainLow/GrainPure Origins, Constants Locked, Operators Chain Recap, Symetrie OP Table).
// Statut : master D40 par defaut dans le chemin V10 compose. L'appel bas niveau
// runV10Boom reste opt-in (VIVY_V10_BOOM_ENABLED) pour ne pas modifier silencieusement
// les anciennes routes qui l'utilisent seules. Pas un claim de preuve RH ni de generation
// de premiers. Les constantes ci-dessous sont les traces verrouillees de la cascade.
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
const {
  buildOutputCodecArgs,
} = require('./double-harmonic-d40.cjs');

const V10_BOOM_SCHEMA = 'funesterie.audio.double-harmonic-boom-d40.v10';
const V10_BOOM_METHOD = 'v9-electrolysis-plus-axis-m-inversion-delay-boom-v10';
const V10_BOOM_STATE = 'v10-boom-production-default';
const V10_BOOM_PRESET = 'v10-boom-v9-electrolysis-cross-m-wet015';

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

// V11 PAN — ouverture du pan. Le boom V10 ne touche que le grave et RESSERRE l'image :
// mesure du 02/08/2026 sur un rendu reel (40 s), ecart milieu-cote en dB, plus petit
// = plus large — brut Suno 10.30, apres boom 11.00, bande des cordes -30.1 des deux
// cotes. Le boom n'apporte donc rien aux cordes, il ajoute 0.5 dB dans le grave.
// D'ou « on n'entend pas les violons ».
//
// A 1.5 : largeur 11.00 -> 7.40, cordes -30.1 -> -29.0, et l'equilibre gauche/droite
// reste exactement celui de la source (-0.40 global, -0.10 sur les cordes) — ce
// qu'aucune construction a base de dephasage n'a tenu. Cout : repli mono -0.30 -> -0.70.
// Valeur choisie a l'oreille par Djeff contre 2.0 (qui creuse le centre).
//
// Le boom est un filtre lineaire identique sur les deux canaux, donc il COMMUTE avec
// toute operation milieu/cote : l'ordre boom<->pan est sans effet. Verifie par
// difference echantillon par echantillon entre les deux ordres : -91 dB, silence.
// Seul l'alimiter, non lineaire, doit rester en dernier — d'ou la place ci-dessous.
// Elargir la bande haute seule a ete teste et ne sert a rien : le grave est deja
// quasi mono, le repli en souffre autant (-0.80) et le raccord s'ajoute pour rien.
//
// Nom retenu par Djeff : « V11 pan ». La V10 Boom n'est pas modifiee — la V11 est
// l'ouverture du pan posee apres elle. Note complete : docs/research/audio/V11_PAN_2026-08-02.md
const V11_PAN_SCHEMA = 'funesterie.audio.v11-pan';
const V11_PAN_WIDTH = 1.5;

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
    researchOnly: false,
    researchOrigin: true,
    productionDefault: true,
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
  // Garde-fou canon : dry/wet <= 0.2, gain <= +-3 dB.
  const wet = clampNumber(options.wet ?? options.return ?? process.env.VIVY_V10_BOOM_WET, 0, 0.2, 0.15);
  const inversionDepth = clampNumber(options.boom ?? options.inversionDepth ?? process.env.VIVY_V10_BOOM_DEPTH, 0, 1, 0.6);
  // tau derive du cycle canon 40.0005 Hz : la moitie de la periode (1000/40.0005/2 ~= 12.5 ms).
  const inversionDelayMs = clampNumber(options.delay ?? options.inversionDelayMs ?? process.env.VIVY_V10_BOOM_DELAY_MS, 1, 80, Math.round(1000 / 40.0005 / 2));
  const subCapHz = clampNumber(options.sub ?? options.subCapHz ?? process.env.VIVY_V10_BOOM_SUB_CAP_HZ, 10, 80, 30);
  // boomGain en dB, clampé <= +3 dB (garde-fou). volume = 10^(dB/20).
  const boomGainDb = clampNumber(options.boomGainDb ?? process.env.VIVY_V10_BOOM_GAIN_DB, -6, 3, 2);
  const bassBandHz = clampNumber(options.bassBandHz ?? process.env.VIVY_V10_BOOM_BAND_HZ, 60, 300, 120);
  const peakLimit = clampNumber(options.peakLimit ?? process.env.VIVY_V10_BOOM_PEAK_LIMIT, 0.8, 0.99, 0.95);
  // V11 pan — 1 = image inchangee (comportement V10 d'origine).
  // VIVY_V10_BOOM_PAN_WIDTH reste lu en second : c'est le nom sous lequel la valeur
  // est partie en prod le 02/08 avant d'etre renommee, on ne veut pas la perdre.
  const panWidth = clampNumber(
    options.panWidth ?? options.v11Pan ?? process.env.VIVY_V11_PAN_WIDTH ?? process.env.VIVY_V10_BOOM_PAN_WIDTH,
    1,
    2.5,
    V11_PAN_WIDTH
  );
  return {
    wet,
    inversionDepth,
    inversionDelayMs,
    subCapHz,
    boomGainDb,
    bassBandHz,
    peakLimit,
    panWidth,
    boomGain: Math.pow(10, boomGainDb / 20),
    researchOnly: false,
    researchOrigin: true,
    productionDefault: true,
  };
}

function buildV10BoomPlan(options = {}) {
  const config = resolveV10BoomConfig(options);
  return {
    schema: V10_BOOM_SCHEMA,
    method: V10_BOOM_METHOD,
    state: V10_BOOM_STATE,
    variant: 'v10boom',
    baseVariant: 'v9electrolysis',
    preset: V10_BOOM_PRESET,
    canon: {
      mgPhase: V10_CANON.mgPhase,
      c7: V10_CANON.c7,
      pivot: V10_CANON.pivot,
      S: V10_CANON.S,
      crossCycle: V10_CANON.crossCycle,
    },
    compass: loadV10Compass(options.currentState || '+real', options.returnRatio ?? config.wet),
    boom: config,
    // V11 pan : couche posee APRES la V10 Boom, qui n'est pas modifiee. Elle commute
    // avec le boom (filtre lineaire identique sur les deux canaux) — seul le limiteur,
    // non lineaire, impose de rester en dernier.
    v11Pan: {
      schema: V11_PAN_SCHEMA,
      width: config.panWidth,
      applied: config.panWidth !== 1,
      neutralAt: 1,
      max: 2.5,
      envKey: 'VIVY_V11_PAN_WIDTH',
      boomPreserved: true,
      commutesWithBoom: true,
      measuredOn: '1785657333928-209bf9de-Session-principale (40 s, 2026-08-02)',
      // ecart milieu-cote en dB, plus petit = plus large
      widthSourceDb: 10.3,
      widthBoomOnlyDb: 11,
      widthWithPanDb: 7.4,
      stringsBoomOnlyDb: -30.1,
      stringsWithPanDb: -29,
      monoFoldCostDb: -0.4,
    },
    safety: {
      researchOnly: false,
      researchOrigin: true,
      explicitListeningCandidate: false,
      ownerListeningValidated: true,
      productionDefault: true,
      v9ElectrolysisBasePreserved: true,
      wetCeiling: 0.2,
      gainCeilingDb: 3,
      peakGuard: config.peakLimit,
    },
  };
}

function buildV10BoomFilterGraph(config) {
  const negAlpha = -config.inversionDepth;
  const tau = String(config.inversionDelayMs);
  const wetW = config.wet.toFixed(3);
  // V11 pan : ouverture juste avant le limiteur. A 1 on n'insere rien, le graphe
  // redevient octet pour octet celui de la V10 d'origine.
  const panWidth = Number(config.panWidth) || 1;
  const pan = panWidth === 1 ? '' : `stereotools=slev=${panWidth.toFixed(3)},`;
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
    `[full][m3]amix=inputs=2:duration=first:normalize=0:weights=1 ${wetW}[mix]`,
    `[mix]${pan}alimiter=limit=${config.peakLimit.toFixed(3)}:attack=5:release=50:level=false[out]`,
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
    ...buildOutputCodecArgs(outputPath),
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
  // ffmpeg ne peut pas lire et ecrire le meme fichier. Un repertoire temporaire unique
  // par passe evite toute collision entre deux jobs lances dans la meme milliseconde et
  // garde l'extension audio exploitable par ffmpeg.
  const sameFile = path.resolve(inputPath) === path.resolve(outputPath);
  const parsedOutput = path.parse(outputPath);
  const tempRoot = sameFile
    ? fs.mkdtempSync(path.join(parsedOutput.dir, `.${parsedOutput.name}.v10boom-`))
    : '';
  const finalOutput = sameFile
    ? path.join(tempRoot, `render${parsedOutput.ext || '.wav'}`)
    : outputPath;
  const args = buildV10BoomArgs(inputPath, finalOutput, config);
  try {
    await run(args, { timeoutMs, errorCode: 'v10_boom_failed' });
    const rendered = fs.statSync(finalOutput);
    if (!rendered.isFile() || rendered.size <= 0) {
      throw new Error('v10_boom_empty_output');
    }
    if (sameFile) {
      fs.copyFileSync(finalOutput, outputPath);
    }
  } finally {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  return { applied: true, config, canon: { mgPhase: V10_CANON.mgPhase, c7: V10_CANON.c7, S: V10_CANON.S } };
}

async function processV10BoomD40({
  inputPath,
  outputPath,
  profile = 'blend',
  timeoutMs,
  analysisOptions = {},
  boomOptions = {},
  processV9Turbo,
  runFfmpeg,
} = {}) {
  if (typeof processV9Turbo !== 'function') throw new Error('v10_boom_missing_v9_processor');
  if (!inputPath) throw new Error('missing_input_path');
  if (!outputPath) throw new Error('missing_output_path');

  // La V9 et la V10 ne partagent plus le fichier final. Chaque mix possede son espace
  // de travail; la V10 lit le master V9 intermediaire et ecrit le master public une
  // seule fois. Deux traitements consecutifs ou concurrents ne peuvent donc plus se
  // supprimer ou se recopier l'un sur l'autre.
  const parsedOutput = path.parse(outputPath);
  fs.mkdirSync(parsedOutput.dir, { recursive: true });
  const jobRoot = fs.mkdtempSync(path.join(parsedOutput.dir, `.${parsedOutput.name}.v10job-`));
  const v9OutputPath = path.join(jobRoot, `v9-electrolysis${parsedOutput.ext || '.wav'}`);
  let base;
  let boom;
  try {
    base = await processV9Turbo({
      inputPath,
      outputPath: v9OutputPath,
      profile,
      timeoutMs,
      analysisOptions: {
        ...analysisOptions,
        modulation: analysisOptions.modulation || analysisOptions.modulationMode || 'electrolysis-guitar',
        modulationMode: analysisOptions.modulationMode || analysisOptions.modulation || 'electrolysis-guitar',
        electrolysis: true,
        electrolysisGuitar: true,
        frequencyHz: analysisOptions.frequencyHz ?? 40.44,
        frequencyMinHz: analysisOptions.frequencyMinHz ?? 40.26,
        frequencyMaxHz: analysisOptions.frequencyMaxHz ?? 40.62,
        amount: analysisOptions.amount ?? 0.042,
        irregularity: analysisOptions.irregularity ?? 0.36,
        asymmetry: analysisOptions.asymmetry ?? 0.27,
        bidirectional: true,
      },
    });
    const v9Rendered = fs.statSync(v9OutputPath);
    if (!v9Rendered.isFile() || v9Rendered.size <= 0) {
      throw new Error('v10_boom_empty_v9_base');
    }
    boom = await runV10Boom(
      v9OutputPath,
      outputPath,
      {
        ...boomOptions,
        enabled: true,
        timeoutMs,
        runFfmpeg,
      },
      runFfmpeg
    );
  } finally {
    fs.rmSync(jobRoot, { recursive: true, force: true });
  }
  return {
    ...base,
    method: V10_BOOM_METHOD,
    state: V10_BOOM_STATE,
    variant: 'v10boom',
    baseVariant: 'v9electrolysis',
    preset: V10_BOOM_PRESET,
    boom,
    safety: {
      ...(base.safety || {}),
      researchOnly: false,
      researchOrigin: true,
      explicitListeningCandidate: false,
      ownerListeningValidated: true,
      productionDefault: true,
      v9ElectrolysisBasePreserved: true,
      wetCeiling: 0.2,
      gainCeilingDb: 3,
      peakGuard: boom.config.peakLimit,
    },
  };
}

module.exports = {
  V10_BOOM_SCHEMA,
  V10_BOOM_METHOD,
  V10_BOOM_STATE,
  V10_BOOM_PRESET,
  V10_CANON,
  V11_PAN_SCHEMA,
  V11_PAN_WIDTH,
  resolveV10BoomConfig,
  buildV10BoomPlan,
  buildV10BoomFilterGraph,
  buildV10BoomArgs,
  runV10Boom,
  processV10BoomD40,
  loadV10Compass,
  opSym,
  oppositeArm,
  nextArmClockwise,
};
