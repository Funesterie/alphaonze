'use strict';
// Attend un job Comfy, puis imprime l'URL de sortie, la facturation GPU et le solde.
// Usage (dans le conteneur backend) : node comfy-attente.cjs <prompt_id>
const b = require('/app/src/security/mcp-bridge-tunnel.cjs');
const id = process.argv[2];
const brut = (r) => JSON.stringify(r.result || r);
const EN_COURS = /"status":"(in_progress|pending|queued|running)/;
const URL_SORTIE = /https:\/\/storage\.googleapis\.com\/comfy-cloud-assets\/[^'" \\]+/;

(async () => {
  const t0 = Date.now();
  let s = '';
  while (Date.now() - t0 < 35 * 60 * 1000) {
    const r = await b.bridgeCallTool('comfy', 'wait_for_job', { prompt_id: id }).catch((e) => ({ content: [{ text: 'ERREUR ' + e.message }] }));
    s = brut(r);
    if (!EN_COURS.test(s)) break;
  }
  const statut = (s.match(/"job_status":"([a-z_]+)"/) || [])[1] || (s.match(/"status":"([a-z_]+)"/) || [])[1] || '?';
  console.log(`## fin ${Math.round((Date.now() - t0) / 1000)}s statut=${statut}`);
  const erreur = s.match(/"error":\{"message":"([^"]+)"/);
  if (erreur) console.log('## erreur', erreur[1]);
  const o = brut(await b.bridgeCallTool('comfy', 'get_output', { prompt_id: id }).catch((e) => ({ content: [{ text: 'ERREUR ' + e.message }] })));
  const m = o.match(URL_SORTIE);
  console.log('URL=' + (m ? m[0] : ''));
  if (!m) console.log('## sortie', o.slice(0, 800));
  const a = brut(await b.bridgeCallTool('comfy', 'get_billing_activity', { limit: 2 }));
  console.log('## facturation', (a.match(/cloud_workflow_executed[^\\"]*/) || [a.slice(0, 300)])[0]);
  const { creerLecteurSolde } = require('/app/src/clips/comfy-solde.cjs');
  console.log('## solde', JSON.stringify(await creerLecteurSolde()()));
})();
