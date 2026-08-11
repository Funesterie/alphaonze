'use strict';
const fs = require('node:fs'), path = require('node:path');
const { sha256Hex } = require('./hash.cjs');
class ChunkStore {
  constructor(root) { this.root = root; fs.mkdirSync(root, { recursive: true }); }
  _p(sha) { return path.join(this.root, sha); }
  has(sha) { try { fs.accessSync(this._p(sha)); return true; } catch { return false; } }
  get(sha) { try { return fs.readFileSync(this._p(sha)); } catch { return null; } }
  put(buf) { const sha = sha256Hex(buf); if (!this.has(sha)) fs.writeFileSync(this._p(sha), buf); return sha; }
  putHashed(sha, buf) { if (!this.has(sha)) fs.writeFileSync(this._p(sha), buf); }
  list() { return fs.readdirSync(this.root).filter(f => /^[0-9a-f]{64}$/.test(f)); }
  count() { return this.list().length; }
  size() { return this.list().reduce((s, f) => s + fs.statSync(this._p(f)).size, 0); }
}
module.exports = { ChunkStore };
