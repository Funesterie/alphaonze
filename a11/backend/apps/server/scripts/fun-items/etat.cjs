'use strict';

/**
 * etat.cjs — Les couloirs de Funesterie, vus depuis l'interieur du conteneur.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Toutes ces lectures ont ete faites a la main le 18/08/2026, une par une, en
 * collant des `node -e "..."` de trois lignes dans un SSH. Ca marche, mais ca ne
 * se retient pas, ca se retape mal, et une accolade oubliee dans un shell rend
 * une erreur qui ressemble a une panne de serveur.
 *
 * Un script pose dans le depot, appele par un verbe court, remplace la
 * gymnastique de guillemets par un mot. C'est tout ce que c'est: une carte des
 * couloirs, pas un outil de plus.
 *
 * LECTURE SEULE, TOUJOURS. Rien ici n'ecrit, ne genere, ne depense un credit.
 * On peut le lancer en production sans reflechir, c'est le seul moyen qu'il
 * serve vraiment.
 */

const SALLES = {
  voix: salleVoix,
  personas: sallePersonas,
  cout: salleCout,
  gratuit: salleGratuit,
  graphe: salleGraphe,
};

function titre(texte) {
  console.log('');
  console.log('  ' + texte);
  console.log('  ' + '-'.repeat(texte.length));
}

function ligne(cle, valeur) {
  console.log('  ' + String(cle).padEnd(30) + String(valeur));
}

/** Le catalogue de voix, avec ce qui est mort et ce qui ne l'est pas. */
function salleVoix() {
  const { readVoiceCatalog } = require('../../src/music/voice-catalog.cjs');
  const voix = readVoiceCatalog(process.env).voices || [];
  titre(`Catalogue de voix (${voix.length})`);
  for (const v of voix) {
    const etat = v.personaExpiredAt
      ? 'EXPIREE ' + String(v.personaExpiredAt).slice(0, 10)
      : 'vivante';
    const id = String(v.voiceId || v.personaId || '');
    ligne(
      `${v.name || v.id}`,
      `${(v.active ? 'active' : 'retiree').padEnd(8)} ${etat.padEnd(20)} id=${id.slice(0, 4)}...  echantillon=${v.sampleFile ? 'oui' : 'NON'}`
    );
  }
  const mortes = voix.filter((v) => v.personaExpiredAt).length;
  if (mortes) console.log(`\n  ${mortes} voix a reanimer.`);
}

/** Le casting LLM: qui parle, sur quel modele, chez quel fournisseur. */
function sallePersonas() {
  const { llmPersonas } = require('../../src/persona/llm-personas.cjs');
  titre(`Casting LLM (${llmPersonas.length})`);
  for (const p of llmPersonas) {
    ligne(`${p.emoji || ' '} ${p.name}`, `${p.provider.padEnd(12)} ${p.model}`);
  }
}

/** Ce qu'un clip coute VRAIMENT, lu sur la configuration de production. */
function salleCout() {
  const c = require('../../src/clips/cout-clip.cjs');
  const p = c.parametresRendu(process.env);
  const cout = c.coutClip({ env: process.env });
  titre('Cout d un clip');
  ligne('scenes', p.scenes);
  ligne('secondes par scene', p.secondesParScene);
  ligne('secondes generees', cout.secondesGenerees);
  ligne('credits GPU', cout.creditsGpu);
  ligne('forfait de soumission', cout.creditsForfait);
  ligne('TOTAL', `${cout.credits} credits  (~${cout.usd} USD)`);
  ligne('estimation ?', cout.estime ? 'oui, multiplicateur x' + cout.multiplicateur : 'non');
  titre('Plafond mensuel par palier');
  for (const palier of ['standard', 'creator', 'pro']) {
    const cap = c.capaciteMensuelle({ env: process.env, palier });
    ligne(palier, `${String(cap.clipsParMois).padStart(4)} clips/mois   ${cap.usdParMois} USD/mois`);
  }
}

/** L etat du commutateur tout-gratuit et du quota qui le tient. */
function salleGratuit() {
  const g = require('../../src/auth/tout-gratuit.cjs');
  titre('Mode gratuit');
  ligne('actif', g.estActif(process.env) ? 'OUI' : 'non');
  ligne('palier offert', g.palierOffert());
  ligne('clips par compte et par mois', g.quotaClipsParMois(process.env));
}

/** Le graphe: ce qu il contient vraiment, sans ouvrir de console Neo4j. */
async function salleGraphe() {
  const neo4j = require('neo4j-driver');
  const pilote = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
  );
  const session = pilote.session({ database: process.env.NEO4J_DATABASE || 'neo4j' });
  try {
    const noeuds = await session.run('MATCH (n) RETURN count(n) AS c');
    const liens = await session.run('MATCH ()-[r]->() RETURN count(r) AS c');
    titre('Graphe Neo4j');
    ligne('noeuds', noeuds.records[0].get('c').toString());
    ligne('relations', liens.records[0].get('c').toString());
    const top = await session.run(
      'MATCH (n) UNWIND labels(n) AS l RETURN l, count(*) AS c ORDER BY c DESC LIMIT 10'
    );
    titre('Dix labels les plus peuples');
    for (const r of top.records) ligne(r.get('l'), r.get('c').toString());
  } finally {
    await session.close();
    await pilote.close();
  }
}

async function main() {
  const salle = String(process.argv[2] || '').trim().toLowerCase();
  if (!salle || salle === 'tout') {
    for (const nom of Object.keys(SALLES)) {
      try { await SALLES[nom](); } catch (e) { console.log(`  [${nom}] indisponible: ${String(e.message).slice(0, 80)}`); }
    }
    return;
  }
  if (!SALLES[salle]) {
    console.log('  salles: ' + Object.keys(SALLES).join(', ') + ', tout');
    process.exitCode = 1;
    return;
  }
  await SALLES[salle]();
}

main().catch((e) => {
  console.error('  erreur:', String(e && e.message).slice(0, 200));
  process.exitCode = 1;
});
