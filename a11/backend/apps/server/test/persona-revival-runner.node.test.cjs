'use strict';

/**
 * Le balayage doit reanimer ce qui est mort, et surtout ne rien depenser d'autre.
 *
 * Chaque reanimation coute une generation Suno reelle (12 credits mesures sur Ile le
 * 08/08/2026). Un runner trop zele est donc un runner qui coute de l'argent: les
 * tests ci-dessous portent moins sur « est-ce que ca reanime » que sur « qu'est-ce
 * que ca refuse de tenter ».
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'funesterie-reanim-'));
const ENV = { ...process.env, A11_VOICE_CATALOG_FILE: path.join(dossier, 'voice-catalog.json') };

const { upsertVoiceInCatalog } = require('../src/music/voice-catalog.cjs');
const {
  runExpiredPersonaRevival,
  listRevivableVoices,
  needsRevival,
} = require('../src/music/persona-revival-runner.cjs');

const MORTE = '2026-08-08T18:29:31.298Z';

upsertVoiceInCatalog({
  name: 'morte-avec-adn',
  voiceId: '50f63c18626119450e2b491ebfcbdae3',
  consentBy: 'test@funesterie.me',
  sampleFile: 'morte.mp3',
  personaExpiredAt: MORTE,
}, ENV);

upsertVoiceInCatalog({
  name: 'morte-sans-adn',
  voiceId: 'aa63c18626119450e2b491ebfcbdae31',
  consentBy: 'test@funesterie.me',
  sampleFile: '',
  personaExpiredAt: MORTE,
}, ENV);

upsertVoiceInCatalog({
  name: 'vivante',
  voiceId: 'b3f2a1be02a5198149888aaeccdb77b5',
  consentBy: 'test@funesterie.me',
  sampleFile: 'vivante.mp3',
}, ENV);

test('seule une voix morte, active et pourvue de son ADN merite une reanimation', () => {
  const noms = listRevivableVoices(ENV).map((v) => v.name);
  assert.deepEqual(noms, ['morte-avec-adn']);

  // Sans echantillon, il n'y a rien a reinjecter chez Suno: tenter reviendrait a
  // bruler une des deux chances autorisees pour rien.
  assert.equal(needsRevival({ active: true, personaExpiredAt: MORTE, sampleFile: '' }, ENV), false);
  // Une voix vivante n'a rien a refabriquer.
  assert.equal(needsRevival({ active: true, sampleFile: 'x.mp3' }, ENV), false);
  // Une voix retiree du catalogue ne doit pas consommer de credits.
  assert.equal(needsRevival({ active: false, personaExpiredAt: MORTE, sampleFile: 'x.mp3' }, ENV), false);
});

test('le plafond d essais et le delai coupent la reanimation', () => {
  // Deux essais deja consommes: la voix attend une main humaine, pas une boucle.
  assert.equal(needsRevival({
    active: true, personaExpiredAt: MORTE, sampleFile: 'x.mp3', recoveryAttempts: 2,
  }, ENV), false);

  // Un essai il y a une minute: le delai de 6 h n'est pas ecoule.
  assert.equal(needsRevival({
    active: true,
    personaExpiredAt: MORTE,
    sampleFile: 'x.mp3',
    recoveryAttempts: 1,
    recoveryLastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
  }, ENV), false);
});

test('sans cle Suno la campagne ne tente rien', async () => {
  const r = await runExpiredPersonaRevival({ apiKey: '', buildSampleUrl: () => 'https://x', env: ENV });
  assert.equal(r.skipped, 'cle_suno_absente');
  assert.equal(r.treated, 0);
});

test('sans constructeur d URL la campagne ne tente rien', async () => {
  const r = await runExpiredPersonaRevival({ apiKey: 'k', env: ENV });
  assert.equal(r.skipped, 'constructeur_url_absent');
  assert.equal(r.treated, 0);
});

test('une URL d echantillon vide est refusee avant tout appel a Suno', async () => {
  // Le cas concret: secret de signature absent. Suno recevrait un 404 et la
  // tentative serait perdue. On s'arrete avant, et on le dit.
  const r = await runExpiredPersonaRevival({
    apiKey: 'k',
    baseUrl: 'https://exemple.invalide/api/v1',
    buildSampleUrl: () => '',
    callBackUrl: 'https://exemple.invalide/callback',
    env: ENV,
  });
  assert.equal(r.treated, 1);
  assert.equal(r.résultats[0].name, 'morte-avec-adn');
  assert.equal(r.résultats[0].ok, false);
  assert.equal(r.résultats[0].error, 'sample_share_not_configured');
});

test('le budget de campagne borne le nombre de voix traitees', async () => {
  upsertVoiceInCatalog({
    name: 'deuxieme-morte',
    voiceId: 'cc63c18626119450e2b491ebfcbdae32',
    consentBy: 'test@funesterie.me',
    sampleFile: 'deuxieme.mp3',
    personaExpiredAt: MORTE,
  }, ENV);
  assert.equal(listRevivableVoices(ENV).length, 2, 'deux voix sont bien reanimables');

  const r = await runExpiredPersonaRevival({
    apiKey: 'k',
    baseUrl: 'https://exemple.invalide/api/v1',
    buildSampleUrl: () => '',
    callBackUrl: 'https://exemple.invalide/callback',
    env: { ...ENV, A11_PERSONA_REVIVAL_MAX_PER_RUN: '1' },
  });
  assert.equal(r.treated, 1, 'une seule par campagne: chaque reanimation coute des credits');
});
