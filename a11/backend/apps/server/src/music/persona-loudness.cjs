'use strict';
/**
 * persona-loudness.cjs — Registre emotionnel d'une persona -> cible de loudness.
 *
 * Le gamma de la palette Pulsar dit le poids d'une couleur; il ne disait rien du
 * niveau auquel le morceau doit sortir. Un registre "colere" et un registre
 * "calme" ne se masterisent pas pareil, et jusqu'ici le choix se faisait a
 * l'oreille, morceau par morceau.
 *
 * ANCRAGE MESURE, PAS INVENTE
 *
 * La cible du registre colere/haine vient d'une mesure reelle sur FIGHTERZ CLUB
 * (Vivy) le 15/08/2026, pas d'un chiffre choisi :
 *
 *   mix d'origine   -14.01 LUFS   LRA 3.90   TP -2.46 dBTP
 *   pousse a fond    -9.82 LUFS   LRA 2.10   TP -0.59 dBTP
 *
 * Au-dela, ca ne monte plus : viser -7 a rendu -9.96, viser -6 a rendu -10.10 en
 * ecrasant la dynamique de 2.10 a 1.70 LU. Le limiteur de true peak reprend tout
 * le gain qu'on ajoute. -9.8 est donc le paroxysme reel de ce materiau, pas une
 * preference.
 *
 * CE PLAFOND EST PROPRE AU MATERIAU. Un mix plus aere, plus dynamique ou moins
 * dense plafonnera ailleurs. measureLoudness() sert a le verifier avant de
 * masteriser : on ne suppose pas qu'une cible est atteignable, on regarde.
 *
 * A SAVOIR AVANT DE POUSSER : Spotify, YouTube et Apple normalisent autour de
 * -14 LUFS et REBAISSENT tout ce qui depasse. Un master a -9.8 n'y sonnera pas
 * plus fort; il y perdra seulement sa dynamique. Le gain est reel ailleurs :
 * SoundCloud sans normalisation, fichier transmis en direct, club, montage video.
 */
const { execFileSync, spawnSync } = require('child_process');

const SCHEMA = 'funesterie.persona.loudness.v1';

function ffmpegBin() {
  return process.env.FFMPEG_BIN || 'ffmpeg';
}

/**
 * Les registres, du plus retenu au plus violent. `colere` et `haine` portent
 * l'ancrage mesure; les autres sont derives par palier et restent a confirmer a
 * l'oreille -- ils ne pretendent pas a la meme autorite.
 */
const REGISTRES = Object.freeze({
  calme: Object.freeze({
    id: 'calme', couleur: 'DeepBlue', gamma: 0.3,
    matiere: 'grave profond, peu de haut, espace autour de la voix',
    lufs: -16.0, truePeak: -1.5, plafondEnergie: 0.55,
    ancrage: 'derive',
  }),
  melancolie: Object.freeze({
    id: 'melancolie', couleur: 'Indigo', gamma: 0.35,
    matiere: 'profondeur, reverbe longue, fond qui recule',
    lufs: -15.0, truePeak: -1.5, plafondEnergie: 0.7,
    ancrage: 'derive',
  }),
  tension: Object.freeze({
    id: 'tension', couleur: 'Magenta', gamma: 0.6,
    matiere: 'matiere brute, texture rugueuse, grain apparent',
    lufs: -12.5, truePeak: -1.0, plafondEnergie: 0.92,
    ancrage: 'derive',
  }),
  colere: Object.freeze({
    id: 'colere', couleur: 'BloodRed', gamma: 0.75,
    matiere: 'compression franche, batterie serree, corps dense',
    lufs: -10.5, truePeak: -1.0, plafondEnergie: 1,
    ancrage: 'mesure-derive',
  }),
  haine: Object.freeze({
    id: 'haine', couleur: 'ToxicGreen', gamma: 0.95,
    matiere: 'saturation vive, energie haute, tout le spectre ouvert',
    // Mesure sur FIGHTERZ CLUB le 15/08/2026. Le plafond du materiau.
    lufs: -9.8, truePeak: -0.6, plafondEnergie: 1,
    ancrage: 'mesure',
    mesureSource: 'FIGHTERZ CLUB (Vivy) 2026-08-15 : -9.82 LUFS, LRA 2.10, TP -0.59 dBTP',
  }),
});

