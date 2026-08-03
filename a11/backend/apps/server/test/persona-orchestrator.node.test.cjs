'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ETATS,
  runResurrection,
  validerPointeursMemoire,
} = require(path.join(__dirname, '../src/persona/persona-recovery-orchestrator.cjs'));

const {
  estVoixMorte,
  rebindProviders,
  rebindVoix,
} = require(path.join(__dirname, '../src/persona/persona-provider-rebind.cjs'));

// Une sequence entierement verte, dont chaque test ci-dessous casse UNE piece.
const verte = () => ({
  freeze: async () => ({ ok: true, routerLevel: true, activeColorChanged: false }),
  snapshot: async () => ({ ok: true }),
  restoreCode: async () => ({ ok: true, commit: 'abc1234' }),
  restoreMemory: async () => ({ ok: true }),
  rehydrate: async () => ({
    ok: true,
    pointeurs: [{ id: 'canon', checksum: 'aa' }, { id: 'episodique', checksum: 'bb' }],
    carnets: [{ id: 'canon', checksum: 'aa' }, { id: 'episodique', checksum: 'bb' }],
  }),
  rebind: async () => ({ ok: true, toutesLiees: true, pointeurs: [] }),
  fingerprint: async () => ({ state: ETATS.RESTORED, scores: { global: 0.97 } }),
  canary: async () => ({ state: ETATS.RESTORED }),
  djeffGo: async () => ({ go: true }),
  promotion: async () => ({ ok: true, holocronReecrit: true }),
});

test('la sequence complete promeut la persona', async () => {
  const r = await runResurrection('vivy', verte());
  assert.equal(r.etat, ETATS.PROMOTED);
  assert.equal(r.promue, true);
});

test('un freeze qui n est pas au niveau routeur bloque tout', async () => {
  // §5 : « FREEZE est router-level, pas un flag ». Un booleen que le code consulte
  // poliment ne gele rien — le trafic continue d arriver pendant la resurrection.
  const e = verte();
  e.freeze = async () => ({ ok: true, routerLevel: false });
  const r = await runResurrection('vivy', e);
  assert.equal(r.etat, ETATS.QUARANTINED);
  assert.match(r.raison, /routeur/);
});

test('une bascule d active-color pendant le freeze est interdite', async () => {
  const e = verte();
  e.freeze = async () => ({ ok: true, routerLevel: true, activeColorChanged: true });
  const r = await runResurrection('vivy', e);
  assert.equal(r.etat, ETATS.QUARANTINED);
  assert.match(r.raison, /active-color/);
});

test('un carnet manquant met en QUARANTINED, jamais en RESTORED', async () => {
  // Une persona qui pointe vers un souvenir absent n est pas guerie : elle est
  // amnesique sans le savoir. C est exactement le cas des notes mem-2026-05-29
  // disparues, ou la requete rendait zero sans que rien ne signale la perte.
  const e = verte();
  e.rehydrate = async () => ({
    ok: true,
    pointeurs: [{ id: 'canon', checksum: 'aa' }, { id: 'perdu', checksum: 'cc' }],
    carnets: [{ id: 'canon', checksum: 'aa' }],
  });
  const r = await runResurrection('vivy', e);
  assert.equal(r.etat, ETATS.QUARANTINED);
  assert.match(r.raison, /perdu/);
});

test('un checksum divergent est aussi grave qu un carnet absent', async () => {
  const e = verte();
  e.rehydrate = async () => ({
    ok: true,
    pointeurs: [{ id: 'canon', checksum: 'aa' }],
    carnets: [{ id: 'canon', checksum: 'ZZ' }],
  });
  const r = await runResurrection('vivy', e);
  assert.equal(r.etat, ETATS.QUARANTINED);
  assert.match(r.raison, /checksums divergents/);
});

test('une seule voix non reliee bloque la promotion', async () => {
  // §5 : « un rebind echoue laisse en QUARANTINED, jamais en RESTORED ».
  // On ne moyenne pas : 4 voix sur 5 n est pas un succes.
  const e = verte();
  e.rebind = async () => ({ ok: true, toutesLiees: false, echecs: 1 });
  const r = await runResurrection('vivy', e);
  assert.equal(r.etat, ETATS.QUARANTINED);
  assert.match(r.raison, /voix non reliee/);
});

test('une empreinte ou un canary non verts bloquent', async () => {
  for (const etape of ['fingerprint', 'canary']) {
    const e = verte();
    e[etape] = async () => ({ state: ETATS.QUARANTINED });
    const r = await runResurrection('vivy', e);
    assert.equal(r.etat, ETATS.QUARANTINED, `${etape} rouge doit bloquer`);
  }
});

test('sans DJEFF GO la persona reste RESTORED, jamais PROMOTED', async () => {
  // L absence de reponse humaine n est PAS un oui.
  for (const reponse of [undefined, null, {}, { go: false }, { go: 'oui' }]) {
    const e = verte();
    e.djeffGo = async () => reponse;
    const r = await runResurrection('vivy', e);
    assert.equal(r.etat, ETATS.RESTORED, `djeffGo=${JSON.stringify(reponse)} ne doit pas promouvoir`);
    assert.equal(r.promue, false);
  }
  // Et une etape djeffGo absente ne vaut pas un oui non plus.
  const e = verte();
  delete e.djeffGo;
  const r = await runResurrection('vivy', e);
  assert.equal(r.etat, ETATS.RESTORED);
});

