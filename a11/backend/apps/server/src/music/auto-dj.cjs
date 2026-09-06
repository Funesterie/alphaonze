'use strict';

/**
 * auto-dj.cjs — Quelle voix chante quelle section, sans qu'on la choisisse.
 *
 * POURQUOI UN QUATERNION ET PAS UN SCORE
 *
 * Un morceau et une voix se decrivent tous les deux sur QUATRE axes, et ces axes
 * ne sont pas interchangeables : une voix trop brillante ne se rattrape pas avec
 * plus de grave. Un score unique les melange et perd cette information. Le
 * quaternion garde les quatre axes distincts, et sa rotation `q' = u q u¯¹` les
 * redistribue sans les confondre — c'est exactement la raison donnee dans
 * docs/research/audio/V11_PAN_INTEGRAL_PROCESS_2026-08-05.md §9.1.
 *
 * Les axes, repris de ce document (`q = r + i·v + j·p + k·s`) :
 *
 *   r  energie de base   morceau: section.energy    voix: densite (RMS/peak)
 *   v  voix              morceau: section.medium    voix: corps (150-800 Hz)
 *   p  phase/resonance   morceau: section.grave     voix: fond (sous 150 Hz)
 *   s  espace            morceau: section.aigu      voix: brillance (2-6 kHz)
 *
 * Cote morceau les valeurs viennent de song-teardown.cjs, cote voix de
 * verifier-voix-persona.cjs. Les deux sont MESUREES sur l'audio reel : ce module
 * ne devine rien, il rapproche deux mesures.
 *
 * SUR LE MOT « QUINTERNION »
 *
 * Il n'existe pas d'algebre a division de dimension 5 sur les reels. Le theoreme
 * de Frobenius (1878) ne laisse que les dimensions 1, 2 et 4 — reels, complexes,
 * quaternions — et Hurwitz ajoute 8 pour les octonions si on abandonne
 * l'associativite. Aucune structure de dimension 5 ne peut donc offrir ce que le
 * quaternion offre ici : un inverse pour chaque element, donc une rotation.
 *
 * C'est deja la mise en garde du §9.2 du document V11. On ne fabrique donc pas de
 * fausse algebre : le CINQUIEME critere — la disponibilite — s'applique EN DEHORS
 * du quaternion, comme une ponderation scalaire assumee. C'est moins joli comme
 * mot, c'est du calcul qui tient.
 *
 * « EVERYBODY NEED SOMEBODY »
 *
 * Ce cinquieme critere est la regle sociale du DJ, et c'est elle qui porte le nom.
 * Sans elle, la meilleure voix sur le papier prendrait TOUTES les sections de
 * toutes les chansons : le catalogue existerait sans jamais s'entendre. Trois
 * garde-fous :
 *
 *   1. jamais deux sections d'affilee par la meme voix;
 *   2. une voix qui n'a pas chante depuis longtemps voit son poids MONTER
 *      (`faim`) — l'oubli est un argument, pas une punition;
 *   3. une voix absente du bus de presence n'est pas exclue, seulement retrogradee :
 *      un agent endormi reste dans le catalogue, il chante quand personne d'autre
 *      ne convient.
 *
 * Le point 3 est deliberé. Exclure les absents ferait taire la moitie du casting
 * chaque fois que le bus tousse — et le bus a deja tousse cinq semaines en 2026.
 */

const PROFILE_SCHEMA = 'funesterie.auto-dj.v1';

// Fenetre de conversion des dB relatifs en 0..1. Les profils vocaux mesures
// tiennent entre -25 dB et 0 dB par rapport au niveau global du fichier : en
// dessous de -25 la bande n'est plus audible, au-dessus de 0 elle domine tout.
const DB_PLANCHER = -25;
const DB_PLAFOND = 0;

/** Poids maximal que la faim peut ajouter. Au-dela, le DJ choisirait au tour de role. */
const FAIM_MAX = 0.35;
/** Ce que coute l'absence du bus. Assez pour departager, pas pour exclure. */
const MALUS_ABSENCE = 0.12;

