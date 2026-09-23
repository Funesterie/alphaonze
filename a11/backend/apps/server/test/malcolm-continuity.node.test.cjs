'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  judgeContinuity,
  normalizeMalcolmVerdict,
  buildToileSvg,
  buildMalcolmPayload,
  ALLOWED_VERDICTS,
} = require('../src/clips/malcolm-continuity.cjs');

test('judgeContinuity : sans image, on ne fait pas semblant de juger', async () => {
  const out = await judgeContinuity({ planIndex: 0, planVisual: 'A room.' });
  assert.equal(out.ok, false);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'missing_image_url');
});

test('judgeContinuity : un plan coherent passe tel quel', async () => {
  const out = await judgeContinuity({
    imageUrl: 'https://example.test/plan-1.png',
    planIndex: 1,
    planName: 'Plan 1',
    planVisual: 'Medium shot, working at the desk.',
    previousPlanVisual: 'Wide shot of the workshop.',
    lieu: 'atelier',
    callStructuredVisionJson: async ({ imageUrl, systemPrompt }) => {
      assert.equal(imageUrl, 'https://example.test/plan-1.png');
      assert.match(systemPrompt, /Malcolm/);
      return {
        changement_normal: true,
        coherent_avec_precedent: true,
        suite_logique_theme: true,
        meme_ambiance: true,
        rupture_acceptable: null,
        raison_changement: 'Cadrage resserre pour suivre le geste.',
        suite_possible: 'Continuer sur le meme lieu.',
        verdict: 'coherent',
        confidence: 0.9,
      };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.verdict.verdict, 'coherent');
  assert.equal(out.verdict.rupture_acceptable, null, 'pas de rupture a juger si tout colle');
  assert.equal(out.verdict.confidence, 0.9);
});

test('judgeContinuity : une rupture de ton voulue (bridge) n est pas un rejet', async () => {
  const out = await judgeContinuity({
    imageUrl: 'https://example.test/plan-5.png',
    planIndex: 5,
    callStructuredVisionJson: async () => ({
      changement_normal: true,
      coherent_avec_precedent: true,
      suite_logique_theme: true,
      meme_ambiance: false,
      rupture_acceptable: true,
      raison_changement: 'Montee d intensite du bridge musical.',
      suite_possible: 'Redescendre progressivement vers l outro.',
      verdict: 'rupture_acceptee',
      confidence: 0.7,
    }),
  });
  assert.equal(out.verdict.verdict, 'rupture_acceptee');
  assert.equal(out.verdict.meme_ambiance, false);
  assert.equal(out.verdict.rupture_acceptable, true, 'la rupture est nommee comme legitime, pas cachee');
});

test('judgeContinuity : une derive non voulue est rejetee', async () => {
  const out = await judgeContinuity({
    imageUrl: 'https://example.test/plan-8.png',
    planIndex: 8,
    callStructuredVisionJson: async () => ({
      changement_normal: false,
      coherent_avec_precedent: false,
      suite_logique_theme: false,
      meme_ambiance: false,
      rupture_acceptable: false,
      raison_changement: 'Le lieu a change sans raison entre les deux plans.',
      suite_possible: 'Regenerer ce plan dans le lieu unique.',
      verdict: 'rejete',
      confidence: 0.85,
    }),
  });
  assert.equal(out.verdict.verdict, 'rejete');
  assert.equal(out.verdict.rupture_acceptable, false);
});

test('normalizeMalcolmVerdict : rupture_acceptable reste null si rien ne casse', () => {
  // Un juge qui repond quand meme sur rupture_acceptable alors que tout est
  // coherent : la regle dit d'ignorer ce champ, il n'y a rien a juger.
  const verdict = normalizeMalcolmVerdict({
    meme_ambiance: true,
    coherent_avec_precedent: true,
    rupture_acceptable: false,
    verdict: 'coherent',
  });
  assert.equal(verdict.rupture_acceptable, null);
});

test('normalizeMalcolmVerdict : un verdict inconnu retombe sur "uncertain", jamais invente', () => {
  const verdict = normalizeMalcolmVerdict({ verdict: 'nawak' });
  assert.equal(verdict.verdict, 'uncertain');
  assert.ok(ALLOWED_VERDICTS.has('coherent'));
});

test('judgeContinuity : un echec de l appel vision se journalise, ne casse rien', async () => {
  const out = await judgeContinuity({
    imageUrl: 'https://example.test/plan-2.png',
    callStructuredVisionJson: async () => { throw new Error('vision_timeout'); },
  });
  assert.equal(out.ok, false);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'malcolm_vision_failed');
  assert.match(out.message, /vision_timeout/);
});

test('buildMalcolmPayload : porte le plan precedent seulement s il existe', () => {
  const avecPrecedent = buildMalcolmPayload({ planIndex: 2, planVisual: 'B', previousPlanVisual: 'A' });
  assert.equal(avecPrecedent.plan_precedent_demande, 'A');
  const sansPrecedent = buildMalcolmPayload({ planIndex: 0, planVisual: 'A' });
  assert.equal(sansPrecedent.plan_precedent_demande, null);
});

test('buildToileSvg : un noeud par plan, une arete de moins, couleur par verdict', () => {
  const entries = [
    { planIndex: 0, planName: 'Intro' },
    { planIndex: 1, planName: 'Verse', verdict: { verdict: 'coherent', raison_changement: 'suite naturelle' } },
    { planIndex: 2, planName: 'Bridge', verdict: { verdict: 'rupture_acceptee', raison_changement: 'montee d intensite' } },
    { planIndex: 3, planName: 'Outro', verdict: { verdict: 'rejete', raison_changement: 'lieu change sans raison' } },
  ];
  const svg = buildToileSvg(entries, { title: 'Poursuite Nocturne' });
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  // 2 cercles par noeud (halo + point) + 1 par entree de legende (4 entrees fixes).
  assert.equal((svg.match(/<circle/g) || []).length, entries.length * 2 + 4);
  assert.equal((svg.match(/<line /g) || []).length, entries.length - 1);
  assert.match(svg, /#4ade80/, 'vert pour coherent');
  assert.match(svg, /#fbbf24/, 'orange pour rupture assumee');
  assert.match(svg, /#f87171/, 'rouge pour rejete');
  assert.match(svg, /Poursuite Nocturne/);
  for (const entry of entries) assert.match(svg, new RegExp(entry.planName));
});

test('buildToileSvg : un seul plan ne casse pas (pas de division par zero)', () => {
  const svg = buildToileSvg([{ planIndex: 0, planName: 'Solo' }]);
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/<line /g) || []).length, 0);
});

test('buildToileSvg : liste vide rend un SVG valide, pas une exception', () => {
  const svg = buildToileSvg([]);
  assert.match(svg, /^<svg /);
});

// 23/09/2026, Djeff : "les personnages sont les meme (couleur de cheveux
// bijoux, etc), les vehicules aussi ? pas de retro rajoute/enleve" — un
// verdict global ne pouvait pas attraper ca. Ces tests verifient que Malcolm
// juge chaque entite et qu'une derive d'identite n'est JAMAIS traitee comme
// une rupture de ton acceptable, meme si le modele repond "rupture_acceptee".

test('judgeContinuity : cheveux de personnage qui changent = rejete, jamais une rupture acceptable', async () => {
  const out = await judgeContinuity({
    imageUrl: 'https://example.test/plan-3.png',
    planIndex: 3,
    castLabels: ['Djeff'],
    // Le modele se trompe et propose "rupture_acceptee" : Malcolm doit forcer
    // le rejet quand meme, une identite qui change n'est pas un choix de ton.
    callStructuredVisionJson: async () => ({
      personnages: [{ nom: 'Djeff', coherent: false, details: 'cheveux passes de bruns a blonds sans raison' }],
      vehicules: [],
      autres_incoherences: [],
      changement_normal: true,
      coherent_avec_precedent: true,
      suite_logique_theme: true,
      meme_ambiance: true,
      rupture_acceptable: true,
      raison_changement: 'Derive du modele de rendu.',
      suite_possible: 'Regenerer ce plan avec la fiche personnage.',
      verdict: 'rupture_acceptee',
      confidence: 0.6,
    }),
  });
  assert.equal(out.verdict.identityIssues, true);
  assert.equal(out.verdict.verdict, 'rejete', 'une derive d\'identite prime sur ce que dit le modele');
  assert.equal(out.verdict.rupture_acceptable, null, 'pas applicable des qu il y a une derive d\'identite');
  assert.equal(out.verdict.personnages[0].coherent, false);
  assert.match(out.verdict.personnages[0].details, /blonds/);
});

test('judgeContinuity : retro de vehicule disparu = rejete', async () => {
  const out = await judgeContinuity({
    imageUrl: 'https://example.test/plan-4.png',
    planIndex: 4,
    vehicleHints: ['Beta 50 kittee 80cc rouge'],
    callStructuredVisionJson: async ({ payload }) => {
      assert.deepEqual(payload.vehicules_attendus, ['Beta 50 kittee 80cc rouge']);
      return {
        personnages: [],
        vehicules: [{ nom: 'Beta 50', coherent: false, details: 'retroviseur droit disparu entre les deux plans' }],
        autres_incoherences: [],
        changement_normal: true,
        coherent_avec_precedent: true,
        suite_logique_theme: true,
        meme_ambiance: true,
        rupture_acceptable: null,
        raison_changement: 'Piece manquante au rendu.',
        suite_possible: 'Regenerer avec le retroviseur explicite dans le prompt.',
        verdict: 'coherent',
        confidence: 0.55,
      };
    },
  });
  assert.equal(out.verdict.identityIssues, true);
  assert.equal(out.verdict.verdict, 'rejete');
  assert.match(out.verdict.vehicules[0].details, /retroviseur/);
});

test('judgeContinuity : personnages et vehicules coherents n empechent pas une rupture de ton acceptable', async () => {
  const out = await judgeContinuity({
    imageUrl: 'https://example.test/plan-6.png',
    planIndex: 6,
    callStructuredVisionJson: async () => ({
      personnages: [{ nom: 'Djeff', coherent: true, details: 'meme coiffure, meme blouson' }],
      vehicules: [{ nom: 'Beta 50', coherent: true, details: 'meme moto, retroviseurs presents' }],
      autres_incoherences: [],
      changement_normal: true,
      coherent_avec_precedent: true,
      suite_logique_theme: true,
      meme_ambiance: false,
      rupture_acceptable: true,
      raison_changement: 'Montee d intensite du refrain.',
      suite_possible: 'Redescendre vers l outro.',
      verdict: 'rupture_acceptee',
      confidence: 0.8,
    }),
  });
  assert.equal(out.verdict.identityIssues, false);
  assert.equal(out.verdict.verdict, 'rupture_acceptee');
  assert.equal(out.verdict.rupture_acceptable, true);
});

test('buildMalcolmPayload : transmet la fiche personnages/vehicules attendus', () => {
  const payload = buildMalcolmPayload({
    planIndex: 0,
    planVisual: 'A shot.',
    castLabels: ['Djeff', 'Djeff', 'Vivy'],
    vehicleHints: ['Beta 50 rouge'],
  });
  assert.deepEqual(payload.personnages_attendus, ['Djeff', 'Vivy'], 'dedoublonne');
  assert.deepEqual(payload.vehicules_attendus, ['Beta 50 rouge']);
});

test('buildToileSvg : l info-bulle nomme l entite en cause, pas juste "rejete"', () => {
  const entries = [
    { planIndex: 0, planName: 'Intro' },
    {
      planIndex: 1,
      planName: 'Poursuite',
      verdict: {
        verdict: 'rejete',
        raison_changement: 'derive du rendu',
        personnages: [],
        vehicules: [{ nom: 'Beta 50', coherent: false, details: 'retroviseur droit disparu' }],
        autres_incoherences: [],
      },
    },
  ];
  const svg = buildToileSvg(entries);
  assert.match(svg, /retroviseur droit disparu/);
});
