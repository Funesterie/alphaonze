#!/usr/bin/env node

const WebSocket = require('ws');

const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const TWITCH_HELIX_STREAMS_URL = 'https://api.twitch.tv/helix/streams';
const DEFAULT_ANNOUNCE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TRACK_NOTICE_POLL_INTERVAL_MS = 10 * 1000;
const DEFAULT_RECAP_INTERVAL_MS = 28 * 60 * 1000;
const DEFAULT_TWITCH_LIVE_POLL_INTERVAL_MS = 60 * 1000;
const DEFAULT_PUBLIC_BASE_URL = 'https://vivy.funesterie.me';
const ANNOUNCE_MESSAGES = Object.freeze([
  '🎤 Vivy Live — propose une chanson avec !vivy ton idée | vote avec !vote S1 | note avec !etoiles 5 S1 ou ⭐⭐⭐⭐⭐',
  '🎵 Commandes : !vivy thème chanson | !nossen style plus épique | !chanson sujet + ambiance | !vote S1 | !etoiles 5 S1',
]);

function cleanEnv(value = '') {
  return String(value || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveAnnounceInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ANNOUNCE_INTERVAL_MS;
  return Math.max(1000, Math.floor(parsed));
}

function resolveTrackNoticePollInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TRACK_NOTICE_POLL_INTERVAL_MS;
  return Math.max(3000, Math.floor(parsed));
}

function resolveRecapInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECAP_INTERVAL_MS;
  return Math.max(25 * 60 * 1000, Math.min(30 * 60 * 1000, Math.floor(parsed)));
}

function resolveLivePollInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TWITCH_LIVE_POLL_INTERVAL_MS;
  return Math.max(15 * 1000, Math.min(10 * 60 * 1000, Math.floor(parsed)));
}

function normalizeTwitchBearerToken(value = '') {
  return cleanEnv(value).replace(/^oauth:/i, '');
}

