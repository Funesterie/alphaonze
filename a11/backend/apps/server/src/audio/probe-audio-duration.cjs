'use strict';

/**
 * Mesure la duree reelle d'un fichier audio local, par ffprobe.
 *
 * Djeff, 09/08/2026: « je refuse de livrer un mix sans pouvoir verifier sa longueur ».
 * La duree annoncee par un fournisseur est une intention, pas une mesure: seule la
 * lecture du fichier dit ce qui a vraiment ete rendu. Sans fichier local, il n'y a
 * donc rien a verifier -- c'est pour cela que la materialisation locale et cette
 * sonde vont ensemble.
 *
 * Asynchrone volontairement. vivy-stream.cjs porte une sonde jumelle en execFileSync
 * (`probeLocalAudioDurationSeconds`), heritee et laissee en place: la remplacer en
 * plein incident ferait courir un risque a un chemin qui fonctionne. A fusionner
 * quand l'occasion se presentera, dans ce sens-ci.
 */

const fs = require('node:fs');
const { execFile } = require('node:child_process');

const PROBE_TIMEOUT_MS = 15000;

/**
 * @returns {Promise<number>} duree en secondes, 0 si non mesurable.
 *   Zero veut dire « on ne sait pas », jamais « le fichier est vide »: l'appelant
 *   doit traiter cette valeur comme une absence de mesure et non comme une mesure.
 */
function probeAudioDurationSeconds(filePath = '') {
  return new Promise((resolve) => {
    if (!filePath) return resolve(0);
    if (!fs.existsSync(filePath)) return resolve(0);

    const binaire = String(process.env.FFPROBE_BIN || 'ffprobe').trim() || 'ffprobe';
    execFile(
      binaire,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        if (error) return resolve(0);
        const duree = Number(String(stdout || '').trim());
        resolve(Number.isFinite(duree) && duree > 0 ? duree : 0);
      }
    );
  });
}

module.exports = { probeAudioDurationSeconds, PROBE_TIMEOUT_MS };
