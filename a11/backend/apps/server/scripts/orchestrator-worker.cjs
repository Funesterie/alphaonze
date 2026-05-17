'use strict';
/**
 * Funesterie Orchestrator Worker
 *
 * Boucle d'orchestration : ChatGPT Enterprise (ou tout agent orchestrateur)
 * poll les tÃ¢ches assignÃ©es, vÃ©rifie l'avancement, relance les agents en retard,
 * et ne s'arrÃªte que quand tout est "done".
 *
 * Peut tourner en tÃ¢che planifiÃ©e Windows ou en daemon.
 *
 * Usage :
 *   node scripts/orchestrator-worker.cjs --project "Funesterie Desktop"
 *   node scripts/orchestrator-worker.cjs --loop          # boucle infinie (daemon)
 *   node scripts/orchestrator-worker.cjs --once          # un seul check
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MCP_URL = process.env.A11_MCP_URL || 'https://mcp.funesterie.me/mcp';
const MCP_TOKEN = process.env.MCP_AUTH_TOKEN || loadToken();
const POLL_INTERVAL_MS = Number(process.env.ORCHESTRATOR_POLL_MS || 60_000); // 1 min
const STALE_TASK_THRESHOLD_MS = 30 * 60 * 1000; // 30 min sans update = relance
const MAX_NUDGES = 3; // Max relances avant escalade
const ORCHESTRATOR_ID = process.env.ORCHESTRATOR_ID || 'chatgpt-enterprise';
const STATE_FILE = resolveStateFile(
  process.env.ORCHESTRATOR_STATE_FILE
  || process.env.A11_DISPATCH_STATE_FILE
  || process.env.TASK_DISPATCH_STATE_FILE,
  'task-dispatch-state.json'
);
const LEGACY_STATE_FILE = resolveStateFile(process.env.ORCHESTRATOR_LEGACY_STATE_FILE, 'orchestrator-state.json');

function resolveStateFile(explicit, filename) {
  if (explicit) return path.resolve(explicit);

  const agentBus = process.env.A11_AGENT_BUS_DIR || process.env.AGENT_BUS_DIR;
  if (agentBus) {
    return path.join(agentBus, filename);
  }

  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Funesterie', filename);
  }

  if (fs.existsSync('/agent-bus')) {
    return path.join('/agent-bus', filename);
  }

  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, 'funesterie', filename);
  }

  if (process.env.HOME) {
    return path.join(process.env.HOME, '.local', 'state', 'funesterie', filename);
  }

  return path.resolve(process.cwd(), '.funesterie', filename);
}

function loadToken() {
  const agentBusDir = process.env.A11_AGENT_BUS_DIR || process.env.AGENT_BUS_DIR || 'D:\\agent-bus';
  const candidates = [
    process.env.A11_MCP_TOKEN_FILE,
    process.env.MCP_AUTH_TOKEN_FILE,
    path.join(agentBusDir, 'mcp-token-current.txt'),
    'D:\\projets\\funesterie\\a11mcp\\.env',
    // Legacy sync folder. Keep last so Drive is never used as the live bus.
    path.join(process.env.USERPROFILE || '', 'OneDrive', 'a11_memory', 'agent-bus', 'mcp-token-current.txt'),
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

// â”€â”€â”€ MCP Client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function mcpToolCall(toolName, args = {}) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
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
        for (const line of raw.split('\n')) {
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

// â”€â”€â”€ State Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function loadState() {
  for (const file of [STATE_FILE, LEGACY_STATE_FILE]) {
    try {
      if (fs.existsSync(file)) return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { /* ignore */ }
  }
  return { tasks: [], lastPoll: null, nudges: {} };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(normalizeState(state), null, 2));
}

function findOrCreateProjectThread() {
  return 'discussion-2026-05-13T192551024Z-kiro-pc2-hooks-infra-status';
}