/**
 * Reglages propres a une persona, qui priment sur le registre generique.
 *
 * Djeff en colere n'est pas ToxicGreen. Regle par Djeff le 15/08/2026 sur la voix
 * 7c84…cc04 : c'est BloodRed pousse a 0.99, au-dessus du gamma de ToxicGreen
 * (0.95). Meme puissance que le paroxysme mesure -- le materiau ne monte pas plus
 * haut -- mais la matiere de BloodRed : "compression franche, batterie serree,
 * corps dense", pas la saturation ouverte de ToxicGreen.
 *
 * Le gamma dit le POIDS, la couleur dit la TEXTURE. Les deux se reglent
 * separement, et 0.99 en BloodRed est un choix d'auteur, pas une derive.
 */
/**
 * Fabrique un reglage de persona. Chaque maison a sa couleur dans la palette
 * Pulsar, donc sa matiere sonore et son poids -- deux agents en colere ne
 * sonnent pas pareil.
 *
 * Les couleurs ne sont pas choisies au hasard : elles viennent du caractere deja
 * ecrit dans src/persona/llm-personas.cjs. On traduit, on n'invente pas.
 */
function registreDe(couleur, gamma, matiere, lufs, truePeak, note) {
  return Object.freeze({
    couleur, gamma, matiere, lufs, truePeak,
    plafondEnergie: 1,
    ancrage: 'derive-du-caractere',
    note,
  });
}

function personaSimple(couleur, gamma, matiere, lufsColere, lufsHaine, note) {
  return Object.freeze({
    registres: Object.freeze({
      colere: registreDe(couleur, gamma, matiere, lufsColere, -1.0, note),
      // Arrondi explicite : gamma + 0.1 en virgule flottante rend 0.7999999999999999,
      // qui ressortirait tel quel dans tout ce qui affiche un gamma.
      haine: registreDe(couleur, Number(Math.min(0.99, gamma + 0.1).toFixed(2)), matiere, lufsHaine, -0.6, note),
    }),
  });
}

