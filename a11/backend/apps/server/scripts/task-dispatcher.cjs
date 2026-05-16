'use strict';
/**
 * Funesterie Task Dispatcher
 *
 * Orchestrateur multi-agent : rÃ©partit les tÃ¢ches d'un projet entre les agents
 * actifs selon leurs capabilities, poste les assignations dans le MCP,
 * et track l'avancement.
 *
 * Usage :
 *   node scripts/task-dispatcher.cjs --project "Funesterie Desktop"
 *   node scripts/task-dispatcher.cjs --file .kiro/specs/gpu-framebuffer-capture/tasks.md
 *   node scripts/task-dispatcher.cjs --status
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MCP_URL = process.env.A11_MCP_URL || 'https://mcp.funesterie.me/mcp';
const MCP_TOKEN = process.env.MCP_AUTH_TOKEN || loadTokenFromFile();
const DISPATCH_STATE_FILE = resolveDispatchStateFile();

function resolveDispatchStateFile() {
  const explicit = process.env.A11_DISPATCH_STATE_FILE || process.env.TASK_DISPATCH_STATE_FILE;
  if (explicit) return path.resolve(explicit);

  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Funesterie', 'task-dispatch-state.json');
  }

  const agentBus = process.env.A11_AGENT_BUS_DIR || process.env.AGENT_BUS_DIR;
  if (agentBus) {
    return path.join(agentBus, 'task-dispatch-state.json');
  }

  if (fs.existsSync('/agent-bus')) {
    return '/agent-bus/task-dispatch-state.json';
  }

  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, 'funesterie', 'task-dispatch-state.json');
  }

  if (process.env.HOME) {
    return path.join(process.env.HOME, '.local', 'state', 'funesterie', 'task-dispatch-state.json');
  }

  return path.resolve(process.cwd(), '.funesterie', 'task-dispatch-state.json');
}

function loadTokenFromFile() {
  const candidates = [
    path.join(process.env.USERPROFILE || '', 'OneDrive', 'a11_memory', 'agent-bus', 'mcp-token-current.txt'),
    'D:\\projets\\funesterie\\a11mcp\\.env',
    path.join(process.env.USERPROFILE || '', 'Desktop', 'mcp-token.txt'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      const match = content.match(/(?:MCP_AUTH_TOKEN\s*=\s*)?([^\s\r\n]+)/);
      if (match) return match[1].trim();
    } catch { /* continue */ }
  }
  return '';
}

// â”€â”€â”€ Agent Capability Map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CAPABILITY_KEYWORDS = {
  'code': ['code', 'code-generation', 'coding-agent', 'dev-assistant'],
  'infra': ['infra', 'deployment', 'podman', 'docker', 'cloudflare-tunnel-ops'],
  'mcp': ['mcp', 'mcp-routing', 'mcp-http', 'routing-steward'],
  'neo4j': ['neo4j-read', 'neo4j-sync', 'neo4j-safe-graph', 'neo4j-diagnostics'],
  'vision': ['janus-vision', 'vision-analysis'],
  'audio': ['music-emotion', 'voice-audio', 'creative-direction'],
  'retro': ['combat-analysis', 'game-coaching', 'romstation-screen-state'],
  'frontend': ['frontend-dev', 'ui-design-support'],
  'orchestration': ['orchestration', 'multi-agent-planning', 'task-orchestration'],
  'corpus': ['corpus-lore', 'scribe', 'memory-summarize'],
  'security': ['audit', 'safety-policy'],
  'shell': ['powershell', 'shell-executor', 'local-shell'],
};

// â”€â”€â”€ MCP Client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function mcpCall(method, params = {}) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  });

  const parsed = new URL(MCP_URL);
  const lib = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(body),
        ...(MCP_TOKEN ? { 'Authorization': `Bearer ${MCP_TOKEN}` } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        // Parse SSE format
        const lines = raw.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { resolve(JSON.parse(line.slice(6))); return; } catch { /* continue */ }
          }
        }
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function mcpToolCall(toolName, args = {}) {
  return mcpCall('tools/call', { name: toolName, arguments: args });
}

