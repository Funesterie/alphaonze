function resolveBindHost(env = process.env) {
  const explicitHost = String(env?.HOST || '').trim();
  if (explicitHost) return explicitHost;

  const legacyHost = String(env?.HOST_SERVER || '').trim();
  if (legacyHost) return legacyHost;

  return '127.0.0.1';
}

module.exports = {
  resolveBindHost,
};