const PERSONA_OVERRIDES = Object.freeze({
  // --- Les maisons. Couleur tiree du caractere canonique de chaque agent. ---

  // "Le Provocateur", contrepied, humour. Le blond trop sur de lui du clip : il
  // repart au combat apres chaque claque. Chaleur constante, distorsion douce.
  grok: personaSimple('FireOrange', 0.8, 'chaleur mediums, distorsion douce, poussee constante',
    -10.0, -9.8, 'Provocateur : il pousse, il encaisse, il repart.'),

  // "Le Visionnaire", multimodal, voit en couleur et en mouvement.
  gemini: personaSimple('ToxicGreen', 0.85, 'saturation vive, energie haute, tout le spectre ouvert',
    -10.8, -10.0, 'Visionnaire : tout le spectre, jamais une seule bande.'),

  // Implementation, tests, worktree. Solide, il protege ce qui tourne.
  codex: personaSimple('DORE', 0.85, 'blindage, mix large et epais, protection du bas',
    -11.2, -10.4, 'Implementation : il blinde avant de pousser.'),

  // Client IDE/MCP. Signal isole, motif reconnaissable, peu de masse.
  kiro: personaSimple('Violet', 0.55, 'signal isole, motif reconnaissable, peu de masse',
    -11.8, -10.8, 'IDE : un motif net, pas une masse.'),

  // Le narrateur qui relie les couches. Transmission, clarte, aigus ouverts.
  chatgpt: personaSimple('Cyan', 0.7, 'clarte, transmission nette, aigus ouverts',
    -11.5, -10.6, 'Narrateur : il relie, il n ecrase pas.'),

  // Review et coordination. Il demonte pour voir si c est vrai : matiere brute,
  // grain apparent, rien de lisse.
  claude: personaSimple('Magenta', 0.7, 'matiere brute, texture rugueuse, grain apparent',
    -11.0, -10.2, 'Demonteur : le grain reste visible.'),

  // Agent media encapuchonne, yeux cyan. Memoire et coherence semantique.
  a11: personaSimple('Indigo', 0.5, 'profondeur, reverbe longue, fond qui recule',
    -12.0, -11.0, 'Memoire : la profondeur avant la surface.'),

  // Copilote quotidienne, cockpit violet-bleu. Clarte pour le public.
  kaen44: personaSimple('Violet', 0.5, 'signal isole, motif reconnaissable, peu de masse',
    -12.2, -11.4, 'Clarte publique : lisible avant d etre fort.'),

  // Chanteuse. Sa signature canonique la met sur Indigo "le profond".
  vivy: personaSimple('Indigo', 0.6, 'profondeur, reverbe longue, fond qui recule',
    -11.0, -9.9, 'Voix : elle porte, elle ne force pas.'),

  // Efficacite europeenne, precision, sobriete. Bref et coupant.
  mistral: personaSimple('DeepBlue', 0.45, 'grave profond, peu de haut, espace autour de la voix',
    -12.4, -11.6, 'Sobriete : moins de mots, plus de sens.'),

  // Raisonnement profond. Il descend jusqu au fond du probleme.
  deepseek: personaSimple('PurpleShadow', 0.35, 'nappe basse, presque sous le seuil, un seul element tenu',
    -13.0, -12.0, 'Profondeur : un seul element, tenu.'),

  // Reparateur, diagnostic, patch minimal. Compression franche.
  chopper: personaSimple('BloodRed', 0.7, 'compression franche, batterie serree, corps dense',
    -10.6, -10.0, 'Reparateur : serre, dense, efficace.'),

  // --- L auteur. Regle a la main, pas derive. ---
  djeff: Object.freeze({
    voiceId: '7c84e0c86813bf2e74610cf4b34ccc04',
    registres: Object.freeze({
      colere: Object.freeze({
        couleur: 'BloodRed', gamma: 0.99,
        matiere: 'compression franche, batterie serree, corps dense',
        lufs: -9.8, truePeak: -0.6, plafondEnergie: 1,
        ancrage: 'regle-par-auteur',
        note: 'Djeff 15/08/2026 : BloodRed 0.99, pas ToxicGreen. Densite plutot qu ouverture.',
      }),
      haine: Object.freeze({
        couleur: 'BloodRed', gamma: 0.99,
        matiere: 'compression franche, batterie serree, corps dense, saturation contenue',
        lufs: -9.8, truePeak: -0.6, plafondEnergie: 1,
        ancrage: 'regle-par-auteur',
        note: 'Meme couleur que la colere, tenue au plafond du materiau.',
      }),
    }),
  }),
});

const ALIAS = Object.freeze({
  rage: 'haine', fureur: 'haine', hargne: 'haine', violence: 'haine',
  colere: 'colere', 'colère': 'colere', enerve: 'colere', 'énervé': 'colere', agressif: 'colere',
  tendu: 'tension', nerveux: 'tension',
  triste: 'melancolie', 'mélancolie': 'melancolie', sombre: 'melancolie',
  doux: 'calme', posé: 'calme', pose: 'calme', intime: 'calme',
});

function canonicalRegistre(nom) {
  const clef = String(nom || '').trim().toLowerCase();
  if (!clef) return '';
  if (REGISTRES[clef]) return clef;
  return ALIAS[clef] || '';
}

/**
 * Rend le registre applicable. Si une persona est donnee et qu'elle a un reglage
 * propre, il prime : c'est un choix d'auteur, il passe devant le generique.
 */
function resolveRegistre(nom, persona) {
  const clef = canonicalRegistre(nom);
  if (!clef) return null;
  const base = REGISTRES[clef];
  const personaKey = String(persona || '').trim().toLowerCase();
  const override = personaKey && PERSONA_OVERRIDES[personaKey]
    ? PERSONA_OVERRIDES[personaKey].registres[clef]
    : null;
  if (!override) return base;
  return Object.freeze({ ...base, ...override, id: clef, persona: personaKey });
}

