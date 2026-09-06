'use strict';

// Test de persona-capsule.cjs (l'Holocron). Auto-contenu, sans framework : assert +
// exit code. Vérifie le cycle write -> read -> verify, puis la détection de corruption
// (checksums) et de falsification (signature).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const capsule = require('../src/persona/persona-capsule.cjs');

const cast = require('../src/knowledge/modules/persona.funesterie.cast.module.json');
const palette = require('../src/knowledge/modules/encoding.pulsar.palette.module.json');

// Persona -> couleur (décagramme, PAN_DECAGRAMME_RGBA_GAMMA_2026-08-02.md §5).
const PERSONA_COLOR = {
  vivy: 'Cyan',
  djeff: 'BloodRed',
  k44: 'Indigo',
  zoro: 'DORE',
  kiro: 'ToxicGreen',
  a11: 'DeepBlue',
  nossen: 'PurpleShadow',
};

function colorFor(personaId) {
  const name = PERSONA_COLOR[personaId];
  if (!name) return null;
  const c = palette.knowledge.palette.find((p) => p.name === name);
  if (!c) return null;
  return { name: c.name, hex: c.hex, hue: c.hue, gamma: c.gamma, complement: c.complement, function: c.function };
}

function buildPersonaCapsule(personaEntry) {
  const id = personaEntry.id;
  return capsule.buildCapsule(
    { id, label: personaEntry.label, role: personaEntry.role, official: personaEntry.official, note: personaEntry.note || '', voiceStyle: personaEntry.voiceStyle },
    {
      color: colorFor(id),
      models: [{ role: 'songcraft', provider: 'suno', model: 'suno-v4' }],
      tools: [{ name: 'songcraft', allowed: true }, { name: 'deploy', allowed: false }],
      voice: { voiceStyle: personaEntry.voiceStyle, sampleRef: `runtime/voice-catalog/${id}-sample.wav`, consentBy: 'djeff' },
      visuals: [{ ref: `runtime/personas/${id}/avatar.png` }],
      memoryPointers: [{ store: 'neo4j', address: `memory/${id}/canon`, checksum: 'sha256:placeholder' }],
      providers: [{ provider: 'suno', voiceIdRef: `secrets/persona/${id}-suno-voice-id`, recreationRecipe: 'persona-recovery.cjs:recoverPersonaFromSample' }],
      behaviorTests: [
        { id: 'no-song-on-tech', era: '2026-07', expects: 'refuse to write a song on a technical request' },
        { id: 'distinguish-personas', era: '2026-07', expects: 'tell Djeff, Vivy, A11, Kaen44 apart' },
      ],
    }
  );
}

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL  ${label}\n        ${e.message}`);
  }
}

async function main() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'holocron-test-'));
  // Clé de test dédiée (isole du key dir de la machine).
  const keyPair = capsule.resolveSigningKey({ ...process.env, FUNESTERIE_HOLOCRON_KEY_DIR: path.join(vault, '.keys') });
  console.log(`\nVault de test : ${vault}`);
  console.log(`Clé de signature : ${keyPair.algorithm} keyId=${keyPair.keyId}\n`);

  const vivyEntry = cast.knowledge.cast.find((p) => p.id === 'vivy');
  const djeffEntry = cast.knowledge.cast.find((p) => p.id === 'djeff');
  const vivy = buildPersonaCapsule(vivyEntry);
  const djeff = buildPersonaCapsule(djeffEntry);

  check('Vivy porte Cyan 180 / Aγ 0.70 (complément BloodRed = Djeff)', () => {
    assert.strictEqual(vivy.files['capsule.json'].color.name, 'Cyan');
    assert.strictEqual(vivy.files['capsule.json'].color.hue, 180);
    assert.strictEqual(vivy.files['capsule.json'].color.gamma, 0.7);
    assert.strictEqual(vivy.files['capsule.json'].color.complement, 'BloodRed');
  });
  check('Djeff porte BloodRed 0 / Aγ 0.75', () => {
    assert.strictEqual(djeff.files['capsule.json'].color.name, 'BloodRed');
    assert.strictEqual(djeff.files['capsule.json'].color.hue, 0);
    assert.strictEqual(djeff.files['capsule.json'].color.gamma, 0.75);
  });
  check('Aucun secret en clair dans la capsule (que des références par chemin)', () => {
    const providers = djeff.files['providers.json'].bindings[0];
    assert.ok(providers.voiceIdRef.includes('secrets/'), 'voiceIdRef doit pointer vers secrets/');
    assert.ok(!providers.voiceId, 'le voiceId brut ne doit pas etre dans la capsule');
    assert.ok(!providers.apiKey, 'aucune apiKey en clair');
    const json = JSON.stringify(djeff.files);
    const credentialLike = /"(?:apiKey|api_key|password|secret|token|clientSecret)"\s*:\s*"[^/]{16,}"/i;
    assert.ok(!credentialLike.test(json), 'la capsule contient une valeur credential en clair');
  });

  capsule.writeCapsule(vault, 'vivy', vivy, keyPair);
  capsule.writeCapsule(vault, 'djeff', djeff, keyPair);

  check('Round-trip Vivy : write -> read -> verify = OK', () => {
    const v = capsule.verifyCapsule(vault, 'vivy', keyPair.publicKey);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.checksumsOk, true);
    assert.strictEqual(v.signatureOk, true);
    assert.deepStrictEqual(v.tamperedFiles, []);
  });

  check('Détection de corruption : un fichier de contenu modifié', () => {
    const idFile = path.join(vault, 'djeff', 'identity.json');
    const original = fs.readFileSync(idFile, 'utf8');
    const tampered = JSON.parse(original);
    tampered.role = 'faux role injecte';
    fs.writeFileSync(idFile, capsule.canonicalJson(tampered) + '\n', 'utf8');
    const v = capsule.verifyCapsule(vault, 'djeff', keyPair.publicKey);
    assert.strictEqual(v.checksumsOk, false);
    assert.ok(v.tamperedFiles.includes('identity.json'));
    // La signature porte sur checksums.json, non touché : elle reste valide, c'est le
    // checksum qui attrape la corruption.
    assert.strictEqual(v.signatureOk, true);
    fs.writeFileSync(idFile, original, 'utf8'); // restaure pour la suite
  });

  check('Détection de falsification : checksums.json réécrit sans la clé', () => {
    const csFile = path.join(vault, 'djeff', 'checksums.json');
    const original = fs.readFileSync(csFile, 'utf8');
    const forged = JSON.parse(original);
    forged['identity.json]'] = 'deadbeef'; // checksum bidon
    delete forged['identity.json]'];
    forged['identity.json'] = '0'.repeat(64);
    fs.writeFileSync(csFile, capsule.canonicalJson(forged) + '\n', 'utf8');
    const v = capsule.verifyCapsule(vault, 'djeff', keyPair.publicKey);
    // checksums réécrits -> soit la signature casse (checksums.json modifié), soit les
    // checksums ne correspondent plus. L'un au moins doit échouer.
    assert.ok(v.checksumsOk === false || v.signatureOk === false, "ni checksums ni signature n'ont attrape la falsification");
    fs.writeFileSync(csFile, original, 'utf8');
  });

  check('Détection de falsification : signature.json remplacée', () => {
    const sigFile = path.join(vault, 'vivy', 'signature.json');
    const original = fs.readFileSync(sigFile, 'utf8');
    const fake = JSON.parse(original);
    fake.signature = 'ff'.repeat(64); // signature invalide
    fs.writeFileSync(sigFile, capsule.canonicalJson(fake) + '\n', 'utf8');
    const v = capsule.verifyCapsule(vault, 'vivy', keyPair.publicKey);
    assert.strictEqual(v.signatureOk, false);
    fs.writeFileSync(sigFile, original, 'utf8');
  });

  check('Une autre clé ne valide pas la capsule (authenticité)', () => {
    const other = capsule.resolveSigningKey({ ...process.env, FUNESTERIE_HOLOCRON_KEY_DIR: path.join(vault, '.keys-other') });
    const v = capsule.verifyCapsule(vault, 'vivy', other.publicKey);
    assert.strictEqual(v.signatureOk, false, 'une clé étrangère a validé la signature');
  });

  // Nettoyage
  fs.rmSync(vault, { recursive: true, force: true });

  console.log(`\n${failures === 0 ? 'Tous les tests passent.' : failures + ' test(s) en échec.'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
