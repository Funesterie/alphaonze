'use strict';
/**
 * verifier-voix-persona.cjs — La voix generee correspond-elle a sa description ?
 *
 * Simple interface en ligne de commande. La mesure elle-meme vit desormais dans
 * le serveur (src/music/voice-profile.cjs), parce qu'auto-dj.cjs en a besoin en
 * production : dupliquer les quatre bandes ici aurait garanti qu'un jour les
 * deux copies divergent, et que le DJ classe les voix sur une echelle differente
 * de celle qu'on verifie a la main.
 */
const path = require('path');

const SERVER = process.env.A11_SERVER_ROOT
  || path.join(__dirname, '..', 'backend', 'apps', 'server');
const { profilVocal, distanceProfils } = require(path.join(SERVER, 'src/music/voice-profile.cjs'));

function main() {
  const fichiers = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!fichiers.length) {
    console.log('usage : node verifier-voix-persona.cjs <fichier.wav> [autre.wav ...]');
    return;
  }

  const profils = [];
  for (const f of fichiers) {
    const p = profilVocal(f);
    if (!p) {
      console.error(`mesure impossible : ${f}`);
      continue;
    }
    profils.push(p);
  }
  if (!profils.length) return;

  console.log('brillance = haut medium (2-6 kHz), corps = 150-800 Hz, fond = sous 150 Hz');
  console.log('tous en dB relatifs au niveau global du fichier\n');
  console.table(profils.map((p) => ({
    fichier: p.fichier,
    brillance: p.brillance,
    corps: p.corps,
    fond: p.fond,
    densite: p.densite,
    rmsGlobal: p.rmsGlobal,
  })));

  if (profils.length > 1) {
    console.log('\ndistances deux a deux (sous 2.0, les voix risquent de se confondre) :');
    for (let i = 0; i < profils.length; i += 1) {
      for (let j = i + 1; j < profils.length; j += 1) {
        const d = distanceProfils(profils[i], profils[j]);
        console.log(`  ${profils[i].fichier} <-> ${profils[j].fichier} : ${d}${d < 2 ? '  <-- trop proches' : ''}`);
      }
    }
  }
}

if (require.main === module) main();

module.exports = { profilVocal, distanceProfils };
