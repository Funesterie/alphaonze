'use strict';

const { buildAccountConnectorState } = require('../auth/account-connectors.cjs');

const SESSION_DRIVE_STORAGE_ALIASES = new Set([
  'session-drive',
  'external-drive',
  'user-drive',
  'account-drive',
  'google-drive',
  'onedrive',
]);

const SERVER_LOCAL_STORAGE_ALIASES = new Set([
  'local',
  'server',
  'server-local',
  'r2',
  'hetzner',
]);

function normalizeSessionStoragePreference(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (SESSION_DRIVE_STORAGE_ALIASES.has(normalized)) return 'session-drive';
  if (SERVER_LOCAL_STORAGE_ALIASES.has(normalized)) return 'server-local';
  return '';
}

function providerDestination(provider = '') {
  return provider === 'microsoft' ? 'onedrive' : 'google_drive';
}

function providerLabel(provider = '') {
  return provider === 'microsoft' ? 'Microsoft OneDrive' : 'Google Drive';
}

function buildStorageTarget(provider = '', connector = {}) {
  const linked = connector?.linked === true;
  const filesAccess = String(connector?.filesAccess || (linked ? 'unknown' : 'not_linked'));
  const authorized = linked && filesAccess === 'authorized';
  return {
    provider,
    destination: providerDestination(provider),
    label: providerLabel(provider),
    configured: connector?.configured === true,
    linked,
    account: linked ? (connector?.account || null) : null,
    filesAccess,
    writable: authorized,
    writerState: authorized ? 'ready' : 'blocked',
    reason: authorized ? 'session_drive_ready' : 'session_drive_not_authorized',
  };
}

function normalizeSessionDriveOptions(options = {}) {
  if (options && typeof options === 'object' && (options.headers || options.cookies || options.user)) {
    return {
      req: options,
      user: options.user || {},
      env: process.env,
    };
  }
  return options && typeof options === 'object' ? options : {};
}

function resolveSessionDriveStorageState(options = {}) {
  const normalizedOptions = normalizeSessionDriveOptions(options);
  const state = buildAccountConnectorState({
    user: normalizedOptions.user || {},
    req: normalizedOptions.req || null,
    env: normalizedOptions.env || process.env,
  });
  const connectors = state?.connectors || {};
  const storageTargets = ['google', 'microsoft'].map((provider) => (
    buildStorageTarget(provider, connectors?.[provider] || {})
  ));
  const authorizedTargets = storageTargets.filter((target) => target.linked && target.filesAccess === 'authorized');
  const providers = authorizedTargets.map((target) => target.provider);

  return {
    state,
    connectors: {
      google: connectors.google || null,
      microsoft: connectors.microsoft || null,
    },
    storageTargets,
    providers,
    ready: providers.length > 0,
    writable: providers.length > 0,
    reason: providers.length
      ? 'session_drive_ready'
      : 'session_drive_not_authorized',
    writer: {
      ready: providers.length > 0,
      state: providers.length ? 'ready' : 'blocked',
      note: providers.length
        ? 'Drive scopes are authorized and the session Drive writer can store files for this session.'
        : 'No session connector currently has file-write scope.',
    },
  };
}

function buildSessionDriveStatusPayload(sessionDrive = {}) {
  const storageTargets = Array.isArray(sessionDrive.storageTargets) ? sessionDrive.storageTargets : [];
  return {
    ok: true,
    storagePreference: 'session-drive',
    ready: sessionDrive.ready === true,
    writable: sessionDrive.writable === true,
    reason: sessionDrive.reason || 'session_drive_not_authorized',
    writer: sessionDrive.writer || { ready: false, state: 'blocked' },
    availableProviders: (sessionDrive.providers || []).map(providerDestination),
    connectors: sessionDrive.connectors || {
      google: sessionDrive.state?.connectors?.google || null,
      microsoft: sessionDrive.state?.connectors?.microsoft || null,
    },
    storageTargets,
  };
}

module.exports = {
  buildSessionDriveStatusPayload,
  normalizeSessionStoragePreference,
  resolveSessionDriveStorageState,
};
