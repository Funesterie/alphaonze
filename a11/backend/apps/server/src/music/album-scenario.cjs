'use strict';

/**
 * album-scenario.cjs — Qui mène chaque morceau, a l'echelle de l'album.
 *
 * auto-dj.cjs choisit une voix par SECTION dans un morceau. Ce module monte d'un
 * cran : il choisit la voix qui MENE chaque morceau d'un album, pour que l'album
 * raconte quelque chose par le simple fait de savoir qui chante quand. C'est le
 * « Suno ID scenarise » : l'identifiant de voix envoye a Suno n'est pas pris au
 * hasard morceau par morceau, il suit un scenario.
 *
 * MEME MATHEMATIQUE QUE LE DJ, PAR RESPECT DE LA COHERENCE
 *
 * On reutilise le quaternion d'auto-dj (4 axes : energie, voix, phase, espace) et
 * sa distance angulaire. Le role d'un morceau -- intro, banger, ballade, final --
 * se traduit en une cible sur ces memes axes, et on rapproche cette cible du
 * timbre mesure de chaque voix. Dupliquer la logique aurait garanti qu'un jour le
 * DJ et l'album classent les voix sur deux echelles differentes.
 *
 * « EVERYBODY NEED SOMEBODY », A L'ECHELLE DE L'ALBUM
 *
 * La meme regle sociale, un cran plus haut. Sans elle, la meilleure voix sur le
 * papier menerait les douze morceaux, et l'album n'aurait qu'un seul visage.
 * Trois garde-fous, identiques a ceux du DJ mais appliques aux morceaux :
 *
 *   1. jamais deux morceaux d'affilee menes par la meme voix;
 *   2. une voix qui n'a pas mene depuis longtemps voit son poids monter;
 *   3. le binome (persona-binome.cjs) du meneur precedent est LEGEREMENT favorise
 *      -- un album a des fils conducteurs, une voix se repond a travers les
 *      morceaux comme djeff<->vivy. C'est un scenario, pas un tirage.
 *
 * DETERMINISTE
 *
 * Meme album, meme casting, meme scenario : toujours la meme distribution. Un
 * scenario qu'on ne peut pas rejouer n'est pas un scenario, c'est un coup de des.
 */

const { quaternionDeSection, quaternionDeVoix, distance, estEligible } = require('./auto-dj.cjs');
const { binomeDe } = require('./persona-binome.cjs');

const SCHEMA = 'funesterie.album-scenario.v1';

/**
 * Cible sur les quatre axes du quaternion, par role de morceau.
 *
 * energie = intensite globale, voix = presence du medium, phase = poids du grave,
 * espace = brillance/aigu. Les valeurs sont des directions, pas des absolus :
 * c'est leur EQUILIBRE qui compte, la normalisation du quaternion s'occupe du reste.
 *
 * Un role inconnu retombe sur 'couplet' : neutre, sans imposer de couleur.
 */
const MOODS_PAR_ROLE = Object.freeze({
  intro: { energy: 0.25, medium: 0.35, grave: 0.55, aigu: 0.30 },
  couplet: { energy: 0.55, medium: 0.70, grave: 0.45, aigu: 0.45 },
  banger: { energy: 0.95, medium: 0.75, grave: 0.80, aigu: 0.70 },
  refrain: { energy: 0.85, medium: 0.80, grave: 0.60, aigu: 0.75 },
  ballade: { energy: 0.30, medium: 0.75, grave: 0.35, aigu: 0.55 },
  interlude: { energy: 0.20, medium: 0.40, grave: 0.30, aigu: 0.60 },
  pont: { energy: 0.50, medium: 0.55, grave: 0.40, aigu: 0.65 },
  final: { energy: 0.90, medium: 0.70, grave: 0.75, aigu: 0.80 },
  outro: { energy: 0.25, medium: 0.45, grave: 0.50, aigu: 0.35 },
});

/** Poids maximal que l'oubli peut ajouter. Plafonne, sinon l'album devient un tourniquet. */
const FAIM_MAX = 0.30;
/** Coup de pouce au binome du meneur precedent : un fil, pas une regle. */
const BONUS_BINOME = 0.10;

