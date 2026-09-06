'use strict';

/**
 * persona-recovery-orchestrator.cjs — La séquence FREEZE→PROMOTION (F.O.R.C.E. §5, §9.3).
 *
 * Enchaîne les dix étapes de la résurrection et, surtout, **empêche d'arriver au
 * bout quand une porte n'est pas franchie**. C'est tout l'intérêt du module : les
 * pièces (capsule, empreinte, canary, rebind) savent chacune dire non ; l'orchestre
 * garantit qu'un non quelque part ne devient jamais un oui à la fin.
 *
 * Les dix étapes (§5) :
 *   1 FREEZE            trafic coupé vers la baie jaune, AU NIVEAU DU ROUTEUR
 *   2 SNAPSHOT          C-3PO : Neo4j, épisodique, fils MCP, sessions, refs
 *   3 RESTORE CODE      R2-D2 remet le dernier commit déclaré sain
 *   4 RESTORE MEMORY    les carnets, sans toucher au code
 *   5 REHYDRATE         identité, modèles, outils, permissions, pointeurs
 *   6 REBIND            reconnexion des voix
 *   7 FINGERPRINT       empreinte comportementale
 *   8 CANARY            vrais flows
 *   9 DJEFF GO          validation humaine
 *  10 PROMOTION         jaune → bleu, ancien bleu → vert
 *
 * Trois règles fermées, tirées du §5, qui sont la raison d'être de ce fichier :
 *
 * FREEZE est router-level, pas un drapeau. Le proxy ne route pas vers yellow
 * pendant le gel, et `active-color` ne bascule PAS. Un booléen que le code
 * consulte poliment ne gèle rien : on exige donc une confirmation du routeur, et
 * on refuse d'avancer sans elle.
 *
 * REHYDRATE revalide les pointeurs mémoire contre les carnets restaurés — ils
 * doivent exister ET avoir le bon checksum. Un carnet manquant met en QUARANTINED,
 * pas en RESTORED. Une persona qui pointe vers un souvenir absent n'est pas guérie,
 * elle est amnésique sans le savoir.
 *
 * DJEFF GO ne peut pas être satisfait par défaut. L'absence de réponse humaine
 * n'est pas un oui. C'est verrouillé par test.
 */

const ETATS = Object.freeze({
  RECOVERING: 'RECOVERING',
  QUARANTINED: 'QUARANTINED',
  RESTORED: 'RESTORED',
  PROMOTED: 'PROMOTED',
});

const ETAPES = Object.freeze([
  'freeze', 'snapshot', 'restoreCode', 'restoreMemory', 'rehydrate',
  'rebind', 'fingerprint', 'canary', 'djeffGo', 'promotion',
]);

function nowIso() {
  return new Date().toISOString();
}

/**
 * Revalide les pointeurs mémoire contre les carnets restaurés (§5).
 * Rend la liste des manquants ET des corrompus — un checksum qui a bougé est
 * aussi grave qu'un fichier absent, et plus sournois.
 */
function validerPointeursMemoire(pointeurs, carnets) {
  const attendus = Array.isArray(pointeurs) ? pointeurs : [];
  const presents = new Map(
    (Array.isArray(carnets) ? carnets : []).map((c) => [String(c?.id ?? c?.name ?? ''), c])
  );
  const manquants = [];
  const corrompus = [];
  for (const p of attendus) {
    const cle = String(p?.id ?? p?.name ?? '');
    const carnet = presents.get(cle);
    if (!carnet) { manquants.push(cle); continue; }
    if (p?.checksum && carnet?.checksum && p.checksum !== carnet.checksum) corrompus.push(cle);
  }
  return { total: attendus.length, manquants, corrompus, valide: manquants.length === 0 && corrompus.length === 0 };
}

async function lancerEtape(nom, fn, journal, args) {
  const debut = nowIso();
  try {
    const out = typeof fn === 'function' ? await fn(args) : { ignore: true };
    journal.push({ etape: nom, at: debut, ok: out?.ok !== false && !out?.ignore, ignore: !!out?.ignore, detail: out });
    return out;
  } catch (error) {
    journal.push({ etape: nom, at: debut, ok: false, erreur: String(error?.message || error) });
    return { ok: false, error };
  }
}

/**
 * Joue la séquence. Chaque étape est injectée : ce module ne sait rien faire
 * lui-même, il sait seulement dans quel ordre et à quelles conditions.
 *
 * @param {string} personaId
 * @param {object} etapes  une fonction par nom de ETAPES
 * @param {object} [options]
 */
