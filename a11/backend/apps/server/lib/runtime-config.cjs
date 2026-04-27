const { isOpenAiImageEnabled } = require('./openai-image.cjs');
const { resolveEmailServiceConfigFromEnv } = require('./email-service.cjs');

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

function hasAnyValue(...values) {
  return values.some((value) => String(value || '').trim());
}

function resolveLocalLlmBaseUrl(env = {}) {
  const explicitOllamaBase = normalizeUrl(env.OLLAMA_BASE || '');
  if (explicitOllamaBase) return explicitOllamaBase;
  if (hasAnyValue(env.OLLAMA_HOST, env.OLLAMA_PORT)) {
    const host = String(env.OLLAMA_HOST || '127.0.0.1').trim() || '127.0.0.1';
    const port = String(env.OLLAMA_PORT || '11434').trim() || '11434';
    return normalizeUrl(`http://${host}:${port}`);
  }
  return normalizeUrl(env.LLAMA_BASE || env.LOCAL_LLM_URL || '');
}

function resolveSemanticTranslationMode(env = {}) {
  const explicitBaseUrl = normalizeUrl(env.A11_TRANSLATION_BASE_URL || '');
  const routerBaseUrl = normalizeUrl(env.LLM_ROUTER_URL || '');
  const localBaseUrl = resolveLocalLlmBaseUrl(env);
  const hasScopedKey = hasAnyValue(env.A11_TRANSLATION_API_KEY);
  const usesRouter = Boolean(explicitBaseUrl || routerBaseUrl);
  const baseUrl = explicitBaseUrl || routerBaseUrl || localBaseUrl;
  const configured = usesRouter || Boolean(localBaseUrl) || hasScopedKey;

  return {
    configured,
    provider: usesRouter ? 'llm-router' : (configured ? 'local-llm' : 'heuristic'),
    baseUrl,
  };
}

function resolveLlmProvider(value, fallback = 'none') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'ollama') return 'ollama';
  if (normalized === 'openai') return 'openai';
  if (['llama_server', 'llama-server', 'llama', 'local'].includes(normalized)) return 'llama_server';
  if (['none', 'disabled', 'off'].includes(normalized)) return 'none';
  return fallback;
}

function deriveDefaultLlmProvider(env = {}) {
  const explicitProvider = resolveLlmProvider(env.A11_LLM_PROVIDER, '');
  if (explicitProvider) return explicitProvider;
  if (hasAnyValue(env.OLLAMA_BASE, env.OLLAMA_HOST, env.OLLAMA_PORT)) return 'ollama';
  if (hasAnyValue(env.LLAMA_BASE, env.LOCAL_LLM_URL)) return 'llama_server';
  if (hasAnyValue(env.A11_OPENAI_API_KEY, env.OPENAI_API_KEY)) return 'openai';
  return 'none';
}

function isQflushEnabled(env = {}) {
  const explicit = String(env.A11_ENABLE_QFLUSH || '').trim();
  if (explicit) return toBoolean(explicit);
  return hasAnyValue(
    env.QFLUSH_URL,
    env.QFLUSH_REMOTE_URL,
    env.QFLUSH_BASE_URL,
    env.QFLUSH_CHAT_FLOW,
    (toBoolean(env.A11_QFLUSH_USE_DRAGON) ? env.DRAGON_API_URL : '')
  );
}

function isProductionRuntime(env = {}) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  return nodeEnv === 'production';
}

function hasSdProxyUrl(env = {}) {
  return hasAnyValue(env.A11_SD_PROXY_URL, env.SD_PROXY_URL);
}

function isExplicitLocalRuntime(env = {}) {
  return toBoolean(env.A11_LOCAL_MODE) || String(env.A11_RUNTIME_PROFILE || '').trim().toLowerCase() === 'local';
}

