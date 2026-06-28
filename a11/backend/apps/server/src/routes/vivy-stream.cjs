const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

const STREAM_SCHEMA = 'funesterie.vivy.stream.v1';
const MAX_RECENT_MESSAGES = 48;
const MAX_SUGGESTIONS = 24;
const MAX_STARS = 120;
const DEFAULT_ROUND_MS = 2 * 60 * 1000;

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
    endsAt: new Date(startedAt + DEFAULT_ROUND_MS).toISOString(),
    suggestions: [],
    voters: {},
    winningSuggestionId: null,
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
      message: 'En attente du chat Twitch.',
    },
    round: createRound(),
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
  cloned.nossenSeed = buildNossenSeedFromRound(cloned);
  return cloned;
}

function createVivyStreamStore(options = {}) {
  const runtimeRoot = options.runtimeRoot || getCanonicalRuntimeRoot(process.env);
  const statePath = options.statePath || path.join(runtimeRoot, 'vivy-stream', 'state.json');
  const clients = new Set();
  let state = createInitialState();

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
            learning: { ...initial.learning, ...(parsed.learning || {}) },
            stats: { ...initial.stats, ...(parsed.stats || {}) },
            recentMessages: Array.isArray(parsed.recentMessages) ? parsed.recentMessages : [],
            stars: Array.isArray(parsed.stars) ? parsed.stars : [],
          };
        }
      }
    } catch (error) {
      console.warn('[vivy-stream] state load failed:', error?.message || String(error));
    }
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

  function addSuggestion(parsed) {
    const round = ensureOpenRound();
    const text = cleanText(parsed.suggestion, 420);
    if (!text) return null;
    const folded = foldForLookup(text);
    const existing = round.suggestions.find((entry) => foldForLookup(entry.text) === folded);
    if (existing) {
      existing.votes = Number(existing.votes || 0) + 1;
      existing.updatedAt = parsed.receivedAt;
      return existing;
    }
    const suggestionNumber = Number(state.stats.suggestions || 0) + 1;
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
    state.stats.suggestions = suggestionNumber;
    return suggestion;
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
    const round = ensureOpenRound();
    const targetId = normalizeSuggestionId(star.targetId);
    const suggestion = targetId
      ? round.suggestions.find((entry) => entry.id === targetId)
      : round.suggestions[0] || null;
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
    ensureOpenRound();
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
    if (parsed.suggestion) {
      suggestion = addSuggestion(parsed);
      action = 'suggestion';
    }
    if (parsed.voteTargetId) {
      vote = addVote(parsed);
      if (vote) action = 'vote';
    }
    if (parsed.star) {
      star = addStar(parsed);
      if (star) action = action === 'message' ? 'star' : `${action}+star`;
    }
    refreshSuggestionScores(state.round);
    state.current.phase = state.round.suggestions.length ? 'voting' : 'listening';
    state.current.message = state.round.suggestions.length
      ? 'Le chat propose et vote pour le prochain NOSSEN.'
      : 'En attente d’une idée !vivy, !nossen ou !chanson.';
    save();
    return { ok: true, action, parsed, suggestion, vote, star, state: publicState(state) };
  }

  function startRound(input = {}) {
    const title = cleanOneLine(input.title || input.topic, 'Vivy Live', 120);
    state.round = createRound(createShortId('round'));
    state.current = {
      ...state.current,
      title,
      phase: 'listening',
      message: 'Nouveau round Twitch ouvert.',
    };
    save();
    return publicState(state);
  }

  function lockRound(input = {}) {
    const targetId = normalizeSuggestionId(input.suggestionId || input.id || '');
    refreshSuggestionScores(state.round);
    const winner = targetId
      ? state.round.suggestions.find((entry) => entry.id === targetId)
      : state.round.suggestions[0];
    if (!winner) return { ok: false, error: 'no_suggestion', state: publicState(state) };
    state.round.status = 'locked';
    state.round.winningSuggestionId = winner.id;
    state.current.phase = 'locked';
    state.current.message = `Idée gagnante ${winner.id}: ${winner.text}`;
    save();
    return { ok: true, winner, nossenSeed: buildNossenSeedFromRound(state), state: publicState(state) };
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

function buildOverlayHtml() {
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

function createVivyStreamRouter(options = {}) {
  const router = express.Router();
  const store = options.store || createVivyStreamStore(options);
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

  return router;
}

module.exports = {
  STREAM_SCHEMA,
  buildNossenSeedFromRound,
  createVivyStreamRouter,
  createVivyStreamStore,
  extractStarRating,
  parseVivyStreamChatMessage,
};
