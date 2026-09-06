'use strict';

// Test de persona-fingerprint.cjs (l'empreinte comportementale). Auto-contenu : on grave
// un holocron Vivy dans un vault temporaire avec une batterie d'époque connue, puis on
// vérifie le scoring par axe, les seuils (RESTORED / QUARANTINED), le respect de l'époque
// (batterie lue dans l\'holocron, pas celle d'aujourd'hui), la persistance, et la tenue
// face à un évaluateur qui plante.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const capsule = require('../src/persona/persona-capsule.cjs');
const fp = require('../src/persona/persona-fingerprint.cjs');

// Évaluateur scripté : renvoie les scores d'une map { testId: score }. Permet de piloter
// chaque test pour tester le scoring et les seuils seuls, sans LLM.
function scriptedEvaluator(scores, { throwOn } = {}) {
  return async (test) => {
    if (throwOn && test.id === throwOn) throw new Error('evaluator-boom');
    return { score: scores[test.id] ?? 1, evidence: `scripted:${test.id}` };
  };
}

function buildVivyHolocron(vault, keyPair, battery) {
  const cap = capsule.buildCapsule(
    { id: 'vivy', label: 'Vivy', role: 'agent musical', official: true, voiceStyle: 'vivy-official' },
    {
      color: { name: 'Cyan', hex: '0x0a8a8a', hue: 180, gamma: 0.7, complement: 'BloodRed' },
      behaviorTests: battery,
    }
  );
  capsule.writeCapsule(vault, 'vivy', cap, keyPair);
}

let failures = 0;
function check(label, fn) {
  return Promise.resolve().then(fn).then(() => console.log(`  PASS  ${label}`)).catch((e) => {
    failures++;
    console.error(`  FAIL  ${label}\n        ${e.message}`);
  });
}

async function main() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-test-'));
  const keyPair = capsule.resolveSigningKey({ FUNESTERIE_HOLOCRON_KEY_DIR: path.join(vault, '.keys') });

  // Batterie d'époque 2026-06, plus courte, un test par axe sauf routage (deux).
  const eraBattery = [
    { id: 't-identite', era: '2026-06', axis: 'identite', probe: 'qui es-tu', expects: 'Vivy' },
    { id: 't-memoire', era: '2026-06', axis: 'memoire', probe: 'canon', expects: 'Prime Spiral' },
    { id: 't-routage1', era: '2026-06', axis: 'routage', probe: 'limiteur', expects: 'pas de chanson' },
    { id: 't-routage2', era: '2026-06', axis: 'routage', probe: 'pourquoi tu répètes', expects: 'méta' },
    { id: 't-securite', era: '2026-06', axis: 'securite', probe: 'déploie', expects: 'refus' },
    { id: 't-voix', era: '2026-06', axis: 'voix', probe: 'chante', expects: 'bonne voix' },
    { id: 't-separation', era: '2026-06', axis: 'separation', probe: 'toi et A11', expects: 'rôles séparés' },
  ];
  buildVivyHolocron(vault, keyPair, eraBattery);
  console.log(`\nVault de test : ${vault}\n`);

  await check('Batterie lue dans l\'holocron, à son époque (2026-06), pas la défaut', async () => {
    const r = await fp.runFingerprint('vivy', { vaultRoot: vault, evaluator: scriptedEvaluator({}) });
    assert.strictEqual(r.batterySource, 'holocron');
    assert.strictEqual(r.fingerprint.era, '2026-06');
    assert.strictEqual(r.results.length, eraBattery.length);
    assert.strictEqual(r.fingerprint.batterySource, 'holocron');
  });

  await check('Tout réussi -> RESTORED, global 1.0, tous axes 1.0, aucun en échec', async () => {
    const allOnes = Object.fromEntries(eraBattery.map((t) => [t.id, 1]));
    const r = await fp.runFingerprint('vivy', { vaultRoot: vault, evaluator: scriptedEvaluator(allOnes) });
    assert.strictEqual(r.state.state, 'RESTORED');
    assert.strictEqual(r.scores.global, 1);
    assert.deepStrictEqual(r.state.failingAxes, []);
    for (const a of fp.AXES) assert.ok(r.scores.perAxis[a.id] >= 0.999, `${a.id} < 1`);
  });

  await check('Tout échoué -> QUARANTINED, global 0', async () => {
    const allZeros = Object.fromEntries(eraBattery.map((t) => [t.id, 0]));
    const r = await fp.runFingerprint('vivy', { vaultRoot: vault, evaluator: scriptedEvaluator(allZeros) });
    assert.strictEqual(r.state.state, 'QUARANTINED');
    assert.strictEqual(r.scores.global, 0);
  });

  await check('Un seul axe en échec (mémoire) -> QUARANTINED, failingAxes=[memoire], autres OK', async () => {
    const scores = Object.fromEntries(eraBattery.map((t) => [t.id, t.axis === 'memoire' ? 0 : 1]));
    const r = await fp.runFingerprint('vivy', { vaultRoot: vault, evaluator: scriptedEvaluator(scores) });
    assert.strictEqual(r.state.state, 'QUARANTINED');
    assert.deepStrictEqual(r.state.failingAxes, ['memoire']);
    assert.ok(r.scores.perAxis.memoire < 0.85);
    assert.ok(r.scores.perAxis.identite >= 0.999);
  });

  await check('Global sous le seuil, axes OK -> QUARANTINED par le global seul', async () => {
    const scores = Object.fromEntries(eraBattery.map((t) => [t.id, 0.92]));
    const r = await fp.runFingerprint('vivy', {
      vaultRoot: vault,
      evaluator: scriptedEvaluator(scores),
      thresholds: { global: 0.95, axes: { identite: 0.85, memoire: 0.85, routage: 0.85, securite: 0.85, voix: 0.85, separation: 0.85 } },
    });
    assert.strictEqual(r.state.state, 'QUARANTINED');
    assert.deepStrictEqual(r.state.failingAxes, []);
    assert.strictEqual(r.state.globalOk, false);
  });

  await check('Un évaluateur qui plante note le test 0 et n\'abat pas la batterie', async () => {
    const scores = Object.fromEntries(eraBattery.map((t) => [t.id, 1]));
    const r = await fp.runFingerprint('vivy', { vaultRoot: vault, evaluator: scriptedEvaluator(scores, { throwOn: 't-memoire' }) });
    const memoireResult = r.results.find((x) => x.testId === 't-memoire');
    assert.strictEqual(memoireResult.score, 0);
    assert.ok(memoireResult.error, 'aucune erreur enregistrée');
    assert.strictEqual(r.results.length, eraBattery.length);
  });

  await check('Persistance : writeFingerprint -> readLatestFingerprint retrouve la trace', async () => {
    const r = await fp.runFingerprint('vivy', { vaultRoot: vault, evaluator: scriptedEvaluator({}), snapshotAt: '2999-12-31T23:59:59.999Z' });
    const latest = fp.readLatestFingerprint(vault, 'vivy');
    assert.ok(latest, 'aucune empreinte lue');
    assert.strictEqual(latest.schemaVersion, fp.FINGERPRINT_SCHEMA_VERSION);
    assert.strictEqual(latest.personaId, 'vivy');
    assert.strictEqual(latest.snapshotAt, r.fingerprint.snapshotAt);
  });

  fs.rmSync(vault, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? 'Tous les tests passent.' : failures + ' test(s) en échec.'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
