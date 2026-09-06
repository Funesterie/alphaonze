#!/usr/bin/env node
'use strict';
/**
 * funesterie — CLI interactive Djeff Engine.
 *
 * Terminal interactif sur Hetzner. Djeff tape, le système exécute.
 * Accès direct : LLM local, Neo4j, voix, clips, serveur A11, deploy.
 *
 * Usage : node funesterie.cjs
 *         ou: ssh deploy@37.27.63.109 'docker exec -it a11-backend-green node /app/cli/funesterie.cjs'
 */

const readline = require('readline');
const http = require('http');
const https = require('https');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Config ─────────────────────────────────────────────────────────────────
const OLLAMA_BASE = process.env.A11_OLLAMA_BASE || process.env.OLLAMA_BASE_URL || 'http://a11-ollama:11434';
const MODEL = process.env.DJEFF_ENGINE_MODEL || 'djeff-engine';
const SERVER_BASE = process.env.A11_SERVER_BASE || 'http://127.0.0.1:3000';
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://a11-neo4j:7687';
const NEO4J_USER = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASS = process.env.NEO4J_PASSWORD || '';

const VIOLET = '\x1b[35m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ─── Historique de conversation ─────────────────────────────────────────────
const history = [];
const MAX_HISTORY = 20;

// ─── Utilitaires ────────────────────────────────────────────────────────────
function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    mod.get(parsed, { timeout: 15000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve({ raw: d }); } });
    }).on('error', reject);
  });
}

function shell(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim(); }
  catch (e) { return `ERR: ${e.message}`; }
}

