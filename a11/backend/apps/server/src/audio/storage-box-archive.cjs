'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function envDisabled(value) {
  return /^(?:0|false|no|off)$/i.test(String(value ?? '').trim());
}

function sanitizeArchiveName(value = '') {
  const base = path.basename(String(value || 'nossen.mp3'));
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '') || 'nossen.mp3';
}

function resolveStorageBoxConfig(env = process.env) {
  const keyPath = String(env.STORAGE_BOX_KEY || '/home/deploy/.ssh/storagebox_ed25519').trim();
  return {
    enabled: !envDisabled(env.VIVY_STORAGE_BOX_ARCHIVE_ENABLED) && Boolean(keyPath),
    host: String(env.STORAGE_BOX_HOST || 'u647261.your-storagebox.de').trim(),
    user: String(env.STORAGE_BOX_USER || 'u647261').trim(),
    port: String(env.STORAGE_BOX_PORT || '23').trim() || '23',
    keyPath,
    baseDir: String(env.STORAGE_BOX_DIR || '/vivy-archive').replace(/\/+$/, '') || '/vivy-archive',
  };
}

function commonSshArgs(config) {
  const args = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
  ];
  if (config.keyPath) args.push('-i', config.keyPath);
  return args;
}

function archiveLocalSongBestEffort(localPath, options = {}) {
  const env = options.env || process.env;
  const config = resolveStorageBoxConfig(env);
  const source = String(localPath || '').trim();
  if (!config.enabled || !source) return Promise.resolve({ ok: false, skipped: true, reason: 'disabled' });
  try {
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size <= 0) return Promise.resolve({ ok: false, skipped: true, reason: 'source_invalid' });
    if (!fs.existsSync(config.keyPath)) return Promise.resolve({ ok: false, skipped: true, reason: 'key_missing' });
  } catch {
    return Promise.resolve({ ok: false, skipped: true, reason: 'source_missing' });
  }

  const filename = sanitizeArchiveName(options.filename || source);
  const remoteDir = `${config.baseDir}/songs`;
  const remotePath = `${remoteDir}/${filename}`;
  const host = `${config.user}@${config.host}`;
  const exec = typeof options.execFile === 'function' ? options.execFile : execFile;

  return new Promise((resolve) => {
    exec(
      'ssh',
      [...commonSshArgs(config), '-p', config.port, host, 'mkdir', '-p', remoteDir],
      { timeout: Number(options.mkdirTimeoutMs || 15000) },
      (mkdirError) => {
        if (mkdirError) return resolve({ ok: false, reason: 'mkdir_failed', error: mkdirError.message });
        exec(
          'scp',
          [...commonSshArgs(config), '-P', config.port, source, `${host}:${remotePath}`],
          { timeout: Number(options.uploadTimeoutMs || 180000) },
          (uploadError) => {
            if (uploadError) return resolve({ ok: false, reason: 'upload_failed', error: uploadError.message });
            return resolve({ ok: true, remotePath, filename });
          }
        );
      }
    );
  });
}

module.exports = {
  archiveLocalSongBestEffort,
  resolveStorageBoxConfig,
  sanitizeArchiveName,
};
