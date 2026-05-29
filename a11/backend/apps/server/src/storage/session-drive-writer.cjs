'use strict';

const {
  GOOGLE_CLIENT_ID_NAMES,
  GOOGLE_CLIENT_SECRET_NAMES,
  MICROSOFT_CLIENT_ID_NAMES,
  MICROSOFT_CLIENT_SECRET_NAMES,
  firstEnv,
} = require('../auth/account-connectors.cjs');
const { normalizeProvider } = require('../auth/oauth-token-vault.cjs');

const GOOGLE_DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const MICROSOFT_GRAPH_ROOT_URL = 'https://graph.microsoft.com/v1.0/me/drive/root:';

function cleanText(value) {
  return String(value || '').trim();
}

function buildError(code, message = code, status = 500, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function normalizeRequestedProvider(value = '') {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized || ['session-drive', 'external-drive', 'user-drive', 'account-drive'].includes(normalized)) return '';
  return normalizeProvider(normalized);
}

function selectSessionDriveProvider(requested = '', providers = []) {
  const available = [...new Set((providers || []).map(normalizeProvider).filter(Boolean))];
  if (!available.length) {
    throw buildError('session_drive_not_authorized', 'No session Drive provider is authorized.', 409);
  }
  const explicit = normalizeRequestedProvider(requested);
  if (explicit) {
    if (!available.includes(explicit)) {
      throw buildError('session_drive_provider_unavailable', `Session Drive provider is not linked: ${explicit}`, 409, {
        provider: explicit,
        availableProviders: available,
      });
    }
    return explicit;
  }
  return available.includes('google') ? 'google' : available[0];
}

function resolveSessionId(req = {}) {
  return cleanText(
    req?.user?.sid
    || req?.user?.sessionId
    || req?.user?.session_id
    || req?.auth?.sid
    || req?.session?.id
  );
}

function sanitizeDriveFilename(filename = '') {
  return cleanText(filename || 'file.bin')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180)
    || 'file.bin';
}

function tokenExpiresSoon(record = {}, now = () => new Date()) {
  const expiresAt = cleanText(record.expiresAt);
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) return false;
  return parsed <= now().getTime() + 60_000;
}

function mergeScope(defaultScope, record = {}) {
  return cleanText(record.scope) || defaultScope;
}

async function readErrorBody(response) {
  try {
    return String(await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

async function refreshGoogleToken({ record, tokenVault, sessionId, env, fetchImpl, now }) {
  const refreshToken = cleanText(record.refreshToken);
  if (!refreshToken) {
    throw buildError('session_drive_refresh_token_missing', 'Google Drive refresh token is missing for this session.', 409);
  }
  const clientId = firstEnv(env, GOOGLE_CLIENT_ID_NAMES);
  const clientSecret = firstEnv(env, GOOGLE_CLIENT_SECRET_NAMES);
  if (!clientId || !clientSecret) {
    throw buildError('session_drive_oauth_config_missing', 'Google OAuth client config is missing on the server.', 503);
  }

  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!response.ok) {
    throw buildError('session_drive_token_refresh_failed', await readErrorBody(response) || 'Google token refresh failed.', 502, {
      providerStatus: response.status,
    });
  }

  const tokens = await response.json();
  await tokenVault.storeSessionProviderTokens({
    sessionId,
    provider: 'google',
    account: record.account,
    tokens: { ...tokens, refresh_token: refreshToken },
    oauthScopes: tokens.scope || record.scope,
    oauthScopeProfile: record.oauthScopeProfile,
  });
  return tokenVault.getSessionProviderTokens({ sessionId, provider: 'google' });
}

async function refreshMicrosoftToken({ record, tokenVault, sessionId, env, fetchImpl }) {
  const refreshToken = cleanText(record.refreshToken);
  if (!refreshToken) {
    throw buildError('session_drive_refresh_token_missing', 'Microsoft OneDrive refresh token is missing for this session.', 409);
  }
  const clientId = firstEnv(env, MICROSOFT_CLIENT_ID_NAMES);
  const clientSecret = firstEnv(env, MICROSOFT_CLIENT_SECRET_NAMES);
  if (!clientId || !clientSecret) {
    throw buildError('session_drive_oauth_config_missing', 'Microsoft OAuth client config is missing on the server.', 503);
  }

  const tenant = cleanText(
    env?.MICROSOFT_TENANT_ID
    || env?.AZURE_TENANT_ID
    || env?.MS_TENANT_ID
    || env?.ENTRA_TENANT_ID
    || 'common'
  );
  const response = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: mergeScope('openid profile email offline_access User.Read Files.ReadWrite', record),
    }).toString(),
  });

  if (!response.ok) {
    throw buildError('session_drive_token_refresh_failed', await readErrorBody(response) || 'Microsoft token refresh failed.', 502, {
      providerStatus: response.status,
    });
  }

  const tokens = await response.json();
  await tokenVault.storeSessionProviderTokens({
    sessionId,
    provider: 'microsoft',
    account: record.account,
    tokens: { ...tokens, refresh_token: tokens.refresh_token || refreshToken },
    oauthScopes: tokens.scope || record.scope,
    oauthScopeProfile: record.oauthScopeProfile,
  });
  return tokenVault.getSessionProviderTokens({ sessionId, provider: 'microsoft' });
}