test('une promotion sans reecriture de l holocron est refusee', async () => {
  // §5 : l holocron est a la fois l entree (restore) et la sortie (promote).
  // Promouvoir sans le reecrire laisserait la prochaine resurrection repartir
  // d une version perimee.
  const e = verte();
  e.promotion = async () => ({ ok: true, holocronReecrit: false });
  const r = await runResurrection('vivy', e);
  assert.equal(r.etat, ETATS.RESTORED);
  assert.match(r.raison, /holocron/);
});

test('une etape qui plante ne fait pas tomber l orchestre', async () => {
  const e = verte();
  e.snapshot = async () => { throw new Error('neo4j injoignable'); };
  const r = await runResurrection('vivy', e);
  assert.equal(r.etat, ETATS.QUARANTINED);
  assert.ok(r.journal.some((j) => j.etape === 'snapshot' && j.ok === false));
});

test('le journal trace chaque etape franchie', async () => {
  const r = await runResurrection('vivy', verte());
  const etapes = r.journal.map((j) => j.etape);
  for (const attendue of ['freeze', 'snapshot', 'rehydrate', 'pointeurs', 'rebind', 'fingerprint', 'canary', 'djeffGo', 'promotion']) {
    assert.ok(etapes.includes(attendue), `${attendue} doit etre journalisee`);
  }
});

test('validerPointeursMemoire distingue absence et corruption', () => {
  const v = validerPointeursMemoire(
    [{ id: 'a', checksum: '1' }, { id: 'b', checksum: '2' }, { id: 'c' }],
    [{ id: 'a', checksum: '1' }, { id: 'b', checksum: 'X' }]
  );
  assert.deepEqual(v.manquants, ['c']);
  assert.deepEqual(v.corrompus, ['b']);
  assert.equal(v.valide, false);
});

// ---------------------------------------------------------------- rebind voix

test('une voix qui repond n est pas retouchee', async () => {
  let recreations = 0;
  const r = await rebindVoix({ id: 'vivy', provider: 'suno', voiceId: 'v1' }, {
    sonder: async () => ({ ok: true, voiceId: 'v1' }),
    recreer: async () => { recreations += 1; return { ok: true, voiceId: 'v2' }; },
    autoriserRecreation: true,
  });
  assert.equal(r.action, 'inchange');
  assert.equal(recreations, 0, 'idempotence : rien ne doit etre recree');
});

test('SENSITIVE_WORD_ERROR est lu comme une voix morte, pas comme un mot interdit', () => {
  // Piege reel : le provider renvoie une erreur de contenu alors que le probleme
  // est l identifiant. Chercher un mot interdit dans les paroles fait perdre des heures.
  assert.equal(estVoixMorte('SENSITIVE_WORD_ERROR'), true);
  assert.equal(estVoixMorte(new Error('voice has expired')), true);
  assert.equal(estVoixMorte('quota exceeded'), false);
});

test('une voix expiree n est pas recreee sans autorisation explicite', async () => {
  // La recreation coute des credits. Elle ne doit jamais partir toute seule.
  const r = await rebindVoix({ id: 'vivy', provider: 'suno', voiceId: 'v1', samplePath: '/x.wav' }, {
    sonder: async () => ({ ok: false, error: new Error('voice has expired') }),
    recreer: async () => ({ ok: true, voiceId: 'v2' }),
  });
  assert.equal(r.action, 'echec');
  assert.match(r.raison, /non autorisee/);
});

test('une voix expiree sans echantillon local ne peut pas etre refaite', async () => {
  const r = await rebindVoix({ id: 'vivy', provider: 'suno', voiceId: 'v1' }, {
    sonder: async () => ({ ok: false, error: new Error('voice has expired') }),
    recreer: async () => ({ ok: true, voiceId: 'v2' }),
    autoriserRecreation: true,
  });
  assert.equal(r.action, 'echec');
  assert.match(r.raison, /echantillon/);
});

test('rebindProviders ne declare toutesLiees que si aucune voix n echoue', async () => {
  const voix = [
    { id: 'a', provider: 'suno', voiceId: 'v1' },
    { id: 'b', provider: 'suno', voiceId: 'v2' },
  ];
  const bon = await rebindProviders(voix, { sonder: async (v) => ({ ok: true, voiceId: v.voiceId }) });
  assert.equal(bon.toutesLiees, true);
  assert.equal(bon.inchangees, 2);

  const mauvais = await rebindProviders(voix, {
    sonder: async (v) => (v.id === 'a' ? { ok: true, voiceId: 'v1' } : { ok: false, error: new Error('voice has expired') }),
  });
  assert.equal(mauvais.toutesLiees, false, '4 voix sur 5 n est pas un succes');
  assert.equal(mauvais.echecs, 1);
});

test('un id qui a change est recable et remonte dans les pointeurs', async () => {
  const r = await rebindProviders([{ id: 'vivy', provider: 'suno', voiceId: 'ancien' }], {
    sonder: async () => ({ ok: true, voiceId: 'neuf' }),
  });
  assert.equal(r.toutesLiees, true);
  assert.equal(r.modifiees, 1);
  assert.deepEqual(r.pointeurs, [{ voix: 'vivy', provider: 'suno', voiceId: 'neuf', ancienId: 'ancien' }]);
});

test('une liste de voix vide ne vaut pas un rebind reussi', async () => {
  const r = await rebindProviders([], { sonder: async () => ({ ok: true }) });
  assert.equal(r.toutesLiees, false, 'rien a relier n est pas la meme chose que tout est relie');
});
