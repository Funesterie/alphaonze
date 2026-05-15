'use strict';
/**
 * Funesterie Desktop â€” Auto-Updater
 *
 * VÃ©rifie les mises Ã  jour silencieusement via R2 (files.funesterie.me)
 * ou GitHub Releases. TÃ©lÃ©charge et installe sans intervention utilisateur.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
const R2_UPDATE_MANIFEST_URL = 'https://files.funesterie.me/public/desktop/update-manifest.json';

class AutoUpdater {
  constructor(options = {}) {
    this.currentVersion = options.version || '0.0.0';
    this.updateManifestUrl = options.manifestUrl || R2_UPDATE_MANIFEST_URL;
    this.downloadDir = options.downloadDir || path.join(process.env.APPDATA || '', 'Funesterie', 'updates');
    this.checkTimer = null;
    this.updateAvailable = null;
    this.eventHandlers = new Map();
  }

  /**
   * Start periodic update checks
   */
  start() {
    this.checkForUpdate(); // Check immediately
    this.checkTimer = setInterval(() => this.checkForUpdate(), UPDATE_CHECK_INTERVAL_MS);
  }

  stop() {
    if (this.checkTimer) clearInterval(this.checkTimer);
  }

  /**
   * Check for updates from R2 manifest
   */
  async checkForUpdate() {
    try {
      const manifest = await this._fetchManifest();
      if (!manifest || !manifest.version) return null;

      if (this._isNewer(manifest.version, this.currentVersion)) {
        this.updateAvailable = manifest;
        this._emit('update-available', manifest);
        return manifest;
      }

      this._emit('up-to-date', { version: this.currentVersion });
      return null;
    } catch (err) {
      this._emit('update-error', { error: err.message });
      return null;
    }
  }

  /**
   * Download and apply update (silent)
   */
  async downloadAndInstall() {
    if (!this.updateAvailable) return false;

    try {
      const { downloadUrl, version, sha256 } = this.updateAvailable;
      if (!downloadUrl) return false;

      this._emit('download-start', { version });

      // Ensure download dir exists
      fs.mkdirSync(this.downloadDir, { recursive: true });

      const filename = `funesterie-${version}-setup.exe`;
      const filepath = path.join(this.downloadDir, filename);

      await this._downloadFile(downloadUrl, filepath);

      // Verify SHA256 if provided
      if (sha256) {
        const crypto = require('node:crypto');
        const fileBuffer = fs.readFileSync(filepath);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        if (hash !== sha256) {
          fs.unlinkSync(filepath);
          throw new Error(`SHA256 mismatch: expected ${sha256}, got ${hash}`);
        }
      }

      this._emit('download-complete', { version, filepath });

      // Schedule install on next restart (don't interrupt user)
      this._scheduleInstall(filepath);
      return true;
    } catch (err) {
      this._emit('update-error', { error: err.message });
      return false;
    }
  }

  /**
   * Fetch update manifest from R2
   */
  async _fetchManifest() {
    const raw = await this._httpsGet(this.updateManifestUrl);
    return JSON.parse(raw);
  }

  /**
   * Compare semver versions
   */
  _isNewer(remote, local) {
    const r = String(remote || '').split('.').map(Number);
    const l = String(local || '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((r[i] || 0) > (l[i] || 0)) return true;
      if ((r[i] || 0) < (l[i] || 0)) return false;
    }
    return false;
  }

  /**
   * Download file to disk
   */
  _downloadFile(url, filepath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filepath);
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          // Follow redirect
          return this._downloadFile(res.headers.location, filepath).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(filepath);
          return reject(new Error(`Download failed: ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', (err) => { fs.unlinkSync(filepath); reject(err); });
      }).on('error', (err) => { fs.unlinkSync(filepath); reject(err); });
    });
  }

  /**
   * Schedule install on app restart
   */
  _scheduleInstall(filepath) {
    const pendingFile = path.join(this.downloadDir, 'pending-update.json');
    fs.writeFileSync(pendingFile, JSON.stringify({
      filepath,
      scheduledAt: new Date().toISOString(),
      version: this.updateAvailable?.version,
    }));
    this._emit('install-scheduled', { filepath });
  }

  _httpsGet(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  _emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    for (const handler of handlers) {
      try { handler(data); } catch { /* ignore */ }
    }
  }
}

module.exports = { AutoUpdater };
