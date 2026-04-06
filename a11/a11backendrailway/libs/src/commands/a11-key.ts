import * as fs from 'fs';
import * as path from 'path';

const CFG = path.join(process.cwd(), '.qflush', 'a11.config.json');

function ensureDir() {
  const dir = path.dirname(CFG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export default async function runA11Key(argv: string[] = []) {
  const sub = argv[0] || 'status';

  if (sub === 'set') {
    // usage: qflush a11-key set --server http://127.0.0.1:3000 --ollama http://127.0.0.1:11434 --model llama3.1:8b --timeout 60000
    const opts: any = {};
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--server') opts.serverUrl = argv[++i];
      else if (a === '--ollama') opts.ollamaUrl = argv[++i];
      else if (a === '--model') opts.defaultModel = argv[++i];
      else if (a === '--timeout') opts.timeoutMs = Number(argv[++i]);
      else if (a === '--enabled') opts.enabled = argv[++i] === 'true';
    }
    ensureDir();
    const cfg = Object.assign({ enabled: true, serverUrl: 'http://127.0.0.1:3000', ollamaUrl: 'http://127.0.0.1:11434', defaultModel: 'llama3.1:8b', timeoutMs: 60000 }, opts);
    try {
      fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), 'utf8');
      console.log('A11 config saved to .qflush/a11.config.json');
      return 0;
    } catch (e) {
      console.error('failed to save a11 config', e);
      return 3;
    }
  }

  if (sub === 'test') {
    try {
      if (!fs.existsSync(CFG)) { console.error('no config found at .qflush/a11.config.json'); return 4; }
      const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
      const url = (cfg.serverUrl || 'http://127.0.0.1:3000').replace(/\/$/, '') + '/v1/health';
      const fetch = (global as any).fetch || (await import('node-fetch')).default;
      const res = await fetch(url, { method: 'GET', timeout: cfg.timeoutMs || 60000 });
      if (res.ok) {
        const txt = await res.text();
        console.log('A-11 server healthy:', res.status, txt);
        return 0;
      }
      console.error('A-11 health check failed:', res.status, await res.text());
      return 5;
    } catch (e) {
      console.error('A-11 health check error:', String(e));
      return 6;
    }
  }

  if (sub === 'status') {
    if (!fs.existsSync(CFG)) { console.log('A-11 not configured'); return 0; }
    try {
      const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
      console.log('A-11 config :', JSON.stringify(cfg, null, 2));
      return 0;
    } catch (e) { console.error('failed to read config', e); return 2; }
  }

  console.log('usage: qflush a11-key [set --server <url> --ollama <url> --model <m> --timeout <ms> | test | status]');
  return 1;
}