function resolveStreamResetUrl(ingestUrl = '') {
  const fallback = 'https://vivy.funesterie.me/api/vivy/stream/reset';
  const raw = cleanEnv(ingestUrl);
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/(?:chat|event)$/i, '/reset');
    if (!/\/reset$/i.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/+$/g, '')}/reset`;
    }
    url.search = '';
    return url.toString();
  } catch {
    return fallback;
  }
}

function normalizeAnnouncement(value = '') {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 460);
}

function clipInline(value = '', max = 90) {
  const text = normalizeAnnouncement(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function absolutizePublicUrl(value = '', baseUrl = DEFAULT_PUBLIC_BASE_URL) {
  const raw = cleanEnv(value);
  if (!raw) return '';
  try {
    return new URL(raw, cleanEnv(baseUrl) || DEFAULT_PUBLIC_BASE_URL).toString();
  } catch {
    return raw;
  }
}

function buildTrackNoticeMessage(state = {}, options = {}) {
  const current = state.current || {};
  const phase = cleanEnv(current.phase).toLowerCase();
  if (phase !== 'presenting' && phase !== 'playing') return '';
  const trackUrl = cleanEnv(current.trackUrl);
  if (!trackUrl) return '';
  const title = clipInline(current.trackTitle || current.title || 'Nouvelle création Vivy', 100);
  const requestedBy = clipInline(current.requestedBy || '', 40);
  const publicUrl = absolutizePublicUrl(current.sharePath || trackUrl, options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL);
  const authorPart = requestedBy ? ` demandée par ${requestedBy}` : '';
  return normalizeAnnouncement(`🎵 Nouvelle création Vivy: "${title}"${authorPart} ▶ ${publicUrl} ⭐ Note avec !etoiles 5`);
}

function formatStars(value = {}) {
  const count = Number(value.starCount || 0);
  const average = Number(value.starAverage || 0);
  if (!count || !average) return '⭐--';
  return `⭐${average.toFixed(average % 1 ? 1 : 0)}/5(${count})`;
}

function buildSongRecapMessages(state = {}, options = {}) {
  const publicBaseUrl = options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL;
  const songs = Array.isArray(state.songs) ? state.songs : [];
  const entries = songs
    .filter((song) => song?.trackUrl)
    .map((song, index) => {
      const title = clipInline(song.trackTitle || song.title || `Morceau ${index + 1}`, 42);
      const link = absolutizePublicUrl(song.sharePath || song.trackUrl, publicBaseUrl);
      return `${index + 1}. ${title} ${formatStars(song)} ⬇ ${link}`;
    });
  if (!entries.length) return [];
  const messages = [];
  let current = '🎶 Morceaux Vivy passés dans le live:';
  entries.forEach((entry) => {
    const candidate = `${current} ${entry}`;
    if (candidate.length > 430 && current !== '🎶 Morceaux Vivy passés dans le live:') {
      messages.push(normalizeAnnouncement(current));
      current = `🎶 Suite: ${entry}`;
    } else if (candidate.length > 430) {
      messages.push(normalizeAnnouncement(`${current} ${entry}`));
      current = '🎶 Suite:';
    } else {
      current = candidate;
    }
  });
  if (current && current !== '🎶 Suite:') messages.push(normalizeAnnouncement(current));
  return messages.filter(Boolean);
}

function createAnnouncementRotator(options = {}) {
  const messages = (options.messages || ANNOUNCE_MESSAGES).map(normalizeAnnouncement).filter(Boolean);
  const intervalMs = resolveAnnounceInterval(options.intervalMs);
  const disabled = options.disabled === true;
  const isConnected = options.isConnected || (() => false);
  const sendMessage = options.sendMessage || (() => {});
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const logger = options.logger || console;
  let messageIndex = 0;
  let timer = null;

  function tick() {
    if (disabled || !messages.length || !isConnected()) return false;
    const message = messages[messageIndex % messages.length];
    try {
      sendMessage(message);
      messageIndex += 1;
      return true;
    } catch (error) {
      logger.warn?.('[vivy-twitch] announce failed:', error?.message || String(error));
      return false;
    }
  }

  function start() {
    if (disabled || timer || !messages.length) return false;
    timer = setIntervalFn(tick, intervalMs);
    timer?.unref?.();
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearIntervalFn(timer);
    timer = null;
    return true;
  }

  return { intervalMs, start, stop, tick };
}

function createTrackNoticeWatcher(options = {}) {
  const stateUrl = cleanEnv(options.stateUrl);
  const publicBaseUrl = cleanEnv(options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL);
  const pollIntervalMs = resolveTrackNoticePollInterval(options.pollIntervalMs);
  const disabled = options.disabled === true || !stateUrl;
  const isConnected = options.isConnected || (() => false);
  const sendMessage = options.sendMessage || (() => {});
  const fetchFn = options.fetchFn || fetch;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const logger = options.logger || console;
  let timer = null;
  let inFlight = false;
  let observedOnce = false;
  let lastTrackKey = cleanEnv(options.lastTrackKey);

  async function tick() {
    if (disabled || !stateUrl || !isConnected() || inFlight) return false;
    inFlight = true;
    try {
      const response = await fetchFn(stateUrl, { headers: { Accept: 'application/json' } });
      if (!response?.ok) throw new Error(`state_http_${response?.status || 'unknown'}`);
      const state = await response.json();
      const current = state?.current || {};
      const trackKey = cleanEnv(current.trackUrl || current.trackTitle || current.title);
      const message = buildTrackNoticeMessage(state, { publicBaseUrl });
      if (!observedOnce) {
        observedOnce = true;
        if (trackKey) lastTrackKey = trackKey;
        return false;
      }
      if (!message || !trackKey || trackKey === lastTrackKey) return false;
      sendMessage(message);
      lastTrackKey = trackKey;
      return true;
    } catch (error) {
      logger.warn?.('[vivy-twitch] track notice failed:', error?.message || String(error));
      return false;
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (disabled || timer || !stateUrl) return false;
    timer = setIntervalFn(() => {
      tick().catch((error) => logger.warn?.('[vivy-twitch] track notice failed:', error?.message || String(error)));
    }, pollIntervalMs);
    timer?.unref?.();
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearIntervalFn(timer);
    timer = null;
    return true;
  }

  return { pollIntervalMs, start, stop, tick };
}

function createSongRecapRotator(options = {}) {
  const stateUrl = cleanEnv(options.stateUrl);
  const publicBaseUrl = cleanEnv(options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL);
  const intervalMs = resolveRecapInterval(options.intervalMs);
  const disabled = options.disabled === true || !stateUrl;
  const isConnected = options.isConnected || (() => false);
  const sendMessage = options.sendMessage || (() => {});
  const fetchFn = options.fetchFn || fetch;
  const sleepFn = options.sleep || sleep;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const logger = options.logger || console;
  let timer = null;
  let inFlight = false;
  let lastSignature = '';

  async function tick() {
    if (disabled || !stateUrl || !isConnected() || inFlight) return false;
    inFlight = true;
    try {
      const response = await fetchFn(stateUrl, { headers: { Accept: 'application/json' } });
      if (!response?.ok) throw new Error(`state_http_${response?.status || 'unknown'}`);
      const state = await response.json();
      const signature = JSON.stringify((state.songs || []).map((song) => [
        song.id,
        song.trackUrl,
        song.starCount,
        song.starAverage,
      ]));
      if (!signature || signature === '[]') return false;
      if (options.skipDuplicate === true && signature === lastSignature) return false;
      const messages = buildSongRecapMessages(state, { publicBaseUrl });
      if (!messages.length) return false;
      for (let index = 0; index < messages.length; index += 1) {
        sendMessage(messages[index]);
        if (index < messages.length - 1) await sleepFn(1200);
      }
      lastSignature = signature;
      return true;
    } catch (error) {
      logger.warn?.('[vivy-twitch] song recap failed:', error?.message || String(error));
      return false;
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (disabled || timer || !stateUrl) return false;
    timer = setIntervalFn(() => {
      tick().catch((error) => logger.warn?.('[vivy-twitch] song recap failed:', error?.message || String(error)));
    }, intervalMs);
    timer?.unref?.();
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearIntervalFn(timer);
    timer = null;
    return true;
  }

  return { intervalMs, start, stop, tick };
}

function parseTags(raw = '') {
  const tags = {};
  if (!raw.startsWith('@')) return tags;
  raw.slice(1).split(';').forEach((part) => {
    const index = part.indexOf('=');
    const key = index >= 0 ? part.slice(0, index) : part;
    const value = index >= 0 ? part.slice(index + 1) : '';
    tags[key] = value
      .replace(/\\s/g, ' ')
      .replace(/\\:/g, ';')
      .replace(/\\\\/g, '\\')
      .replace(/\\r/g, '\r')
      .replace(/\\n/g, '\n');
  });
  return tags;
}

function parsePrivmsg(line = '') {
  const match = line.match(/^(?:@([^ ]+) )?:([^! ]+)![^ ]+ PRIVMSG #([^ ]+) :([\s\S]*)$/);
  if (!match) return null;
  const tags = match[1] ? parseTags(`@${match[1]}`) : {};
  return {
    tags,
    username: tags['display-name'] || match[2],
    login: match[2],
    channel: match[3],
    message: match[4],
    messageId: tags.id || '',
  };
}

function shouldForwardMessage(message = '') {
  if (process.env.VIVY_STREAM_COMMANDS_ONLY !== '1') return true;
  return /^!(?:vivy|nossen|song|chanson|theme|th[eè]me|idee|idée|vote|choix|etoiles?|étoiles?|stars?|note)\b/i.test(message)
    || /[⭐★🌟]/u.test(message)
    || /\b[1-5]\s*\/\s*5\b/.test(message);
}

async function postChatMessage(endpoint, secret, payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Vivy-Stream-Secret'] = secret;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`vivy_stream_http_${response.status}: ${body.slice(0, 240)}`);
  }
  return body ? JSON.parse(body) : {};
}

async function postStreamReset(endpoint, secret, payload = {}, options = {}) {
  const url = cleanEnv(endpoint);
  if (!url) return { ok: false, skipped: true, error: 'reset_url_missing' };
  const fetchFn = options.fetchFn || fetch;
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Vivy-Stream-Secret'] = secret;
  const response = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`vivy_stream_reset_http_${response.status}: ${body.slice(0, 240)}`);
  }
  return body ? JSON.parse(body) : { ok: true };
}

async function fetchTwitchStreamStatus(options = {}) {
  const disabled = options.disabled === true;
  const channel = cleanEnv(options.channel).replace(/^#/, '').toLowerCase();
  if (disabled) {
    return { ok: true, live: true, disabled: true, reason: 'live_gate_disabled' };
  }
  if (!channel) return { ok: false, live: false, reason: 'missing_channel' };
  const clientId = cleanEnv(options.clientId);
  const accessToken = normalizeTwitchBearerToken(options.accessToken);
  if (!clientId || !accessToken) {
    return { ok: false, live: false, reason: 'missing_helix_credentials' };
  }
  const fetchFn = options.fetchFn || fetch;
  const streamsUrl = cleanEnv(options.streamsUrl) || TWITCH_HELIX_STREAMS_URL;
  const url = new URL(streamsUrl);
  url.searchParams.set('user_login', channel);
  const response = await fetchFn(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Client-ID': clientId,
    },
  });
  const body = await response.text();
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {}
  if (!response.ok) {
    return {
      ok: false,
      live: false,
      reason: `helix_http_${response.status}`,
      message: cleanEnv(json?.message || body).slice(0, 240),
    };
  }
  const entries = Array.isArray(json?.data) ? json.data : [];
  const stream = entries.find((entry) => cleanEnv(entry?.user_login).toLowerCase() === channel) || entries[0] || null;
  return {
    ok: true,
    live: Boolean(stream),
    checkedAt: new Date().toISOString(),
    streamId: cleanEnv(stream?.id),
    title: cleanEnv(stream?.title).slice(0, 160),
    gameName: cleanEnv(stream?.game_name).slice(0, 120),
    startedAt: cleanEnv(stream?.started_at),
  };
}

function send(ws, line) {
  ws.send(line);
  if (process.env.VIVY_STREAM_DEBUG_IRC === '1') {
    console.log(`[vivy-twitch] >>> ${line.replace(/PASS .+$/i, 'PASS [redacted]')}`);
  }
}

async function runOnce(config) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(TWITCH_IRC_URL);
    let joined = false;
    let closedBySignal = false;
    const announcer = createAnnouncementRotator({
      disabled: config.announceDisabled,
      intervalMs: config.announceIntervalMs,
      isConnected: () => joined && ws.readyState === WebSocket.OPEN,
      sendMessage: (message) => send(ws, `PRIVMSG #${config.channel} :${message}`),
    });
    const trackNotifier = createTrackNoticeWatcher({
      disabled: config.trackNoticeDisabled,
      stateUrl: config.stateUrl,
      publicBaseUrl: config.publicBaseUrl,
      pollIntervalMs: config.trackNoticePollIntervalMs,
      isConnected: () => joined && ws.readyState === WebSocket.OPEN,
      sendMessage: (message) => send(ws, `PRIVMSG #${config.channel} :${message}`),
    });
    const recapRotator = createSongRecapRotator({
      disabled: config.recapDisabled,
      stateUrl: config.stateUrl,
      publicBaseUrl: config.publicBaseUrl,
      intervalMs: config.recapIntervalMs,
      isConnected: () => joined && ws.readyState === WebSocket.OPEN,
      sendMessage: (message) => send(ws, `PRIVMSG #${config.channel} :${message}`),
    });

    const close = () => {
      closedBySignal = true;
      announcer.stop();
      trackNotifier.stop();
      recapRotator.stop();
      try {
        ws.close();
      } catch {}
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);

    ws.on('open', () => {
      console.log(`[vivy-twitch] connected, joining #${config.channel}`);
      send(ws, 'CAP REQ :twitch.tv/tags twitch.tv/commands');
      send(ws, `PASS ${config.oauthToken}`);
      send(ws, `NICK ${config.username}`);
      send(ws, `JOIN #${config.channel}`);
      announcer.start();
      trackNotifier.start();
      recapRotator.start();
    });

    ws.on('message', async (data) => {
      const lines = String(data || '').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (process.env.VIVY_STREAM_DEBUG_IRC === '1') console.log(`[vivy-twitch] <<< ${line}`);
        if (line.startsWith('PING ')) {
          send(ws, line.replace(/^PING/i, 'PONG'));
          continue;
        }
        if (line.includes(' 001 ')) {
          joined = true;
          trackNotifier.tick().catch((error) => {
            console.warn('[vivy-twitch] track notice failed:', error?.message || String(error));
          });
        }
        const parsed = parsePrivmsg(line);
        if (!parsed || !shouldForwardMessage(parsed.message)) continue;
        try {
          await postChatMessage(config.ingestUrl, config.secret, {
            source: 'twitch',
            channel: parsed.channel,
            username: parsed.username,
            login: parsed.login,
            userId: parsed.tags['user-id'],
            messageId: parsed.messageId,
            message: parsed.message,
            color: parsed.tags.color,
            badges: parsed.tags.badges,
            isModerator: /(^|,)moderator\//.test(parsed.tags.badges || ''),
            isSubscriber: /(^|,)subscriber\//.test(parsed.tags.badges || ''),
            receivedAt: new Date().toISOString(),
          });
        } catch (error) {
          console.warn('[vivy-twitch] ingest failed:', error?.message || String(error));
        }
      }
    });

    ws.on('error', (error) => {
      announcer.stop();
      trackNotifier.stop();
      recapRotator.stop();
      reject(error);
    });

    ws.on('close', (code, reason) => {
      announcer.stop();
      trackNotifier.stop();
      recapRotator.stop();
      process.removeListener('SIGINT', close);
      process.removeListener('SIGTERM', close);
      if (closedBySignal) {
        console.log('[vivy-twitch] stopped');
        process.exit(0);
      }
      const suffix = reason ? `: ${String(reason)}` : '';
      const message = joined
        ? `connection closed ${code}${suffix}`
        : `connection closed before join ${code}${suffix}`;
      resolve(new Error(message));
    });
  });
}

