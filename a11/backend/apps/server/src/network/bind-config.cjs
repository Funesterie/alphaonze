function resolveBindHost(env = process.env) {
  const explicitHost = String(env?.HOST || '').trim();
  if (explicitHost) return explicitHost;

  const legacyHost = String(env?.HOST_SERVER || '').trim();
  if (legacyHost) return legacyHost;

  if (env?.RENDER || env?.RENDER_SERVICE_ID || env?.RENDER_SERVICE_NAME) {
    return '0.0.0.0';
  }

  return '127.0.0.1';
}

module.exports = {
  resolveBindHost,
};
