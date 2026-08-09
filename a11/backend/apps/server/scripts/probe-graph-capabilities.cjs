'use strict';

/**
 * Rapport lisible des capacites Microsoft Graph de l'application Funesterie.
 *
 *   node scripts/probe-graph-capabilities.cjs
 *
 * Repond a une seule question: Vivy peut-elle atteindre le disque en mode
 * application, donc sans utilisateur connecte et sans jeton a rafraichir ?
 * N'affiche ni jeton, ni secret, ni message Graph brut.
 */

const {
  probeGraphCapabilities,
  formatGraphCapabilities,
} = require('../src/auth/azure-graph-probe.cjs');

probeGraphCapabilities(process.env)
  .then((rapport) => {
    for (const ligne of formatGraphCapabilities(rapport)) console.log(ligne);
    // Code de sortie utile en CI: 0 si le disque est joignable, 1 sinon.
    process.exitCode = rapport.driveUtilisable ? 0 : 1;
  })
  .catch((error) => {
    console.error('[graph-probe] echec inattendu:', String(error?.message || error).slice(0, 120));
    process.exitCode = 2;
  });
