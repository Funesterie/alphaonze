'use strict';
/**
 * malcolm-checkpoints.cjs — journal Neo4j des "conseils de terrain" de Malcolm.
 *
 * Demande de Djeff (23/09/2026, apres le branchement manga) : "ajoute les logs
 * pour evaluation checkpoint dans neo4j genre conseil de terrain 'a faire
 * attention a ameliorer, a eviter'". Malcolm juge deja chaque plan/planche
 * (malcolm-continuity.cjs) ; ce module transforme les verdicts PROBLEMATIQUES
 * (rejete, rupture_acceptee) en notes de terrain courtes et actionnables,
 * persistees dans Neo4j pour que la prochaine generation ait de quoi
 * apprendre. Un plan "coherent" ne genere aucune note : rien a signaler
 * n'est pas une lecon.
 *
 * Deux categories, alignees sur les deux verdicts problematiques que
 * normalizeMalcolmVerdict peut produire :
 *   - "a_eviter"    (rejete)            : erreur de rendu constatee (derive
 *     d'identite le plus souvent) -- pas un choix, une chose a corriger.
 *   - "a_ameliorer" (rupture_acceptee)  : changement assume mais pas
 *     explicitement voulu par le brief -- Malcolm a laisse passer, mais
 *     suite_possible dit ce qui rendrait le plan suivant plus sur.
 *
 * Ecriture best-effort, comme Malcolm lui-meme (voir clip-generator-v2.cjs) :
 * Neo4j indisponible ne doit JAMAIS casser une generation de clip. Borne en
 * temps (NOSSEN_MALCOLM_CHECKPOINT_TIMEOUT_MS) pour ne pas retenir la fin
 * d'un clip a cause d'un Aura ou d'un local injoignable.
 */

const { Neo4jMemoryRouter, sanitizePropertyMap, hashText } = require('../../lib/neo4j-memory-router.cjs');

const CATEGORY_BY_VERDICT = {
  rejete: 'a_eviter',
  rupture_acceptee: 'a_ameliorer',
};

function normalize(value, max = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Transforme le malcolmLog d'un clip en notes de terrain -- une par
 * personnage/vehicule incoherent quand il y en a, sinon une par plan
 * problematique. Fonction pure : testable sans Neo4j.
 */
function buildCheckpointNotes(malcolmLog = []) {
  const notes = [];
  for (const entry of Array.isArray(malcolmLog) ? malcolmLog : []) {
    if (entry.skipped || !entry.verdict) continue;
    const verdict = entry.verdict;
    const category = CATEGORY_BY_VERDICT[verdict.verdict];
    if (!category) continue; // coherent, ou un verdict inattendu : rien a signaler.

    // Une derive d'identite se signale ENTITE PAR ENTITE : "attention a la
    // veste de Djeff" apprend plus que "plan 3 rejete".
    const entityIssues = [
      ...(verdict.personnages || []).filter((p) => !p.coherent).map((p) => ({ type: 'personnage', nom: p.nom, details: p.details })),
      ...(verdict.vehicules || []).filter((v) => !v.coherent).map((v) => ({ type: 'vehicule', nom: v.nom, details: v.details })),
    ];

    if (entityIssues.length) {
      for (const issue of entityIssues) {
        notes.push({
          category,
          planIndex: Number.isInteger(entry.planIndex) ? entry.planIndex : -1,
          planName: normalize(entry.planName, 60),
          entityType: issue.type,
          entityName: normalize(issue.nom, 60),
          conseil: normalize(issue.details, 240) || `${issue.type} ${normalize(issue.nom, 60)} : incohérence détectée`,
        });
      }
    } else {
      // Pas d'entite en cause : la note porte sur le plan (ambiance/theme).
      const conseil = [verdict.raison_changement, verdict.suite_possible].filter(Boolean).join(' — ');
      notes.push({
        category,
        planIndex: Number.isInteger(entry.planIndex) ? entry.planIndex : -1,
        planName: normalize(entry.planName, 60),
        entityType: 'plan',
        entityName: '',
        conseil: normalize(conseil, 240) || 'rupture de ton non expliquée',
      });
    }
  }
  return notes;
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`malcolm_checkpoint_timeout_${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Ecrit un checkpoint Neo4j pour le clip : un noeud MalcolmCheckpoint qui
 * resume le passage (compte par verdict), relie a une note par plan
 * problematique. Best-effort total : ne leve JAMAIS, retourne {ok:false} en
 * cas d'echec (Neo4j hors ligne, config absente, delai depasse...).
 */
async function writeMalcolmCheckpoint({
  clipId = '',
  title = '',
  render = 'video',
  malcolmLog = [],
  malcolmSummary = null,
} = {}, {
  runWriteImpl,
  env = process.env,
} = {}) {
  const timeoutMs = Math.max(200, Number(env.NOSSEN_MALCOLM_CHECKPOINT_TIMEOUT_MS || 12000) || 12000);
  try {
    const notes = buildCheckpointNotes(malcolmLog);
    const summary = malcolmSummary || { coherent: 0, rupture_acceptee: 0, rejete: 0, skipped: 0 };
    const now = new Date().toISOString();
    const checkpointId = `malcolm-checkpoint:${clipId || hashText(title + now)}`;

    const run = runWriteImpl || (async (cypher, params) => {
      const router = new Neo4jMemoryRouter();
      return router.runWrite(cypher, params);
    });

    // UNWIND sur un tableau vide produit zero ligne (comportement standard
    // Cypher) : le checkpoint est quand meme cree/mis a jour par le MERGE/SET
    // au-dessus, seule la creation de notes est sautee. Pas besoin de CASE.
    const cypher = `
      MERGE (c:MalcolmCheckpoint {id: $checkpointId})
      ON CREATE SET c.createdAt = datetime($now)
      SET c += $checkpoint
      WITH c
      UNWIND $notes AS note
      CREATE (n:MalcolmFieldNote)
      SET n = note, n.createdAt = datetime($now)
      MERGE (c)-[:A_NOTE]->(n)
      RETURN c
    `;

    await withTimeout(run(cypher, {
      checkpointId,
      now,
      checkpoint: sanitizePropertyMap({
        clipId,
        title: normalize(title, 200),
        render,
        coherent: summary.coherent || 0,
        ruptureAcceptee: summary.rupture_acceptee || 0,
        rejete: summary.rejete || 0,
        skipped: summary.skipped || 0,
        noteCount: notes.length,
      }),
      notes: notes.map((note) => sanitizePropertyMap({ ...note, clipId })),
    }), timeoutMs);

    return { ok: true, notes: notes.length };
  } catch (error) {
    console.warn(`[malcolm] checkpoint Neo4j non écrit (${String(error?.message || error).slice(0, 160)})`);
    return { ok: false, notes: 0, error: String(error?.message || error) };
  }
}

module.exports = {
  CATEGORY_BY_VERDICT,
  buildCheckpointNotes,
  writeMalcolmCheckpoint,
};
