#!/usr/bin/env node

const WebSocket = require('ws');

const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

function cleanEnv(value = '') {
  return String(value || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const close = () => {
      closedBySignal = true;
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
      reject(error);
    });

    ws.on('close', (code, reason) => {
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
  parsePrivmsg,
  parseTags,
  shouldForwardMessage,
};