function moodDeRole(role = '') {
  return MOODS_PAR_ROLE[String(role || '').trim().toLowerCase()] || MOODS_PAR_ROLE.couplet;
}

function faim(nom, historique, total) {
  const dernier = historique.lastIndexOf(nom);
  const depuis = dernier < 0 ? historique.length : historique.length - 1 - dernier;
  const portee = Math.max(1, Math.min(total, 6));
  return Math.max(0, Math.min(1, depuis / portee)) * FAIM_MAX;
}

/**
 * Scenarise un album : une voix meneuse par morceau.
 *
 * `tracks` : [{ n, title, role, hook? }] -- le plan d'album, comme celui que
 *            j-rouette-album-engine.cjs sait deja lire.
 * `voix`   : entrees de voice-catalog enrichies d'un `profil` (voice-profile.cjs).
 *
 * Chaque morceau recoit sa voix ET son identifiant Suno (idHash/voiceId), pret a
 * partir dans buildVivySunoPayload. Jamais le voiceId en clair dans les journaux :
 * l'appelant decide de le resoudre au dernier moment.
 */
function scenariserAlbum({ tracks = [], voix = [] } = {}) {
  const eligibles = [];
  const ecartees = [];
  for (const v of voix) {
    const verdict = estEligible(v);
    if (verdict.ok) eligibles.push(v);
    else ecartees.push({ name: v?.name || '(sans nom)', raison: verdict.raison });
  }

  if (!eligibles.length) {
    return {
      schema: SCHEMA,
      distribution: [],
      ecartees,
      avertissement: 'aucune voix eligible : aucun album ne peut etre scenarise',
    };
  }

  const historique = [];
  const distribution = [];

  (Array.isArray(tracks) ? tracks : []).forEach((track, index) => {
    const cible = quaternionDeSection(moodDeRole(track.role));
    const precedent = historique[historique.length - 1];
    const binomeDuPrecedent = precedent ? binomeDe(precedent) : '';

    const notes = eligibles.map((v) => {
      const ecart = distance(cible, quaternionDeVoix(v.profil || {}));
      const bonusFaim = faim(v.name, historique, tracks.length);
      const bonusBinome = (binomeDuPrecedent && v.name === binomeDuPrecedent) ? BONUS_BINOME : 0;
      // Ecart plus petit = mieux : la faim et le binome se soustraient.
      const score = ecart - bonusFaim - bonusBinome;
      return { voix: v, ecart, bonusFaim, bonusBinome, score };
    });

    // Regle 1 : jamais deux morceaux d'affilee, sauf s'il ne reste qu'une voix.
    const ouvertes = notes.length > 1 ? notes.filter((n) => n.voix.name !== precedent) : notes;
    ouvertes.sort((a, b) => a.score - b.score || a.voix.name.localeCompare(b.voix.name));
    const gagnante = ouvertes[0];

    historique.push(gagnante.voix.name);
    distribution.push({
      n: track.n ?? index + 1,
      title: track.title || `Morceau ${index + 1}`,
      role: track.role || 'couplet',
      lead: gagnante.voix.name,
      libelle: gagnante.voix.label || gagnante.voix.name,
      idHash: gagnante.voix.idHash || gagnante.voix.name,
      ecart: Number(gagnante.ecart.toFixed(4)),
      // Pourquoi cette voix mene ce morceau, en clair -- pour relire un choix qui surprend.
      motif: gagnante.bonusBinome > 0
        ? `repond a ${precedent} (binome)`
        : gagnante.bonusFaim > 0.15
          ? 'voix laissee de cote, ramenee'
          : 'timbre proche du role',
      binomeDe: binomeDe(gagnante.voix.name) || null,
    });
  });

  return {
    schema: SCHEMA,
    morceaux: distribution.length,
    eligibles: eligibles.length,
    ecartees,
    // La mesure du « everybody need somebody » a l'echelle album : combien de voix
    // distinctes portent l'album. 1 sur douze = la regle n'a pas fait son travail.
    voixDistinctes: new Set(distribution.map((d) => d.lead)).size,
    distribution,
  };
}

module.exports = { SCHEMA, MOODS_PAR_ROLE, moodDeRole, scenariserAlbum };