async function resolveAccessToken({ provider, req, tokenVault, env, fetchImpl, now }) {
  const sessionId = resolveSessionId(req);
  if (!sessionId) {
    throw buildError('session_drive_session_missing', 'Session id is missing from the authenticated request.', 401);
  }
  const record = await tokenVault?.getSessionProviderTokens?.({ sessionId, provider });
  if (!record || !cleanText(record.accessToken || record.refreshToken)) {
    throw buildError('session_drive_token_missing', `No ${provider} Drive token is available for this session.`, 409);
  }
  if (cleanText(record.accessToken) && !tokenExpiresSoon(record, now)) {
    return { accessToken: cleanText(record.accessToken), sessionId, record };
  }

  const refreshed = provider === 'google'
    ? await refreshGoogleToken({ record, tokenVault, sessionId, env, fetchImpl, now })
    : await refreshMicrosoftToken({ record, tokenVault, sessionId, env, fetchImpl, now });

  const accessToken = cleanText(refreshed?.accessToken);
  if (!accessToken) {
    throw buildError('session_drive_token_missing', `No refreshed ${provider} Drive access token is available.`, 409);
  }
  return { accessToken, sessionId, record: refreshed };
}

async function uploadGoogleDriveFile({ accessToken, filename, buffer, contentType, fetchImpl }) {
  const boundary = `funesterie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = Buffer.from(
    `--${boundary}\r\n`
    + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
    + `${JSON.stringify({ name: filename, mimeType: contentType })}\r\n`
    + `--${boundary}\r\n`
    + `${`Content-Type: ${contentType}`}\r\n\r\n`,
    'utf8'
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([metadata, Buffer.from(buffer), footer]);

  const response = await fetchImpl(`${GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,webContentLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });
  if (!response.ok) {
    throw buildError('session_drive_upload_failed', await readErrorBody(response) || 'Google Drive upload failed.', 502, {
      provider: 'google',
      providerStatus: response.status,
    });
  }
  const json = await response.json();
  return {
    provider: 'google',
    id: cleanText(json.id),
    name: cleanText(json.name) || filename,
    url: cleanText(json.webViewLink || json.webContentLink),
  };
}

async function uploadMicrosoftDriveFile({ accessToken, filename, buffer, contentType, fetchImpl }) {
  const response = await fetchImpl(`${MICROSOFT_GRAPH_ROOT_URL}/${encodeURIComponent(filename)}:/content`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': contentType,
      'Content-Length': String(Buffer.byteLength(buffer)),
    },
    body: Buffer.from(buffer),
  });
  if (!response.ok) {
    throw buildError('session_drive_upload_failed', await readErrorBody(response) || 'Microsoft OneDrive upload failed.', 502, {
      provider: 'microsoft',
      providerStatus: response.status,
    });
  }
  const json = await response.json();
  return {
    provider: 'microsoft',
    id: cleanText(json.id),
    name: cleanText(json.name) || filename,
    url: cleanText(json.webUrl || json['@microsoft.graph.downloadUrl']),
  };
}

function createSessionDriveUploadWriter({
  req,
  provider,
  sessionDrive = {},
  tokenVault,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw buildError('session_drive_fetch_unavailable', 'Server fetch API is unavailable.', 503);
  }
  const selectedProvider = selectSessionDriveProvider(provider, sessionDrive.providers || []);
  return {
    backend: `session-drive:${selectedProvider}`,
    provider: selectedProvider,
    uploadBuffer: async ({ filename, buffer, contentType }) => {
      const safeFilename = sanitizeDriveFilename(filename);
      const normalizedContentType = cleanText(contentType) || 'application/octet-stream';
      const { accessToken } = await resolveAccessToken({
        provider: selectedProvider,
        req,
        tokenVault,
        env,
        fetchImpl,
        now,
      });
      const uploaded = selectedProvider === 'google'
        ? await uploadGoogleDriveFile({
            accessToken,
            filename: safeFilename,
            buffer,
            contentType: normalizedContentType,
            fetchImpl,
          })
        : await uploadMicrosoftDriveFile({
            accessToken,
            filename: safeFilename,
            buffer,
            contentType: normalizedContentType,
            fetchImpl,
          });

      return {
        filename: uploaded.name || safeFilename,
        storageKey: `session-drive/${selectedProvider}/${uploaded.id || safeFilename}`,
        url: uploaded.url || '',
        contentType: normalizedContentType,
        sizeBytes: Buffer.byteLength(buffer),
        provider: selectedProvider,
        externalId: uploaded.id || null,
      };
    },
  };
}

module.exports = {
  createSessionDriveUploadWriter,
  selectSessionDriveProvider,
  sanitizeDriveFilename,
};
