const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const { createVivyStreamNossenRunner } = require('../vivy/twitch-nossen-runner.cjs');

const STREAM_SCHEMA = 'funesterie.vivy.stream.v1';
const MAX_RECENT_MESSAGES = 48;
const MAX_SUGGESTIONS = 24;
const MAX_PENDING_SUGGESTIONS = 24;
const MAX_STARS = 120;
const DEFAULT_ROUND_MS = 90 * 1000;
const WINNER_REVEAL_MS = 4 * 1000;
const PRESENTATION_MS = 4 * 1000;
const DEFAULT_TRACK_SECONDS = 4 * 60;
const RATING_MS = 30 * 1000;
const LIVE_PHASES = new Set([
  'idle', 'listening', 'voting', 'winner', 'composing', 'presenting', 'playing', 'rating', 'error',
]);
const PRODUCTION_STAGES = ['analysis', 'lyrics', 'composition', 'mix'];

const STOP_WORDS = new Set([
  'avec', 'alors', 'avoir', 'cette', 'dans', 'des', 'donc', 'elle', 'faire', 'fais',
  'fait', 'pour', 'que', 'qui', 'sur', 'une', 'les', 'pas', 'plus', 'mais', 'comme',
  'chanson', 'musique', 'nossen', 'vivy', 'theme', 'thème', 'song', 'vote', 'etoile',
  'étoile', 'stars', 'star',
]);

function cleanText(value = '', max = 2000) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanOneLine(value = '', fallback = '', max = 200) {
  const cleaned = cleanText(value, max);
  return cleaned || fallback;
}

function resolveRoundMs(value = process.env.VIVY_STREAM_VOTE_MS || process.env.VIVY_STREAM_ROUND_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ROUND_MS;
  return Math.max(10_000, Math.min(10 * 60 * 1000, Math.floor(parsed)));
}

