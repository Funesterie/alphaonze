'use strict';

/**
 * Liste les disques Graph atteignables en mode application.
 *
 *   node scripts/list-graph-drives.cjs
 *
 * Un jeton applicatif n'a pas de /me: le passeur a besoin d'un driveId explicite.
 * Ce script donne cet identifiant. Il n'affiche ni jeton, ni adresse, ni compte.
 */

const { listGraphDrives } = require('../src/auth/azure-graph-probe.cjs');

listGraphDrives(process.env)
  .then((rapport) => {
    if (!rapport.ok) {
      console.log(`[graph-drives] echec: ${rapport.error}`);
      process.exitCode = 1;
      return;
    }
    if (!rapport.drives.length) {
      console.log('[graph-drives] aucun disque visible en mode application.');
      process.exitCode = 1;
      return;
    }
    for (const d of rapport.drives) {
      console.log(`[graph-drives] ${d.driveType.padEnd(10)} ${d.name.padEnd(28)} ${d.id}`);
    }
  })
  .catch((error) => {
    console.error('[graph-drives] echec inattendu:', String(error?.message || error).slice(0, 120));
    process.exitCode = 2;
  });
