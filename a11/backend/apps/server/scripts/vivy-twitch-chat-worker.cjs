#!/usr/bin/env node

const WebSocket = require('ws');

const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const DEFAULT_ANNOUNCE_INTERVAL_MS = 5 * 60 * 1000;
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

function normalizeAnnouncement(value = '') {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 360);
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

    const close = () => {
      closedBySignal = true;
      announcer.stop();
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
    });

    ws.on('message', async (data) => {
      const lines = String(data || '').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (process.env.VIVY_STREAM_DEBUG_IRC === '1') console.log(`[vivy-twitch] <<< ${line}`);
        if (line.startsWith('PING ')) {
          send(ws, line.replace(/^PING/i, 'PONG'));
          continue;
        }
        if (line.includes(' 001 ')) joined = true;
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
      reject(error);
    });

    ws.on('close', (code, reason) => {
      announcer.stop();
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
  const config = {
    channel: cleanEnv(process.env.TWITCH_CHANNEL || process.env.VIVY_TWITCH_CHANNEL).replace(/^#/, '').toLowerCase(),
    username: cleanEnv(process.env.TWITCH_BOT_USERNAME || process.env.TWITCH_USERNAME).toLowerCase(),
    oauthToken: cleanEnv(process.env.TWITCH_OAUTH_TOKEN || process.env.TWITCH_IRC_OAUTH),
    ingestUrl: cleanEnv(process.env.VIVY_STREAM_INGEST_URL) || 'https://vivy.funesterie.me/api/vivy/stream/chat',
    secret: cleanEnv(process.env.VIVY_STREAM_SECRET),
    announceIntervalMs: resolveAnnounceInterval(process.env.VIVY_STREAM_ANNOUNCE_INTERVAL_MS),
    announceDisabled: process.env.VIVY_STREAM_ANNOUNCE_DISABLED === '1',
  };

  if (!config.channel || !config.username || !config.oauthToken) {
    console.error('[vivy-twitch] missing env: TWITCH_CHANNEL, TWITCH_BOT_USERNAME, TWITCH_OAUTH_TOKEN');
    process.exit(1);
  }
  if (!config.oauthToken.startsWith('oauth:')) {
    console.error('[vivy-twitch] TWITCH_OAUTH_TOKEN must start with oauth:');
    process.exit(1);
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      const closeReason = await runOnce(config);
      console.warn(`[vivy-twitch] ${closeReason.message}`);
    } catch (error) {
      console.warn('[vivy-twitch] connection failed:', error?.message || String(error));
    }
    const backoffMs = Math.min(60000, 3000 * attempt);
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
  createAnnouncementRotator,
  parsePrivmsg,
  parseTags,
  resolveAnnounceInterval,
  shouldForwardMessage,
};