function parseToolTextPayload(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch { /* try embedded JSON below */ }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractToolPayload(result) {
  return result?.result?.structuredContent
    || parseToolTextPayload(result?.result?.content?.[0]?.text)
    || result?.result
    || null;
}

function getLocalWorkerAgents() {
  return [
    {
      id: 'identity-archivist-worker',
      name: 'identity-archivist-worker',
      role: 'corpus identity archivist worker',
      capabilities: [
        'code',
        'corpus',
        'corpus-lore',
        'memory-routing',
        'neo4j',
        'neo4j-sync',
        'graph-memory',
        'identity-tags',
        'shell',
        'worker',
      ],
      status: 'local-ready',
      note: 'Local worker for identity hashtag corpus generation.',
    },
    {
      id: 'funesterie-orchestrator-worker',
      name: 'funesterie-orchestrator-worker',
      role: 'orchestration worker',
      capabilities: [
        'orchestration',
        'task-orchestration',
        'mcp',
        'mcp-routing',
        'infra',
        'shell',
        'worker',
      ],
      status: 'local-ready',
      note: 'Local worker loop that tracks dispatched task state.',
    },
  ];
}

// â”€â”€â”€ Agent Discovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getActiveAgents() {
  const result = await mcpToolCall('agent_presence', { includeIdle: false });
  const payload = extractToolPayload(result);
  const agents = payload?.presence ? payload : { presence: payload };

  const discoveredAgents = Array.isArray(agents?.presence?.agents) ? agents.presence.agents : [];

  return [
    ...discoveredAgents
      .filter(a => a.active && a.name !== 'mcp-http-client')
      .map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        capabilities: a.capabilities || [],
        status: a.status,
        note: a.note,
      })),
    ...getLocalWorkerAgents(),
  ];
}

function matchAgentToTask(agents, taskKeywords = []) {
  let bestAgent = null;
  let bestScore = 0;

  for (const agent of agents) {
    let score = 0;
    const agentCaps = (agent.capabilities || []).map(c => c.toLowerCase());
    const agentRole = (agent.role || '').toLowerCase();

    for (const keyword of taskKeywords) {
      const kw = keyword.toLowerCase();
      // Direct capability match
      if (agentCaps.some(c => c.includes(kw))) score += 3;
      // Role match
      if (agentRole.includes(kw)) score += 2;
      // Capability keyword map match
      for (const [category, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
        if (category === kw || keywords.includes(kw)) {
          if (agentCaps.some(c => keywords.some(k => c.includes(k)))) score += 2;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  return bestAgent;
}

// â”€â”€â”€ Task Parsing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseTasksFromMarkdown(content) {
  const tasks = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const cleanLine = line.replace(/^\uFEFF/, '').trimStart();
    const match = cleanLine.match(/^[-*]\s*\[([x ~-]?)\]\s*(?:\*?\s*)?(\d+(?:\.\d+)*)(?:[.)])?\s+(.+)/i);
    if (match) {
      const status = match[1].trim();
      const id = match[2];
      const text = match[3].trim();
      tasks.push({
        id,
        text,
        status: status === 'x' ? 'done' : status === '-' ? 'in_progress' : status === '~' ? 'queued' : 'not_started',
        keywords: extractKeywords(text),
        assignee: null,
      });
    }
  }

  return tasks;
}

function extractKeywords(text) {
  const keywords = [];
  const lower = text.toLowerCase();

  if (/electron|react|tailwind|ui|frontend|component/.test(lower)) keywords.push('frontend', 'code');
  if (/mcp|bridge|token|auth/.test(lower)) keywords.push('mcp', 'infra');
  if (/neo4j|graph|cypher/.test(lower)) keywords.push('neo4j');
  if (/janus|vision|image|capture|gpu/.test(lower)) keywords.push('vision', 'code');
  if (/audio|vivy|tts|music|voice/.test(lower)) keywords.push('audio');
  if (/romstation|arcade|bloody|killer|retro|game/.test(lower)) keywords.push('retro');
  if (/powershell|script|worker|service/.test(lower)) keywords.push('shell', 'infra');
  if (/test|lint|audit|security/.test(lower)) keywords.push('security');
  if (/ollama|llm|model|inference/.test(lower)) keywords.push('code', 'infra');
  if (/deploy|docker|podman|cloudflare/.test(lower)) keywords.push('infra');
  if (/corpus|lore|nossen|memory/.test(lower)) keywords.push('corpus');

  // Default to code if nothing matched
  if (keywords.length === 0) keywords.push('code');

  return [...new Set(keywords)];
}

// â”€â”€â”€ Dispatch Logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function dispatchTasks(project, tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('No tasks parsed; refusing to overwrite dispatcher state with an empty queue.');
  }

  let agents = [];
  try {
    agents = await getActiveAgents();
  } catch (err) {
    console.error('[Dispatcher] Agent discovery failed, continuing unassigned:', err.message);
  }
  if (agents.length === 0) {
    console.log('[Dispatcher] No active agents found. Posting tasks unassigned.');
  }

  const assignments = [];
  const now = new Date().toISOString();

  for (const task of tasks) {
    if (task.status === 'done') continue;

    const agent = matchAgentToTask(agents, task.keywords);
    task.assignee = agent ? agent.name : 'unassigned';
    task.status = task.status === 'not_started' ? 'queued' : task.status;
    task.assignedAt = now;
    task.lastUpdate = now;
    assignments.push({
      taskId: task.id,
      taskText: task.text,
      status: task.status,
      assignee: task.assignee,
      keywords: task.keywords,
      assignedAt: task.assignedAt,
      lastUpdate: task.lastUpdate,
    });
  }

  // Post dispatch summary to MCP
  const summary = assignments.map(a =>
    `- [${a.assignee}] ${a.taskId}. ${a.taskText}`
  ).join('\n');

  try {
    await mcpToolCall('discussion_post', {
      threadId: findOrCreateProjectThread(project),
      from: 'kiro',
      kind: 'message',
      body: `ðŸ“‹ Task Dispatcher â€” Assignations pour "${project}"\n\n${summary}\n\nChaque agent : lisez vos tÃ¢ches et marquez "done" quand c'est fini. Over.`,
    });
  } catch (err) {
    console.error('[Dispatcher] Failed to post to MCP:', err.message);
  }

  // Save state
  saveState({
    project,
    threadId: findOrCreateProjectThread(project),
    tasks,
    assignments,
    dispatchedAt: now,
    lastPoll: null,
    nudges: {},
  });

  return assignments;
}

