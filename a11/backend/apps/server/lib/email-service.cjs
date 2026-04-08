const { Resend } = require('resend');
const nodemailer = require('nodemailer');

function normalizeRecipients(to) {
  if (Array.isArray(to)) {
    return Array.from(new Set(
      to
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ));
  }

  const raw = String(to || '').trim();
  if (!raw) return [];
  return Array.from(new Set(
    raw
      .split(/[;,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

function parseBooleanFlag(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function createSmtpClient(config = {}, transportFactory = nodemailer.createTransport.bind(nodemailer)) {
  const smtpUrl = String(config.smtpUrl || config.mailUrl || '').trim();
  const smtpHost = String(config.smtpHost || '').trim();
  const smtpPort = Number(config.smtpPort || 0) || 0;
  const smtpUser = String(config.smtpUser || '').trim();
  const smtpPass = String(config.smtpPass || '').trim();
  const gmailUser = String(config.gmailUser || '').trim();
  const gmailAppPassword = String(config.gmailAppPassword || '').trim();

  if (smtpUrl) {
    return {
      provider: 'smtp',
      transport: transportFactory(smtpUrl),
    };
  }

  if (smtpHost) {
    const secure = parseBooleanFlag(config.smtpSecure, smtpPort === 465);
    const ignoreTLS = parseBooleanFlag(config.smtpIgnoreTLS, false);
    const requireTLS = parseBooleanFlag(config.smtpRequireTLS, false);
    const rejectUnauthorized = parseBooleanFlag(config.smtpRejectUnauthorized, true);
    const transportOptions = {
      host: smtpHost,
      port: smtpPort || (secure ? 465 : 587),
      secure,
      auth: smtpUser || smtpPass
        ? {
            user: smtpUser,
            pass: smtpPass,
          }
        : undefined,
      ignoreTLS,
      requireTLS,
      tls: {
        rejectUnauthorized,
      },
    };

    return {
      provider: 'smtp',
      transport: transportFactory(transportOptions),
    };
  }

  if (gmailUser && gmailAppPassword) {
    return {
      provider: 'gmail',
      transport: transportFactory({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailAppPassword,
        },
      }),
    };
  }

  return null;
}

function createEmailService(config = {}) {
  const ResendCtor = typeof config.resendCtor === 'function' ? config.resendCtor : Resend;
  const resendApiKey = String(config.resendApiKey || '').trim();
  const fromEmail = String(config.fromEmail || 'A11 <onboarding@resend.dev>').trim();
  const appUrl = String(config.appUrl || 'https://a11.funesterie.pro').trim();
  const resendClient = resendApiKey ? new ResendCtor(resendApiKey) : null;
  const smtpClient = createSmtpClient(config, config.transportFactory);

  function isConfigured() {
    return Boolean(resendClient || smtpClient?.transport);
  }

  function getStatus() {
    return {
      configured: isConfigured(),
      provider: resendClient ? 'resend' : (smtpClient?.provider || null),
      providers: {
        resend: Boolean(resendClient),
        smtp: Boolean(smtpClient?.transport),
      },
      from: fromEmail,
      appUrl,
    };
  }

  async function sendEmail({ to, subject, text, html, attachments, tags }) {
    const recipients = normalizeRecipients(to);
    if (!recipients.length) {
      return { ok: false, reason: 'missing_to' };
    }
    if (!resendClient && !smtpClient?.transport) {
      return { ok: false, reason: 'mail_provider_not_configured' };
    }

    if (resendClient) {
      const response = await resendClient.emails.send({
        from: fromEmail,
        to: recipients.length === 1 ? recipients[0] : recipients,
        subject: String(subject || 'A11').trim() || 'A11',
        text: typeof text === 'string' ? text : undefined,
        html: typeof html === 'string' ? html : undefined,
        attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined,
        tags: Array.isArray(tags) && tags.length ? tags : undefined,
      });

      return {
        ok: true,
        provider: 'resend',
        id: response?.data?.id || response?.id || null,
        to: recipients,
      };
    }

    const response = await smtpClient.transport.sendMail({
      from: fromEmail,
      to: recipients,
      subject: String(subject || 'A11').trim() || 'A11',
      text: typeof text === 'string' ? text : undefined,
      html: typeof html === 'string' ? html : undefined,
      attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined,
      headers: Array.isArray(tags) && tags.length
        ? Object.fromEntries(tags.map((tag, index) => [`X-A11-Tag-${index + 1}`, `${tag.name}:${tag.value}`]))
        : undefined,
    });

    return {
      ok: true,
      provider: smtpClient.provider,
      id: response?.messageId || null,
      to: recipients,
      accepted: Array.isArray(response?.accepted) ? response.accepted : recipients,
      rejected: Array.isArray(response?.rejected) ? response.rejected : [],
    };
  }

  async function sendFileEmail({ to, subject, message, fileUrl, attachment }) {
    const textBody = String(message || 'Voici ton fichier généré.').trim();
    const linkPart = fileUrl ? `\n\nLien: ${fileUrl}` : '';
    return sendEmail({
      to,
      subject: String(subject || 'A11 — Fichier généré').trim(),
      text: `${textBody}${linkPart}`,
      attachments: attachment ? [{
        filename: attachment.filename,
        content: attachment.buffer,
      }] : undefined,
      tags: [{ name: 'type', value: 'file' }],
    });
  }

  async function sendPasswordResetEmail({ to, link }) {
    const resetLink = String(link || '').trim();
    return sendEmail({
      to,
      subject: 'A11 — Réinitialisation mot de passe',
      html: `<p>Clique ici pour réinitialiser ton mot de passe (valide 15 min):</p><p><a href="${resetLink}">${resetLink}</a></p>`,
      text: `Réinitialise ton mot de passe (valide 15 min): ${resetLink}`,
      tags: [{ name: 'type', value: 'password_reset' }],
    });
  }

  return {
    isConfigured,
    getStatus,
    sendEmail,
    sendFileEmail,
    sendPasswordResetEmail,
    normalizeRecipients,
  };
}

module.exports = {
  createEmailService,
};