function shouldEnableLocalSdFallback(env = {}) {
  if (String(env.A11_SD_ALLOW_LOCAL_FALLBACK || '').trim()) {
    return toBoolean(env.A11_SD_ALLOW_LOCAL_FALLBACK);
  }

  if (!isProductionRuntime(env)) {
    return true;
  }

  if (hasSdProxyUrl(env) && !isExplicitLocalRuntime(env)) {
    return false;
  }

  if (toBoolean(env.ENABLE_SD)) {
    return true;
  }

  if (isExplicitLocalRuntime(env)) {
    return true;
  }

  if (String(env.SD_SCRIPT_PATH || '').trim() || String(env.SD_PYTHON_PATH || '').trim()) {
    return true;
  }

  return false;
}

function resolveImagePipelineMode(env = {}) {
  const raw = String(env.A11_IMAGE_PIPELINE_MODE || '').trim().toLowerCase();
  if (raw === 'creative') return 'raw';
  if (raw === 'orchestrated' || raw === 'orchestrateur') return 'smart';
  if (['raw', 'smart', 'auto'].includes(raw)) return raw;
  return 'auto';
}

function buildRuntimeConfig(env = process.env) {
  const resolvedMailConfig = resolveEmailServiceConfigFromEnv(env);
  const runtimeProfile = String(env.A11_RUNTIME_PROFILE || '').trim().toLowerCase();
  const localOnly = toBoolean(env.A11_LOCAL_MODE) || runtimeProfile === 'local';
  const productionRuntime = isProductionRuntime(env);
  const dragonApiUrl = normalizeUrl(env.DRAGON_API_URL || '');
  const qflushUseDragonCompat = toBoolean(env.A11_QFLUSH_USE_DRAGON);
  const qflushEnabled = isQflushEnabled(env);
  const declaredQflushRemoteUrl = qflushEnabled
    ? normalizeUrl(
      env.QFLUSH_URL
        || env.QFLUSH_REMOTE_URL
        || env.QFLUSH_BASE_URL
        || ''
    )
    : '';
  const qflushRemoteUrl = declaredQflushRemoteUrl
    || (qflushEnabled && !localOnly && qflushUseDragonCompat ? dragonApiUrl : '');
  const qflushRemoteSource = declaredQflushRemoteUrl
    ? 'qflush'
    : (qflushRemoteUrl ? 'dragon-compat' : '');
  const frontendUrl = normalizeUrl(env.APP_URL || env.FRONT_URL || 'https://alphaonze.funesterie.pro');
  const ttsInternalUrl = String(env.TTS_URL || env.TTS_HOST || '').trim();
  const ttsPublicBaseUrl = normalizeUrl(env.TTS_PUBLIC_BASE_URL || env.TTS_BASE_URL || '');
  const publicApiUrl = normalizeUrl(env.PUBLIC_API_URL || env.API_URL || env.A11_SERVER_URL || '');
  const r2Bucket = String(env.R2_BUCKET || env.R2_BUCKET_NAME || '').trim();
  const openAiConfigured = hasAnyValue(env.A11_OPENAI_API_KEY, env.OPENAI_API_KEY);
  const semanticTranslationMode = resolveSemanticTranslationMode(env);
  const translationConfigured = semanticTranslationMode.configured;
  const sdProxyUrl = normalizeUrl(env.A11_SD_PROXY_URL || env.SD_PROXY_URL || '');
  const sdLocalFallbackEnabled = shouldEnableLocalSdFallback(env);
  const sdOpenAiFallbackEnabled = isOpenAiImageEnabled(env)
    && toBoolean(env.A11_SD_ALLOW_OPENAI_FALLBACK)
    && openAiConfigured;
  const sdMode = sdProxyUrl
    ? (sdLocalFallbackEnabled ? 'proxy+local-fallback' : 'proxy-only')
    : (sdLocalFallbackEnabled ? 'local-only' : (sdOpenAiFallbackEnabled ? 'openai-only' : 'unconfigured'));
  const explicitWazaaLlm = String(env.A11_WAZAA_LLM_ENRICH || '').trim();
  const wazaaLlmEnabled = explicitWazaaLlm
    ? toBoolean(explicitWazaaLlm)
    : translationConfigured;
  const defaultLlmProvider = deriveDefaultLlmProvider(env);
  const memorySummaryProvider = (() => {
    const configured = String(env.MEMORY_SUMMARY_PROVIDER || '').trim().toLowerCase();
    if (configured === 'openai' || configured === 'local') return configured;
    if (qflushRemoteUrl || hasAnyValue(env.LLAMA_BASE, env.LOCAL_LLM_URL, env.OLLAMA_BASE, env.QFLUSH_CHAT_FLOW)) {
      return 'local';
    }
    return openAiConfigured ? 'openai' : 'local';
  })();
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
      memorySummaryFlow: qflushEnabled ? String(env.QFLUSH_MEMORY_SUMMARY_FLOW || 'a11.memory.summary.v1').trim() : '',
      ephemeralMemoryFlow: qflushEnabled ? String(env.QFLUSH_EPHEMERAL_MEMORY_FLOW || 'a11.memory.ephemeral.v1').trim() : '',
      chatFlow: qflushEnabled ? String(env.QFLUSH_CHAT_FLOW || '').trim() : '',
      manageTts: toBoolean(env.MANAGE_TTS),
    },
    r2: {
      endpoint: String(env.R2_ENDPOINT || '').trim(),
      bucket: r2Bucket,
      publicBaseUrl: normalizeUrl(env.R2_PUBLIC_BASE_URL || ''),
    },
    mail: {
      from: String(resolvedMailConfig.fromEmail || 'A11 <onboarding@resend.dev>').trim(),
      hasResend: Boolean(String(resolvedMailConfig.resendApiKey || '').trim()),
      hasSmtp: Boolean(String(resolvedMailConfig.smtpUrl || '').trim() || String(resolvedMailConfig.smtpHost || '').trim()),
      hasGmail: Boolean(String(resolvedMailConfig.gmailUser || '').trim() && String(resolvedMailConfig.gmailAppPassword || '').trim()),
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
    features: {
      chat: {
        provider: qflushRemoteUrl
          ? 'qflush'
          : defaultLlmProvider,
        qflushRemoteUrl,
        llmProvider: defaultLlmProvider,
      },
      semantic: {
        provider: wazaaLlmEnabled ? semanticTranslationMode.provider : 'heuristic',
        llmEnrichmentEnabled: wazaaLlmEnabled,
        translationConfigured,
      },
      image: {
        pipelineMode: resolveImagePipelineMode(env),
      },
      memory: {
        provider: memorySummaryProvider,
        qflushFlow: String(env.QFLUSH_MEMORY_SUMMARY_FLOW || 'a11.memory.summary.v1').trim(),
      },
      sd: {
        provider: sdProxyUrl
          ? 'proxy'
          : (sdLocalFallbackEnabled ? 'local' : (sdOpenAiFallbackEnabled ? 'openai' : 'unconfigured')),
        mode: sdMode,
        proxyUrl: sdProxyUrl,
        expectedRoute: sdProxyUrl ? '/api/tools/generate_sd' : null,
        localFallbackEnabled: sdLocalFallbackEnabled,
        openAiFallbackEnabled: sdOpenAiFallbackEnabled,
      },
      tts: {
        provider: hasTtsHttpConfig ? 'http' : 'local',
      },
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
    features: {
      chat: {
        provider: config.features.chat.provider,
        llmProvider: config.features.chat.llmProvider,
        qflushRemoteUrl: config.features.chat.qflushRemoteUrl || null,
      },
      semantic: {
        provider: config.features.semantic.provider,
        llmEnrichmentEnabled: config.features.semantic.llmEnrichmentEnabled,
        translationConfigured: config.features.semantic.translationConfigured,
      },
      image: {
        pipelineMode: config.features.image.pipelineMode,
      },
      memory: {
        provider: config.features.memory.provider,
        qflushFlow: config.features.memory.qflushFlow || null,
      },
      sd: {
        provider: config.features.sd.provider,
        mode: config.features.sd.mode,
        proxyUrl: config.features.sd.proxyUrl || null,
        expectedRoute: config.features.sd.expectedRoute || null,
        localFallbackEnabled: config.features.sd.localFallbackEnabled,
        openAiFallbackEnabled: config.features.sd.openAiFallbackEnabled,
      },
      tts: {
        provider: config.features.tts.provider,
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
