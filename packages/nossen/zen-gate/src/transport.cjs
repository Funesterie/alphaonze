'use strict';
const { spawn } = require('node:child_process');
const { haveNeed } = require('./negotiate.cjs');
const { reconstruct } = require('./reconstruct.cjs');
const { encodeBundle } = require('./bundle.cjs');

function runChild(args, input) {
  return new Promise((res, rej) => {
    const ch = spawn(args[0], args.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    ch.stdout.on('data', d => out.push(d));
    ch.stderr.on('data', d => err.push(d));
    ch.on('error', rej);
    ch.on('close', code => { if (code !== 0) rej(new Error('exit ' + code + ': ' + Buffer.concat(err).toString().slice(0, 600))); else res(Buffer.concat(out)); });
    ch.stdin.end(input || Buffer.alloc(0));
  });
}

// Unified transport interface: sendManifest / requestHaveNeed / sendBundle(packed) -> remote reconstruct result.
class InMemoryTransport {
  constructor(receiverStore) { this.store = receiverStore; this.manifest = null; this.bytes = 0; this.rounds = 0; }
  async sendManifest(m) { this.manifest = m; this.bytes += Buffer.byteLength(JSON.stringify(m), 'utf8'); return m; }
  async requestHaveNeed() { this.rounds++; return haveNeed(this.manifest, this.store); }
  async sendBundle(packed) { const bin = encodeBundle(packed.manifest, packed.chunks); this.bytes += bin.length; return reconstruct({ manifest: packed.manifest, chunks: packed.chunks }, this.store, null); }
}

// Local subprocess transport: runs `node <cliScript> have|apply --store <recvStore>` as real child processes.
class SubprocessTransport {
  constructor({ nodeBin, cliScript, recvStore, out = null }) { this.nodeBin = nodeBin; this.cli = cliScript; this.recvStore = recvStore; this.out = out; this.manifest = null; this.bytes = 0; this.rounds = 0; }
  _args(cmd) { const a = [this.cli, cmd, '--store', this.recvStore]; if (cmd === 'apply' && this.out) a.push('--out', this.out); return a; }
  async sendManifest(m) { this.manifest = m; this.bytes += Buffer.byteLength(JSON.stringify(m), 'utf8'); return m; }
  async requestHaveNeed() { this.rounds++; const out = await runChild([this.nodeBin, ...this._args('have')], Buffer.from(JSON.stringify(this.manifest), 'utf8')); return JSON.parse(out.toString('utf8')); }
  async sendBundle(packed) { const bin = encodeBundle(packed.manifest, packed.chunks); this.bytes += bin.length; const out = await runChild([this.nodeBin, ...this._args('apply')], bin); return JSON.parse(out.toString('utf8')); }
}

// SSH transport to EX44: runs the same CLI on the remote over `ssh`, piping manifest/bundle through stdin.
class SshTransport {
  constructor({ sshArgs, remoteNode, remoteCli, remoteStore, remoteOut = null }) { this.sshArgs = sshArgs; this.remoteNode = remoteNode; this.remoteCli = remoteCli; this.remoteStore = remoteStore; this.remoteOut = remoteOut; this.manifest = null; this.bytes = 0; this.rounds = 0; }
  _remoteCmd(cmd) { let s = this.remoteNode + ' ' + this.remoteCli + ' ' + cmd + ' --store ' + this.remoteStore; if (cmd === 'apply' && this.remoteOut) s += ' --out ' + this.remoteOut; return s; }
  async sendManifest(m) { this.manifest = m; this.bytes += Buffer.byteLength(JSON.stringify(m), 'utf8'); return m; }
  async requestHaveNeed() { this.rounds++; const out = await runChild(['ssh', ...this.sshArgs, '-o', 'BatchMode=yes', this._remoteCmd('have')], Buffer.from(JSON.stringify(this.manifest), 'utf8')); return JSON.parse(out.toString('utf8')); }
  async sendBundle(packed) { const bin = encodeBundle(packed.manifest, packed.chunks); this.bytes += bin.length; const out = await runChild(['ssh', ...this.sshArgs, '-o', 'BatchMode=yes', this._remoteCmd('apply')], bin); return JSON.parse(out.toString('utf8')); }
}

module.exports = { InMemoryTransport, SubprocessTransport, SshTransport, runChild };
