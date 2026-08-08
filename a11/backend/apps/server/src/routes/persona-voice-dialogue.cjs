'use strict';

// Dialogue borne entre personas officielles.
//
// Le texte est produit tour par tour avec l'identite de chaque persona, puis le
// client peut envoyer chaque `ttsRequest` a /api/tts/speak. On ne lance jamais
// une boucle autonome infinie et on n'ajoute jamais les sorties synthetiques au
// corpus d'entrainement: seules les references humaines consenties y entrent.

const express = require('express');
const { isFamilyVoiceUser } = require('./vivy-voice-chat.cjs');
const {
  ensurePersonaAgentRevivalSweep,
  getPersonaAgentRevivalStatus,
} = require('../persona/persona-agent-revival-runner.cjs');

const DIALOGUE_SCHEMA = 'funesterie.persona-voice-dialogue.v1';
const SUPPORTED_PERSONAS = new Set(['vivy', 'djeff']);

function cleanText(value = '', max = 1600) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

function normalizePersona(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['vivy', 'vivi'].includes(raw)) return 'vivy';
  if (['djeff', 'jeff', 'pignon'].includes(raw)) return 'djeff';
  return '';
}

function normalizePersonas(values = []) {
  const list = Array.isArray(values) ? values : String(values || '').split(/[;,\s]+/g);
  const normalized = list.map(normalizePersona).filter((value, index, all) => value && all.indexOf(value) === index);
  return normalized.length >= 2 ? normalized.slice(0, 4) : ['vivy', 'djeff'];
}

function buildPersonaTurnPrompt({ topic, persona, turns = [], turnNumber = 1 } = {}) {
  const transcript = turns
    .slice(-6)
    .map((turn) => `${turn.persona}: ${cleanText(turn.text, 900)}`)
    .join('\n');
  return cleanText([
    `Conversation de travail privee entre personas officielles. Sujet: ${cleanText(topic, 1200)}`,
    `Tu es ${persona}. Reponds uniquement avec ton prochain tour, sans parler a la place des autres personas.`,
    'Apporte une idee, une objection ou une amelioration concrete. Pas de consigne technique interne dans le texte public.',
    `Tour ${turnNumber}.`,
    transcript ? `Tours precedents:\n${transcript}` : '',
  ].filter(Boolean).join('\n\n'), 4800);
}

function extractPersonaReply(result = {}) {
  return cleanText(
    result.reply
    || result.assistant
    || result.publicText
    || result.content
    || result.summary
    || '',
    1600
  );
}

function buildTtsRequest(turn = {}, language = 'fr') {
  return {
    endpoint: '/api/tts/speak',
    body: {
      text: turn.text,
      persona: turn.persona,
      voicePersona: turn.persona,
      identityVoice: true,
      useIdentityVoice: true,
      audioFormat: 'mp3',
      voicePolish: true,
      async: true,
      language,
    },
  };
}

function createPersonaVoiceDialogueRouter(options = {}) {
  const router = express.Router();
  // La fabrique est montée une fois au boot du serveur. Le runner porte son propre
  // singleton global, donc un remontage de route en test/hot reload n'empile jamais
  // les minuteurs. Ce watchdog concerne les agents, pas les voix Suno du dialogue.
  ensurePersonaAgentRevivalSweep({ env: options.env || process.env });
  const verifyJWT = typeof options.verifyJWT === 'function'
    ? options.verifyJWT
    : (_req, res) => res.status(503).json({ ok: false, error: 'auth_guard_missing' });
  const responders = options.responders || {};

  router.get('/recovery/status', verifyJWT, (req, res) => {
    if (!isFamilyVoiceUser(req)) {
      return res.status(403).json({ ok: false, error: 'persona_recovery_family_only' });
    }
    return res.json(getPersonaAgentRevivalStatus());
  });

  router.get('/capabilities', verifyJWT, (req, res) => res.json({
    ok: true,
    schema: DIALOGUE_SCHEMA,
    allowed: isFamilyVoiceUser(req),
    personas: [...SUPPORTED_PERSONAS].filter((persona) => typeof responders[persona] === 'function'),
    maxTurns: 6,
    trainingFromSyntheticOutput: false,
    ttsEndpoint: '/api/tts/speak',
    feedbackEndpoint: '/api/voice-learning/quality-feedback',
  }));

  router.post('/', verifyJWT, express.json({ limit: '256kb' }), async (req, res) => {
    if (!isFamilyVoiceUser(req)) {
      return res.status(403).json({ ok: false, error: 'persona_dialogue_family_only' });
    }
    const topic = cleanText(req.body?.topic || req.body?.message || req.body?.prompt, 2400);
    if (!topic) return res.status(400).json({ ok: false, error: 'persona_dialogue_topic_missing' });
    const personas = normalizePersonas(req.body?.personas || ['vivy', 'djeff'])
      .filter((persona) => SUPPORTED_PERSONAS.has(persona) && typeof responders[persona] === 'function');
    if (personas.length < 2) {
      return res.status(503).json({ ok: false, error: 'persona_dialogue_responders_unavailable' });
    }
    const maxTurns = Math.max(2, Math.min(6, Math.round(Number(req.body?.maxTurns) || 4)));
    const language = cleanText(req.body?.language || 'fr', 12) || 'fr';
    const turns = [];

    for (let index = 0; index < maxTurns; index += 1) {
      const persona = personas[index % personas.length];
      const prompt = buildPersonaTurnPrompt({ topic, persona, turns, turnNumber: index + 1 });
      const result = await responders[persona]({
        message: prompt,
        mode: 'chat',
        language,
        sessionId: cleanText(req.body?.sessionId, 120) || undefined,
        conversationId: cleanText(req.body?.conversationId, 120) || undefined,
        personaDialogue: true,
        personaDialogueTurn: index + 1,
      }, req);
      const text = extractPersonaReply(result);
      if (!text) break;
      turns.push({ index: index + 1, persona, text });
    }

    return res.json({
      ok: turns.length >= 2,
      schema: DIALOGUE_SCHEMA,
      topic,
      personas,
      bounded: true,
      maxTurns,
      turns: turns.map((turn) => ({ ...turn, ttsRequest: buildTtsRequest(turn, language) })),
      voiceLearning: {
        syntheticOutputsEnterTrainingCorpus: false,
        feedbackEndpoint: '/api/voice-learning/quality-feedback',
      },
    });
  });

  return router;
}

module.exports = createPersonaVoiceDialogueRouter;
module.exports.DIALOGUE_SCHEMA = DIALOGUE_SCHEMA;
module.exports.SUPPORTED_PERSONAS = SUPPORTED_PERSONAS;
module.exports.buildPersonaTurnPrompt = buildPersonaTurnPrompt;
module.exports.buildTtsRequest = buildTtsRequest;
module.exports.extractPersonaReply = extractPersonaReply;
module.exports.normalizePersonas = normalizePersonas;
