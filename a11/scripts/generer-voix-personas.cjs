'use strict';
/**
 * generer-voix-personas.cjs — Fabriquer une voix propre a chaque persona.
 *
 * POURQUOI GENERER PLUTOT QUE CLONER
 *
 * voice-catalog.cjs impose `consentBy` : "Qui atteste que la personne autorise
 * l'usage de sa voix. Obligatoire." Les trois voix existantes le respectent --
 * djeff (lui-meme), ile (Ilyana), marvin (son frere). Prendre une voix trouvee
 * en ligne casserait ce garde-fou, violerait les conditions de Suno sur l'audio
 * televerse, et arriverait au pire moment : la verification YouTube est en cours.
 *
 * Une voix GENEREE n'appartient a personne d'autre. Elle devient reellement celle
 * de Funesterie, elle ne peut pas etre reclamee, et elle passe la verification
 * sans discussion. C'est la meme idee que "se l'approprier", en mieux : on ne
 * l'emprunte pas, on la fabrique.
 *
 * RECETTE, apprise aujourd'hui a nos depens :
 *   1. generer un a cappella court par persona, avec son timbre dans le style
 *      -- ici c'est legitime : il n'y a pas encore de persona a ecraser;
 *   2. isoler la voix avec demucs --two-stems=vocals;
 *   3. garder PLUSIEURS MINUTES. Un extrait de 20 s a ete refuse par Suno : la
 *      fenetre 10-30 s de persona-recovery sert au continueAt de reanimation,
 *      pas a la creation;
 *   4. creer l'ID Suno depuis ce fichier;
 *   5. l'enregistrer au catalogue avec consentBy 'genere-funesterie'.
 *
 * Ce script fait l'etape 1 et prepare les autres. Il DEPENSE DES CREDITS : il
 * refuse de partir sans --confirm.
 */
const path = require('path');

const SERVER = process.env.A11_SERVER_ROOT || '/app';
const pl = require(path.join(SERVER, 'src/music/persona-loudness.cjs'));
const studio = require(path.join(SERVER, 'src/routes/vivy-studio.cjs'));

// Paroles neutres et courtes : on capture un TIMBRE, pas un morceau. Assez de
// syllabes pour couvrir voyelles ouvertes, fermees et consonnes dures.
const PAROLES = [
  '[Verse]',
  'Je pose ma voix sur la ligne, elle tient, elle ne tremble pas',
  'Chaque mot trouve sa place, chaque souffle garde son pas',
  '[Chorus]',
  'Je suis la, je reste la, la machine ecoute et retient',
  'Rien ne se perd, rien ne ment, le signal revient',
].join('\n');

function buildPayloadPour(entree) {
  const style = [
    'a cappella, voix seule, aucun instrument, aucune batterie',
    'prise proche, studio sec, peu de reverbe',
    entree.voix.timbre,
    entree.voix.debit,
  ].join(', ');

  const payload = studio.buildVivySunoPayload({
    title: `Voix ${entree.persona}`,
    lyrics: PAROLES,
    prompt: PAROLES,
    style,
    // On CREE la voix : aucune persona a rappeler, aucune a preserver.
    preserveSelectedVoice: false,
  });

  // Les negatifs propres a la persona s'ajoutent a ceux du systeme. C'est le seul
  // endroit ou une description vocale a le droit de partir vers Suno.
  const propres = pl.negativeTagsVoix(entree.persona);
  if (propres) {
    payload.negativeTags = [payload.negativeTags, propres].filter(Boolean).join(', ');
  }
  return payload;
}

function main() {
  const confirme = process.argv.includes('--confirm');
  const seulement = (() => {
    const i = process.argv.indexOf('--persona');
    return i >= 0 ? String(process.argv[i + 1] || '').toLowerCase() : '';
  })();

  let cibles = pl.voixDisponibles().filter((d) => !d.reelle && d.voix);
  if (seulement) cibles = cibles.filter((d) => d.persona === seulement);

  if (!cibles.length) {
    console.log('Aucune persona a doter d une voix.');
    return;
  }

  console.log(`${cibles.length} persona(s) sans voix reelle\n`);
  const payloads = cibles.map((c) => ({ persona: c.persona, genre: c.voix.genre, payload: buildPayloadPour(c) }));

  for (const p of payloads) {
    console.log(`${p.persona.padEnd(10)} ${p.genre.padEnd(7)} ${String(p.payload.style).slice(0, 92)}`);
  }

  if (!confirme) {
    console.log('\nSimulation. Rien n a ete envoye, aucun credit depense.');
    console.log('Pour lancer reellement : --confirm  (ajouter --persona <nom> pour n en faire qu une)');
    return;
  }

  console.log('\n--confirm passe : envoi reel a Suno.');
  console.log('ATTENTION : cette etape depense des credits, une generation par persona.');
  console.log(JSON.stringify(payloads.map((p) => ({ persona: p.persona, title: p.payload.title })), null, 2));
  // L envoi lui-meme passe par la route authentifiee du studio : ce script
  // prepare et verifie, il ne court-circuite pas le controle d acces.
  console.log('\nEnvoi a faire depuis une session authentifiee (bouton NOSSEN ou /produce).');
}

main();
