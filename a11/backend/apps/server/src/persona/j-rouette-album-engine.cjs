'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

const ALBUM_ID = 'J_ROUETTE_STYLE';
const MAX_BRIEF_CHARS = 2400;
const MAX_MODULE_BRIEF_CHARS = 1200;

function djeffPersonaDir(env = process.env) {
  return path.join(getCanonicalRuntimeRoot(env), 'personas', 'djeff');
}

function albumPlanPath(env = process.env) {
  return path.join(djeffPersonaDir(env), 'djeff-album-j-rouette-style.json');
}

function albumModulesPath(env = process.env) {
  return path.join(djeffPersonaDir(env), 'djeff-album-j-rouette-modules.json');
}

function albumKnowledgePath(env = process.env) {
  return path.join(djeffPersonaDir(env), 'djeff-album-j-rouette-knowledge.jsonl');
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readKnowledgeEntries(env = process.env) {
  const file = albumKnowledgePath(env);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadAlbumPlan(env = process.env) {
  return readJson(albumPlanPath(env), null);
}

function loadAlbumModules(env = process.env) {
  const data = readJson(albumModulesPath(env), { modules: [] });
  return Array.isArray(data.modules) ? data.modules : [];
}

function isAlbumApproved(plan = {}) {
  const status = String(plan.status || '').trim().toLowerCase();
  return status.includes('approved');
}

function detectJRouetteAlbumIntent(text = '') {
  const folded = String(text || '').toLowerCase();
  return /\b(j[\s-]?rouette|rouette\s*style|roue\s*libre.*babylone|babylone.*point\s*mort|dedommagement|dossier\s*74|compression\s*v[eé]cue|kick\s*qui\s*grippe)\b/i.test(folded)
    || (/\broue\b/i.test(folded) && /\b(psy|psychiatr|babylone|50cc|am6|variateur|atelier|dossier)\b/i.test(folded));
}

function buildModuleBrief(modules = [], { limit = 8 } = {}) {
  const picked = modules.slice(0, Math.max(1, limit));
  if (!picked.length) return '';
  const chunks = picked.map((mod) => {
    const tools = Array.isArray(mod.tools) ? mod.tools.join(', ') : '';
    return `${mod.label || mod.id}: ${mod.purpose || ''}${tools ? ` [${tools}]` : ''}`;
  });
  return chunks.join(' | ').slice(0, MAX_MODULE_BRIEF_CHARS);
}

function buildTrackLines(plan = {}) {
  const tracks = Array.isArray(plan.tracks) ? plan.tracks : [];
  return tracks.map((track) => {
    const hook = track.hook ? ` — ${track.hook}` : '';
    return `${track.n}. ${track.title} (${track.role})${hook}`;
  });
}

function buildJRouetteAlbumBrief(env = process.env, { includeModules = true } = {}) {
  const plan = loadAlbumPlan(env);
  if (!plan || !isAlbumApproved(plan)) return '';

  const structure = plan.structure || {};
  const tracks = buildTrackLines(plan).join(' ; ');
  const modules = includeModules ? buildModuleBrief(loadAlbumModules(env)) : '';
  const knowledge = readKnowledgeEntries(env)
    .slice(0, 6)
    .map((entry) => `${entry.title}: ${String(entry.body || '').replace(/\s+/g, ' ').trim()}`)
    .join(' | ');

  const parts = [
    `Album ${plan.workingTitle || ALBUM_ID} (GO Djeff): ${plan.concept || ''}`,
    structure.coupletA ? `Couplet A: ${structure.coupletA}` : '',
    structure.coupletB ? `Couplet B: ${structure.coupletB}` : '',
    structure.refrain ? `Refrain: ${structure.refrain}` : '',
    structure.pont ? `Pont: ${structure.pont}` : '',
    tracks ? `Titres: ${tracks}` : '',
    modules ? `Modules/outils: ${modules}` : '',
    knowledge ? `Connaissances: ${knowledge}` : '',
    'Garde-fous: pas de noms réels; méca = anthropie matière; dossier froid vs vécu brut.',
  ].filter(Boolean);

  return parts.join(' ').slice(0, MAX_BRIEF_CHARS);
}

function buildJRouetteTrackBrief(trackNumber = 0, env = process.env) {
  const plan = loadAlbumPlan(env);
  if (!plan || !isAlbumApproved(plan)) return '';
  const track = (plan.tracks || []).find((item) => Number(item.n) === Number(trackNumber));
  if (!track) return '';
  const knowledge = readKnowledgeEntries(env)
    .filter((entry) => Number(entry.track) === Number(trackNumber) || entry.trackId === track.title)
    .map((entry) => entry.body)
    .join(' ');
  return [
    `Morceau ${track.n} — ${track.title} (${track.role})`,
    track.mood ? `Mood: ${track.mood}` : '',
    track.hook ? `Hook: ${track.hook}` : '',
    track.note ? `Note: ${track.note}` : '',
    knowledge,
  ].filter(Boolean).join(' ').slice(0, MAX_BRIEF_CHARS);
}

function listJRouetteModules(env = process.env) {
  return loadAlbumModules(env).map((mod) => ({
    id: mod.id,
    label: mod.label,
    purpose: mod.purpose,
    tools: mod.tools || [],
    knowledgeRefs: mod.knowledgeRefs || [],
  }));
}

function resolveJRouetteContextForPrompt(text = '', env = process.env) {
  if (!detectJRouetteAlbumIntent(text)) return '';
  return buildJRouetteAlbumBrief(env);
}

module.exports = {
  ALBUM_ID,
  albumKnowledgePath,
  albumModulesPath,
  albumPlanPath,
  buildJRouetteAlbumBrief,
  buildJRouetteTrackBrief,
  detectJRouetteAlbumIntent,
  listJRouetteModules,
  loadAlbumModules,
  loadAlbumPlan,
  readKnowledgeEntries,
  resolveJRouetteContextForPrompt,
};