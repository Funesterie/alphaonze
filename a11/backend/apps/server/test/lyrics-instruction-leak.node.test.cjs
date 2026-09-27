'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isLyricInstructionLine,
  stripLyricInstructionLines,
} = require('../src/music/lyrics-instruction-leak.cjs');

// Lignes réellement chantées par Suno entre le 23 et le 24/09/2026.
const LEAKED = [
  'Production musicale NOSSEN',
  'Production musicale,',
  'Relais vocal obligatoire: Djeff seul sur un bloc complet -> Vivy seul sur un bloc complet',
  'Les refrains répétés doivent être portés par une seule voix nommée à chaque reprise, en alternance si possible; [Duo] sert seulement à un refrain final très court de deux lignes ma',
  "N'écris jamais tout un couplet ou tout un refrain en trio/duo/tous: le casting doit s'entendre comme des relais de timbres, pas comme une seule voix empilée",
  'Contraintes de structure utilisateur:',
  'Direction freestyle rap obligatoire: couplets continus en phases',
  'punchlines concrètes et fréquentes, rimes techniques multisyllabiques',
  'variations de flow et de débit; refrain seu',
  'Ancre au moins une image concrète de ce décor sans jamais le décrire comme une',
  'Tempo — cypher rap morceau 5, DJEFF — album, GO — zéro style, même quand la section change.',
  'Hook obligatoire: La roue libre accroche au kick — sauf quand Babylone te met au point mort',
  'Duo Djeff+Vivy: Djeff couplets rap atelier/vécu, Vivy refrain dossier froid.',
  'Chaque voix doit avoir au moins une section solo complète de quatre vers',
  'Titre possible: suis.',
];

// Vraies paroles du même corpus, proches par le vocabulaire.
const SUNG = [
  "Moi j'note mentalement: il porte des Crocs",
  'Chaque couplet un escalier qui monte, sans jamais fléchir,',
  'Tu parles couronne et feu mais ton style est verrouillé',
  'Je garde mon flow, mes rimes et ma parole',
  'Garde la tête haute quand la ville te juge',
  'Toujours le même refrain dans ta bouche',
  '[Verse 1 - Djeff]',
  '[Couplet 1 - Djeff, flow rapide, refrain]',
];

test('les consignes chantées sont reconnues à leur forme', () => {
  for (const line of LEAKED) assert.equal(isLyricInstructionLine(line), true, line);
});

test('les paroles proches par le vocabulaire restent', () => {
  for (const line of SUNG) assert.equal(isLyricInstructionLine(line), false, line);
});

test('stripLyricInstructionLines retire seulement les consignes', () => {
  const { lyrics, removed } = stripLyricInstructionLines([
    '[Verse 1]',
    'Relais vocal obligatoire: Djeff seul sur un bloc complet',
    'Je roule seul sous la pluie',
  ].join('\n'));
  assert.equal(removed.length, 1);
  assert.equal(lyrics, '[Verse 1]\nJe roule seul sous la pluie');
});

test('la dernière barrière avant Suno retire les consignes et le couplet qui n’en contenait que', () => {
  process.env.VIVY_SUNO_API_KEY = process.env.VIVY_SUNO_API_KEY || 'test-key';
  const { buildVivySunoPayload } = require('../src/routes/vivy-studio.cjs');
  const payload = buildVivySunoPayload({
    songTitle: 'Signal',
    songArtists: ['vivy'],
    cleanLyrics: [
      '[Intro]',
      '[Instrumental Break]',
      '',
      '[Verse 1]',
      'Production musicale NOSSEN',
      'Direction freestyle rap obligatoire: couplets continus en phases',
      'variations de flow et de débit; refrain seu',
      '',
      '[Verse 2]',
      'Je roule seul sous la pluie',
      'La ville dort sans un bruit',
      '',
      '[Chorus]',
      'On tient debout',
      'On tient le coup',
    ].join('\n'),
  });
  assert.doesNotMatch(payload.prompt, /obligatoire|Production musicale|refrain seu/);
  assert.doesNotMatch(payload.prompt, /\[Verse 1\]/);
  assert.match(payload.prompt, /\[Instrumental Break\]/);
  assert.match(payload.prompt, /Je roule seul sous la pluie/);
});
