'use strict';
const h = require('../src/index.cjs');
function out(r){ if(!r) return console.log('(no response)'); if(!r.ok) return console.log('Robot API', r.status, (r.text||'').substring(0,200)); console.log(JSON.stringify(r.json, null, 2)); }
(async () => {
  const cmd = process.argv[2];
  if (cmd === 'servers') out(await h.listServers());
  else if (cmd === 'server') out(await h.getServer(process.argv[3]));
  else if (cmd === 'reboot') out(await h.reboot(process.argv[3]));
  else if (cmd === 'rescue') out(await h.getRescue(process.argv[3]));
  else { process.stderr.write('usage: hetzner <servers|server <id>|reboot <id>|rescue <id>>\n  set HETZNER_ROBOT_USER + HETZNER_ROBOT_PASS\n'); process.exit(2); }
})().catch(e => { process.stderr.write('hetzner error: ' + (e && e.stack || e) + '\n'); process.exit(1); });
