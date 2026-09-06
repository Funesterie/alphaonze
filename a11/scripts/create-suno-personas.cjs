'use strict';
/**
 * create-suno-personas.cjs
 * 
 * Crée une persona Suno pour chaque sample vocal dans /app/runtime/voice-samples/
 * qui n'a pas encore de voiceId dans le catalogue.
 *
 * Utilise l'API Suno upload-extend → generate-persona (même chemin que persona-recovery.cjs).
 *
 * Usage: docker exec -e ELEVENLABS_API_KEY=... a11-backend-green node /app/scripts/create-suno-personas.cjs
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const SAMPLE_DIR = '/app/runtime/voice-samples';
const CALLBACK_URL = process.env.VIVY_SUNO_CALLBACK_URL || 'https://vivy.funesterie.me/api/vivy/studio/suno/callback';

// Charger la clé Suno
const keyFile = process.env.VIVY_SUNO_API_KEY_FILE || '';
let SUNO_KEY = '';
if (keyFile && fs.existsSync(keyFile)) SUNO_KEY = fs.readFileSync(keyFile, 'utf8').trim();
if (!SUNO_KEY) SUNO_KEY = process.env.VIVY_SUNO_API_KEY || '';

const SUNO_BASE = process.env.VIVY_SUNO_BASE_URL || 'https://api.sunoapi.org/api/v1';

let catalog;
try { catalog = require('/app/src/music/voice-catalog.cjs'); }
catch (_) { catalog = require(path.resolve(__dirname, '../backend/apps/server/src/music/voice-catalog.cjs')); }

function postJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: 60000,
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (_) { resolve({ status: res.statusCode, data: { raw: Buffer.concat(chunks).toString() } }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    mod.get(parsed, { headers, timeout: 30000 }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (_) { resolve({ status: res.statusCode, data: { raw: Buffer.concat(chunks).toString() } }); }
      });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Agents à créer
const AGENTS = [
  { name: 'vivy', label: 'Vivy', gender: 'female', consentBy: 'djeff' },
  { name: 'a11', label: 'A11', gender: 'male', consentBy: 'djeff' },
  { name: 'kaen44', label: 'Kaen44', gender: 'female', consentBy: 'djeff' },
  { name: 'grok', label: 'Grok', gender: 'male', consentBy: 'djeff' },
  { name: 'claude', label: 'Claude', gender: 'male', consentBy: 'djeff' },
  { name: 'chatgpt', label: 'ChatGPT', gender: 'male', consentBy: 'djeff' },
  { name: 'kiro', label: 'Kiro', gender: 'male', consentBy: 'djeff' },
  { name: 'codex', label: 'Codex', gender: 'male', consentBy: 'djeff' },
  { name: 'gemini', label: 'Gemini', gender: 'male', consentBy: 'djeff' },
];

async function createPersonaForAgent(agent) {
  const samplePath = path.join(SAMPLE_DIR, `${agent.name}.mp3`);
  if (!fs.existsSync(samplePath)) {
    return { ok: false, reason: 'no_sample', name: agent.name };
  }

  // Vérifier si déjà dans le catalogue
  const existing = catalog.findVoiceInCatalog(agent.name);
  if (existing && existing.voiceId && existing.active && !existing.personaExpiredAt) {
    return { ok: false, reason: 'already_active', name: agent.name, voiceId: existing.voiceId.slice(0, 8) };
  }

  // Le sample doit être accessible via URL pour l'API Suno
  // On utilise le endpoint play-upload du serveur local
  const sampleUrl = `https://a11.funesterie.me/api/vivy/stream/download?url=/runtime/voice-samples/${agent.name}.mp3&kind=voice-sample`;

  console.log(`  [${agent.name}] Création persona via upload-extend...`);

  // 1. Upload-extend : soumettre l'échantillon
  const headers = { Authorization: `Bearer ${SUNO_KEY}` };
  const uploadRes = await postJson(`${SUNO_BASE}/generate/upload-extend`, {
    uploadUrl: sampleUrl,
    defaultParamFlag: false,
    instrumental: false,
    continueAt: 8, // 8s, longueur typique d'un sample
    model: process.env.VIVY_SUNO_MODEL || 'V5_5',
    callBackUrl: CALLBACK_URL,
  }, headers);

  if (uploadRes.status !== 200 || !uploadRes.data?.data?.taskId) {
    return { ok: false, reason: 'upload_failed', name: agent.name, detail: JSON.stringify(uploadRes.data).slice(0, 200) };
  }

  const taskId = uploadRes.data.data.taskId;
  console.log(`  [${agent.name}] taskId: ${taskId}, attente...`);

  // 2. Attendre que la génération soit terminée
  let audioId = '';
  for (let i = 0; i < 30 && !audioId; i++) {
    await sleep(8000);
    const info = await getJson(`${SUNO_BASE}/generate/record-info?taskId=${encodeURIComponent(taskId)}`, headers);
    const records = info.data?.data?.response?.recordInfos || info.data?.data?.recordInfos || [];
    for (const rec of (Array.isArray(records) ? records : [])) {
      if (rec.id && (rec.status === 'complete' || rec.audio_url)) {
        audioId = rec.id;
        break;
      }
    }
    if (!audioId) process.stdout.write('.');
  }
  
  if (!audioId) {
    return { ok: false, reason: 'generation_timeout', name: agent.name, taskId };
  }
  console.log(`\n  [${agent.name}] audioId: ${audioId}`);

  // 3. Créer la persona à partir de l'audio
  const personaRes = await postJson(`${SUNO_BASE}/generate/generate-persona`, {
    audioId,
    voiceName: `Funesterie ${agent.label}`,
  }, headers);

  if (personaRes.status !== 200 || !personaRes.data?.data?.voiceId) {
    // Essayer d'extraire le voiceId d'un autre champ
    const altId = personaRes.data?.data?.persona_id || personaRes.data?.data?.id || '';
    if (altId && /^[a-f0-9]{32}$/i.test(altId)) {
      return await registerVoice(agent, altId);
    }
    return { ok: false, reason: 'persona_creation_failed', name: agent.name, detail: JSON.stringify(personaRes.data).slice(0, 200) };
  }

  const voiceId = personaRes.data.data.voiceId;
  return await registerVoice(agent, voiceId);
}

async function registerVoice(agent, voiceId) {
  console.log(`  [${agent.name}] voiceId: ${voiceId}`);
  
  // Enregistrer dans le catalogue
  try {
    catalog.upsertVoiceInCatalog({
      name: agent.name,
      label: agent.label,
      voiceId,
      owner: 'Funesterie',
      consentBy: agent.consentBy,
      gender: agent.gender,
      style: `Voix ${agent.label} pour le casting Funesterie`,
      aliases: [],
      addedBy: 'create-suno-personas-script',
      addedAt: new Date().toISOString(),
    });
    return { ok: true, name: agent.name, voiceId };
  } catch (err) {
    return { ok: false, reason: 'catalog_write_failed', name: agent.name, error: err.message };
  }
}

async function main() {
  if (!SUNO_KEY) {
    console.error('ERREUR: Clé Suno API manquante');
    process.exit(1);
  }

  console.log(`Création de personas Suno pour ${AGENTS.length} agents...`);
  console.log(`API: ${SUNO_BASE}`);
  console.log(`Callback: ${CALLBACK_URL}`);
  console.log('');

  const results = [];
  for (const agent of AGENTS) {
    try {
      const result = await createPersonaForAgent(agent);
      results.push(result);
      if (result.ok) {
        console.log(`  ✓ ${agent.name}: ${result.voiceId}`);
      } else {
        console.log(`  ✗ ${agent.name}: ${result.reason} ${result.detail || ''}`);
      }
      // Délai entre chaque pour ne pas surcharger l'API
      await sleep(3000);
    } catch (err) {
      console.error(`  ✗ ${agent.name}: CRASH ${err.message}`);
      results.push({ ok: false, name: agent.name, reason: 'crash', error: err.message });
    }
  }

  console.log(`\n─── Résultat ───`);
  const ok = results.filter(r => r.ok);
  const skip = results.filter(r => r.reason === 'already_active');
  const fail = results.filter(r => !r.ok && r.reason !== 'already_active');
  console.log(`  Créés  : ${ok.length}`);
  console.log(`  Skip   : ${skip.length} (déjà actifs)`);
  console.log(`  Échecs : ${fail.length}`);
  if (ok.length > 0) {
    console.log(`\n  Nouvelles voix:`);
    ok.forEach(r => console.log(`    ${r.name}: ${r.voiceId}`));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