function borne(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** dB relatif -> 0..1, avec la fenetre documentee ci-dessus. */
function dbVersUnite(db) {
  if (!Number.isFinite(db)) return 0.5;
  return borne((db - DB_PLANCHER) / (DB_PLAFOND - DB_PLANCHER), 0, 1);
}

/**
 * Normalise en quaternion unitaire.
 *
 * Sans cette etape, une voix simplement PLUS FORTE gagnerait toutes les
 * comparaisons : on veut comparer des directions, pas des longueurs. Une voix
 * discrete et une voix puissante qui occupent le meme equilibre de bandes
 * doivent tomber au meme endroit.
 */
function unitaire(w, x, y, z) {
  const n = Math.hypot(w, x, y, z);
  // Quatre zeros n'ont pas de direction. On renvoie l'identite plutot que NaN :
  // une mesure ratee doit degrader le choix, pas le faire exploser.
  if (!n) return { w: 1, x: 0, y: 0, z: 0 };
  return { w: w / n, x: x / n, y: y / n, z: z / n };
}

/** Quaternion d'une section de morceau, depuis song-teardown.cjs. */
function quaternionDeSection(section = {}) {
  return unitaire(
    Number(section.energy) || 0,
    Number(section.medium) || 0,
    Number(section.grave) || 0,
    Number(section.aigu) || 0,
  );
}

/** Quaternion d'une voix, depuis le profil de verifier-voix-persona.cjs. */
function quaternionDeVoix(profil = {}) {
  return unitaire(
    dbVersUnite(profil.densite),
    dbVersUnite(profil.corps),
    dbVersUnite(profil.fond),
    dbVersUnite(profil.brillance),
  );
}

function produit(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Sur un quaternion unitaire, l'inverse est le conjugue. */
function conjugue(q) {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

function rotation(q, u) {
  return produit(produit(u, q), conjugue(u));
}

/**
 * Rotation propre a une section : `u` avance d'un angle regulier le long du
 * morceau, autour d'un axe fixe.
 *
 * Sans elle, la cible ne bougerait qu'avec les bandes mesurees, et un morceau
 * homogene collerait la meme voix du debut a la fin. Ici la cible se DEPLACE dans
 * l'espace des voix a mesure que le morceau avance : le DJ traverse le casting au
 * lieu de camper dessus. L'angle est deterministe — meme morceau, meme decoupage.
 */
function rotationDeSection(index, total) {
  const n = Math.max(1, Number(total) || 1);
  const angle = (Math.PI * (Number(index) || 0)) / n;
  const demi = angle / 2;
  // Axe (1,1,1) normalise : il touche les trois axes imaginaires a egalite, donc
  // aucune bande n'est privilegiee par la rotation elle-meme.
  const a = Math.sin(demi) / Math.sqrt(3);
  return { w: Math.cos(demi), x: a, y: a, z: a };
}

/**
 * Distance angulaire entre deux quaternions unitaires, ramenee dans 0..1.
 *
 * `Math.abs` sur le produit scalaire : q et -q designent la meme rotation, les
 * traiter comme opposes ferait passer une voix parfaite pour la pire.
 */
function distance(a, b) {
  const dot = borne(Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z), 0, 1);
  return (2 * Math.acos(dot)) / Math.PI;
}

/**
 * Une voix ne peut chanter que si elle EXISTE reellement chez Suno.
 *
 * Le catalogue distingue l'intention du fait : une persona peut decrire sa voix
 * sans posseder d'identifiant. Et une persona expiree garde son identifiant tout
 * en ne designant plus rien — le defaut du 03/08 qui a envoye quatre jours de
 * generations dans le vide. Les deux cas sortent ici, pas plus loin.
 */
function estEligible(voix = {}) {
  if (!voix || voix.active === false) return { ok: false, raison: 'inactive' };
  if (!voix.voiceId && !voix.idHash) return { ok: false, raison: 'aucun-id-suno' };
  if (voix.personaExpired || voix.personaExpiredAt) return { ok: false, raison: 'persona-expiree' };
  if (!voix.consentBy) return { ok: false, raison: 'consentement-absent' };
  return { ok: true, raison: '' };
}

/**
 * La faim : combien de sections cette voix a laisse passer.
 *
 * Plafonnee, sinon une voix jamais choisie finirait par gagner contre n'importe
 * quel ecart de timbre, et le DJ deviendrait un tourniquet.
 */
function faim(nom, historique = [], sectionsTotal = 1) {
  const dernier = historique.lastIndexOf(nom);
  const depuis = dernier < 0 ? historique.length : historique.length - 1 - dernier;
  const portee = Math.max(1, Math.min(sectionsTotal, 8));
  return borne(depuis / portee, 0, 1) * FAIM_MAX;
}

/**
 * Choisit une voix par section.
 *
 * `voix` : entrees de voice-catalog.cjs enrichies d'un `profil` mesure.
 * `presents` : noms vus vivants sur le bus (agent-presence). Facultatif.
 */
function choisirVoix({ sections = [], voix = [], presents = [] } = {}) {
  const eligibles = [];
  const ecartees = [];
  for (const v of voix) {
    const verdict = estEligible(v);
    if (verdict.ok) eligibles.push(v);
    else ecartees.push({ name: v?.name || '(sans nom)', raison: verdict.raison });
  }

  if (!eligibles.length) {
    return {
      schema: PROFILE_SCHEMA,
      choix: [],
      ecartees,
      // Un catalogue vide n'est pas une erreur technique : c'est l'etat normal
      // tant qu'aucune voix n'a ete generee. L'appelant doit pouvoir le dire.
      avertissement: 'aucune voix eligible : rien a faire chanter',
    };
  }

  const presentSet = new Set(presents.map((p) => String(p || '').toLowerCase()));
  const historique = [];
  const choix = [];

  sections.forEach((section, index) => {
    const cible = rotation(quaternionDeSection(section), rotationDeSection(index, sections.length));
    const precedent = historique[historique.length - 1];

    const notes = eligibles.map((v) => {
      const ecart = distance(cible, quaternionDeVoix(v.profil || {}));
      const bonusFaim = faim(v.name, historique, sections.length);
      const absent = presentSet.size > 0 && !presentSet.has(String(v.name).toLowerCase());
      // Un ecart PLUS PETIT est meilleur : la faim se soustrait, l'absence s'ajoute.
      const score = ecart - bonusFaim + (absent ? MALUS_ABSENCE : 0);
      return { voix: v, ecart, bonusFaim, absent, score };
    });

    // Regle 1 : jamais deux fois d'affilee. On ne l'applique que s'il reste
    // quelqu'un d'autre — a une seule voix eligible, se taire serait pire.
    const ouvertes = notes.length > 1 ? notes.filter((n) => n.voix.name !== precedent) : notes;
    ouvertes.sort((a, b) => a.score - b.score || a.voix.name.localeCompare(b.voix.name));
    const gagnante = ouvertes[0];

    historique.push(gagnante.voix.name);
    choix.push({
      index,
      startSeconds: section.startSeconds,
      endSeconds: section.endSeconds,
      label: section.label || '',
      voix: gagnante.voix.name,
      libelle: gagnante.voix.label || gagnante.voix.name,
      ecart: Number(gagnante.ecart.toFixed(4)),
      faim: Number(gagnante.bonusFaim.toFixed(4)),
      absente: gagnante.absent,
      // De quel ecart la deuxieme etait-elle derriere ? Un ecart minuscule veut
      // dire que le choix s'est joue sur la faim, pas sur le timbre : c'est
      // exactement ce qu'on veut pouvoir relire quand un choix surprend.
      marge: ouvertes[1] ? Number((ouvertes[1].score - gagnante.score).toFixed(4)) : null,
    });
  });

  return {
    schema: PROFILE_SCHEMA,
    sections: sections.length,
    eligibles: eligibles.length,
    ecartees,
    // Combien de voix distinctes ont reellement chante. C'est la mesure du
    // « everybody need somebody » : si elle vaut 1 sur dix sections, la regle
    // ne fait pas son travail.
    voixDistinctes: new Set(choix.map((c) => c.voix)).size,
    choix,
  };
}

module.exports = {
  PROFILE_SCHEMA,
  dbVersUnite,
  unitaire,
  quaternionDeSection,
  quaternionDeVoix,
  produit,
  conjugue,
  rotation,
  rotationDeSection,
  distance,
  estEligible,
  faim,
  choisirVoix,
};
