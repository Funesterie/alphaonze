const { Resend } = require('resend');

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

function createEmailService(config = {}) {
  const resendApiKey = String(config.resendApiKey || '').trim();
  const fromEmail = String(config.fromEmail || 'A11 <onboarding@resend.dev>').trim();
  const appUrl = String(config.appUrl || 'https://a11.funesterie.pro').trim();
  const resendClient = resendApiKey ? new Resend(resendApiKey) : null;

  function isConfigured() {
    return Boolean(resendClient);
  }

  function getStatus() {
    return {
      configured: isConfigured(),
      provider: resendClient ? 'resend' : null,
      from: fromEmail,
      appUrl,
    };
  }

  async function sendEmail({ to, subject, text, html, attachments, tags }) {
    const recipients = normalizeRecipients(to);
    if (!recipients.length) {
      return { ok: false, reason: 'missing_to' };
    }
    if (!resendClient) {
      return { ok: false, reason: 'mail_provider_not_configured' };
    }

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