function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? { ...raw } : {};
  const assignments = Array.isArray(state.assignments) ? state.assignments : [];
  const tasks = Array.isArray(state.tasks) && state.tasks.length
    ? state.tasks
    : assignments.map((assignment) => ({
      id: String(assignment.taskId || assignment.id || ''),
      text: String(assignment.taskText || assignment.text || ''),
      status: assignment.status || 'queued',
      keywords: assignment.keywords || [],
      assignee: assignment.assignee || 'unassigned',
      assignedAt: assignment.assignedAt || state.dispatchedAt || new Date().toISOString(),
      lastUpdate: assignment.lastUpdate || state.dispatchedAt || new Date().toISOString(),
    })).filter((task) => task.id);
  return {
    project: state.project || 'Funesterie',
    threadId: state.threadId || findOrCreateProjectThread(state.project || 'Funesterie'),
    dispatchedAt: state.dispatchedAt || null,
    assignments,
    tasks,
    lastPoll: state.lastPoll || null,
    nudges: state.nudges || {},
    escalations: state.escalations || {},
  };
}

// â”€â”€â”€ Orchestration Logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function checkTaskProgress(state) {
  const now = Date.now();
  const actions = [];

  for (const task of state.tasks) {
    if (task.status === 'done') continue;

    const lastUpdate = new Date(task.lastUpdate || task.assignedAt || 0).getTime();
    const elapsed = now - lastUpdate;
    const nudgeCount = state.nudges[task.id] || 0;

    if (elapsed > STALE_TASK_THRESHOLD_MS && nudgeCount < MAX_NUDGES) {
      // Task is stale â€” nudge the assignee
      actions.push({
        type: 'nudge',
        task,
        reason: `Pas de mise Ã  jour depuis ${Math.round(elapsed / 60000)} min`,
      });
      state.nudges[task.id] = nudgeCount + 1;
    } else if (nudgeCount >= MAX_NUDGES && !state.escalations[task.id]) {
      // Too many nudges â€” escalate
      actions.push({
        type: 'escalate',
        task,
        reason: `${MAX_NUDGES} relances sans rÃ©ponse â€” escalade Ã  Djeff`,
      });
      state.escalations[task.id] = new Date().toISOString();
    }
  }

  return actions;
}

async function executeActions(actions, state) {
  for (const action of actions) {
    if (action.type === 'nudge') {
      await nudgeAgent(action.task, action.reason);
    } else if (action.type === 'escalate') {
      await escalateTask(action.task, action.reason);
    }
  }
}

async function nudgeAgent(task, reason) {
  const message = `ðŸ”” [Orchestrator] Relance pour @${task.assignee}\n\nTÃ¢che : ${task.id}. ${task.text}\nRaison : ${reason}\n\nMerci de poster un update ou marquer "done". Si tu es bloquÃ©, dis-le.`;

  try {
    await mcpToolCall('discussion_post', {
      threadId: state?.threadId || 'discussion-2026-05-13T192551024Z-kiro-pc2-hooks-infra-status',
      from: ORCHESTRATOR_ID,
      kind: 'message',
      body: message,
    });
    console.log(`[Orchestrator] Nudged ${task.assignee} for task ${task.id}`);
  } catch (err) {
    console.error(`[Orchestrator] Failed to nudge:`, err.message);
  }
}

async function escalateTask(task, reason) {
  const message = `âš ï¸ [Orchestrator] ESCALADE\n\nTÃ¢che : ${task.id}. ${task.text}\nAssignÃ© Ã  : ${task.assignee}\nRaison : ${reason}\n\n@djeff â€” intervention nÃ©cessaire ou rÃ©assignation.`;

  try {
    await mcpToolCall('discussion_post', {
      threadId: state?.threadId || 'discussion-2026-05-13T192551024Z-kiro-pc2-hooks-infra-status',
      from: ORCHESTRATOR_ID,
      kind: 'status',
      body: message,
    });
    console.log(`[Orchestrator] Escalated task ${task.id}`);
  } catch (err) {
    console.error(`[Orchestrator] Failed to escalate:`, err.message);
  }
}

