'use strict';

/**
 * vivy-singer-selection.cjs — Le casting, choisi par Vivy plutôt que coché à la main.
 *
 * Djeff, 03/08 : « je veux une autre méthode de sélection, un listing chanteur, ou
 * alors Vivy choisit manuellement parmi tous les chanteurs et rechoisit si un pas
 * dispo ».
 *
 * Ce que ça remplace. Dans l'interface, cocher une voix premium du catalogue posait
 * `voixPremiumTientLeRole = true`, ce qui grisait d'un coup TOUS les artistes
 * officiels — Vivy comprise. Le motif était bon (Suno n'accepte qu'une persona par
 * morceau) mais la sanction était trop large : elle interdisait aussi les officiels,
 * qui n'utilisent justement PAS de persona Suno. On se retrouvait avec un casting
 * d'une seule voix sans l'avoir voulu.
 *
 * La règle réelle, et elle seule : **au plus UNE voix premium par morceau**. Les
 * officiels ne consomment pas de persona, ils peuvent être plusieurs, et ils peuvent
 * accompagner une premium.
 *
 * Et une voix indisponible ne bloque plus : elle est écartée avec son motif, et le
 * choix se reporte. Une persona expirée ne doit pas arrêter une chanson — c'est ce
 * qui a tué Djeff pendant quatre jours sans que personne ne voie pourquoi.
 */

const MAX_PREMIUM_PAR_MORCEAU = 1;

/** Motifs d'indisponibilité, du plus grave au plus bénin. */
const MOTIFS = Object.freeze({
  EXPIREE: 'persona expiree',
  SANS_ID: 'aucun identifiant de voix',
  SANS_ADN: 'aucun echantillon pour la reanimer',
  INCONNUE: 'chanteur inconnu',
});

function texte(v) {
  return String(v ?? '').trim();
}

/**
 * Registre de tous les chanteurs, officiels et premium, avec leur disponibilité.
 *
 * @param {Array} officiels  [{ id, label, role }] — n'utilisent pas de persona Suno
 * @param {Array} catalogue  entrées du voice-catalog
 */
function buildSingerRegistry({ officiels = [], catalogue = [] } = {}) {
  const registre = [];

  for (const a of officiels) {
    const id = texte(a?.id).toLowerCase();
    if (!id) continue;
    registre.push({
      id,
      label: texte(a?.label) || id,
      role: texte(a?.role),
      kind: 'officiel',
      consommePersona: false,
      disponible: true,
      motif: '',
    });
  }

  for (const v of catalogue) {
    const nom = texte(v?.name).toLowerCase();
    if (!nom) continue;
    const expiree = Boolean(v?.personaExpiredAt);
    const sansId = !texte(v?.voiceId);
    const sansAdn = !texte(v?.sampleFile);
    let motif = '';
    if (sansId) motif = MOTIFS.SANS_ID;
    else if (expiree) motif = MOTIFS.EXPIREE;

    // Deja present comme officiel (Djeff est les deux) : on enrichit au lieu de doubler.
    const existant = registre.find((r) => r.id === nom);
    const donnees = {
      kind: 'premium',
      consommePersona: true,
      voiceId: texte(v?.voiceId),
      adnSecondes: Number(v?.sampleDurationSeconds) || 0,
      // Sans ADN, la voix marche tant qu'elle vit — mais elle est irrecuperable
      // si elle expire. On le signale sans la rendre indisponible.
      fragile: sansAdn,
      disponible: !motif,
      motif,
    };
    if (existant) Object.assign(existant, donnees, { label: existant.label });
    else registre.push({ id: nom, label: texte(v?.name) || nom, role: '', ...donnees });
  }

  return registre;
}

/**
 * Choisit le casting. Vivy passe ses souhaits dans `souhaites` ; ce qui n'est pas
 * disponible est écarté avec son motif et remplacé par un repli du même registre.
 *
 * @param {Array} registre
 * @param {object} o
 * @param {Array<string>} [o.souhaites]  ordre de préférence
 * @param {number} [o.maxVoix]
 * @param {boolean} [o.autoriserRepli]   si un souhait tombe, en prendre un autre
 */
function pickSingers(registre = [], { souhaites = [], maxVoix = 3, autoriserRepli = true } = {}) {
  const parId = new Map(registre.map((r) => [r.id, r]));
  const retenus = [];
  const ecartes = [];
  let premiumPris = 0;

  const peutPrendre = (r) => {
    if (!r.disponible) return { ok: false, motif: r.motif || MOTIFS.INCONNUE };
    if (r.consommePersona && premiumPris >= MAX_PREMIUM_PAR_MORCEAU) {
      return { ok: false, motif: `Suno n accepte qu une persona par morceau (${MAX_PREMIUM_PAR_MORCEAU})` };
    }
    return { ok: true };
  };

  const prendre = (r) => {
    retenus.push(r);
    if (r.consommePersona) premiumPris += 1;
  };

  for (const brut of souhaites) {
    if (retenus.length >= maxVoix) break;
    const id = texte(brut).toLowerCase();
    const r = parId.get(id);
    if (!r) { ecartes.push({ id, motif: MOTIFS.INCONNUE }); continue; }
    if (retenus.some((x) => x.id === id)) continue;
    const verdict = peutPrendre(r);
    if (verdict.ok) prendre(r);
    else ecartes.push({ id, label: r.label, motif: verdict.motif });
  }

  // Repli : on complete avec ce qui reste, officiels d'abord — ils ne consomment
  // pas de persona, donc ils ne peuvent jamais faire echouer le morceau.
  const replis = [];
  if (autoriserRepli && retenus.length < Math.min(maxVoix, 1)) {
    const reste = registre
      .filter((r) => !retenus.some((x) => x.id === r.id))
      .sort((a, b) => Number(a.consommePersona) - Number(b.consommePersona));
    for (const r of reste) {
      if (retenus.length >= maxVoix) break;
      if (peutPrendre(r).ok) { prendre(r); replis.push(r.id); }
    }
  }

  return {
    retenus,
    ecartes,
    replis,
    // Un morceau sans aucune voix ne doit pas partir chez Suno.
    utilisable: retenus.length > 0,
    premiumUtilisee: retenus.find((r) => r.consommePersona)?.id || null,
  };
}

/** Listing lisible, pour l'interface ou pour Vivy. */
function describeSingers(registre = []) {
  return registre.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    disponible: r.disponible,
    motif: r.motif || '',
    fragile: Boolean(r.fragile),
    note: r.disponible
      ? (r.fragile ? 'disponible, mais sans echantillon : irrecuperable si elle expire' : 'disponible')
      : `indisponible — ${r.motif}`,
  }));
}

module.exports = {
  MAX_PREMIUM_PAR_MORCEAU,
  MOTIFS,
  buildSingerRegistry,
  describeSingers,
  pickSingers,
};