function foldForLookup(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function createRound(id = createShortId('round')) {
  const startedAt = Date.now();
  return {
    id,
    status: 'open',
    startedAt: new Date(startedAt).toISOString(),
    endsAt: null,
    suggestions: [],
    voters: {},
    winningSuggestionId: null,
  };
}

function createProductionState() {
  return {
    startedAt: null,
    updatedAt: null,
    stages: {
      analysis: { status: 'pending', progress: 0 },
      lyrics: { status: 'pending', progress: 0 },
      composition: { status: 'pending', progress: 0 },
      mix: { status: 'pending', progress: 0 },
    },
  };
}

function createInitialState() {
  return {
    schema: STREAM_SCHEMA,
    updatedAt: nowIso(),
    current: {
      title: 'Vivy Live',
      phase: 'idle',
      trackUrl: '',
      trackTitle: '',
      requestedBy: '',
      phaseStartedAt: null,
      phaseEndsAt: null,
      playbackStartedAt: null,
      durationSeconds: 0,
      message: 'En attente du chat Twitch.',
    },
    round: createRound(),
    production: createProductionState(),
    pendingSuggestions: [],
    recentMessages: [],
    stars: [],
    learning: {
      totalStars: 0,
      averageStars: 0,
      keywordScores: {},
      likedTerms: [],
    },
    stats: {
      messages: 0,
      suggestions: 0,
      votes: 0,
      stars: 0,
    },
  };
}

function createShortId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeSuggestionId(value = '') {
  const raw = cleanOneLine(value, '', 24).toUpperCase();
  if (!raw) return '';
  if (/^\d{1,3}$/.test(raw)) return `S${raw}`;
  return raw.replace(/^#/, '');
}

function extractSuggestion(message = '') {
  const raw = cleanText(message, 600);
  const match = raw.match(/^!(?:vivy|nossen|song|chanson|theme|th[eè]me|idee|idée)\s+(.{4,})$/i);
  if (!match) return '';
  return cleanText(match[1], 420);
}

function extractVote(message = '') {
  const raw = cleanText(message, 120);
  const match = raw.match(/^!(?:vote|choix)\s+#?([a-z0-9_-]{1,16})\b/i);
  if (!match) return '';
  return normalizeSuggestionId(match[1]);
}

function extractStarRating(message = '') {
  const raw = cleanText(message, 200);
  const explicit = raw.match(/^!(?:etoiles?|étoiles?|stars?|note)\s+([1-5])(?:\s+#?([a-z0-9_-]{1,16}))?/i)
    || raw.match(/\b([1-5])\s*\/\s*5\b/);
  if (explicit) {
    return {
      rating: Math.max(1, Math.min(5, Number(explicit[1]))),
      targetId: normalizeSuggestionId(explicit[2] || ''),
    };
  }
  const starCount = (raw.match(/[⭐★🌟]/gu) || []).length;
  if (!starCount) return null;
  return {
    rating: Math.max(1, Math.min(5, starCount)),
    targetId: '',
  };
}

function parseVivyStreamChatMessage(input = {}) {
  const message = cleanText(input.message || input.text || input.content, 700);
  const author = cleanOneLine(input.username || input.user || input.displayName || input.author, 'anonymous', 80);
  const source = cleanOneLine(input.source || 'twitch', 'twitch', 40);
  return {
    source,
    author,
    message,
    messageId: cleanOneLine(input.messageId || input.id, createShortId('chat'), 120),
    suggestion: extractSuggestion(message),
    voteTargetId: extractVote(message),
    star: extractStarRating(message),
    receivedAt: nowIso(),
  };
}

function collectLearningTerms(value = '') {
  return foldForLookup(value)
    .split(/[^a-z0-9]+/g)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
    .filter((word, index, list) => list.indexOf(word) === index)
    .slice(0, 16);
}

function refreshSuggestionScores(round) {
  const suggestions = Array.isArray(round?.suggestions) ? round.suggestions : [];
  suggestions.forEach((suggestion) => {
    const votes = Number(suggestion.votes || 0);
    const starAverage = Number(suggestion.starAverage || 0);
    const starBonus = starAverage ? (starAverage - 3) * 1.5 : 0;
    suggestion.score = Number((1 + votes * 2 + starBonus).toFixed(2));
  });
  suggestions.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)
    || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

function buildNossenSeedFromRound(state) {
  const round = state?.round || {};
  refreshSuggestionScores(round);
  const winner = round.suggestions?.find((entry) => entry.id === round.winningSuggestionId)
    || round.suggestions?.[0]
    || null;
  const likedTerms = Array.isArray(state?.learning?.likedTerms) ? state.learning.likedTerms.slice(0, 10) : [];
  const topIdeas = (round.suggestions || []).slice(0, 5).map((entry) => (
    `${entry.id}: ${entry.text} (${entry.votes || 0} votes, ${entry.starAverage || 0}/5)`
  ));
  return {
    ok: Boolean(winner),
    source: 'twitch-live',
    winner,
    canvas: [
      winner ? `Matière Twitch gagnante: ${winner.text}` : '',
      topIdeas.length ? `Autres idées du chat:\n${topIdeas.join('\n')}` : '',
      likedTerms.length ? `Vocabulaire aimé par le chat: ${likedTerms.join(', ')}` : '',
      'Objectif: transformer la demande gagnante en chanson NOSSEN chantable, précise, pas générique, avec vocabulaire vécu.',
    ].filter(Boolean).join('\n\n'),
    notes: likedTerms.length
      ? `Éviter les images passe-partout; privilégier les détails concrets aimés: ${likedTerms.join(', ')}.`
      : 'Éviter les images passe-partout; chercher des détails concrets depuis le chat.',
  };
}

function publicState(state) {
  const cloned = JSON.parse(JSON.stringify(state || createInitialState()));
  if (cloned.round?.voters) delete cloned.round.voters;
  cloned.serverNow = nowIso();
  cloned.nossenSeed = buildNossenSeedFromRound(cloned);
  return cloned;
}

function createVivyStreamStore(options = {}) {
  const runtimeRoot = options.runtimeRoot || getCanonicalRuntimeRoot(process.env);
  const statePath = options.statePath || path.join(runtimeRoot, 'vivy-stream', 'state.json');
  const clients = new Set();
  const onRoundLocked = typeof options.onRoundLocked === 'function' ? options.onRoundLocked : null;
  let state = createInitialState();
  let lifecycleTimer = null;

  function load() {
    try {
      if (fs.existsSync(statePath)) {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (parsed?.schema === STREAM_SCHEMA) {
          const initial = createInitialState();
          state = {
            ...initial,
            ...parsed,
            current: { ...initial.current, ...(parsed.current || {}) },
            round: { ...initial.round, ...(parsed.round || {}) },
            production: {
              ...initial.production,
              ...(parsed.production || {}),
              stages: {
                ...initial.production.stages,
                ...(parsed.production?.stages || {}),
              },
            },
            learning: { ...initial.learning, ...(parsed.learning || {}) },
            stats: { ...initial.stats, ...(parsed.stats || {}) },
            pendingSuggestions: Array.isArray(parsed.pendingSuggestions) ? parsed.pendingSuggestions : [],
            recentMessages: Array.isArray(parsed.recentMessages) ? parsed.recentMessages : [],
            stars: Array.isArray(parsed.stars) ? parsed.stars : [],
          };
        }
      }
    } catch (error) {
      console.warn('[vivy-stream] state load failed:', error?.message || String(error));
    }
    scheduleLifecycle();
    return state;
  }

  function save() {
    state.updatedAt = nowIso();
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
      console.warn('[vivy-stream] state save failed:', error?.message || String(error));
    }
    broadcast();
    scheduleLifecycle();
  }

  function broadcast(eventName = 'state') {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(publicState(state))}\n\n`;
    clients.forEach((res) => {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    });
  }

  function ensureOpenRound() {
    if (!state.round || state.round.status !== 'open') {
      state.round = createRound();
    }
    return state.round;
  }

  function winnerFromState() {
    return state.round?.suggestions?.find((entry) => entry.id === state.round.winningSuggestionId)
      || state.round?.suggestions?.[0]
      || null;
  }

  function setCurrentPhase(phase, fields = {}) {
    const normalized = LIVE_PHASES.has(phase) ? phase : 'idle';
    state.current = {
      ...state.current,
      ...fields,
      phase: normalized,
      phaseStartedAt: nowIso(),
    };
  }

  function startVotingCountdown(round) {
    if (!round?.suggestions?.length || round.endsAt) return;
    const startedAt = Date.now();
    round.startedAt = new Date(startedAt).toISOString();
    round.endsAt = new Date(startedAt + resolveRoundMs()).toISOString();
  }

  function beginProduction() {
    const winner = winnerFromState();
    if (!winner) return startRound();
    const startedAt = nowIso();
    state.production = createProductionState();
    state.production.startedAt = startedAt;
    state.production.updatedAt = startedAt;
    state.production.stages.analysis = { status: 'active', progress: 0 };
    setCurrentPhase('composing', {
      title: winner.text,
      requestedBy: winner.author,
      phaseEndsAt: null,
      message: 'Vivy commence à composer.',
    });
    save();
    return publicState(state);
  }

  function beginPlayback() {
    if (!state.current.trackUrl) {
      setCurrentPhase('error', {
        phaseEndsAt: null,
        message: 'La piste audio du live est introuvable.',
      });
      save();
      return publicState(state);
    }
    const durationSeconds = Math.max(1, Number(state.current.durationSeconds || DEFAULT_TRACK_SECONDS));
    const startedAt = Date.now();
    setCurrentPhase('playing', {
      playbackStartedAt: new Date(startedAt).toISOString(),
      phaseEndsAt: new Date(startedAt + (durationSeconds * 1000)).toISOString(),
      message: 'Lecture en cours',
    });
    save();
    return publicState(state);
  }

  function beginRating() {
    const endsAt = Date.now() + RATING_MS;
    setCurrentPhase('rating', {
      phaseEndsAt: new Date(endsAt).toISOString(),
      message: 'Votez avec !etoiles 1 à 5',
    });
    save();
    return publicState(state);
  }

  function scheduleLifecycle() {
    if (lifecycleTimer) clearTimeout(lifecycleTimer);
    lifecycleTimer = null;
    const phase = state.current?.phase;
    let deadline = null;
    let transition = null;
    if (state.round?.status === 'open' && state.round?.suggestions?.length && state.round.endsAt) {
      deadline = Date.parse(state.round.endsAt);
      transition = () => lockRound();
    } else if (phase === 'winner' && state.current.phaseEndsAt) {
      deadline = Date.parse(state.current.phaseEndsAt);
      transition = beginProduction;
    } else if (phase === 'presenting' && state.current.phaseEndsAt) {
      deadline = Date.parse(state.current.phaseEndsAt);
      transition = beginPlayback;
    } else if (phase === 'playing' && state.current.phaseEndsAt) {
      deadline = Date.parse(state.current.phaseEndsAt);
      transition = beginRating;
    } else if (phase === 'rating' && state.current.phaseEndsAt) {
      deadline = Date.parse(state.current.phaseEndsAt);
      transition = () => startRound();
    }
    if (!Number.isFinite(deadline) || !transition) return;
    const timerDelay = Math.max(10, Math.min(2_147_000_000, deadline - Date.now()));
    lifecycleTimer = setTimeout(transition, timerDelay);
    lifecycleTimer.unref?.();
  }

  function addSuggestion(parsed) {
    const round = ensureOpenRound();
    const text = cleanText(parsed.suggestion, 420);
    if (!text) return null;
    const folded = foldForLookup(text);
    const existing = round.suggestions.find((entry) => foldForLookup(entry.text) === folded);
    if (existing) {
      existing.votes = Number(existing.votes || 0) + 1;
      existing.updatedAt = parsed.receivedAt;
      startVotingCountdown(round);
      return existing;
    }
    const suggestionNumber = round.suggestions.reduce((highest, entry) => {
      const number = Number(String(entry.id || '').replace(/^S/i, ''));
      return Number.isFinite(number) ? Math.max(highest, number) : highest;
    }, 0) + 1;
    const suggestion = {
      id: `S${suggestionNumber}`,
      text,
      author: parsed.author,
      source: parsed.source,
      createdAt: parsed.receivedAt,
      updatedAt: parsed.receivedAt,
      votes: 1,
      starCount: 0,
      starAverage: 0,
      score: 1,
    };
    round.suggestions.unshift(suggestion);
    round.suggestions = round.suggestions.slice(0, MAX_SUGGESTIONS);
    state.stats.suggestions = Number(state.stats.suggestions || 0) + 1;
    startVotingCountdown(round);
    return suggestion;
  }

  function queueSuggestion(parsed) {
    const text = cleanText(parsed.suggestion, 420);
    if (!text) return null;
    state.pendingSuggestions = Array.isArray(state.pendingSuggestions) ? state.pendingSuggestions : [];
    const folded = foldForLookup(text);
    const existing = state.pendingSuggestions.find((entry) => foldForLookup(entry.suggestion) === folded);
    if (existing) {
      existing.receivedAt = parsed.receivedAt;
      existing.author = parsed.author;
      return existing;
    }
    const queued = {
      suggestion: text,
      author: parsed.author,
      source: parsed.source,
      message: parsed.message,
      messageId: parsed.messageId,
      receivedAt: parsed.receivedAt,
    };
    state.pendingSuggestions.push(queued);
    state.pendingSuggestions = state.pendingSuggestions.slice(-MAX_PENDING_SUGGESTIONS);
    return queued;
  }

  function addVote(parsed) {
    const round = ensureOpenRound();
    const targetId = normalizeSuggestionId(parsed.voteTargetId);
    const suggestion = round.suggestions.find((entry) => entry.id === targetId);
    if (!suggestion) return null;
    const voterKey = foldForLookup(parsed.author);
    const previousId = round.voters?.[voterKey];
    if (previousId && previousId !== targetId) {
      const previous = round.suggestions.find((entry) => entry.id === previousId);
      if (previous) previous.votes = Math.max(0, Number(previous.votes || 0) - 1);
    }
    round.voters = round.voters || {};
    if (previousId !== targetId) {
      suggestion.votes = Number(suggestion.votes || 0) + 1;
      state.stats.votes = Number(state.stats.votes || 0) + 1;
    }
    round.voters[voterKey] = targetId;
    suggestion.updatedAt = parsed.receivedAt;
    return suggestion;
  }

  function addStar(parsed) {
    const star = parsed.star;
    if (!star?.rating) return null;
    const round = state.round || createRound();
    const targetId = normalizeSuggestionId(star.targetId);
    const suggestion = targetId
      ? round.suggestions.find((entry) => entry.id === targetId)
      : winnerFromState() || round.suggestions[0] || null;
    const entry = {
      id: createShortId('star'),
      rating: Number(star.rating),
      author: parsed.author,
      targetId: suggestion?.id || targetId || null,
      message: parsed.message,
      createdAt: parsed.receivedAt,
    };
    state.stars = Array.isArray(state.stars) ? state.stars : [];
    state.stars.unshift(entry);
    state.stars = state.stars.slice(0, MAX_STARS);
    state.stats.stars = Number(state.stats.stars || 0) + 1;
    const totalStars = Number(state.learning.totalStars || 0) + 1;
    const currentAverage = Number(state.learning.averageStars || 0);
    state.learning.totalStars = totalStars;
    state.learning.averageStars = Number((((currentAverage * (totalStars - 1)) + entry.rating) / totalStars).toFixed(2));
    if (suggestion) {
      const previousCount = Number(suggestion.starCount || 0);
      const previousAverage = Number(suggestion.starAverage || 0);
      suggestion.starCount = previousCount + 1;
      suggestion.starAverage = Number((((previousAverage * previousCount) + entry.rating) / suggestion.starCount).toFixed(2));
      collectLearningTerms(suggestion.text).forEach((term) => {
        state.learning.keywordScores[term] = Number((Number(state.learning.keywordScores[term] || 0) + (entry.rating - 3)).toFixed(2));
      });
      state.learning.likedTerms = Object.entries(state.learning.keywordScores)
        .filter(([, score]) => Number(score) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
        .map(([term]) => term)
        .slice(0, 18);
    }
    return entry;
  }

  function addChatMessage(input = {}) {
    const parsed = parseVivyStreamChatMessage(input);
    if (!parsed.message) {
      return { ok: false, error: 'empty_message', state: publicState(state) };
    }
    state.stats.messages = Number(state.stats.messages || 0) + 1;
    state.recentMessages.unshift({
      id: parsed.messageId,
      source: parsed.source,
      author: parsed.author,
      message: parsed.message,
      receivedAt: parsed.receivedAt,
    });
    state.recentMessages = state.recentMessages.slice(0, MAX_RECENT_MESSAGES);

    let action = 'message';
    let suggestion = null;
    let vote = null;
    let star = null;
    const acceptsRoundInput = ['idle', 'listening', 'voting'].includes(state.current.phase)
      && (!state.round || state.round.status === 'open');
    if (parsed.suggestion && acceptsRoundInput) {
      suggestion = addSuggestion(parsed);
      action = 'suggestion';
    } else if (parsed.suggestion) {
      suggestion = queueSuggestion(parsed);
      action = suggestion ? 'suggestion_queued' : 'suggestion_ignored';
    }
    if (parsed.voteTargetId && acceptsRoundInput) {
      vote = addVote(parsed);
      if (vote) action = 'vote';
    } else if (parsed.voteTargetId) {
      action = 'vote_ignored';
    }
    if (parsed.star) {
      star = addStar(parsed);
      if (star) action = action === 'message' ? 'star' : `${action}+star`;
    }
    refreshSuggestionScores(state.round);
    if ((suggestion || vote) && ['idle', 'listening', 'voting'].includes(state.current.phase)) {
      const latest = suggestion || vote;
      setCurrentPhase('voting', {
        title: latest?.text || state.current.title || 'Vivy Live',
        requestedBy: latest?.author || state.current.requestedBy || '',
        phaseEndsAt: state.round.endsAt,
        message: 'Le chat propose et vote pour le prochain NOSSEN.',
      });
    } else if (star && state.current.phase === 'rating') {
      state.current.message = `${state.stats.stars} note${state.stats.stars > 1 ? 's' : ''} reçue${state.stats.stars > 1 ? 's' : ''}.`;
    }
    save();
    return { ok: true, action, parsed, suggestion, vote, star, state: publicState(state) };
  }

  function startRound(input = {}) {
    const title = cleanOneLine(input.title || input.topic, 'Vivy Live', 120);
    const queuedSuggestions = Array.isArray(state.pendingSuggestions)
      ? state.pendingSuggestions.slice(0, MAX_PENDING_SUGGESTIONS)
      : [];
    state.pendingSuggestions = [];
    state.round = createRound(createShortId('round'));
    state.production = createProductionState();
    state.current = {
      title,
      phase: 'listening',
      trackUrl: '',
      trackTitle: '',
      requestedBy: '',
      phaseStartedAt: nowIso(),
      phaseEndsAt: null,
      playbackStartedAt: null,
      durationSeconds: 0,
      message: 'Nouveau round Twitch ouvert.',
    };
    queuedSuggestions.forEach((entry) => addSuggestion(entry));
    if (state.round.suggestions.length) {
      const latest = state.round.suggestions[0];
      setCurrentPhase('voting', {
        title: latest.text,
        requestedBy: latest.author,
        phaseEndsAt: state.round.endsAt,
        message: 'Les propositions reçues pendant le morceau passent au vote.',
      });
    }
    save();
    return publicState(state);
  }

  function lockRound(input = {}) {
    const targetId = normalizeSuggestionId(input.suggestionId || input.id || '');
    refreshSuggestionScores(state.round);
    const existingWinner = winnerFromState();
    if (state.round?.status === 'locked' && existingWinner) {
      return {
        ok: true,
        alreadyLocked: true,
        winner: existingWinner,
        nossenSeed: buildNossenSeedFromRound(state),
        state: publicState(state),
      };
    }
    const winner = targetId
      ? state.round.suggestions.find((entry) => entry.id === targetId)
      : state.round.suggestions[0];
    if (!winner) return { ok: false, error: 'no_suggestion', state: publicState(state) };
    state.round.status = 'locked';
    state.round.winningSuggestionId = winner.id;
    const revealEndsAt = Date.now() + WINNER_REVEAL_MS;
    setCurrentPhase('winner', {
      title: winner.text,
      requestedBy: winner.author,
      phaseEndsAt: new Date(revealEndsAt).toISOString(),
      message: `Idée gagnante ${winner.id}`,
    });
    save();
    const nossenSeed = buildNossenSeedFromRound(state);
    if (onRoundLocked) {
      Promise.resolve(onRoundLocked({
        roundId: state.round.id,
        winner: JSON.parse(JSON.stringify(winner)),
        nossenSeed,
      })).catch((error) => {
        console.error('[vivy-stream] automatic NOSSEN start failed:', error?.message || String(error));
      });
    }
    return { ok: true, winner, nossenSeed, state: publicState(state) };
  }

  function updateLive(input = {}) {
    const action = cleanOneLine(input.action || input.phase, '', 40).toLowerCase();
    const winner = winnerFromState();
    if (action === 'progress' || action === 'composing') {
      if (!state.production?.stages) state.production = createProductionState();
      const stage = cleanOneLine(input.stage, 'analysis', 40).toLowerCase();
      if (!PRODUCTION_STAGES.includes(stage)) {
        return { ok: false, error: 'invalid_production_stage', state: publicState(state) };
      }
      const progress = Math.max(0, Math.min(100, Number(input.progress ?? 0) || 0));
      const stageIndex = PRODUCTION_STAGES.indexOf(stage);
      PRODUCTION_STAGES.forEach((name, index) => {
        if (index < stageIndex) state.production.stages[name] = { status: 'done', progress: 100 };
        else if (index === stageIndex) {
          state.production.stages[name] = {
            status: progress >= 100 ? 'done' : 'active',
            progress,
          };
        }
      });
      state.production.startedAt ||= nowIso();
      state.production.updatedAt = nowIso();
      setCurrentPhase('composing', {
        title: cleanOneLine(input.title, winner?.text || state.current.title || 'Vivy Live', 160),
        requestedBy: cleanOneLine(input.requestedBy || input.author, winner?.author || state.current.requestedBy, 80),
        phaseEndsAt: null,
        message: cleanOneLine(input.message, 'Vivy compose la chanson gagnante.', 200),
      });
      save();
      return { ok: true, state: publicState(state) };
    }
    if (action === 'ready' || action === 'presenting') {
      const trackUrl = cleanOneLine(input.trackUrl || input.audioUrl || input.url, '', 1200);
      if (!trackUrl) return { ok: false, error: 'track_url_missing', state: publicState(state) };
      const durationSeconds = Math.max(1, Math.min(3600, Number(input.durationSeconds || input.duration || DEFAULT_TRACK_SECONDS)));
      PRODUCTION_STAGES.forEach((name) => {
        state.production.stages[name] = { status: 'done', progress: 100 };
      });
      state.production.updatedAt = nowIso();
      const presentationEndsAt = Date.now() + PRESENTATION_MS;
      setCurrentPhase('presenting', {
        title: cleanOneLine(input.title || input.trackTitle, winner?.text || state.current.title || 'Nouvelle composition', 160),
        trackTitle: cleanOneLine(input.trackTitle || input.title, winner?.text || 'Nouvelle composition', 160),
        trackUrl,
        requestedBy: cleanOneLine(input.requestedBy || input.author, winner?.author || state.current.requestedBy, 80),
        durationSeconds,
        playbackStartedAt: null,
        phaseEndsAt: new Date(presentationEndsAt).toISOString(),
        message: 'Vivy présente sa nouvelle composition.',
      });
      save();
      return { ok: true, state: publicState(state) };
    }
    if (action === 'play' || action === 'playing') {
      if (input.trackUrl || input.audioUrl || input.url) {
        state.current.trackUrl = cleanOneLine(input.trackUrl || input.audioUrl || input.url, '', 1200);
      }
      if (input.durationSeconds || input.duration) {
        state.current.durationSeconds = Math.max(1, Math.min(3600, Number(input.durationSeconds || input.duration)));
      }
      return { ok: Boolean(state.current.trackUrl), state: beginPlayback() };
    }
    if (action === 'rating') return { ok: true, state: beginRating() };
    if (action === 'next' || action === 'start') return { ok: true, state: startRound(input) };
    if (action === 'error') {
      setCurrentPhase('error', {
        phaseEndsAt: null,
        message: cleanOneLine(input.message, 'La composition a rencontré un problème.', 240),
      });
      save();
      return { ok: true, state: publicState(state) };
    }
    return { ok: false, error: 'invalid_live_action', state: publicState(state) };
  }

  function connectSse(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, schema: STREAM_SCHEMA })}\n\n`);
    clients.add(res);
    broadcast();
    req.on('close', () => clients.delete(res));
  }

  load();
  return {
    getState: () => publicState(state),
    addChatMessage,
    startRound,
    lockRound,
    updateLive,
    connectSse,
  };
}

function isLocalRequest(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function createWriteGuard() {
  return function guard(req, res, next) {
    const configuredSecret = String(process.env.VIVY_STREAM_SECRET || '').trim();
    const provided = String(req.get('x-vivy-stream-secret') || req.get('x-twitch-stream-secret') || req.body?.secret || '').trim();
    if (configuredSecret && provided) {
      const expected = Buffer.from(configuredSecret);
      const candidate = Buffer.from(provided);
      if (expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)) {
        return next();
      }
    }
    if (!configuredSecret) {
      if ((process.env.NODE_ENV !== 'production') && (isLocalRequest(req) || process.env.VIVY_STREAM_ALLOW_UNSIGNED === '1')) {
        return next();
      }
      if (process.env.VIVY_STREAM_ALLOW_UNSIGNED === '1') return next();
    }
    return res.status(configuredSecret ? 401 : 503).json({
      ok: false,
      error: configuredSecret ? 'vivy_stream_secret_invalid' : 'vivy_stream_secret_missing',
      message: configuredSecret
        ? 'Secret live Vivy invalide.'
        : 'VIVY_STREAM_SECRET doit etre configure avant d accepter les messages Twitch.',
    });
  };
}

function buildLegacyOverlayHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vivy Live Overlay</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: transparent; color: #fff; overflow: hidden; }
    .wrap { width: 100vw; height: 100vh; box-sizing: border-box; padding: 28px; display: grid; align-content: end; gap: 14px; text-shadow: 0 2px 16px rgba(0,0,0,.72); }
    .panel { max-width: 760px; background: rgba(10, 5, 18, .72); border: 1px solid rgba(255, 119, 218, .5); border-radius: 8px; padding: 18px 20px; box-shadow: 0 20px 80px rgba(0,0,0,.35); backdrop-filter: blur(10px); }
    h1 { font-size: 30px; line-height: 1.05; margin: 0 0 8px; letter-spacing: 0; }
    .phase { color: #ff8fe8; font-weight: 800; text-transform: uppercase; font-size: 12px; }
    .message { margin: 0 0 12px; color: #f6d8ef; font-size: 16px; }
    ol { margin: 0; padding-left: 24px; display: grid; gap: 8px; }
    li { font-size: 18px; line-height: 1.2; }
    .meta { color: #ffd9f6; font-size: 13px; opacity: .86; }
    .stars { font-size: 18px; color: #ffd34d; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="panel">
      <div class="phase" id="phase">Vivy Live</div>
      <h1 id="title">Vivy Live</h1>
      <p class="message" id="message">Connexion au live...</p>
      <ol id="suggestions"></ol>
      <div class="meta" id="meta"></div>
    </section>
  </main>
  <script>
    const phase = document.getElementById('phase');
    const title = document.getElementById('title');
    const message = document.getElementById('message');
    const suggestions = document.getElementById('suggestions');
    const meta = document.getElementById('meta');
    function render(state) {
      const current = state.current || {};
      const round = state.round || {};
      phase.textContent = current.phase || 'live';
      title.textContent = current.title || 'Vivy Live';
      message.textContent = current.message || '';
      suggestions.innerHTML = '';
      (round.suggestions || []).slice(0, 5).forEach((entry) => {
        const li = document.createElement('li');
        const id = document.createElement('strong');
        id.textContent = entry.id || '';
        const body = document.createTextNode(' ' + (entry.text || ''));
        const details = document.createElement('div');
        details.className = 'meta';
        details.textContent = (entry.votes || 0) + ' votes · score ' + (entry.score || 0);
        if (entry.starAverage) {
          const stars = document.createElement('span');
          stars.className = 'stars';
          stars.textContent = ' ' + '★'.repeat(Math.max(1, Math.min(5, Math.round(entry.starAverage))));
          details.appendChild(stars);
        }
        li.appendChild(id);
        li.appendChild(body);
        li.appendChild(details);
        suggestions.appendChild(li);
      });
      const learning = state.learning || {};
      meta.textContent = 'Messages ' + (state.stats?.messages || 0) + ' · étoiles moyennes ' + (learning.averageStars || 0) + '/5 · mots aimés: ' + ((learning.likedTerms || []).slice(0, 8).join(', ') || 'en écoute');
    }
    const stream = new EventSource('/api/vivy/stream/events');
    stream.addEventListener('state', (event) => render(JSON.parse(event.data)));
    stream.onerror = () => { message.textContent = 'Overlay Vivy: reconnexion...'; };
  </script>
</body>
</html>`;
}

function buildOverlayHtml() {
  const overlayPath = path.join(__dirname, '../../public/vivy-live-overlay.html');
  try {
    return fs.readFileSync(overlayPath, 'utf8');
  } catch {
    return buildLegacyOverlayHtml();
  }
}

function createVivyStreamRouter(options = {}) {
  const router = express.Router();
  let store = options.store || null;
  const autoGenerateEnabled = options.autoGenerateEnabled === true
    || (options.autoGenerateEnabled !== false && process.env.VIVY_STREAM_AUTOGENERATE_ENABLED === '1');
  const runner = options.runner || (autoGenerateEnabled
    ? createVivyStreamNossenRunner({
      updateLive: (input) => store.updateLive(input),
    })
    : null);
  const onRoundLocked = options.onRoundLocked || (runner
    ? (payload) => runner.start(payload)
    : null);
  if (!store) store = createVivyStreamStore({ ...options, onRoundLocked });
  const writeGuard = options.writeGuard || createWriteGuard();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'vivy-stream', schema: STREAM_SCHEMA });
  });

  router.get('/state', (_req, res) => {
    res.json(store.getState());
  });

  router.get('/nossen-seed', (_req, res) => {
    res.json(buildNossenSeedFromRound(store.getState()));
  });

  router.get('/events', (req, res) => {
    store.connectSse(req, res);
  });

  router.get('/overlay', (_req, res) => {
    res.type('html').send(buildOverlayHtml());
  });

  router.get('/overlay/background', (_req, res) => {
    const backgroundPath = path.join(__dirname, '../../public/assets/vivy-presence-musicale.png');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(backgroundPath);
  });

  router.post('/chat', express.json({ limit: '32kb' }), writeGuard, (req, res) => {
    res.json(store.addChatMessage(req.body || {}));
  });

  router.post('/event', express.json({ limit: '32kb' }), writeGuard, (req, res) => {
    res.json(store.addChatMessage(req.body || {}));
  });

  router.post('/round/start', express.json({ limit: '16kb' }), writeGuard, (req, res) => {
    res.json(store.startRound(req.body || {}));
  });

  router.post('/round/lock', express.json({ limit: '16kb' }), writeGuard, (req, res) => {
    const result = store.lockRound(req.body || {});
    res.status(result.ok ? 200 : 409).json(result);
  });

  router.post('/round/generate', express.json({ limit: '16kb' }), writeGuard, (req, res) => {
    if (!runner) {
      return res.status(503).json({ ok: false, error: 'vivy_stream_autogenerate_disabled' });
    }
    const state = store.getState();
    const winner = state.round?.suggestions?.find((entry) => entry.id === state.round.winningSuggestionId)
      || state.round?.suggestions?.[0];
    if (!winner || state.round?.status !== 'locked') {
      return res.status(409).json({ ok: false, error: 'vivy_stream_round_not_locked' });
    }
    const started = runner.start({
      roundId: state.round.id,
      winner,
      nossenSeed: buildNossenSeedFromRound(state),
    });
    return res.status(started.started ? 202 : 409).json({
      ok: started.started,
      started: started.started,
      error: started.error,
      roundId: state.round.id,
    });
  });

  router.post('/control', express.json({ limit: '32kb' }), writeGuard, (req, res) => {
    const result = store.updateLive(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  return router;
}

module.exports = {
  STREAM_SCHEMA,
  buildOverlayHtml,
  buildNossenSeedFromRound,
  createVivyStreamRouter,
  createVivyStreamStore,
  extractStarRating,
  parseVivyStreamChatMessage,
  resolveRoundMs,
};
