'use strict';

// Memoire de maitrise ACE-Step.
//
// Elle ne pretend pas re-entrainer le modele. Elle conserve les retours humains
// explicites et les relie aux generations pour que Vivy puisse eviter les defauts
// deja entendus. Les fichiers sont separes par identite hachee, append-only et ne
// contiennent ni jeton, ni e-mail, ni chemin local, ni audio.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

const SCHEMA = 'funesterie.vivy.acestep-mastery.v1';
const VALID_VERDICTS = new Set(['accepted', 'rejected', 'mixed']);
const VALID_DEFECTS = new Set([
  'crackle',
  'noise',
  'clipping',
  'bass_heavy',
  'simple_arrangement',
  'duo_not_distinct',
  'wrong_voice',
  'lyrics_missing',
  'lyrics_invalid',
  'harsh',
  'too_loud',
  'too_quiet',
]);

function cleanOneLine(value = '', max = 240) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanStoredText(value = '', max = 240) {
  return cleanOneLine(value, max * 2)
    .replace(/\b(sk-[a-z0-9_-]{12,}|eyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})\b/gi, '[redacted-token]')
    .replace(/\b(token|api[-_ ]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b[A-Za-z]:\\[^\s]+/g, '[local-path]')
    .replace(/\/(?:home|app|srv|tmp)\/[^\s]+/g, '[local-path]')
    .slice(0, max);
}

function hashActor(actor = '') {
  const value = cleanOneLine(actor, 240);
  if (!value) return '';
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function resolveMasteryDir(env = process.env) {
  const configured = cleanOneLine(env.ACESTEP_MASTERY_DIR, 1000);
  return path.resolve(configured || path.join(getCanonicalRuntimeRoot(env), 'acestep-mastery'));
}

function resolveMasteryFile(actor = '', env = process.env) {
  const actorHash = hashActor(actor);
  return actorHash ? path.join(resolveMasteryDir(env), `${actorHash}.jsonl`) : '';
}

function normalizeDefects(defects = []) {
  const values = Array.isArray(defects) ? defects : String(defects || '').split(/[;,\s]+/);
  return values
    .map((value) => cleanOneLine(value, 48).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter((value, index, list) => VALID_DEFECTS.has(value) && list.indexOf(value) === index)
    .slice(0, 12);
}

function sanitizeEvent(event = {}) {
  const type = ['submitted', 'completed', 'feedback'].includes(event.type) ? event.type : '';
  if (!type) throw new Error('acestep_mastery_event_invalid');
  const safe = {
    schema: SCHEMA,
    at: new Date().toISOString(),
    type,
    promptId: cleanOneLine(event.promptId, 180),
  };
  if (type === 'submitted') {
    safe.castCount = Math.max(1, Math.min(8, Math.round(Number(event.castCount) || 1)));
    safe.castMode = cleanOneLine(event.castMode, 80);
    safe.durationSeconds = Math.max(0, Math.min(1000, Math.round(Number(event.durationSeconds) || 0)));
    safe.tags = cleanStoredText(event.tags, 1200);
    safe.masteryHints = normalizeDefects(event.masteryHints);
  } else if (type === 'completed') {
    safe.sourceFormat = cleanOneLine(event.sourceFormat, 16).toLowerCase();
    safe.singlePassMaster = event.singlePassMaster === true;
  } else {
    safe.verdict = VALID_VERDICTS.has(String(event.verdict || '').toLowerCase())
      ? String(event.verdict).toLowerCase()
      : 'mixed';
    safe.defects = normalizeDefects(event.defects);
    safe.notes = cleanStoredText(event.notes, 600);
  }
  return safe;
}

function appendAceStepMasteryEvent(actor = '', event = {}, options = {}) {
  const env = options.env || process.env;
  const file = resolveMasteryFile(actor, env);
  if (!file) return { ok: false, reason: 'actor_missing' };
  const safe = sanitizeEvent(event);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(safe)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, event: safe };
}

function readAceStepMasteryEvents(actor = '', options = {}) {
  const env = options.env || process.env;
  const file = resolveMasteryFile(actor, env);
  if (!file || !fs.existsSync(file)) return [];
  const maxBytes = Math.max(4096, Math.min(4 * 1024 * 1024, Number(options.maxBytes) || 1024 * 1024));
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.toString('utf8');
    if (start > 0) text = text.slice(Math.max(0, text.indexOf('\n') + 1));
    return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed?.schema === SCHEMA ? [parsed] : [];
      } catch {
        return [];
      }
    });
  } finally {
    fs.closeSync(fd);
  }
}

function summarizeAceStepMastery(actor = '', options = {}) {
  const events = readAceStepMasteryEvents(actor, options);
  const feedback = events.filter((event) => event.type === 'feedback');
  const defectCounts = {};
  const verdictCounts = { accepted: 0, mixed: 0, rejected: 0 };
  for (const event of feedback) {
    if (Object.prototype.hasOwnProperty.call(verdictCounts, event.verdict)) verdictCounts[event.verdict] += 1;
    for (const defect of normalizeDefects(event.defects)) defectCounts[defect] = (defectCounts[defect] || 0) + 1;
  }
  const learnedDefects = Object.entries(defectCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([defect, count]) => ({ defect, count }));
  return {
    schema: SCHEMA,
    generations: events.filter((event) => event.type === 'submitted').length,
    completions: events.filter((event) => event.type === 'completed').length,
    feedbackCount: feedback.length,
    verdictCounts,
    learnedDefects,
    recentFeedback: feedback.slice(-10).reverse().map((event) => ({
      at: event.at,
      promptId: event.promptId,
      verdict: event.verdict,
      defects: normalizeDefects(event.defects),
      notes: cleanStoredText(event.notes, 600),
    })),
  };
}

function buildAceStepMasteryHints(summary = {}) {
  const defects = new Set((summary.learnedDefects || []).filter((item) => Number(item.count) > 0).map((item) => item.defect));
  const hints = [];
  if (defects.has('crackle') || defects.has('noise') || defects.has('clipping') || defects.has('harsh')) {
    hints.push('clean noise floor, no crackle, no vinyl noise, no clipping, smooth non-harsh transients');
  }
  if (defects.has('bass_heavy')) hints.push('controlled sub-bass, balanced low end, clear midrange');
  if (defects.has('simple_arrangement')) {
    hints.push('detailed evolving arrangement, layered instrumentation, countermelodies, fills and section transitions');
  }
  if (defects.has('duo_not_distinct') || defects.has('wrong_voice')) {
    hints.push('clearly contrasting vocal timbres, strict solo handoff at each vocal role section');
  }
  if (defects.has('lyrics_missing') || defects.has('lyrics_invalid')) hints.push('sing every supplied lyric section with clear diction');
  return hints;
}

module.exports = {
  SCHEMA,
  VALID_DEFECTS,
  appendAceStepMasteryEvent,
  buildAceStepMasteryHints,
  hashActor,
  normalizeDefects,
  readAceStepMasteryEvents,
  resolveMasteryDir,
  resolveMasteryFile,
  summarizeAceStepMastery,
};
