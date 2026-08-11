'use strict';
const cf = require('../src/index.cjs');
function out(j) { if (!j) return console.log('(no response)'); if (!j.ok) return console.log('CF API error', j.status, JSON.stringify(j.json && j.json.errors || j.json)); console.log(JSON.stringify(j.json && j.json.result, null, 2)); }
(async () => {
  const cmd = process.argv[2];
  if (cmd === 'whoami') { const r = await cf.verifyToken(); out(r); }
  else if (cmd === 'accounts') { out(await cf.accounts()); }
  else if (cmd === 'zones') { out(await cf.listZones()); }
  else if (cmd === 'dns') { const z = await cf.getZone(process.argv[3]); const id = z.json && z.json.result && z.json.result[0] && z.json.result[0].id; out(id ? await cf.listDNSRecords(id) : r=z); }
  else if (cmd === 'tunnels') { const a = await cf.accounts(); const aid = a.json && a.json.result && a.json.result[0] && a.json.result[0].id; out(aid ? await cf.listTunnels(aid) : a); }
  else if (cmd === 'access') { const a = await cf.accounts(); const aid = a.json && a.json.result && a.json.result[0] && a.json.result[0].id; out(aid ? await cf.listAccessApps(aid) : a); }
  else if (cmd === 'r2') { const a = await cf.accounts(); const aid = a.json && a.json.result && a.json.result[0] && a.json.result[0].id; out(aid ? await cf.listR2Buckets(aid) : a); }
  else { process.stderr.write('usage: cf <whoami|accounts|zones|dns <zone>|tunnels|access|r2>\n  set CLOUDFLARE_API_TOKEN env\n'); process.exit(2); }
})().catch(e => { process.stderr.write('cf error: ' + (e && e.stack || e) + '\n'); process.exit(1); });
