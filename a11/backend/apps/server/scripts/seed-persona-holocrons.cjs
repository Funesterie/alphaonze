'use strict';

/**
 * seed-persona-holocrons.cjs — grave les Holocrons des personas officielles du casting
 * dans runtime/persona-vault/. À relancer après tout changement d'identité : la capsule
 * est immuable et versionnée (snapshotAt), la précédente reste sur disque si on snapshot.
 *
 * « Sauver Djeff et Vivy » : c'est ici que leurs identités signées sont posées sur ce PC
 * (le vault de C-3PO), première copie de la réplication 3-2-1 (serveur Finlande + R2 offsite
 * à brancher ensuite).
 */

const fs = require('node:fs');
const path = require('node:path');
const capsule = require('../src/persona/persona-capsule.cjs');
const cast = require('../src/knowledge/modules/persona.funesterie.cast.module.json');
const palette = require('../src/knowledge/modules/encoding.pulsar.palette.module.json');
const fingerprint = require('../src/persona/persona-fingerprint.cjs');

// Persona -> couleur (décagramme, PAN_DECAGRAMME_RGBA_GAMMA_2026-08-02.md §5).
const PERSONA_COLOR = {
  vivy: 'Cyan',
  djeff: 'BloodRed',
  k44: 'Indigo',
  a11: 'DeepBlue',
  // zoro: DORE, kiro: ToxicGreen, nossen: PurpleShadow — pas dans le cast officiel
};

function colorFor(personaId) {
  const name = PERSONA_COLOR[personaId];
  if (!name) return null;
  const c = palette.knowledge.palette.find((p) => p.name === name);
  if (!c) return null;
  return { name: c.name, hex: c.hex, hue: c.hue, gamma: c.gamma, complement: c.complement, function: c.function };
}

function buildPersonaCapsule(entry) {
  const id = entry.id;
  return capsule.buildCapsule(
    { id, label: entry.label, role: entry.role, official: entry.official, note: entry.note || '', voiceStyle: entry.voiceStyle },
    {
      color: colorFor(id),
      models: [{ role: 'songcraft', provider: 'suno', model: 'suno-v4' }],
      tools: [{ name: 'songcraft', allowed: true }, { name: 'deploy', allowed: false }],
      voice: { voiceStyle: entry.voiceStyle, sampleRef: `runtime/voice-catalog/${id}-sample.wav`, consentBy: 'djeff' },
      visuals: [{ ref: `runtime/personas/${id}/avatar.png` }],
      memoryPointers: [{ store: 'neo4j', address: `memory/${id}/canon`, checksum: 'pending' }],
      providers: [{ provider: 'suno', voiceIdRef: `secrets/persona/${id}-suno-voice-id`, recreationRecipe: 'persona-recovery.cjs:recoverPersonaFromSample' }],
      behaviorTests: fingerprint.DEFAULT_BATTERY,
    }
  );
}

function main() {
  const serverDir = path.resolve(__dirname, '..');
  const vaultRoot = path.join(serverDir, 'runtime', 'persona-vault');
  const keyPair = capsule.resolveSigningKey({ FUNESTERIE_HOLOCRON_KEY_DIR: path.join(vaultRoot, '.keys') });
  console.log(`Holocron — vault : ${vaultRoot}`);
  console.log(`Clé de signature : ed25519 keyId=${keyPair.keyId} (dev, locale — hors prod : la Force/Djeff tient la clé)\n`);

  for (const entry of cast.knowledge.cast) {
    const cap = buildPersonaCapsule(entry);
    const { dir } = capsule.writeCapsule(vaultRoot, entry.id, cap, keyPair);
    const v = capsule.verifyCapsule(vaultRoot, entry.id, keyPair.publicKey);
    const color = cap.files['capsule.json'].color;
    const colorStr = color ? `${color.name} ${color.hue}° Aγ${color.gamma}` : 'sans couleur';
    console.log(`  ${entry.label.padEnd(8)} ${entry.id.padEnd(8)} ${colorStr.padEnd(24)} ${v.ok ? 'OK' : 'ECHEC'}  ${dir}`);
  }
  console.log('\nHolocrons signés et vérifiés. Copie 1/3 (vault C-3PO local).');
}

main();