async function main() {
  const ingestUrl = cleanEnv(process.env.VIVY_STREAM_INGEST_URL) || 'https://vivy.funesterie.me/api/vivy/stream/chat';
  const config = {
    channel: cleanEnv(process.env.TWITCH_CHANNEL || process.env.VIVY_TWITCH_CHANNEL).replace(/^#/, '').toLowerCase(),
    username: cleanEnv(process.env.TWITCH_BOT_USERNAME || process.env.TWITCH_USERNAME).toLowerCase(),
    oauthToken: cleanEnv(process.env.TWITCH_OAUTH_TOKEN || process.env.TWITCH_IRC_OAUTH),
    clientId: cleanEnv(process.env.TWITCH_CLIENT_ID || process.env.TWITCH_BOT_CLIENT_ID || process.env.TWITCH_APP_CLIENT_ID),
    accessToken: normalizeTwitchBearerToken(process.env.TWITCH_ACCESS_TOKEN || process.env.TWITCH_BOT_ACCESS_TOKEN || process.env.TWITCH_OAUTH_TOKEN || process.env.TWITCH_IRC_OAUTH),
    helixStreamsUrl: cleanEnv(process.env.TWITCH_HELIX_STREAMS_URL) || TWITCH_HELIX_STREAMS_URL,
    ingestUrl,
    resetUrl: cleanEnv(process.env.VIVY_STREAM_RESET_URL) || resolveStreamResetUrl(ingestUrl),
    secret: cleanEnv(process.env.VIVY_STREAM_SECRET),
    liveGateDisabled: process.env.VIVY_TWITCH_LIVE_GATE_DISABLED === '1',
    livePollIntervalMs: resolveLivePollInterval(process.env.VIVY_TWITCH_LIVE_POLL_INTERVAL_MS || process.env.TWITCH_LIVE_POLL_INTERVAL_MS),
    resetOnOffline: process.env.VIVY_TWITCH_RESET_ON_OFFLINE !== '0',
    resetOnIrcClose: process.env.VIVY_TWITCH_RESET_ON_IRC_CLOSE === '1',
    announceIntervalMs: resolveAnnounceInterval(process.env.VIVY_STREAM_ANNOUNCE_INTERVAL_MS),
    announceDisabled: process.env.VIVY_STREAM_ANNOUNCE_DISABLED === '1',
    stateUrl: cleanEnv(process.env.VIVY_STREAM_STATE_URL) || 'https://vivy.funesterie.me/api/vivy/stream/state',
    publicBaseUrl: cleanEnv(process.env.VIVY_PUBLIC_BASE_URL) || DEFAULT_PUBLIC_BASE_URL,
    trackNoticePollIntervalMs: resolveTrackNoticePollInterval(process.env.VIVY_STREAM_TRACK_NOTICE_POLL_INTERVAL_MS),
    trackNoticeDisabled: process.env.VIVY_STREAM_TRACK_NOTICE_DISABLED === '1',
    recapIntervalMs: resolveRecapInterval(process.env.VIVY_STREAM_RECAP_INTERVAL_MS),
    recapDisabled: process.env.VIVY_STREAM_RECAP_DISABLED === '1',
  };

  if (!config.channel || !config.username || !config.oauthToken) {
    console.error('[vivy-twitch] missing env: TWITCH_CHANNEL, TWITCH_BOT_USERNAME, TWITCH_OAUTH_TOKEN');
    process.exit(1);
  }
  if (!config.oauthToken.startsWith('oauth:')) {
    console.error('[vivy-twitch] TWITCH_OAUTH_TOKEN must start with oauth:');
    process.exit(1);
  }

  let reconnectAttempt = 1;
  let offlineResetSent = false;
  let lastLive = false;

  async function resetOfflineSession(reason, liveStatus = {}) {
    if (!config.resetOnOffline) return false;
    try {
      const result = await postStreamReset(config.resetUrl, config.secret, {
        source: 'twitch-worker',
        reason,
        channel: config.channel,
        clearMemory: true,
        preserveSongs: true,
        preserveJukebox: false,
        preserveLearning: false,
        liveStatus,
      });
      console.log(`[vivy-twitch] reset live session: ${reason} cleared=${result?.memoryCleared ?? 0}`);
      return true;
    } catch (error) {
      console.warn('[vivy-twitch] reset failed:', error?.message || String(error));
      return false;
    }
  }

  while (true) {
    if (!config.liveGateDisabled) {
      const liveStatus = await fetchTwitchStreamStatus({
        channel: config.channel,
        clientId: config.clientId,
        accessToken: config.accessToken,
        streamsUrl: config.helixStreamsUrl,
      }).catch((error) => ({ ok: false, live: false, reason: error?.message || String(error) }));
      if (!liveStatus.live) {
        if (!offlineResetSent) {
          await resetOfflineSession(liveStatus.ok ? 'twitch_stream_offline' : `twitch_live_check_${liveStatus.reason || 'failed'}`, liveStatus);
          offlineResetSent = true;
        }
        const reason = liveStatus.ok ? 'offline' : (liveStatus.reason || 'live_check_failed');
        console.log(`[vivy-twitch] stream ${reason}; standby ${Math.round(config.livePollIntervalMs / 1000)}s`);
        lastLive = false;
        reconnectAttempt = 1;
        await sleep(config.livePollIntervalMs);
        continue;
      }
      if (!lastLive) {
        console.log(`[vivy-twitch] stream online, opening IRC for #${config.channel}`);
      }
      lastLive = true;
      offlineResetSent = false;
    }

    try {
      const closeReason = await runOnce(config);
      console.warn(`[vivy-twitch] ${closeReason.message}`);
    } catch (error) {
      console.warn('[vivy-twitch] connection failed:', error?.message || String(error));
    }

    if (config.resetOnIrcClose) {
      await resetOfflineSession('twitch_irc_disconnected', { live: lastLive });
      offlineResetSent = true;
    }

    if (!config.liveGateDisabled) {
      const afterCloseStatus = await fetchTwitchStreamStatus({
        channel: config.channel,
        clientId: config.clientId,
        accessToken: config.accessToken,
        streamsUrl: config.helixStreamsUrl,
      }).catch((error) => ({ ok: false, live: false, reason: error?.message || String(error) }));
      if (!afterCloseStatus.live) {
        if (!offlineResetSent) {
          await resetOfflineSession(afterCloseStatus.ok ? 'twitch_stream_offline' : `twitch_live_check_${afterCloseStatus.reason || 'failed'}`, afterCloseStatus);
          offlineResetSent = true;
        }
        lastLive = false;
        reconnectAttempt = 1;
        await sleep(config.livePollIntervalMs);
        continue;
      }
    }

    const backoffMs = Math.min(60000, 3000 * reconnectAttempt);
    reconnectAttempt += 1;
    console.log(`[vivy-twitch] reconnect in ${Math.round(backoffMs / 1000)}s`);
    await sleep(backoffMs);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[vivy-twitch] fatal:', error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  ANNOUNCE_MESSAGES,
  buildSongRecapMessages,
  buildTrackNoticeMessage,
  createAnnouncementRotator,
  createSongRecapRotator,
  createTrackNoticeWatcher,
  fetchTwitchStreamStatus,
  parsePrivmsg,
  parseTags,
  resolveAnnounceInterval,
  resolveLivePollInterval,
  resolveRecapInterval,
  resolveStreamResetUrl,
  resolveTrackNoticePollInterval,
  postStreamReset,
  shouldForwardMessage,
};