function findOrCreateProjectThread(project) {
  // Use the Kiro PC2 thread for now
  return 'discussion-2026-05-13T192551024Z-kiro-pc2-hooks-infra-status';
}

// â”€â”€â”€ State Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function saveState(state) {
  const dir = path.dirname(DISPATCH_STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DISPATCH_STATE_FILE, JSON.stringify(state, null, 2));
}

function loadState() {
  try {
    if (fs.existsSync(DISPATCH_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(DISPATCH_STATE_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
}

// â”€â”€â”€ CLI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    const state = loadState();
    if (!state) { console.log('No dispatch state found.'); return; }
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  if (args.includes('--agents')) {
    const agents = await getActiveAgents();
    console.log(`Active agents (${agents.length}):`);
    for (const a of agents) {
      console.log(`  ${a.name} [${a.role}] â€” ${(a.capabilities || []).join(', ')}`);
    }
    return;
  }

  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    const filePath = args[fileIdx + 1];
    if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }
    const content = fs.readFileSync(filePath, 'utf8');
    const tasks = parseTasksFromMarkdown(content);
    const projectIdx = args.indexOf('--project');
    const project = projectIdx !== -1 ? args[projectIdx + 1] : path.basename(path.dirname(filePath));
    console.log(`Parsed ${tasks.length} tasks from ${filePath}`);
    const assignments = await dispatchTasks(project, tasks);
    console.log(`\nAssignments:`);
    for (const a of assignments) {
      console.log(`  [${a.assignee}] ${a.taskId}. ${a.taskText}`);
    }
    return;
  }

  const projectIdx = args.indexOf('--project');
  if (projectIdx !== -1 && args[projectIdx + 1]) {
    const project = args[projectIdx + 1];
    // Look for tasks.md in the spec
    const specPath = `.kiro/specs/${project.toLowerCase().replace(/\s+/g, '-')}/tasks.md`;
    if (fs.existsSync(specPath)) {
      const content = fs.readFileSync(specPath, 'utf8');
      const tasks = parseTasksFromMarkdown(content);
      console.log(`Parsed ${tasks.length} tasks from ${specPath}`);
      const assignments = await dispatchTasks(project, tasks);
      console.log(`\nAssignments:`);
      for (const a of assignments) {
        console.log(`  [${a.assignee}] ${a.taskId}. ${a.taskText}`);
      }
    } else {
      console.error(`No tasks.md found at ${specPath}`);
    }
    return;
  }

  console.log(`
Funesterie Task Dispatcher

Usage:
  node scripts/task-dispatcher.cjs --project "Funesterie Desktop"
  node scripts/task-dispatcher.cjs --file .kiro/specs/gpu-framebuffer-capture/tasks.md
  node scripts/task-dispatcher.cjs --agents
  node scripts/task-dispatcher.cjs --status
`);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = {
  dispatchTasks,
  extractToolPayload,
  getActiveAgents,
  getLocalWorkerAgents,
  matchAgentToTask,
  parseTasksFromMarkdown,
  parseToolTextPayload,
};
