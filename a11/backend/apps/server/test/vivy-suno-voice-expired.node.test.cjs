'use strict';

/**
 * Une voix nommee morte ne doit pas etre remplacee en silence.
 *
 * Constate le 08/08/2026 sur Ile. Sa persona Suno expire; resolveCatalogVoiceId rend
 * une chaine vide; useVerifiedSunoVoice tombe a faux; et le morceau part chez Suno
 * SANS aucune persona. Suno improvise alors la voix a partir du seul prompt de style
 * -- feminine ici, donc celle de Vivy a l'oreille. Personne n'est prevenu, le morceau
 * revient dans la mauvaise voix, et les credits sont depenses quand meme.
 *
 * Le silence est le vrai defaut: une substitution annoncee serait discutable, une
 * substitution muette est indefendable. On refuse donc de construire la charge.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'funesterie-voix-morte-'));
process.env.A11_VOICE_CATALOG_FILE = path.join(dossier, 'voice-catalog.json');

const { upsertVoiceInCatalog } = require('../src/music/voice-catalog.cjs');
const { buildVivySunoPayload } = require('../src/routes/vivy-studio.cjs');

upsertVoiceInCatalog({
  name: 'ile',
  label: 'Ile',
  voiceId: '50f63c18626119450e2b491ebfcbdae3',
  consentBy: 'test@funesterie.me',
  sampleFile: 'ile.mp3',
  sampleDurationSeconds: 16,
  personaExpiredAt: '2026-08-08T18:29:31.298Z',
});

upsertVoiceInCatalog({
  name: 'vivante',
  label: 'Vivante',
  voiceId: 'b3f2a1be02a5198149888aaeccdb77b5',
  consentBy: 'test@funesterie.me',
  sampleFile: 'vivante.mp3',
  sampleDurationSeconds: 17,
});

function charge(nom) {
  return () => buildVivySunoPayload({
    voiceCatalogName: nom,
    songText: 'Un couplet court pour la charge de test.',
    theme: 'test',
  });
}

test('demander une voix dont la persona est morte refuse au lieu de substituer', () => {
  let erreur = null;
  try {
    charge('ile')();
  } catch (e) {
    erreur = e;
  }
  assert.ok(erreur, 'la construction de la charge doit echouer');
  assert.equal(erreur.message, 'suno_catalog_voice_expired');
  assert.equal(erreur.voiceName, 'ile');
  assert.equal(erreur.expiredAt, '2026-08-08T18:29:31.298Z');
  // Ile garde son echantillon: elle est reanimable, et le message doit le dire au
  // lieu de laisser croire que la voix est perdue.
  assert.equal(erreur.recoverable, true);
  // Meme forme que les autres refus de la route: un code et un statut, sinon la
  // route rend un 500 muet la ou l'utilisateur a besoin de savoir quoi faire.
  assert.equal(erreur.code, 'suno_catalog_voice_expired');
  assert.equal(erreur.status, 409);
  assert.match(erreur.hint, /recover/);
});

test('une voix vivante du catalogue construit toujours sa charge', () => {
  assert.doesNotThrow(charge('vivante'));
});

test('ne rien demander ne declenche aucun refus', () => {
  // Le refus ne vaut que pour une demande explicite: sans nom de voix, la chanson
  // part normalement avec le style, c'est le fonctionnement voulu.
  assert.doesNotThrow(() => buildVivySunoPayload({
    songText: 'Un couplet court pour la charge de test.',
    theme: 'test',
  }));
});
