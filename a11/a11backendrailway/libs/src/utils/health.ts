import http from 'http';
import net from 'net';
import { logger } from './logger.js';

export async function httpProbe(url: string, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 400));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function tcpProbe(host: string, port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    s.setTimeout(timeout);
    s.on('connect', () => {
      done = true;
      s.destroy();
      resolve(true);
    });
    s.on('error', () => { if (!done) { done = true; resolve(false); } });
    s.on('timeout', () => { if (!done) { done = true; s.destroy(); resolve(false); } });
    s.connect(port, host);
  });
}

export async function waitForService(urlOrHost: string, port?: number, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let ok = false;
    if (typeof port === 'number') {
      ok = await tcpProbe(urlOrHost, port, 1000);
    } else if (urlOrHost.startsWith('http')) {
      ok = await httpProbe(urlOrHost, 1000);
    }
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
