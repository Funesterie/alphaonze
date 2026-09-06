'use strict';

/**
 * Une persona morte ne doit ni passer inapercue, ni emporter la chanson.
 *
 * Une persona Suno n'est qu'une reference vers un clip heberge chez eux: quand le clip
 * est purge, l'identifiant survit dans notre catalogue mais ne designe plus rien (553,
 * « The voice has expired »). Deux exigences se rejoignent ici:
 *
 *   - reconnaitre ce deces precisement. Trop large, on desactiverait des voix vivantes
 *     a la premiere panne de generation venue;
 *   - garder l'ADN. L'echantillon sur notre disque est la seule matiere qui permette de
 *     refabriquer la voix; une reanimation qui l'efface rend le deces suivant definitif.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  looksLikeExpiredPersona,
  resolveVocalWindow,
  canAttemptRecovery,
  markPersonaExpired,
} = require('../src/music/persona-recovery.cjs');

const {
  upsertVoiceInCatalog,
  findVoiceInCatalog,
  describeVoiceCatalog,
  resolveVoiceSampleDir,
} = require('../src/music/voice-catalog.cjs');

function catalogueTemporaire() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funesterie-persona-'));
  return { ...process.env, A11_VOICE_CATALOG_FILE: path.join(dir, 'voice-catalog.json') };
}

test('le deces de la persona est reconnu sous ses trois formulations', () => {
  assert.ok(looksLikeExpiredPersona({ code: 553 }), 'le code 553 suffit');
  assert.ok(looksLikeExpiredPersona({ message: 'The voice has expired. Please recreate the voice' }));
  assert.ok(looksLikeExpiredPersona({ message: 'Voice persona generation failed' }));
  assert.ok(looksLikeExpiredPersona({ status: 553, message: '' }));
});

test('une panne ordinaire ne fait pas passer une voix pour morte', () => {
  // Elargir la detection couterait des voix vivantes: un manque de credits ou une
  // limite de debit desactiverait tout le catalogue.
  assert.ok(!looksLikeExpiredPersona({ code: 429, message: 'Too many requests' }));
  assert.ok(!looksLikeExpiredPersona({ code: 402, message: 'Insufficient credits' }));
  assert.ok(!looksLikeExpiredPersona({ code: 500, message: 'generation failed' }));
  assert.ok(!looksLikeExpiredPersona({ message: 'sensitive word error' }));
  assert.ok(!looksLikeExpiredPersona(null));
});

test('la fenetre vocale respecte les bornes imposees par Suno', () => {
  // generate-persona exige une fenetre de 10 a 30 s, comprise dans la duree du clip.
  for (const duree of [0, 8, 12, 30, 90, 240]) {
    const { vocalStart, vocalEnd } = resolveVocalWindow(duree);
    const largeur = vocalEnd - vocalStart;
    assert.ok(vocalStart >= 0, `depart negatif pour ${duree}s`);
    assert.ok(largeur >= 10 && largeur <= 30, `fenetre de ${largeur}s hors bornes pour ${duree}s`);
    if (duree > 0) assert.ok(vocalEnd <= Math.max(duree, 30), `fenetre au-dela du clip pour ${duree}s`);
  }
});

test('une voix sans echantillon n est pas reanimable, et le catalogue le dit', () => {
  const env = catalogueTemporaire();
  upsertVoiceInCatalog({
    name: 'orpheline',
    voiceId: 'a'.repeat(32),
    consentBy: 'Djeff',
  }, env);

  markPersonaExpired('orpheline', 'The voice has expired', env);
  const entry = findVoiceInCatalog('orpheline', env);
  assert.ok(entry.personaExpiredAt, 'le deces doit etre constate');
  assert.ok(!canAttemptRecovery(entry, env), 'sans ADN, aucune reanimation possible');

  const vue = describeVoiceCatalog(env).voices.find((v) => v.name === 'orpheline');
  assert.equal(vue.personaExpired, true);
  assert.equal(vue.recoverable, false, 'il faut un nouvel enregistrement, pas une reanimation');
});

test('une voix avec echantillon reste reanimable, et l ADN survit au changement de persona', () => {
  const env = catalogueTemporaire();
  upsertVoiceInCatalog({ name: 'ilyana', voiceId: 'b'.repeat(32), consentBy: 'Djeff' }, env);

  const dir = resolveVoiceSampleDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ilyana.mp3'), Buffer.from('adn'));
  upsertVoiceInCatalog({
    ...findVoiceInCatalog('ilyana', env),
    sampleFile: 'ilyana.mp3',
    sampleDurationSeconds: 45,
  }, env);

  markPersonaExpired('ilyana', 'voice persona generation failed', env);
  const morte = findVoiceInCatalog('ilyana', env);
  assert.ok(canAttemptRecovery(morte, env), 'avec un echantillon, la reanimation est possible');
  assert.equal(describeVoiceCatalog(env).voices.find((v) => v.name === 'ilyana').recoverable, true);

  // Ce que fait la reanimation reussie: nouvelle identite, meme ADN. Si l'echantillon
  // partait avec l'ancien voiceId, le deces suivant serait sans retour.
  upsertVoiceInCatalog({
    ...morte,
    voiceId: 'c'.repeat(32),
    sampleFile: morte.sampleFile,
    sampleDurationSeconds: morte.sampleDurationSeconds,
    personaExpiredAt: '',
    recoveredAt: new Date().toISOString(),
  }, env);

  const reanimee = findVoiceInCatalog('ilyana', env);
  assert.equal(reanimee.voiceId, 'c'.repeat(32), 'la persona doit avoir ete remplacee');
  assert.equal(reanimee.sampleFile, 'ilyana.mp3', 'l ADN doit survivre a la reanimation');
  assert.ok(fs.existsSync(path.join(dir, 'ilyana.mp3')), 'le fichier ne doit pas etre efface');
  assert.equal(reanimee.personaExpiredAt, '', 'la voix n est plus declaree morte');
  assert.ok(reanimee.recoveredAt, 'la reanimation est datee');
});

test('le plafond d essais empeche de bruler des credits en boucle', () => {
  const env = { ...catalogueTemporaire(), A11_PERSONA_RECOVERY_MAX_ATTEMPTS: '2' };
  upsertVoiceInCatalog({ name: 'boucle', voiceId: 'd'.repeat(32), consentBy: 'Djeff' }, env);
  const dir = resolveVoiceSampleDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'boucle.mp3'), Buffer.from('adn'));
  upsertVoiceInCatalog({
    ...findVoiceInCatalog('boucle', env),
    sampleFile: 'boucle.mp3',
    personaExpiredAt: new Date().toISOString(),
    recoveryAttempts: 2,
  }, env);

  assert.ok(!canAttemptRecovery(findVoiceInCatalog('boucle', env), env), 'apres deux echecs, on laisse la voix tranquille');
});
