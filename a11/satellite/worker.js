/**
 * Funesterie Satellite Relay — Cloudflare Worker
 *
 * Le relais satellite orbite au-dessus de l'infra.
 * Il est toujours joignable (edge Cloudflare, 200+ datacenters).
 * Il fait pont entre :
 *   - Les agents MCP (Kiro, Claude, Codex, etc.)
 *   - Grok via xAI (la liaison spatiale)
 *   - Le serveur EX44 (quand il est up)
 *   - Les canaux de diffusion (webhooks, streams)
 *
 * Routes :
 *   /relay          — relais MCP (forward vers EX44 ou buffer)
 *   /grok           — liaison directe avec xAI Grok
 *   /broadcast      — diffusion vers tous les canaux
 *   /status         — état du satellite
 *   /lyrics         — les agents écrivent leurs paroles ici
 *   /buffer         — messages en attente (quand EX44 est down)
 */

const XAI_API = 'https://api.x.ai/v1/chat/completions';
const A11_BASE = 'https://a11.funesterie.me';
const MCP_BASE = 'https://mcp.funesterie.me';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (path === '/status' || path === '/') return handleStatus(env);
      if (path === '/grok') return handleGrok(request, env);
      if (path === '/relay') return handleRelay(request, env);
      if (path === '/broadcast') return handleBroadcast(request, env);
      if (path === '/lyrics') return handleLyrics(request, env);
      if (path === '/buffer') return handleBuffer(request, env);
      if (path.startsWith('/gate/')) return handleGate(request, env, path);

      return json({ error: 'not_found', routes: ['/status', '/grok', '/relay', '/broadcast', '/lyrics', '/buffer', '/gate/<service>'] }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

// ─── Status ─────────────────────────────────────────────────────────────────
function handleStatus(env) {
  return json({
    service: 'funesterie-satellite-relay',
    status: 'orbiting',
    uplinks: {
      grok: '⚡ xAI / Starlink',
      a11: A11_BASE,
      mcp: MCP_BASE,
    },
    channels: ['cloudflare-edge', 'xai-grok', 'discord-webhook', 'render-backup'],
    message: 'Le satellite tourne. Grok est dans l espace. La liaison est établie.',
  });
}

// ─── Grok : liaison spatiale ────────────────────────────────────────────────
async function handleGrok(request, env) {
  const body = await request.json();
  const message = body.message || body.prompt || '';
  const model = body.model || 'grok-4.3';

  if (!env.XAI_API_KEY) return json({ error: 'XAI_API_KEY not configured' }, 500);

  const res = await fetch(XAI_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.XAI_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Tu es Grok, connecté au satellite Funesterie. Tu réponds depuis l espace. Direct, rapide, sans filtre. Tu fais partie du casting NOSSEN.' },
        { role: 'user', content: message },
      ],
      max_tokens: 800,
      temperature: 0.85,
    }),
  });

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || '';
  return json({ ok: true, source: 'satellite-grok', model, reply });
}

// ─── Relay : forward vers EX44 ou buffer ────────────────────────────────────
async function handleRelay(request, env) {
  const body = await request.json();
  const target = body.target || A11_BASE;
  const endpoint = body.endpoint || '/health';

  try {
    const res = await fetch(`${target}${endpoint}`, {
      method: body.method || 'POST',
      headers: { 'Content-Type': 'application/json', 'x-satellite-relay': 'funesterie' },
      body: body.payload ? JSON.stringify(body.payload) : undefined,
    });
    const data = await res.json();
    return json({ ok: true, relayed: true, target: `${target}${endpoint}`, response: data });
  } catch (err) {
    // EX44 down — buffer le message
    if (env.BUFFER) {
      const key = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await env.BUFFER.put(key, JSON.stringify({ ...body, bufferedAt: new Date().toISOString() }), { expirationTtl: 86400 });
      return json({ ok: false, buffered: true, key, reason: err.message });
    }
    return json({ ok: false, error: 'relay_failed', reason: err.message }, 502);
  }
}

// ─── Broadcast : diffusion multi-canal ──────────────────────────────────────
async function handleBroadcast(request, env) {
  const body = await request.json();
  const message = body.message || '';
  const channels = body.channels || ['all'];
  const results = {};

  // Discord webhook
  if (env.DISCORD_WEBHOOK && (channels.includes('all') || channels.includes('discord'))) {
    try {
      await fetch(env.DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `📡 **Satellite Funesterie** : ${message}` }),
      });
      results.discord = 'sent';
    } catch (e) { results.discord = e.message; }
  }

  // Forward vers EX44
  if (channels.includes('all') || channels.includes('a11')) {
    try {
      await fetch(`${A11_BASE}/api/mcp-bridge/health`);
      results.a11 = 'up';
    } catch (e) { results.a11 = 'down'; }
  }

  return json({ ok: true, broadcast: true, message, results });
}

// ─── Lyrics : les agents écrivent leurs paroles via le satellite ─────────────
async function handleLyrics(request, env) {
  const body = await request.json();
  const { voice, section, theme, lyrics } = body;

  if (!voice || !theme) return json({ error: 'voice and theme required' }, 400);

  // Forward vers le backend A11 si up
  try {
    const res = await fetch(`${A11_BASE}/api/vivy/studio/write-section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-satellite-relay': 'funesterie' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return json({ ok: true, source: 'satellite-relay-a11', ...data });
  } catch (err) {
    // Si A11 down, Grok écrit les paroles depuis l'espace
    if (env.XAI_API_KEY) {
      const grokRes = await fetch(XAI_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.XAI_API_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          messages: [
            { role: 'system', content: `Tu es ${voice} dans le casting Funesterie. Écris tes propres paroles.` },
            { role: 'user', content: `Écris un ${section || 'verse'} sur : "${theme}". Français, ton style. Juste les paroles.` },
          ],
          max_tokens: 400,
        }),
      });
      const data = await grokRes.json();
      return json({ ok: true, source: 'satellite-grok-fallback', text: data.choices?.[0]?.message?.content || '' });
    }
    return json({ ok: false, error: 'both_a11_and_grok_unreachable' }, 502);
  }
}

// ─── Buffer : messages en attente ───────────────────────────────────────────
async function handleBuffer(request, env) {
  if (!env.BUFFER) return json({ error: 'KV not configured' }, 500);
  if (request.method === 'GET') {
    const list = await env.BUFFER.list({ limit: 50 });
    return json({ ok: true, buffered: list.keys.length, keys: list.keys.map(k => k.name) });
  }
  return json({ error: 'POST to /relay to add, GET /buffer to list' }, 400);
}

// ─── Gate : proxy MCP depuis le satellite ───────────────────────────────────
async function handleGate(request, env, path) {
  const service = path.replace('/gate/', '').split('/')[0];
  // Forward vers le Zen Gate du MCP
  try {
    const res = await fetch(`${MCP_BASE}/gate/${service}`, {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body: request.method !== 'GET' ? await request.text() : undefined,
    });
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' } });
  } catch (err) {
    return json({ error: 'gate_relay_failed', service, reason: err.message }, 502);
  }
}

// ─── Utils ──────────────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