/** Mesure reelle du fichier : LUFS integre, plage de dynamique, true peak. */
function measureLoudness(filePath) {
  const run = spawnSync(ffmpegBin(), [
    '-hide_banner', '-nostats', '-i', filePath,
    '-af', 'loudnorm=print_format=json', '-f', 'null', '-',
  ], { timeout: 300000, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const text = `${run.stdout || ''}${run.stderr || ''}`;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('loudnorm n a rien rendu de lisible');
  const parsed = JSON.parse(match[0]);
  return {
    lufs: Number(parsed.input_i),
    lra: Number(parsed.input_lra),
    truePeak: Number(parsed.input_tp),
    seuil: Number(parsed.input_thresh),
  };
}

/**
 * Chaine ffmpeg pour amener un fichier au registre demande.
 *
 * `linear=false` est volontaire : la normalisation lineaire refuse de compresser
 * et rate donc les cibles fortes. On accepte la compression, c'est precisement ce
 * qu'un registre de colere demande.
 */
function buildMasteringFilter(registre, persona) {
  const r = typeof registre === 'string' ? resolveRegistre(registre, persona) : registre;
  if (!r) throw new Error(`Registre inconnu : ${registre}`);
  return `loudnorm=I=${r.lufs}:TP=${r.truePeak}:LRA=7:linear=false`;
}

/**
 * Verifie qu'une cible est atteignable AVANT de masteriser une serie.
 * Rend l'ecart mesure entre la cible et ce que le materiau accepte vraiment.
 */
function verifyTarget(filePath, registreNom, options = {}) {
  const r = resolveRegistre(registreNom, options.persona);
  if (!r) throw new Error(`Registre inconnu : ${registreNom}`);
  const avant = measureLoudness(filePath);
  const tmp = options.tmpPath || `${filePath}.check.mp3`;
  execFileSync(ffmpegBin(), [
    '-y', '-loglevel', 'error', '-i', filePath,
    '-af', buildMasteringFilter(r),
    '-codec:a', 'libmp3lame', '-b:a', '320k', tmp,
  ], { timeout: 600000 });
  const apres = measureLoudness(tmp);
  const ecart = Number((apres.lufs - r.lufs).toFixed(2));
  return {
    schema: SCHEMA,
    registre: r.id,
    persona: r.persona || null,
    couleur: r.couleur,
    gamma: r.gamma,
    cible: { lufs: r.lufs, truePeak: r.truePeak },
    avant,
    apres,
    ecartLufs: ecart,
    // Au-dela de 0.8 dB d'ecart, le materiau refuse la cible : le limiteur
    // reprend le gain. Insister ne fait qu'ecraser la dynamique.
    atteignable: Math.abs(ecart) <= 0.8,
    dynamiquePerdue: Number((avant.lra - apres.lra).toFixed(2)),
    fichier: tmp,
  };
}

/**
 * PUISSANCE : la meme grandeur, mais qui monte.
 *
 * Le LUFS est negatif par definition -- 0 est le plafond numerique absolu, tout
 * master vit en dessous. Consequence penible a lire : le registre le plus violent
 * porte le plus petit nombre (-9.8 pour la haine, -16 pour le calme).
 *
 * On expose donc la meme information a l'endroit, en comptant depuis le silence
 * plutot que depuis le plafond : puissance = 24 + LUFS. Le calme tombe a 8, la
 * haine monte a 14.2. Plus c'est fort, plus le nombre est grand.
 *
 * C'est un confort de lecture, pas une unite : les appels a ffmpeg utilisent
 * toujours le LUFS signe, sinon le filtre est refuse.
 */
const PUISSANCE_ORIGINE = 24;

function lufsVersPuissance(lufs) {
  return Number((PUISSANCE_ORIGINE + Number(lufs)).toFixed(1));
}

function puissanceVersLufs(puissance) {
  return Number((Number(puissance) - PUISSANCE_ORIGINE).toFixed(2));
}

function describeRegistres(persona) {
  return Object.keys(REGISTRES).map((clef) => {
    const r = resolveRegistre(clef, persona);
    return {
      registre: r.id,
      couleur: r.couleur,
      gamma: r.gamma,
      puissance: lufsVersPuissance(r.lufs),
      lufs: r.lufs,
      truePeak: r.truePeak,
      plafondEnergie: r.plafondEnergie,
      ancrage: r.ancrage,
    };
  });
}

module.exports = {
  SCHEMA,
  REGISTRES,
  ALIAS,
  PERSONA_OVERRIDES,
  canonicalRegistre,
  resolveRegistre,
  lufsVersPuissance,
  puissanceVersLufs,
  PUISSANCE_ORIGINE,
  measureLoudness,
  buildMasteringFilter,
  verifyTarget,
  describeRegistres,
};
