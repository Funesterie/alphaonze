'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  MAX_PREMIUM_PAR_MORCEAU,
  buildSingerRegistry,
  describeSingers,
  pickSingers,
} = require(path.join(__dirname, '../src/music/vivy-singer-selection.cjs'));

const OFFICIELS = [
  { id: 'djeff', label: 'Djeff', role: 'couplets rap techniques' },
  { id: 'marvin', label: 'Marvin', role: 'refrains rap-chantes' },
  { id: 'vivy', label: 'Vivy', role: 'lead feminin' },
];

const CATALOGUE = [
  { name: 'djeff', voiceId: 'b3f2a1be', sampleFile: 'djeff.mp3', sampleDurationSeconds: 17 },
  { name: 'ile', voiceId: '50f63c18', sampleFile: 'ile.mp3', sampleDurationSeconds: 16 },
  { name: 'marvin', voiceId: '4b98e1bb', sampleFile: '' },
  { name: 'morte', voiceId: 'cc89170f', sampleFile: 'morte.mp3', personaExpiredAt: '2026-07-30T11:07:29.447Z' },
];

test('choisir une voix premium ne grise plus les officiels', () => {
  // Regression du 03/08 : dans l'interface, cocher une voix du catalogue posait
  // voixPremiumTientLeRole=true et desactivait TOUS les officiels, Vivy comprise.
  // Le motif etait bon (une persona par morceau) mais la sanction trop large : les
  // officiels n'utilisent pas de persona Suno, ils ne consomment rien.
  const reg = buildSingerRegistry({ officiels: OFFICIELS, catalogue: CATALOGUE });
  const r = pickSingers(reg, { souhaites: ['ile', 'vivy', 'marvin'] });
  assert.equal(r.utilisable, true);
  const ids = r.retenus.map((x) => x.id);
  assert.ok(ids.includes('ile'), 'la voix premium est retenue');
  assert.ok(ids.includes('vivy'), 'Vivy ne doit plus etre exclue par la premium');
  assert.equal(r.premiumUtilisee, 'ile');
});

test('au plus une voix premium par morceau — la seconde est ecartee, pas le morceau', () => {
  const reg = buildSingerRegistry({ officiels: OFFICIELS, catalogue: CATALOGUE });
  const r = pickSingers(reg, { souhaites: ['ile', 'djeff'] });
  assert.equal(MAX_PREMIUM_PAR_MORCEAU, 1);
  assert.equal(r.retenus.filter((x) => x.consommePersona).length, 1);
  assert.ok(r.ecartes.some((e) => /une persona par morceau/.test(e.motif)));
  assert.equal(r.utilisable, true, 'ecarter une voix ne doit pas tuer le morceau');
});

test('une persona expiree est ecartee avec son motif, et on rechoisit', () => {
  // C'est ce qui a tue Djeff pendant quatre jours : la voix morte etait servie
  // quand meme, et la generation echouait chez Suno sans que rien ne l'explique.
  const reg = buildSingerRegistry({ officiels: OFFICIELS, catalogue: CATALOGUE });
  const r = pickSingers(reg, { souhaites: ['morte'] });
  assert.ok(r.ecartes.some((e) => e.id === 'morte' && /expiree/.test(e.motif)));
  assert.equal(r.utilisable, true, 'un repli doit avoir pris le relais');
  assert.ok(r.replis.length >= 1);
});

test('le repli prend un officiel avant une premium', () => {
  // Un officiel ne consomme pas de persona : il ne peut jamais faire echouer
  // le morceau. C'est donc le repli le plus sur.
  const reg = buildSingerRegistry({ officiels: OFFICIELS, catalogue: CATALOGUE });
  const r = pickSingers(reg, { souhaites: ['inexistant'] });
  assert.equal(r.utilisable, true);
  assert.equal(r.retenus[0].consommePersona, false, 'un officiel doit passer en premier');
});

test('un chanteur inconnu est signale sans arreter le casting', () => {
  const reg = buildSingerRegistry({ officiels: OFFICIELS, catalogue: CATALOGUE });
  const r = pickSingers(reg, { souhaites: ['zoro', 'vivy'] });
  assert.ok(r.ecartes.some((e) => e.id === 'zoro' && /inconnu/.test(e.motif)));
  assert.ok(r.retenus.some((x) => x.id === 'vivy'));
});

test('Djeff est a la fois officiel et premium sans etre compte deux fois', () => {
  const reg = buildSingerRegistry({ officiels: OFFICIELS, catalogue: CATALOGUE });
  assert.equal(reg.filter((r) => r.id === 'djeff').length, 1);
  const d = reg.find((r) => r.id === 'djeff');
  assert.equal(d.kind, 'premium', 'sa voix du catalogue prime');
  assert.equal(d.label, 'Djeff', 'mais il garde son libelle officiel');
  assert.equal(d.adnSecondes, 17);
});

test('une voix sans echantillon est utilisable mais signalee fragile', () => {
  // Marvin : la voix vit, mais sans ADN elle sera irrecuperable le jour ou elle
  // expirera. On ne l'interdit pas, on le dit.
  const reg = buildSingerRegistry({ officiels: OFFICIELS, catalogue: CATALOGUE });
  const m = reg.find((r) => r.id === 'marvin');
  assert.equal(m.disponible, true);
  assert.equal(m.fragile, true);
  const listing = describeSingers(reg).find((x) => x.id === 'marvin');
  assert.match(listing.note, /irrecuperable/);
});

test('le listing dit pour chacun s il est disponible et pourquoi', () => {
  const listing = describeSingers(buildSingerRegistry({ officiels: OFFICIELS, catalogue: CATALOGUE }));
  const morte = listing.find((x) => x.id === 'morte');
  assert.equal(morte.disponible, false);
  assert.match(morte.note, /indisponible — persona expiree/);
  assert.equal(listing.find((x) => x.id === 'vivy').disponible, true);
});

test('sans aucun chanteur disponible, le morceau n est pas declare utilisable', () => {
  // Mieux vaut refuser tot que d envoyer un morceau sans voix chez Suno.
  const reg = buildSingerRegistry({ officiels: [], catalogue: [CATALOGUE[3]] });
  const r = pickSingers(reg, { souhaites: ['morte'] });
  assert.equal(r.utilisable, false);
  assert.equal(r.retenus.length, 0);
});

test('la limite de voix est respectee', () => {
  const reg = buildSingerRegistry({ officiels: OFFICIELS, catalogue: CATALOGUE });
  const r = pickSingers(reg, { souhaites: ['vivy', 'marvin', 'djeff'], maxVoix: 2 });
  assert.equal(r.retenus.length, 2);
});
