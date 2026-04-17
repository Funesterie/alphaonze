const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

function createMailRouter({
  isMailConfigured,
  getMailStatus,
  sendPlainEmailNow,
  sendConversationResourceEmailNow,
  sendLatestConversationResourceEmailNow,
  normalizeInlineAttachments,
  normalizeConversationId,
  getConversationResourceById,
  getLatestConversationResource,
  appendConversationLog,
} = {}) {
  const router = express.Router();
  const scheduledMailTimers = new Map();
  const scheduledMailDir = path.resolve(
    process.env.A11_SCHEDULED_MAIL_DIR || path.join(__dirname, '..', '..', '.a11_state')
  );
  const scheduledMailPath = path.join(scheduledMailDir, 'scheduled-mails.json');

  function ensureScheduledMailStore() {
    fs.mkdirSync(scheduledMailDir, { recursive: true });
    if (!fs.existsSync(scheduledMailPath)) {
      fs.writeFileSync(scheduledMailPath, '[]', 'utf8');
    }
  }

  function readScheduledMailJobs() {
    ensureScheduledMailStore();
    try {
      const raw = fs.readFileSync(scheduledMailPath, 'utf8');
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error_) {
      console.warn('[MAIL] scheduled store read failed:', error_?.message);
      return [];
    }
  }

  function writeScheduledMailJobs(jobs) {
    ensureScheduledMailStore();
    fs.writeFileSync(scheduledMailPath, JSON.stringify(Array.isArray(jobs) ? jobs : [], null, 2), 'utf8');
  }

  function normalizeScheduledMailKind(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === 'email' || normalized === 'scheduled_email') {
      return 'scheduled_email';
    }
    if (['resource', 'resource_email', 'file', 'file_email'].includes(normalized)) {
      return 'resource_email';
    }
    if (['latest', 'latest_resource', 'latest_resource_email'].includes(normalized)) {
      return 'latest_resource_email';
    }
    return normalized;
  }

  function computeScheduledSendAt({ sendAt, delaySeconds, delay } = {}) {
    const explicitSendAt = String(sendAt || '').trim();
    if (explicitSendAt) {
      const parsed = new Date(explicitSendAt);
      if (!Number.isFinite(parsed.getTime())) {
        throw new Error('invalid_sendAt');
      }
      return parsed.toISOString();
    }

    const rawDelay = delaySeconds ?? delay;
    const resolvedDelaySeconds = Number.isFinite(Number(rawDelay))
      ? Math.max(1, Number(rawDelay))
      : 60;
    return new Date(Date.now() + resolvedDelaySeconds * 1000).toISOString();
  }

  function buildScheduledMailJobId() {
    return `mail_${crypto.randomUUID().replace(/-/g, '')}`;
  }

  function summarizeScheduledMailJob(job) {
    return {
      id: String(job?.id || '').trim(),
      kind: String(job?.kind || '').trim(),
      status: String(job?.status || '').trim() || 'unknown',
      createdAt: job?.createdAt || null,
      sendAt: job?.sendAt || null,
      executedAt: job?.executedAt || null,
      cancelledAt: job?.cancelledAt || null,
      conversationId: job?.conversationId || null,
      to: Array.isArray(job?.to) ? job.to : [],
      subject: String(job?.subject || '').trim() || 'A11',
      attachToEmail: !!job?.attachToEmail,
      attachmentCount: Array.isArray(job?.attachments) ? job.attachments.length : 0,
      resourceId: Number(job?.resourceId || 0) || null,
      resourceKind: String(job?.resourceKind || '').trim() || null,
      error: job?.error || null,
    };
  }

  async function executeScheduledMailJob(jobId) {
    const jobs = readScheduledMailJobs();
    const index = jobs.findIndex((job) => job?.id === jobId);
    if (index < 0) throw new Error('job_not_found');

    const job = jobs[index];
    let result = null;

    try {
      if (job.kind === 'scheduled_email') {
        result = await sendPlainEmailNow({
          userId: job.userId,
          to: job.to,
          subject: job.subject,
          text: job.message,
          html: job.html,
          attachments: job.attachments,
          conversationId: job.conversationId,
          tags: [{ name: 'type', value: 'scheduled_email' }],
          logType: 'mail_sent',
        });
      } else if (job.kind === 'resource_email') {
        result = await sendConversationResourceEmailNow({
          userId: job.userId,
          resourceId: job.resourceId,
          to: job.to,
          subject: job.subject,
          message: job.message,
          attachToEmail: job.attachToEmail,
        });
      } else if (job.kind === 'latest_resource_email') {
        result = await sendLatestConversationResourceEmailNow({
          userId: job.userId,
          conversationId: job.conversationId,
          resourceKind: job.resourceKind,
          to: job.to,
          subject: job.subject,
          message: job.message,
          attachToEmail: job.attachToEmail,
        });
      } else {
        throw new Error(`unsupported_scheduled_mail_kind:${job.kind}`);
      }

      if (!result?.ok) {
        throw new Error(result?.error || 'scheduled_mail_failed');
      }

      job.status = 'sent';
      job.executedAt = new Date().toISOString();
      job.result = result;
      job.error = null;
    } catch (error_) {
      job.status = 'failed';
      job.executedAt = new Date().toISOString();
      job.error = String(error_?.message || error_);
    }

    jobs[index] = job;
    writeScheduledMailJobs(jobs);
    return summarizeScheduledMailJob(job);
  }

  function scheduleMailTimer(job) {
    if (!job?.id) return;
    const existing = scheduledMailTimers.get(job.id);
    if (existing) clearTimeout(existing);
    scheduledMailTimers.delete(job.id);

    if (job.status !== 'scheduled') return;

    const runAtMs = new Date(job.sendAt).getTime();
    if (!Number.isFinite(runAtMs)) return;

    const remaining = runAtMs - Date.now();
    const delay = Math.max(0, Math.min(2147483647, remaining));
    const timer = setTimeout(async () => {
      scheduledMailTimers.delete(job.id);
      if (runAtMs - Date.now() > 1000) {
        scheduleMailTimer(job);
        return;
      }

      try {
        await executeScheduledMailJob(job.id);
      } catch (error_) {
        console.warn('[MAIL] scheduled execution failed:', error_?.message);
      }
    }, delay);

    scheduledMailTimers.set(job.id, timer);
  }

  function bootstrapScheduledMailJobs() {
    const jobs = readScheduledMailJobs();
    for (const job of jobs) {
      if (job?.status === 'scheduled') {
        scheduleMailTimer(job);
      }
    }
  }

  function buildMailUnavailablePayload() {
    const status = typeof getMailStatus === 'function' ? getMailStatus() : null;
    return {
      ok: false,
      error: 'mail_provider_not_configured',
      details: status?.diagnostics || status || null,
    };
  }

  router.post('/api/mail/send', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });
      if (typeof isMailConfigured === 'function' && !isMailConfigured()) {
        return res.status(503).json(buildMailUnavailablePayload());
      }

      const attachments = normalizeInlineAttachments(req.body?.attachments);
      const result = await sendPlainEmailNow({
        userId,
        to: req.body?.to || req.body?.emailTo || req.body?.recipients || '',
        subject: req.body?.subject || req.body?.emailSubject || 'A11',
        text: String(req.body?.message || req.body?.text || req.body?.body || '').trim() || (!req.body?.html ? 'Email envoye depuis A11.' : undefined),
        html: typeof req.body?.html === 'string' ? req.body.html : undefined,
        attachments,
        conversationId: req.body?.conversationId || req.body?.convId || req.body?.sessionId,
        tags: [{ name: 'type', value: 'agent_mail' }],
        logType: 'mail_sent',
      });

      if (!result?.ok) {
        if (result.error === 'missing_to') return res.status(400).json(result);
        if (result.error === 'mail_provider_not_configured') return res.status(503).json(result);
        return res.status(502).json(result);
      }

      return res.json(result);
    } catch (error_) {
      const code = error_?.code || 'mail_send_failed';
      const status = code === 'missing_attachment_content' || code === 'invalid_attachment_base64' || code === 'empty_attachment'
        ? 400
        : 500;
      console.error('[MAIL] send failed:', error_?.message);
      return res.status(status).json({ ok: false, error: code, index: error_?.index ?? null, message: String(error_?.message || error_) });
    }
  });

  router.post('/api/mail/schedule', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });
      if (typeof isMailConfigured === 'function' && !isMailConfigured()) {
        return res.status(503).json(buildMailUnavailablePayload());
      }

      const kind = normalizeScheduledMailKind(req.body?.kind);
      const recipients = Array.isArray(req.body?.to)
        ? req.body.to
        : String(req.body?.to || req.body?.emailTo || req.body?.recipients || '')
            .split(/[;,]+/)
            .map((value) => value.trim())
            .filter(Boolean);
      if (!recipients.length) {
        return res.status(400).json({ ok: false, error: 'missing_to' });
      }

      const sendAt = computeScheduledSendAt({
        sendAt: req.body?.sendAt,
        delaySeconds: req.body?.delaySeconds ?? (Number.isFinite(Number(req.body?.delayMinutes)) ? Number(req.body.delayMinutes) * 60 : req.body?.delay),
      });

      const job = {
        id: buildScheduledMailJobId(),
        kind,
        status: 'scheduled',
        userId,
        createdAt: new Date().toISOString(),
        sendAt,
        conversationId: normalizeConversationId(req.body?.conversationId || req.body?.convId || req.body?.sessionId),
        to: recipients,
        subject: String(req.body?.subject || req.body?.emailSubject || 'A11').trim() || 'A11',
        message: String(req.body?.message || req.body?.text || req.body?.body || '').trim(),
        html: typeof req.body?.html === 'string' ? req.body.html : '',
        attachToEmail: req.body?.attachToEmail === true || req.body?.attachToEmail === 'true',
        attachments: [],
        resourceId: null,
        resourceKind: String(req.body?.kindFilter || req.body?.resourceKind || req.body?.resource_type || '').trim() || '',
      };

      if (kind === 'scheduled_email') {
        job.attachments = normalizeInlineAttachments(req.body?.attachments);
      } else if (kind === 'resource_email') {
        job.resourceId = Number(req.body?.resourceId || 0);
        if (!Number.isFinite(job.resourceId) || job.resourceId <= 0) {
          return res.status(400).json({ ok: false, error: 'invalid_resource_id' });
        }
        const resource = await getConversationResourceById(userId, job.resourceId);
        if (!resource) {
          return res.status(404).json({ ok: false, error: 'resource_not_found' });
        }
      } else if (kind === 'latest_resource_email') {
        const latestResource = await getLatestConversationResource(userId, {
          conversationId: job.conversationId,
          resourceKind: job.resourceKind || undefined,
        });
        if (!latestResource) {
          return res.status(404).json({ ok: false, error: 'latest_resource_not_found' });
        }
      }

      const jobs = readScheduledMailJobs();
      jobs.push(job);
      writeScheduledMailJobs(jobs);
      scheduleMailTimer(job);

      if (typeof appendConversationLog === 'function') {
        appendConversationLog({
          type: 'mail_scheduled',
          userId,
          conversationId: job.conversationId,
          mail: summarizeScheduledMailJob(job),
        });
      }

      return res.json({
        ok: true,
        job: summarizeScheduledMailJob(job),
      });
    } catch (error_) {
      const code = error_?.message === 'invalid_sendAt' ? 'invalid_sendAt' : (error_?.code || 'mail_schedule_failed');
      const status = code === 'invalid_sendAt' || code === 'missing_attachment_content' || code === 'invalid_attachment_base64' || code === 'empty_attachment'
        ? 400
        : 500;
      console.error('[MAIL] schedule failed:', error_?.message);
      return res.status(status).json({ ok: false, error: code, index: error_?.index ?? null, message: String(error_?.message || error_) });
    }
  });

  router.get('/api/mail/scheduled', async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const requestedStatus = String(req.query.status || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
      const jobs = readScheduledMailJobs()
        .filter((job) => String(job?.userId || '') === userId)
        .filter((job) => !requestedStatus || String(job?.status || '').toLowerCase() === requestedStatus)
        .sort((a, b) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime())
        .slice(0, limit)
        .map((job) => summarizeScheduledMailJob(job));

      return res.json({
        ok: true,
        count: jobs.length,
        jobs,
      });
    } catch (error_) {
      console.error('[MAIL] scheduled list failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'scheduled_mail_list_failed', message: String(error_?.message || error_) });
    }
  });

  router.post('/api/mail/scheduled/:id/cancel', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const jobId = String(req.params?.id || '').trim();
      const jobs = readScheduledMailJobs();
      const index = jobs.findIndex((job) => job?.id === jobId && String(job?.userId || '') === userId);
      if (index < 0) {
        return res.status(404).json({ ok: false, error: 'scheduled_mail_not_found' });
      }

      if (jobs[index].status !== 'scheduled') {
        return res.status(409).json({
          ok: false,
          error: 'scheduled_mail_not_cancellable',
          job: summarizeScheduledMailJob(jobs[index]),
        });
      }

      jobs[index].status = 'cancelled';
      jobs[index].cancelledAt = new Date().toISOString();
      writeScheduledMailJobs(jobs);

      const timer = scheduledMailTimers.get(jobId);
      if (timer) clearTimeout(timer);
      scheduledMailTimers.delete(jobId);

      return res.json({
        ok: true,
        job: summarizeScheduledMailJob(jobs[index]),
      });
    } catch (error_) {
      console.error('[MAIL] scheduled cancel failed:', error_?.message);
      return res.status(500).json({ ok: false, error: 'scheduled_mail_cancel_failed', message: String(error_?.message || error_) });
    }
  });

  router.bootstrapScheduledMailJobs = bootstrapScheduledMailJobs;
  return router;
}

module.exports = createMailRouter;
