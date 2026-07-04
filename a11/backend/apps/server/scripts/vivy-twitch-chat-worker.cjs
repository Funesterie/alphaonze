#!/usr/bin/env node

const WebSocket = require('ws');

const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const TWITCH_HELIX_STREAMS_URL = 'https://api.twitch.tv/helix/streams';
const DEFAULT_ANNOUNCE_INTERVAL_MS = 12 * 60 * 1000;
const DEFAULT_TRACK_NOTICE_POLL_INTERVAL_MS = 10 * 1000;
const DEFAULT_RECAP_INTERVAL_MS = 28 * 60 * 1000;
const DEFAULT_TWITCH_LIVE_POLL_INTERVAL_MS = 60 * 1000;
const DEFAULT_BOT_MESSAGE_GAP_MS = 15 * 1000;
const DEFAULT_PUBLIC_BASE_URL = 'https://vivy.funesterie.me';
const ANNOUNCE_MESSAGES = Object.freeze([
  '🎤 Vivy Live — !vivy ton idée | !nossen plus épique | !chanson sujet + ambiance',
  '🎵 Vote avec !vote S1 | note avec !etoiles 5 S1',
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

function resolveBotMessageGap(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_BOT_MESSAGE_GAP_MS;
  return Math.max(0, Math.min(2 * 60 * 1000, Math.floor(parsed)));
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

function isProviderOnlyTrackUrl(value = '') {
  const raw = cleanEnv(value);
  if (!raw) return false;
  try {
    const parsed = new URL(raw, DEFAULT_PUBLIC_BASE_URL);
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'musicfile.removeai.ai';
  } catch {
    return /^https:\/\/musicfile\.removeai\.ai\//i.test(raw);
  }
}

function selectTrackNoticeTrack(state = {}) {
  const current = state.current || {};
  const phase = cleanEnv(current.phase).toLowerCase();
  const currentTrackUrl = cleanEnv(current.trackUrl);
  if ((phase === 'presenting' || phase === 'playing') && currentTrackUrl && !isProviderOnlyTrackUrl(currentTrackUrl)) {
    return current;
  }
  const songs = Array.isArray(state.songs) ? state.songs : [];
  for (let index = songs.length - 1; index >= 0; index -= 1) {
    const song = songs[index] || {};
    const trackUrl = cleanEnv(song.trackUrl);
    if (!trackUrl || isProviderOnlyTrackUrl(trackUrl)) continue;
    if (cleanEnv(song.source).toLowerCase() === 'vivy-interlude') continue;
    return song;
  }
  return null;
}

function buildTrackNoticeMessage(state = {}, options = {}) {
  const track = selectTrackNoticeTrack(state);
  if (!track) return '';
  const trackUrl = cleanEnv(track.trackUrl);
  if (!trackUrl) return '';
  const title = clipInline(track.trackTitle || track.title || 'Nouvelle création Vivy', 100);
  const publicUrl = absolutizePublicUrl(track.sharePath || trackUrl, options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL);
  const coverUrl = absolutizePublicUrl(track.coverImageUrl || track.coverUrl || track.imageUrl || '', options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL);
  const clipUrl = absolutizePublicUrl(track.coverVideoUrl || track.videoUrl || track.video_url || track.clipUrl || '', options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL);
  const visualLink = clipUrl ? ` 🎬 ${clipUrl}` : (coverUrl ? ` 🖼️ ${coverUrl}` : '');
  return normalizeAnnouncement(`🎵 ${title} ▶ ${publicUrl}${visualLink}`);
}

function buildTrackClipNoticeMessage(state = {}, options = {}) {
  const track = selectTrackNoticeTrack(state);
  if (!track) return '';
  const clipUrl = absolutizePublicUrl(
    track.coverVideoUrl || track.videoUrl || track.video_url || track.clipUrl || '',
    options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL
  );
  if (!clipUrl) return '';
  const title = clipInline(track.trackTitle || track.title || 'Nouvelle création Vivy', 90);
  return normalizeAnnouncement(`🎬 Clip Vivy: ${title} ▶ ${clipUrl}`);
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
  const count = songs.filter((song) => song?.trackUrl).length;
  if (!count) return [];
  const playlistUrl = absolutizePublicUrl('/api/vivy/stream/songs', publicBaseUrl);
  return [normalizeAnnouncement(`🎶 Playlist Vivy Live (${count} titre${count > 1 ? 's' : ''}) ▶ ${playlistUrl}`)];
}

function createSpacedSender(options = {}) {
  const sendMessage = options.sendMessage || (() => {});
  const sleepFn = options.sleep || sleep;
  const logger = options.logger || console;
  const gapMs = resolveBotMessageGap(options.gapMs);
  let lastSentAt = 0;
  let chain = Promise.resolve();

  function enqueue(message) {
    const cleanMessage = normalizeAnnouncement(message);
    if (!cleanMessage) return chain;
    chain = chain.then(async () => {
      const now = Date.now();
      const waitMs = lastSentAt > 0 ? Math.max(0, gapMs - (now - lastSentAt)) : 0;
      if (waitMs > 0) await sleepFn(waitMs);
      sendMessage(cleanMessage);
      lastSentAt = Date.now();
    }).catch((error) => {
      logger.warn?.('[vivy-twitch] bot message failed:', error?.message || String(error));
    });
    return chain;
  }

  return { enqueue, gapMs };
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
  let lastClipKey = cleanEnv(options.lastClipKey);

  async function tick() {
    if (disabled || !stateUrl || !isConnected() || inFlight) return false;
    inFlight = true;
    try {
      const response = await fetchFn(stateUrl, { headers: { Accept: 'application/json' } });
      if (!response?.ok) throw new Error(`state_http_${response?.status || 'unknown'}`);
      const state = await response.json();
      const noticeTrack = selectTrackNoticeTrack(state);
      const trackKey = cleanEnv(noticeTrack?.trackUrl || noticeTrack?.sharePath || noticeTrack?.id || noticeTrack?.trackTitle || noticeTrack?.title);
      const clipKey = cleanEnv(noticeTrack?.coverVideoUrl || noticeTrack?.videoUrl || noticeTrack?.video_url || noticeTrack?.clipUrl);
      const message = buildTrackNoticeMessage(state, { publicBaseUrl });
      if (!observedOnce) {
        observedOnce = true;
        if (trackKey) lastTrackKey = trackKey;
        if (clipKey) lastClipKey = clipKey;
        return false;
      }
      if (message && trackKey && trackKey !== lastTrackKey) {
        sendMessage(message);
        lastTrackKey = trackKey;
        lastClipKey = clipKey;
        logger.info?.('[vivy-twitch] shared track link key=%s', trackKey);
        return true;
      }
      if (trackKey && trackKey === lastTrackKey && clipKey && clipKey !== lastClipKey) {
        const clipMessage = buildTrackClipNoticeMessage(state, { publicBaseUrl });
        if (!clipMessage) return false;
        sendMessage(clipMessage);
        lastClipKey = clipKey;
        logger.info?.('[vivy-twitch] shared clip link key=%s', trackKey);
        return true;
      }
      return false;
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

function createTwitchLiveStatusMonitor(options = {}) {
  const intervalMs = resolveLivePollInterval(options.intervalMs);
  const disabled = options.disabled === true;
  const isConnected = options.isConnected || (() => false);
  const fetchStatus = options.fetchStatus || (() => fetchTwitchStreamStatus(options));
  const onOffline = options.onOffline || (() => {});
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const logger = options.logger || console;
  let timer = null;
  let inFlight = false;
  let offlineHandled = false;

  async function tick() {
    if (disabled || !isConnected() || inFlight || offlineHandled) return false;
    inFlight = true;
    try {
      const status = await fetchStatus();
      if (status?.live) return false;
      offlineHandled = true;
      await onOffline(status || { ok: false, live: false, reason: 'unknown' });
      return true;
    } catch (error) {
      logger.warn?.('[vivy-twitch] live monitor failed:', error?.message || String(error));
      return false;
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (disabled || timer) return false;
    timer = setIntervalFn(() => {
      tick().catch((error) => logger.warn?.('[vivy-twitch] live monitor failed:', error?.message || String(error)));
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
  if (isVivyAutomatedChatMessage(message)) return false;
  if (process.env.VIVY_STREAM_COMMANDS_ONLY !== '1') return true;
  return /^!(?:vivy|nossen|song|chanson|theme|th[eè]me|idee|idée|vote|choix|etoiles?|étoiles?|stars?|note)\b/i.test(message)
    || /[⭐★🌟]/u.test(message)
    || /\b[1-5]\s*\/\s*5\b/.test(message);
}

function isVivyAutomatedChatMessage(message = '') {
  const text = normalizeAnnouncement(message);
  return /^🎤\s*Vivy\s+Live\s+—\s+propose\b/i.test(text)
    || /^🎤\s*Vivy\s+Live\s+—\s*!vivy\b/i.test(text)
    || /^🎵\s*Commandes\s*:/i.test(text)
    || /^🎵\s*Vote\s+avec\s+!vote\b/i.test(text)
    || /^🎵\s*Nouvelle\s+création\s+Vivy\s*:/i.test(text)
    || /^🎵\s*.+\s+▶\s+https?:\/\//i.test(text)
    || /^🎶\s*Morceaux\s+Vivy\s+passés\s+dans\s+le\s+live\s*:/i.test(text)
    || /^🎶\s*Playlist\s+Vivy\s+Live\b/i.test(text)
    || /^🎶\s*Suite\s*:/i.test(text);
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
    let closedByOffline = false;
    const spacedSender = createSpacedSender({
      gapMs: config.botMessageGapMs,
      logger: console,
      sendMessage: (message) => send(ws, `PRIVMSG #${config.channel} :${message}`),
    });
    const sendBotMessage = (message) => {
      spacedSender.enqueue(message);
      return true;
    };
    const announcer = createAnnouncementRotator({
      disabled: config.announceDisabled,
      intervalMs: config.announceIntervalMs,
      isConnected: () => joined && ws.readyState === WebSocket.OPEN,
      sendMessage: sendBotMessage,
    });
    const trackNotifier = createTrackNoticeWatcher({
      disabled: config.trackNoticeDisabled,
      stateUrl: config.stateUrl,
      publicBaseUrl: config.publicBaseUrl,
      pollIntervalMs: config.trackNoticePollIntervalMs,
      isConnected: () => joined && ws.readyState === WebSocket.OPEN,
      sendMessage: sendBotMessage,
    });
    const recapRotator = createSongRecapRotator({
      disabled: config.recapDisabled,
      stateUrl: config.stateUrl,
      publicBaseUrl: config.publicBaseUrl,
      intervalMs: config.recapIntervalMs,
      isConnected: () => joined && ws.readyState === WebSocket.OPEN,
      sendMessage: sendBotMessage,
    });
    const liveMonitor = createTwitchLiveStatusMonitor({
      disabled: config.liveGateDisabled,
      intervalMs: config.livePollIntervalMs,
      channel: config.channel,
      clientId: config.clientId,
      accessToken: config.accessToken,
      streamsUrl: config.helixStreamsUrl,
      isConnected: () => joined && ws.readyState === WebSocket.OPEN,
      onOffline: async (status) => {
        closedByOffline = true;
        const reason = status?.ok ? 'twitch_stream_offline' : `twitch_live_check_${status?.reason || 'failed'}`;
        console.log(`[vivy-twitch] stream offline while IRC connected; closing chat and resetting session`);
        if (typeof config.onOfflineDetected === 'function') await config.onOfflineDetected(reason, status);
        announcer.stop();
        trackNotifier.stop();
        recapRotator.stop();
        liveMonitor.stop();
        try {
          ws.close(1000, 'twitch stream offline');
        } catch {}
      },
    });

    const close = () => {
      closedBySignal = true;
      announcer.stop();
      trackNotifier.stop();
      recapRotator.stop();
      liveMonitor.stop();
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
          liveMonitor.start();
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
      liveMonitor.stop();
      reject(error);
    });

    ws.on('close', (code, reason) => {
      announcer.stop();
      trackNotifier.stop();
      recapRotator.stop();
      liveMonitor.stop();
      process.removeListener('SIGINT', close);
      process.removeListener('SIGTERM', close);
      if (closedBySignal) {
        console.log('[vivy-twitch] stopped');
        process.exit(0);
      }
      const suffix = reason ? `: ${String(reason)}` : '';
      const message = joined
        ? (closedByOffline ? `connection closed after stream offline ${code}${suffix}` : `connection closed ${code}${suffix}`)
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
    botMessageGapMs: resolveBotMessageGap(process.env.VIVY_STREAM_BOT_MESSAGE_GAP_MS),
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
  config.onOfflineDetected = async (reason, liveStatus = {}) => {
    if (!offlineResetSent) {
      await resetOfflineSession(reason, liveStatus);
      offlineResetSent = true;
    }
    lastLive = false;
    reconnectAttempt = 1;
  };

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
  buildTrackClipNoticeMessage,
  buildTrackNoticeMessage,
  createAnnouncementRotator,
  createSpacedSender,
  createSongRecapRotator,
  createTrackNoticeWatcher,
  createTwitchLiveStatusMonitor,
  fetchTwitchStreamStatus,
  parsePrivmsg,
  parseTags,
  resolveAnnounceInterval,
  resolveBotMessageGap,
  resolveLivePollInterval,
  resolveRecapInterval,
  resolveStreamResetUrl,
  resolveTrackNoticePollInterval,
  postStreamReset,
  shouldForwardMessage,
};