async function runResurrection(personaId, etapes = {}, options = {}) {
  const journal = [];
  const arret = (etat, raison) => ({
    personaId, etat, raison, at: nowIso(), journal,
    promue: etat === ETATS.PROMOTED,
  });

  // 1. FREEZE — router-level. Sans confirmation du routeur, on ne bouge pas.
  const gel = await lancerEtape('freeze', etapes.freeze, journal, { personaId });
  if (!gel || gel.ok === false) return arret(ETATS.QUARANTINED, 'freeze refuse ou en erreur');
  if (gel.routerLevel !== true) {
    return arret(ETATS.QUARANTINED, 'freeze non confirme au niveau routeur (un drapeau ne gele rien)');
  }
  if (gel.activeColorChanged === true) {
    return arret(ETATS.QUARANTINED, 'active-color a bascule pendant le freeze — interdit par le §5');
  }

  // 2-4. Snapshot, code, memoire.
  for (const nom of ['snapshot', 'restoreCode', 'restoreMemory']) {
    const r = await lancerEtape(nom, etapes[nom], journal, { personaId });
    if (!r || r.ok === false) return arret(ETATS.QUARANTINED, `${nom} en echec`);
  }

  // 5. REHYDRATE — et revalidation des pointeurs contre les carnets restaures.
  const rehydrate = await lancerEtape('rehydrate', etapes.rehydrate, journal, { personaId });
  if (!rehydrate || rehydrate.ok === false) return arret(ETATS.QUARANTINED, 'rehydrate en echec');
  const pointeurs = validerPointeursMemoire(rehydrate.pointeurs, rehydrate.carnets);
  journal.push({ etape: 'pointeurs', at: nowIso(), ok: pointeurs.valide, detail: pointeurs });
  if (!pointeurs.valide) {
    const quoi = [
      pointeurs.manquants.length ? `carnets manquants: ${pointeurs.manquants.join(', ')}` : '',
      pointeurs.corrompus.length ? `checksums divergents: ${pointeurs.corrompus.join(', ')}` : '',
    ].filter(Boolean).join(' | ');
    return arret(ETATS.QUARANTINED, `pointeurs memoire invalides — ${quoi}`);
  }

  // 6. REBIND — un seul echec suffit a bloquer (§5).
  const rebind = await lancerEtape('rebind', etapes.rebind, journal, { personaId });
  if (!rebind || rebind.ok === false || rebind.toutesLiees === false) {
    return arret(ETATS.QUARANTINED, 'rebind incomplet — au moins une voix non reliee');
  }

  // 7. FINGERPRINT.
  const empreinte = await lancerEtape('fingerprint', etapes.fingerprint, journal, { personaId });
  if (!empreinte || empreinte.state !== ETATS.RESTORED) {
    return arret(ETATS.QUARANTINED, `empreinte non validee (${empreinte?.state || 'absente'})`);
  }

  // 8. CANARY.
  const canary = await lancerEtape('canary', etapes.canary, journal, { personaId });
  if (!canary || canary.state !== ETATS.RESTORED) {
    return arret(ETATS.QUARANTINED, `canary non valide (${canary?.state || 'absent'})`);
  }

  // A ce stade la machine a dit oui. Il manque l'humain.
  const restaure = { personaId, etat: ETATS.RESTORED, at: nowIso(), journal, promue: false };

  // 9. DJEFF GO — l'absence de reponse n'est PAS un oui.
  const go = await lancerEtape('djeffGo', etapes.djeffGo, journal, { personaId, empreinte, canary });
  if (go?.go !== true) {
    return { ...restaure, journal, raison: 'en attente de la validation de Djeff' };
  }

  // 10. PROMOTION — et reecriture de l'holocron canonique (§5 : l'holocron est a
  // la fois l'entree et la sortie).
  const promo = await lancerEtape('promotion', etapes.promotion, journal, {
    personaId, empreinte, canary, rebind, pointeurs: rebind?.pointeurs,
  });
  if (!promo || promo.ok === false) {
    return { ...restaure, journal, raison: 'promotion en echec, persona restauree mais non promue' };
  }
  if (promo.holocronReecrit !== true) {
    return { ...restaure, journal, raison: 'promotion sans reecriture de l holocron canonique — refusee' };
  }

  return { personaId, etat: ETATS.PROMOTED, at: nowIso(), journal, promue: true };
}

module.exports = {
  ETAPES,
  ETATS,
  runResurrection,
  validerPointeursMemoire,
};
