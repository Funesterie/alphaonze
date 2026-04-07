function normalizeUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const withoutLeadingSlashes = raw.replace(/^\/+/, '');
  const withProtocol = /^https?:\/\//i.test(withoutLeadingSlashes)
    ? withoutLeadingSlashes
    : `https://${withoutLeadingSlashes}`;
  return withProtocol.replace(/\/+$/, '');
}

function toBoolean(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function buildRuntimeConfig(env = process.env) {
  const runtimeProfile = String(env.A11_RUNTIME_PROFILE || '').trim().toLowerCase();
  const localOnly = toBoolean(env.A11_LOCAL_MODE) || runtimeProfile === 'local';
  const dragonApiUrl = normalizeUrl(env.DRAGON_API_URL || '');
  const qflushUseDragonCompat = toBoolean(env.A11_QFLUSH_USE_DRAGON);
  const declaredQflushRemoteUrl = normalizeUrl(
    env.QFLUSH_URL
      || env.QFLUSH_REMOTE_URL
      || env.QFLUSH_BASE_URL
      || ''
  );
  const qflushRemoteUrl = declaredQflushRemoteUrl
    || (!localOnly && qflushUseDragonCompat ? dragonApiUrl : '');
  const qflushRemoteSource = declaredQflushRemoteUrl
    ? 'qflush'
    : (qflushRemoteUrl ? 'dragon-compat' : '');
  const frontendUrl = normalizeUrl(env.APP_URL || env.FRONT_URL || 'https://a11.funesterie.pro');
  const ttsInternalUrl = String(env.TTS_URL || env.TTS_HOST || '').trim();
  const ttsPublicBaseUrl = normalizeUrl(env.TTS_PUBLIC_BASE_URL || env.TTS_BASE_URL || '');
  const publicApiUrl = normalizeUrl(env.PUBLIC_API_URL || env.API_URL || env.A11_SERVER_URL || '');
  const r2Bucket = String(env.R2_BUCKET || env.R2_BUCKET_NAME || '').trim();
  const hasTtsHttpConfig = Boolean(String(
    env.TTS_URL ||
    env.TTS_HOST ||
    env.TTS_BASE_URL ||
    env.TTS_PUBLIC_BASE_URL ||
    ''
  ).trim());

  return {
    app: {
      env: String(env.NODE_ENV || 'development').trim() || 'development',
      frontendUrl,
      publicApiUrl,
      serveStatic: toBoolean(env.SERVE_STATIC) || String(env.NODE_ENV || '').trim() === 'production',
    },
    tts: {
      internalUrl: ttsInternalUrl,
      publicBaseUrl: ttsPublicBaseUrl,
      enableHttp: toBoolean(env.ENABLE_PIPER_HTTP) || hasTtsHttpConfig,
      port: Number(env.TTS_PORT || 5002),
    },
    dragon: {
      apiUrl: dragonApiUrl,
    },
    qflush: {
      remoteUrl: qflushRemoteUrl,
      remoteSource: qflushRemoteSource,
      useDragonCompat: qflushUseDragonCompat && !declaredQflushRemoteUrl,
      memorySummaryFlow: String(env.QFLUSH_MEMORY_SUMMARY_FLOW || 'a11.memory.summary.v1').trim(),
      ephemeralMemoryFlow: String(env.QFLUSH_EPHEMERAL_MEMORY_FLOW || 'a11.memory.ephemeral.v1').trim(),
      chatFlow: String(env.QFLUSH_CHAT_FLOW || '').trim(),
      manageTts: toBoolean(env.MANAGE_TTS),
    },
    r2: {
      endpoint: String(env.R2_ENDPOINT || '').trim(),
      bucket: r2Bucket,
      publicBaseUrl: normalizeUrl(env.R2_PUBLIC_BASE_URL || ''),
    },
    mail: {
      from: String(env.EMAIL_FROM || 'A11 <onboarding@resend.dev>').trim(),
      hasResend: Boolean(String(env.RESEND_API_KEY || '').trim()),
    },
    auth: {
      hasJwtSecret: Boolean(String(env.JWT_SECRET || '').trim()),
      nezMode: String(env.NEZ_SECURITY_MODE || 'dev').trim() || 'dev',
    },
    railway: {
      publicDomain: String(env.RAILWAY_PUBLIC_DOMAIN || '').trim(),
      serviceName: String(env.RAILWAY_SERVICE_NAME || '').trim(),
      environmentName: String(env.RAILWAY_ENVIRONMENT_NAME || '').trim(),
    },
  };
}

function getPublicRuntimeStatus(options = {}) {
  const config = options.config || buildRuntimeConfig(options.env || process.env);

  return {
    ok: true,
    service: 'a11-api',
    env: config.app.env,
    frontendUrl: config.app.frontendUrl,
    publicApiUrl: config.app.publicApiUrl || null,
    railway: {
      publicDomain: config.railway.publicDomain || null,
      serviceName: config.railway.serviceName || null,
      environmentName: config.railway.environmentName || null,
    },
    integrations: {
      database: Boolean(options.hasDb),
      r2: {
        configured: Boolean(options.isR2Configured),
        bucket: config.r2.bucket || null,
        publicBaseUrl: config.r2.publicBaseUrl || null,
      },
      resend: {
        configured: Boolean(options.hasResend),
        from: config.mail.from,
      },
      dragon: {
        configured: Boolean(config.dragon.apiUrl),
        apiUrl: config.dragon.apiUrl || null,
      },
      tts: {
        enableHttp: config.tts.enableHttp,
        internalUrl: config.tts.internalUrl || null,
        publicBaseUrl: config.tts.publicBaseUrl || null,
        port: config.tts.port,
      },
      qflush: {
        available: Boolean(options.hasQflush),
        remoteUrl: config.qflush.remoteUrl || null,
        remoteSource: config.qflush.remoteSource || null,
        useDragonCompat: config.qflush.useDragonCompat,
        chatFlow: config.qflush.chatFlow || null,
        memorySummaryFlow: config.qflush.memorySummaryFlow || null,
        ephemeralMemoryFlow: config.qflush.ephemeralMemoryFlow || null,
        manageTts: config.qflush.manageTts,
      },
    },
    auth: {
      jwtConfigured: config.auth.hasJwtSecret,
      nezMode: config.auth.nezMode,
    },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  buildRuntimeConfig,
  getPublicRuntimeStatus,
};
