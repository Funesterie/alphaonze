const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmailService, resolveEmailServiceConfigFromEnv } = require('../lib/email-service.cjs');

test('email service enables SMTP fallback when Resend is absent', async () => {
  let capturedTransportOptions = null;
  let capturedMailPayload = null;

  const service = createEmailService({
    fromEmail: 'A11 <hello@example.com>',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'tester',
    smtpPass: 'secret',
    transportFactory: (options) => {
      capturedTransportOptions = options;
      return {
        sendMail: async (payload) => {
          capturedMailPayload = payload;
          return {
            messageId: 'smtp-message-1',
            accepted: Array.isArray(payload.to) ? payload.to : [payload.to],
            rejected: [],
          };
        },
      };
    },
  });

  assert.equal(service.isConfigured(), true);
  assert.equal(service.getStatus().provider, 'smtp');

  const result = await service.sendEmail({
    to: ['alice@example.com', 'bob@example.com'],
    subject: 'SMTP fallback',
    text: 'hello world',
  });

  assert.equal(capturedTransportOptions.host, 'smtp.example.com');
  assert.equal(capturedTransportOptions.port, 587);
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'smtp');
  assert.equal(result.id, 'smtp-message-1');
  assert.deepEqual(capturedMailPayload.to, ['alice@example.com', 'bob@example.com']);
  assert.equal(capturedMailPayload.subject, 'SMTP fallback');
});

test('email service uses Gmail fallback when configured', async () => {
  let capturedTransportOptions = null;

  const service = createEmailService({
    gmailUser: 'robot@gmail.com',
    gmailAppPassword: 'app-password',
    transportFactory: (options) => {
      capturedTransportOptions = options;
      return {
        sendMail: async () => ({
          messageId: 'gmail-message-1',
          accepted: ['dest@example.com'],
          rejected: [],
        }),
      };
    },
  });

  const result = await service.sendEmail({
    to: 'dest@example.com',
    subject: 'Gmail fallback',
    text: 'hello from gmail',
  });

  assert.equal(service.getStatus().provider, 'gmail');
  assert.equal(capturedTransportOptions.service, 'gmail');
  assert.equal(capturedTransportOptions.auth.user, 'robot@gmail.com');
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'gmail');
});

test('email service exposes diagnostics when no provider is configured', async () => {
  const service = createEmailService({});

  const result = await service.sendEmail({
    to: 'dest@example.com',
    subject: 'No provider',
    text: 'hello',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mail_provider_not_configured');
  assert.equal(result.diagnostics.configured, false);
  assert.equal(Array.isArray(result.diagnostics.missing), true);
  assert.ok(result.diagnostics.missing.includes('resend_api_key'));
});

test('resolveEmailServiceConfigFromEnv supports resend and smtp aliases', () => {
  const config = resolveEmailServiceConfigFromEnv({
    A11_RESEND_API_KEY: 're_test_alias',
    MAIL_FROM: 'A11 <mail@example.com>',
    MAIL_HOST: 'smtp.example.com',
    MAIL_PORT: '2525',
    MAIL_USERNAME: 'robot',
    MAIL_PASSWORD: 'secret',
  });

  assert.equal(config.resendApiKey, 're_test_alias');
  assert.equal(config.fromEmail, 'A11 <mail@example.com>');
  assert.equal(config.smtpHost, 'smtp.example.com');
  assert.equal(config.smtpPort, '2525');
  assert.equal(config.smtpUser, 'robot');
  assert.equal(config.smtpPass, 'secret');
});
