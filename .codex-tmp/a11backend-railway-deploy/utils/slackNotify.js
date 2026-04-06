// apps/server/utils/slackNotify.js
// Slack notification dashboard module for A11 backend

const SLACK_WEBHOOK_URL = String(process.env.SLACK_WEBHOOK_URL || process.env.A11_SLACK_WEBHOOK_URL || '').trim();
const SLACK_NOTIFY_ERRORS = !/^(0|false|off|no)$/i.test(String(process.env.SLACK_NOTIFY_ERRORS || '1').trim() || '1');

async function sendSlackNotification({ text, blocks = null }) {
  if (!SLACK_WEBHOOK_URL || !SLACK_NOTIFY_ERRORS) return { ok: false, skipped: true };
  const payload = { text: String(text || '').trim().slice(0, 3000) || 'A11 notification' };
  if (Array.isArray(blocks) && blocks.length) payload.blocks = blocks;
  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`slack_webhook_failed:${response.status}`);
  return { ok: true };
}

async function safeSlack(msg, blocks = null) {
  try {
    await sendSlackNotification({ text: msg, blocks });
  } catch (e) {
    console.warn('[Slack failed]', e.message);
  }
}

// Dashboard hooks
const SlackDashboard = {
  notifyError: async (scope, errorMessage, details = {}) => {
    const normalizedScope = String(scope || 'A11').trim() || 'A11';
    const normalizedMessage = String(errorMessage || 'Erreur inconnue').trim() || 'Erreur inconnue';
    const detailLines = Object.entries(details || {})
      .map(([key, value]) => `• *${key}*: ${String(value ?? '').trim()}`)
      .join('\n');
    const text = `❌ *Erreur* (${normalizedScope})\n${normalizedMessage}${detailLines ? '\n' + detailLines : ''}`;
    await safeSlack(text);
  },
  notifyQflush: async (prompt, user = null) => {
    const text = `🧠 *Qflush run*${user ? ` par ${user}` : ''}\n> ${prompt}`;
    await safeSlack(text);
  },
  notifyImage: async (prompt, fileUrl = null) => {
    const text = `🎨 *Image générée*\n> ${prompt}${fileUrl ? `\n[Voir l'image](${fileUrl})` : ''}`;
    await safeSlack(text);
  },
  notifyEvent: async (event, data = {}) => {
    const text = `🔔 *Event*: ${event}\n${Object.entries(data).map(([k,v])=>`• *${k}*: ${v}`).join('\n')}`;
    await safeSlack(text);
  }
};

module.exports = { sendSlackNotification, safeSlack, SlackDashboard };
