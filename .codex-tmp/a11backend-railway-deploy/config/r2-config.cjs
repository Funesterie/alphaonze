function unwrapRailwayWrappedEnvValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const wrappedMatch = raw.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/);
  if (wrappedMatch) {
    return String(wrappedMatch[1] || '').trim();
  }
  return raw;
}

function pickFirst(...values) {
  for (const value of values) {
    const normalized = unwrapRailwayWrappedEnvValue(value);
    if (normalized) return normalized;
  }
  return '';
}

module.exports = {
  endpoint: pickFirst(
    process.env.R2_ENDPOINT,
    'https://4f23f921cccdcd5533f973922f550c3b.r2.cloudflarestorage.com'
  ),
  accessKeyId: pickFirst(
    process.env.R2_ACCESS_KEY,
    process.env.R2_ACCESS_KEY_ID,
    process.env.Access_Key_ID
  ),
  secretAccessKey: pickFirst(
    process.env.R2_SECRET_KEY,
    process.env.R2_SECRET_ACCESS_KEY,
    process.env.Secret_Access_Key
  ),
  bucket: pickFirst(
    process.env.R2_BUCKET,
    process.env.R2_BUCKET_NAME,
    process.env.R2_BUCKET_ID,
    'a11-files'
  ),
  publicBaseUrl: pickFirst(
    process.env.R2_PUBLIC_BASE_URL,
    'https://files.funesterie.me'
  ),
};
