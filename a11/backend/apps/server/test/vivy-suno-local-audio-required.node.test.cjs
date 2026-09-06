'use strict';

/**
 * « Je refuse de livrer un mix sans pouvoir verifier sa longueur » (Djeff, 09/08/2026).
 *
 * La regle doit tenir cote serveur. Elle ne tenait que si le frontend pensait a
 * envoyer un drapeau: sans lui, materializeVivySunoMedia gardait l'URL du fournisseur,
 * il n'y avait aucun fichier chez nous, donc aucune duree mesurable, et le mix partait
 * quand meme. Journal du 09/08: « Suno MP3 local materialization failed, keeping
 * provider URL ».
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  requiresLocalVivySunoAudio,
  buildVivySunoLocalizingJob,
} = require('../src/routes/vivy-studio.cjs');
const { probeAudioDurationSeconds } = require('../src/audio/probe-audio-duration.cjs');

test('sans consigne, le serveur exige desormais l audio local', () => {
  const ancien = process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO;
  delete process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO;
  try {
    assert.equal(requiresLocalVivySunoAudio({}), true);
  } finally {
    if (ancien === undefined) delete process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO;
    else process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO = ancien;
  }
});

test('un appelant peut encore refuser explicitement', () => {
  // Un apercu jetable n'a pas besoin d'etre mesure: le refus explicite reste possible
  // et doit primer sur le defaut serveur.
  assert.equal(requiresLocalVivySunoAudio({ requireLocalSunoAudio: false }), false);
  assert.equal(requiresLocalVivySunoAudio({ requireLocalAudio: 'no' }), false);
});

test('une demande explicite prime sur un refus dans un autre champ', () => {
  assert.equal(
    requiresLocalVivySunoAudio({ requireLocalSunoAudio: true, requireLocalAudio: false }),
    true
  );
});

test('la variable d environnement rend l ancien comportement sans deploiement', () => {
  const ancien = process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO;
  process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO = 'false';
  try {
    assert.equal(requiresLocalVivySunoAudio({}), false);
    // Une demande explicite doit rester plus forte que la variable.
    assert.equal(requiresLocalVivySunoAudio({ requireLocalSunoAudio: true }), true);
  } finally {
    if (ancien === undefined) delete process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO;
    else process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO = ancien;
  }
});

test('un rapatriement qui n aboutit jamais finit par echouer au lieu d attendre sans fin', () => {
  // Exiger l'audio local par defaut transforme une panne de CDN en attente infinie si
  // rien ne borne la boucle: « processing » + retryable, indefiniment. On ne peut pas
  // livrer l'URL distante pour s'en sortir -- c'est ce que Djeff refuse -- donc au
  // bout du delai on echoue explicitement.
  const ancien = process.env.VIVY_SUNO_LOCALIZATION_DEADLINE_MS;
  process.env.VIVY_SUNO_LOCALIZATION_DEADLINE_MS = '60000';
  try {
    const tache = 'suno-tache-de-test-borne';
    const premier = buildVivySunoLocalizingJob(tache, new Error('timeout'));
    assert.equal(premier.state, 'processing');
    assert.equal(premier.retryable, true);

    // Le meme appel juste apres reste en attente: le delai n'est pas ecoule.
    const second = buildVivySunoLocalizingJob(tache, new Error('timeout'));
    assert.equal(second.state, 'processing');
    assert.ok(second.localizingForMs >= 0);
  } finally {
    if (ancien === undefined) delete process.env.VIVY_SUNO_LOCALIZATION_DEADLINE_MS;
    else process.env.VIVY_SUNO_LOCALIZATION_DEADLINE_MS = ancien;
  }
});

test('passe le delai, le job echoue en disant que la longueur n est pas verifiable', () => {
  const ancien = process.env.VIVY_SUNO_LOCALIZATION_DEADLINE_MS;
  // Plancher a 60 s dans le code: on ne peut pas descendre plus bas, donc on verifie
  // la bascule en jouant sur le temps ecoule plutot que sur un delai minuscule.
  process.env.VIVY_SUNO_LOCALIZATION_DEADLINE_MS = '60000';
  const tache = 'suno-tache-de-test-echue';
  const vraiNow = Date.now;
  try {
    buildVivySunoLocalizingJob(tache, new Error('timeout'));
    Date.now = () => vraiNow() + 61000;
    const fini = buildVivySunoLocalizingJob(tache, new Error('timeout'));
    assert.equal(fini.state, 'error');
    assert.equal(fini.ok, false);
    assert.equal(fini.retryable, false);
    assert.match(fini.message, /longueur/i);
  } finally {
    Date.now = vraiNow;
    if (ancien === undefined) delete process.env.VIVY_SUNO_LOCALIZATION_DEADLINE_MS;
    else process.env.VIVY_SUNO_LOCALIZATION_DEADLINE_MS = ancien;
  }
});

test('la sonde rend 0 pour un fichier absent ou illisible, jamais une valeur inventee', async () => {
  assert.equal(await probeAudioDurationSeconds(''), 0);
  assert.equal(await probeAudioDurationSeconds('/chemin/qui/n/existe/pas.mp3'), 0);

  // Un fichier qui existe mais n'est pas de l'audio: ffprobe echoue, on rend 0.
  // Zero veut dire « non mesuree », c'est a l'appelant de ne pas le lire comme
  // « morceau vide » -- d'ou le champ durationMeasured a cote.
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'funesterie-sonde-'));
  const faux = path.join(dossier, 'pas-un-mp3.mp3');
  fs.writeFileSync(faux, 'ceci n est pas de l audio');
  assert.equal(await probeAudioDurationSeconds(faux), 0);
});
