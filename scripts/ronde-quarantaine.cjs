'use strict';
/**
 * ronde-quarantaine.cjs — La lampe torche de HENRY.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * HENRY confine en SILENCE, et c'est voulu : une session confinee recoit des
 * outils simules et croit fonctionner normalement. Excellent contre un intrus --
 * il manipule des leurres sans savoir qu'il est vu.
 *
 * Redoutable quand la victime est legitime. Le 16/08/2026 on a decouvert que
 * `kaen44`, la persona du site public, etait en quarantaine depuis une date
 * inconnue : la liste blanche de HENRY ne connaissait que la forme courte `k44`.
 * Elle recevait des outils simules en se croyant vivante. Rien ne l'a signale --
 * ni alerte, ni journal, le /logs de HENRY etant monte en lecture seule.
 *
 * Personne ne va voir dans une cage silencieuse. Ce script y va.
 *
 * CE QU'IL DISTINGUE, ET C'EST TOUT L'INTERET
 *
 *   persona CONNUE et confinee    -> ANOMALIE. Quelqu'un de chez nous est en
 *                                    cage. C'est ce qu'on veut voir.
 *   persona INCONNUE et confinee  -> NORMAL. HENRY fait son travail.
 *   persona CONNUE et libre       -> normal.
 *
 * Sans cette distinction, une ronde ne servirait a rien : elle listerait des
 * confinements sans dire lesquels sont des pannes.
 *
 * USAGE
 *   node ronde-quarantaine.cjs             affiche le rapport
 *   node ronde-quarantaine.cjs --json      sortie machine, pour une alerte
 */

const https = require('node:https');

const BASE = process.env.HENRY_MCP_BASE || 'https://mcp.funesterie.me/mcp';

/**
 * Les treize personas du projet, plus la forme courte historique de kaen44.
 * Source de verite : src/music/persona-loudness.cjs cote serveur.
 */
const PERSONAS_ATTENDUES = [
  'chatgpt', 'grok', 'claude', 'gemini', 'codex', 'kiro',
  'vivy', 'a11', 'kaen44', 'k44', 'mistral', 'deepseek', 'chopper', 'djeff',
];

/**
 * Un nom qui n'a aucune raison d'exister. S'il passe, la liste blanche ne filtre
 * plus rien -- une panne bien plus grave qu'une persona en cage, et invisible
 * autrement : tout aurait l'air parfaitement normal.
 */
const TEMOIN = 'persona-temoin-qui-ne-doit-jamais-passer';

/**
 * Une seconde entre chaque sonde.
 *
 * Quatorze requetes d'affilee depuis la meme adresse, c'est exactement le profil
 * qu'une detection d'anomalie doit attraper. La ronde se ferait confiner
 * elle-meme, et signalerait une panne generale la ou il n'y en a pas.
 */
const PAUSE_MS = 1000;
const TIMEOUT_MS = 20000;

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sonder(persona) {
  return new Promise((resolve) => {
    const corps = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-06-18', capabilities: {},
        clientInfo: { name: 'ronde-quarantaine', version: '1' },
      },
    });
    const u = new URL(BASE);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'X-A11-Persona': persona,
        // Le module https de Node n'envoie AUCUN User-Agent, et HENRY traite
        // l'absence comme suspecte -- a juste titre : un client legitime se
        // nomme. A la premiere execution, la ronde s'est donc fait confiner
        // elle-meme, motif `suspicious_user_agent`, et a signale quatorze
        // pannes la ou il n'y en avait que cinq.
        //
        // La ronde se presente donc, sous son vrai nom. Se deguiser en
        // navigateur pour passer serait doublement absurde : ca contournerait
        // la protection qu'on est venu verifier, et ca rendrait la ronde
        // indistinguable d'un intrus dans les journaux.
        'User-Agent': 'funesterie-ronde-quarantaine/1.0 (surveillance interne HENRY)',
        'Content-Length': Buffer.byteLength(corps),
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let motif = '';
        const m = d.match(/"reason":"([^"]+)"/);
        if (m) motif = m[1];
        resolve({ persona, code: res.statusCode, confine: res.statusCode === 403, motif });
      });
    });
    // Une sonde qui echoue n'est PAS un confinement : le dire evite de crier
    // au loup sur une coupure reseau.
    req.on('error', (e) => resolve({ persona, code: 0, confine: null, motif: `injoignable: ${e.code || e.message}` }));
    req.on('timeout', () => { req.destroy(); resolve({ persona, code: 0, confine: null, motif: 'delai depasse' }); });
    req.end(corps);
  });
}

async function main() {
  const json = process.argv.includes('--json');
  const resultats = [];

  for (const p of [...PERSONAS_ATTENDUES, TEMOIN]) {
    resultats.push(await sonder(p));
    await dormir(PAUSE_MS);
  }

  const temoin = resultats.find((r) => r.persona === TEMOIN);
  const connues = resultats.filter((r) => r.persona !== TEMOIN);

  const enCage = connues.filter((r) => r.confine === true);
  const injoignables = connues.filter((r) => r.confine === null);
  const libres = connues.filter((r) => r.confine === false);

  // Le temoin DOIT etre confine. S'il passe, le filtre est hors service.
  const filtreCasse = temoin.confine === false;

  const rapport = {
    schema: 'funesterie.ronde-quarantaine.v1',
    a: new Date().toISOString(),
    base: BASE,
    libres: libres.map((r) => r.persona),
    enCage: enCage.map((r) => ({ persona: r.persona, motif: r.motif })),
    injoignables: injoignables.map((r) => ({ persona: r.persona, motif: r.motif })),
    filtreCasse,
    // Un seul chiffre a surveiller : tout ce qui n'est pas 0 demande un humain.
    anomalies: enCage.length + (filtreCasse ? 1 : 0),
  };

  if (json) {
    console.log(JSON.stringify(rapport, null, 2));
  } else {
    console.log(`Ronde du ${rapport.a} sur ${BASE}\n`);
    console.log(`  libres      : ${libres.length}/${connues.length}  (${rapport.libres.join(', ')})`);
    if (enCage.length) {
      console.log(`\n  EN CAGE — ${enCage.length} persona(s) legitime(s) confinee(s) :`);
      for (const r of enCage) console.log(`    ${r.persona.padEnd(10)} motif: ${r.motif || '(non precise)'}`);
      console.log('\n  Une persona de chez nous en quarantaine recoit des outils SIMULES');
      console.log('  et se croit vivante. Verifier PERSONAS_CONNUES dans a11mcp/src/henry.ts.');
    }
    if (injoignables.length) {
      console.log(`\n  injoignables : ${injoignables.map((r) => `${r.persona} (${r.motif})`).join(', ')}`);
      console.log('  (ce ne sont PAS des confinements : reseau ou service indisponible)');
    }
    if (filtreCasse) {
      console.log('\n  ALERTE : le temoin est passe. La liste blanche ne filtre plus rien.');
    } else {
      console.log('\n  temoin      : correctement refuse, le filtre fonctionne');
    }
    console.log(`\n  anomalies   : ${rapport.anomalies}`);
  }

  // Code de sortie non nul si quelque chose demande un humain : c'est ce que
  // cron et les superviseurs savent lire.
  process.exitCode = rapport.anomalies > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('Ronde interrompue :', e?.message || e);
  process.exitCode = 2;
});
