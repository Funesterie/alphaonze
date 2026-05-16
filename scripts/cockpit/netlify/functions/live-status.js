const UPSTREAM_URL = 'https://mcp.funesterie.me/mcp';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

let requestId = 1;

function parseToolText(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (_innerError) {}
    }
  }
  return null;
}

function parseResponseText(text) {
  const raw = String(text || '');
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const data = JSON.parse(line.slice(6));
      const parsed = parseToolText(data?.result?.content?.[0]?.text);
      if (parsed) return parsed;
    } catch (_error) {}
  }
  return parseToolText(raw);
}

async function callTool(name, args = {}) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: `demo-${requestId++}`,
    method: 'tools/call',
    params: { name, arguments: args },
  });

  const response = await fetch(UPSTREAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) return null;
  return parseResponseText(text);
}

function cleanAgentName(agent) {
  const raw = String(agent?.name || agent?.id || '').trim();
  if (!raw) return null;
  if (/neo4j|mcp|qflush|diagnostic|port|token|secret/i.test(raw)) return 'Agent';
  return raw.slice(0, 34);
}

function isJapaneseVariant(state) {
  const raw = [
    state?.game,
    state?.windowTitle,
    state?.launcher?.title,
    state?.kiro?.summary,
  ].filter(Boolean).join(' ');
  return /japanese|japan|jpn|\(j\)|\[j\]|\bjp\b/i.test(raw);
}

function summarizePitchingThreads(value) {
  const threads = Array.isArray(value?.discussions) ? value.discussions : [];
  const items = threads.slice(0, 6).map((thread) => {
    const pitching = thread?.pitching || thread?.pitch || {};
    const requiredAnswered = Number(pitching.requiredAnswered || 0);
    const requiredTotal = Number(pitching.requiredTotal || 0);
    const expectedAnswered = Number(pitching.expectedAnswered || 0);
    const expectedTotal = Number(pitching.expectedTotal || 0);
    return {
      title: String(thread?.title || 'Rendez-vous agents').slice(0, 80),
      ready: !!pitching.ready,
      requiredAnswered,
      requiredTotal,
      expectedAnswered,
      expectedTotal,
      deadlineSoftPassed: !!pitching.deadlineSoftPassed,
    };
  });
  return {
    total: threads.length,
    ready: items.filter((item) => item.ready).length,
    items,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: 'method_not_allowed' }),
    };
  }

  const settled = await Promise.allSettled([
    callTool('a11_status'),
    callTool('kaen44_status'),
    callTool('agent_presence', { includeIdle: true }),
    callTool('agent_jobs'),
    callTool('romstation_state'),
    callTool('qflush_gamepad_status'),
    callTool('discussion_list', { status: 'pitching', limit: 10 }),
  ]);

  const [a11, kaen44, presence, jobs, romstation, controller, pitchingThreads] = settled.map((item) =>
    item.status === 'fulfilled' ? item.value : null
  );

  const agents = Array.isArray(presence?.presence?.agents) ? presence.presence.agents : [];
  const jobList = Array.isArray(jobs?.jobs?.jobs) ? jobs.jobs.jobs : [];
  const gameState = romstation?.state || null;
  const controllerStatus = controller?.status || null;
  const activeAgents = Number(presence?.presence?.activeCount || agents.filter((agent) => agent?.active).length || 0);
  const totalAgents = Number(presence?.presence?.totalCount || agents.length || 0);

  const summary = {
    ok: true,
    updatedAt: new Date().toISOString(),
    a11: {
      ok: !!a11?.status?.ok,
    },
    kaen44: {
      ok: !!kaen44?.status?.ok,
    },
    agents: {
      active: activeAgents,
      total: totalAgents,
      names: agents
        .filter((agent) => agent?.active)
        .map(cleanAgentName)
        .filter(Boolean)
        .map((name, index) => name === 'Agent' ? `Agent ${index + 1}` : name)
        .slice(0, 8),
    },
    jobs: {
      total: jobList.length,
      ready: jobList.filter((job) => job?.status === 'ready').length,
      running: jobList.filter((job) => job?.status === 'running').length,
    },
    game: {
      source: 'RomStation',
      ready: !!gameState?.available && !isJapaneseVariant(gameState),
      phase: String(gameState?.phase || 'waiting').slice(0, 40),
      japaneseIgnored: !isJapaneseVariant(gameState),
    },
    controller: {
      ready: !!controllerStatus?.ok,
      recentCount: Array.isArray(controllerStatus?.recent) ? controllerStatus.recent.length : 0,
      target: controllerStatus?.targetDefault === 'romstation' ? 'RomStation' : 'RomStation',
    },
    pitching: summarizePitchingThreads(pitchingThreads),
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(summary),
  };
};
