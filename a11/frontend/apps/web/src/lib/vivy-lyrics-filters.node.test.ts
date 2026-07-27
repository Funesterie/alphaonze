/**
 * Corpus de non-regression des filtres de paroles.
 *
 * Idee de Djeff, apres trois pannes d'affilee dues a ces filtres: « tu testes tous les
 * types de chanson pour detecter tous les filtres ». Le corpus couvre les styles reels
 * du projet -- cypher, freestyle technique, moto, chanson douce, chanson sur la musique,
 * pop -- et verifie les deux sens: aucune parole perdue, toutes les consignes coupees.
 *
 * Les filtres sont importes, jamais recopies: une copie des regex dans un script de test
 * derive du code reel, et le resultat devient faux sans prevenir.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { foldForLookup } from "./language.ts";
import {
  looksLikeVivyNossenTechnicalMediaLine,
  isVivyNossenSonicStyleLine,
  isVivyNossenStructureInstructionLine,
  looksLikeVivyNossenOperatorNoiseLine,
} from "./vivy-lyrics-filters.ts";

/** Chaine complete, telle que sanitizeVivyNossenSongSeed l'applique ligne par ligne. */
function estCoupee(ligne: string): boolean {
  const t = ligne.trim();
  if (!t) return false;
  if (/^\[[^\]]+\]$/.test(t)) return false;
  return looksLikeVivyNossenTechnicalMediaLine(t)
    || isVivyNossenSonicStyleLine(t)
    || isVivyNossenStructureInstructionLine(t)
    || looksLikeVivyNossenOperatorNoiseLine(foldForLookup(t));
}

const PAROLES: Record<string, string[]> = {
  "cypher / punchlines": [
    "Micro proche, sourire de coin, je rentre sans demander",
    "Je te mets KO avant la fin du premier couplet",
    "Ils veulent ma peau, ils sont encore en tuto",
    "Je garde le flow froid, le verdict tombe bientot",
    "Mon secret tient dans la doublure de ma veste",
    "Le beat est generique, moi je reste unique",
    "Si le cypher prend feu, c'est que j'ai ferme le tour",
    "J'envoie le son, la salle se leve d'un coup",
  ],
  "freestyle technique": [
    "Equation systematique, je fais des proverbes mathematiques",
    "La racine de tous les problemes, facteur de gravite",
    "Ils confondent la course et la notice de montage",
    "J'ai deja pris le virage pendant qu'ils lisent la page",
    "Je repete jamais deux fois la meme rime",
    "Ma reponse tombe avant meme leur question",
    "Il sort son flow comme on sort une lame",
  ],
  "moto et course": [
    "Le moteur tousse et repart, il connait mieux que moi la route",
    "Pignon, couronne, chaine tendue sur le bitume",
    "Radiateur bouillant, je coupe les gaz dans la descente",
    "Je fais un stoppie devant le peage",
  ],
  "chanson douce": [
    "La nuit descend sur le boulevard, les phares decoupent la buee",
    "Je compte les feux rouges comme on compte les annees",
    "Ta reponse tenait en un regard, je n'ai rien ajoute",
    "Le telephone sonne dans le vide de la cuisine",
    "On garde le cap meme quand la route se derobe",
    "Le dernier mot reste au micro, pas au public",
  ],
  "chanson sur la musique": [
    "La basse, la batterie, le rap qui monte dans la piece",
    "Guitares saturees, synthes qui pleurent, voix qui se casse",
    "Ma voix est ma flamme, elle monte dans le ciel",
    "Je mets l'ambiance avant meme le premier couplet",
  ],
  "pop et refrain": [
    "On avance, on avance, meme quand la route se derobe",
    "On avance, on avance, jusqu'au bout de la nuit",
    "Et le jour finit toujours par venir",
  ],
};

const CONSIGNES: string[] = [
  "Consigne: ecris une vraie chanson complete",
  "mets de l'action dans le theme",
  "quand tu es prete envoie le son",
  "Utilise le tag exact [Vivy]",
  "CONTRAT_COMPOSITION_NOSSEN",
  "on garde le refrain tel quel",
  "Style sonore: epic cinematic dark pop, female vocal, 120 bpm",
  "Le bouton NOSSEN ne marche pas, corrige le prompt",
  "https://vivy.funesterie.me/api/double-harmonic/out/1785159811162.mp3",
  "Casting verrouille: Djeff seul",
  "Origine de matiere: canevas composition",
];

for (const [style, lignes] of Object.entries(PAROLES)) {
  test(`aucune parole perdue: ${style}`, () => {
    const perdues = lignes.filter(estCoupee);
    assert.deepEqual(
      perdues,
      [],
      `${perdues.length} parole(s) supprimee(s) par les filtres`
    );
  });
}

test("les consignes reelles restent coupees", () => {
  const passees = CONSIGNES.filter((ligne) => !estCoupee(ligne));
  assert.deepEqual(passees, [], "des consignes atteindraient Suno et seraient chantees");
});

test("la structure survit au filtrage, minimum dix lignes", () => {
  // isValidVivyNossenSongSeed exige au moins dix lignes de paroles. C'est en passant
  // sous ce seuil que la production s'arretait sur paroles_vivy_invalides.
  const chanson = [...PAROLES["cypher / punchlines"], ...PAROLES["chanson douce"]];
  const restantes = chanson.filter((ligne) => !estCoupee(ligne));
  assert.ok(
    restantes.length >= 10,
    `${restantes.length} lignes restantes sur ${chanson.length}, minimum 10`
  );
});

test("une consigne de style dense est coupee, une parole sur la musique non", () => {
  // Le seuil n'est pas le nombre de mots de musique mais leur densite: une consigne
  // est une liste d'etiquettes, une parole les dilue dans une phrase.
  assert.ok(isVivyNossenSonicStyleLine("epic cinematic dark pop, female vocal, 120 bpm"));
  assert.ok(!isVivyNossenSonicStyleLine("La basse, la batterie, le rap qui monte dans la piece"));
});

test("les mots francais courants ne suffisent plus a couper une ligne", () => {
  // Chacun de ces mots a fait disparaitre une vraie parole avant d'etre corrige.
  for (const mot of ["ko", "secret", "reponse", "repete", "telephone", "generique"]) {
    const ligne = `Dans la nuit je pense a ce ${mot} qui traine encore`;
    assert.ok(!estCoupee(ligne), `le mot "${mot}" coupe encore une parole`);
  }
});