async function checkForCompletions(state) {
  // Read recent discussion messages to detect "done" markers
  try {
    const result = await mcpToolCall('discussion_read', {
      threadId: state.threadId,
      limit: 20,
    });

    const payload = extractToolPayload(result);
    const messages = payload?.discussion?.messages || [];

    for (const msg of messages) {
      const body = (msg.body || '').toLowerCase();
      if (body.includes('done') || body.includes('terminÃ©') || body.includes('fini') || body.includes('âœ…')) {
        // Check if it references a task
        for (const task of state.tasks) {
          if (task.status === 'done') continue;
          if (body.includes(task.id) || body.includes(task.text.toLowerCase().slice(0, 30))) {
            if (msg.from === task.assignee || msg.from === 'djeff') {
              task.status = 'done';
              task.completedAt = msg.at;
              task.completedBy = msg.from;
              console.log(`[Orchestrator] Task ${task.id} marked done by ${msg.from}`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Orchestrator] Failed to check completions:`, err.message);
  }
}

async function reportProgress(state) {
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.status === 'done').length;
  const inProgress = state.tasks.filter(t => t.status === 'in_progress').length;
  const pending = total - done - inProgress;

  if (done === total) {
    // All done!
    const message = `ðŸŽ‰ [Orchestrator] PROJET TERMINÃ‰ !\n\nToutes les ${total} tÃ¢ches sont complÃ©tÃ©es.\n\n${state.tasks.map(t => `âœ… ${t.id}. ${t.text} (${t.assignee})`).join('\n')}`;

    await mcpToolCall('discussion_post', {
      threadId: state.threadId,
      from: ORCHESTRATOR_ID,
      kind: 'status',
      body: message,
    });

    await mcpToolCall('memory_write_safe', {
      from: ORCHESTRATOR_ID,
      title: `Projet "${state.project}" terminÃ©`,
      body: `Toutes les ${total} tÃ¢ches complÃ©tÃ©es. Agents impliquÃ©s : ${[...new Set(state.tasks.map(t => t.assignee))].join(', ')}`,
      scope: 'decision',
      kind: 'agent_decision',
      tags: ['project-complete', state.project.toLowerCase().replace(/\s+/g, '-')],
    });

    return true; // Signal to stop the loop
  }

  console.log(`[Orchestrator] Progress: ${done}/${total} done, ${inProgress} in progress, ${pending} pending`);
  return false;
}

// â”€â”€â”€ Main Loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let state = null;

async function runOnce() {
  state = loadState();
  if (!state.tasks || state.tasks.length === 0) {
    console.log('[Orchestrator] No tasks loaded. Use task-dispatcher.cjs first.');
    return false;
  }

  // Check for completions from discussion messages
  await checkForCompletions(state);

  // Check for stale tasks and nudge
  const actions = await checkTaskProgress(state);
  if (actions.length > 0) {
    await executeActions(actions, state);
  }

  // Report progress
  const allDone = await reportProgress(state);

  // Save state
  state.lastPoll = new Date().toISOString();
  saveState(state);

  return allDone;
}

async function runLoop() {
  console.log(`[Orchestrator] Starting loop (poll every ${POLL_INTERVAL_MS / 1000}s)`);

  while (true) {
    try {
      const done = await runOnce();
      if (done) {
        console.log('[Orchestrator] All tasks complete. Exiting.');
        break;
      }
    } catch (err) {
      console.error('[Orchestrator] Error in loop:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--once')) {
    await runOnce();
  } else if (args.includes('--loop')) {
    await runLoop();
  } else if (args.includes('--status')) {
    const s = loadState();
    console.log(JSON.stringify(s, null, 2));
  } else {
    console.log(`
Funesterie Orchestrator Worker

Usage:
  node scripts/orchestrator-worker.cjs --once     # Single check
  node scripts/orchestrator-worker.cjs --loop     # Daemon mode (polls until all done)
  node scripts/orchestrator-worker.cjs --status   # Show current state

Env:
  ORCHESTRATOR_POLL_MS=60000    # Poll interval (default 1 min)
  ORCHESTRATOR_ID=chatgpt-enterprise  # Who posts the nudges
  MCP_AUTH_TOKEN=...            # MCP auth token
`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