// ─── Commandes intégrées ────────────────────────────────────────────────────
const COMMANDS = {
  '/help': () => `${VIOLET}Commandes Funesterie CLI :${RESET}
  /voix          Liste des voix du catalogue
  /songs         Chansons en store
  /clips         Clips produits
  /health        Santé du serveur
  /neo4j         Stats Neo4j
  /produce <url> Lancer un clip
  /profil <file> Profil spectral d'un audio
  /deploy        Redéployer le backend
  /shell <cmd>   Exécuter une commande shell
  /model         Modèle LLM actif
  /switch        Basculer local/cloud
  /clear         Effacer l'historique
  /exit          Quitter`,

  '/voix': async () => {
    const d = await getJson(`${SERVER_BASE}/api/vivy/stream/state`);
    try {
      const catalog = require('/app/src/music/voice-catalog.cjs').readVoiceCatalog();
      return catalog.voices.map(v =>
        `  ${v.active ? GREEN + '●' : RED + '○'} ${RESET}${v.name} ${DIM}${v.voiceId.slice(0, 8)}...${RESET}`
      ).join('\n') + `\n  ${DIM}Total: ${catalog.voices.length}${RESET}`;
    } catch (_) {
      return `${RED}Catalogue non accessible${RESET}`;
    }
  },

  '/songs': async () => {
    const d = await getJson(`${SERVER_BASE}/api/vivy/stream/songs.json`);
    const songs = d.songs || [];
    return songs.slice(0, 15).map((s, i) =>
      `  ${DIM}${i + 1}.${RESET} ${s.trackTitle || s.title || 'Sans titre'} ${DIM}${(s.createdAt || '').slice(0, 10)}${RESET}`
    ).join('\n') + `\n  ${DIM}Total: ${songs.length}${RESET}`;
  },

  '/clips': async () => {
    const d = await getJson(`${SERVER_BASE}/api/mcp-bridge/clip/list`).catch(() => ({ clips: [] }));
    const clips = d.clips || [];
    if (!clips.length) return `  ${DIM}Aucun clip${RESET}`;
    return clips.slice(0, 10).map(c =>
      `  🎬 ${c.name || c.filename} ${DIM}${c.created?.slice(0, 10) || ''}${RESET}`
    ).join('\n');
  },

  '/health': async () => {
    const h = await getJson(`${SERVER_BASE}/health`).catch(e => ({ error: e.message }));
    return h.status === 'ok' ? `${GREEN}● Serveur OK${RESET}` : `${RED}● ${JSON.stringify(h)}${RESET}`;
  },

  '/neo4j': () => {
    if (!NEO4J_PASS) return `${RED}NEO4J_PASSWORD non configuré${RESET}`;
    const result = shell(`cypher-shell -u ${NEO4J_USER} -p ${NEO4J_PASS} -a ${NEO4J_URI} "MATCH (n) RETURN labels(n)[0] AS type, count(*) AS cnt ORDER BY cnt DESC LIMIT 10" 2>/dev/null`);
    return result || `${DIM}Connexion Neo4j échouée${RESET}`;
  },

  '/model': () => `  Modèle: ${CYAN}${MODEL}${RESET}\n  Ollama: ${OLLAMA_BASE}`,

  '/switch': () => {
    // Toggle serait ici si on avait le routeur en mémoire
    return `  ${DIM}Switch local/cloud — pas encore branché dans cette session${RESET}`;
  },

  '/clear': () => { history.length = 0; return `${DIM}Historique effacé${RESET}`; },

  '/shell': (_, args) => shell(args),

  '/profil': (_, args) => {
    if (!args || !fs.existsSync(args)) return `${RED}Fichier introuvable: ${args}${RESET}`;
    const lufs = shell(`ffmpeg -i "${args}" -af loudnorm=print_format=json -f null - 2>&1 | grep input_i`);
    const duration = shell(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${args}"`);
    return `  Durée: ${duration}s\n  ${lufs}`;
  },

  '/deploy': () => {
    return `  ${VIOLET}Pour déployer :${RESET}\n  bash /home/deploy/a11-prod/current/server/ops/redeploy-green.sh`;
  },
};

// ─── Chat avec Djeff Engine ─────────────────────────────────────────────────
async function chatWithDjeff(input) {
  history.push({ role: 'user', content: input });
  if (history.length > MAX_HISTORY * 2) history.splice(0, 2);

  const messages = [
    { role: 'system', content: 'Tu es dans le terminal Funesterie. Réponds de façon concise et technique. Tu as accès au serveur A11, Neo4j, les voix, les clips. Si on te demande de faire quelque chose, donne la commande exacte ou exécute-la.' },
    ...history,
  ];

  try {
    process.stdout.write(`${VIOLET}djeff${RESET} ${DIM}...${RESET}`);
    const res = await postJson(`${OLLAMA_BASE}/api/chat`, {
      model: MODEL,
      messages,
      stream: false,
      options: { temperature: 0.7, num_predict: 1000 },
    });

    const content = res.message?.content || res.raw || 'silence';
    history.push({ role: 'assistant', content });

    // Effacer le "..."
    process.stdout.write('\r\x1b[K');
    return `${VIOLET}djeff${RESET} ${content}`;
  } catch (err) {
    process.stdout.write('\r\x1b[K');
    return `${RED}[LLM offline: ${err.message}]${RESET}\n${DIM}Ollama: ${OLLAMA_BASE} / Model: ${MODEL}${RESET}`;
  }
}

// ─── REPL ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${VIOLET}${BOLD}  ╔══════════════════════════════════════╗${RESET}`);
  console.log(`${VIOLET}${BOLD}  ║     FUNESTERIE INTERACTIF            ║${RESET}`);
  console.log(`${VIOLET}${BOLD}  ║     Djeff Engine @ ${MODEL.slice(0, 14).padEnd(14)}   ║${RESET}`);
  console.log(`${VIOLET}${BOLD}  ╚══════════════════════════════════════╝${RESET}\n`);
  console.log(`${DIM}  /help pour les commandes · Ctrl+C pour quitter${RESET}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${CYAN}funesterie>${RESET} `,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === '/exit' || input === '/quit') {
      console.log(`\n${DIM}À plus.${RESET}`);
      process.exit(0);
    }

    // Commande intégrée ?
    const cmdMatch = input.match(/^(\/\w+)(?:\s+(.*))?$/);
    if (cmdMatch) {
      const cmd = cmdMatch[1].toLowerCase();
      const args = cmdMatch[2] || '';
      if (COMMANDS[cmd]) {
        try {
          const result = await COMMANDS[cmd](cmd, args);
          console.log(result);
        } catch (e) {
          console.log(`${RED}Erreur: ${e.message}${RESET}`);
        }
      } else {
        console.log(`${DIM}Commande inconnue: ${cmd} — /help pour la liste${RESET}`);
      }
    } else {
      // Chat avec Djeff
      const response = await chatWithDjeff(input);
      console.log(response);
    }

    console.log('');
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n${DIM}Session terminée.${RESET}`);
    process.exit(0);
  });
}

main();
