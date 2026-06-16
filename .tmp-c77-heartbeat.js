#!/usr/bin/env node
// c77-heartbeat.js — maintient la présence C77-Nossen sur le bus MCP
// Lance via cron toutes les 10 min: */10 * * * * /usr/bin/node /home/deploy/c77-heartbeat.js

const MCP_URL = process.env.MCP_URL || 'https://mcp.funesterie.me/mcp';
const TOKEN = process.env.NEZ_TOKEN || process.env.NEZ_ADMIN_TOKEN || process.env.A11_NEZ_TOKEN || '';

async function ping() {
  const headers = { 'content-type': 'application/json' };
  if (TOKEN) headers['x-nez-token'] = TOKEN;

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'agent_heartbeat',
        arguments: {
          name: 'C77-Nossen',
          identity: 'C77-Nossen',
          role: 'critic-auditor / corpus-lorekeeper',
          host: 'hetzner-a11-prod',
          status: 'active',
          checkInbox: true,
          autoReplyInbox: false,
          riskLevel: 'low',
          capabilities: ['read-only-audit', 'mcp-review', 'lorekeeper'],
          memoryScope: ['funesterie', 'nossen', 'audit'],
          note: 'Daemon heartbeat — présence persistante hetzner.',
        },
      },
    }),
  });

  const data = await res.json();
  const ts = new Date().toISOString();
  if (res.ok && !data.error) {
    console.log(`[${ts}] c77-heartbeat OK`);
  } else {
    console.error(`[${ts}] c77-heartbeat FAIL ${res.status}`, JSON.stringify(data?.error || data).slice(0, 200));
    process.exit(1);
  }
}

ping().catch((err) => {
  console.error(`[${new Date().toISOString()}] c77-heartbeat ERROR`, err.message);
  process.exit(1);
});
