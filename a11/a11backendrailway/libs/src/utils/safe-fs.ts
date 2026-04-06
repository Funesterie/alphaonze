// Lightweight safe filesystem helpers used by daemon and apply code
import * as fs from 'fs';
import * as path from 'path';

export function ensureParentDir(filePath: string) {
  try {
    const dir = path.dirname(filePath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // ignore
  }
}

export function safeWriteFileSync(filePath: string, data: string | Buffer, encoding: any = 'utf8') {
  try {
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, data, encoding);
  } catch (e) {
    // best-effort logging
    try { console.warn('[safe-fs] safeWriteFileSync failed for', filePath, String(e)); } catch (_) {}
  }
}

export function safeAppendFileSync(filePath: string, data: string | Buffer, encoding: any = 'utf8') {
  try {
    ensureParentDir(filePath);
    fs.appendFileSync(filePath, data, encoding);
  } catch (e) {
    try { console.warn('[safe-fs] safeAppendFileSync failed for', filePath, String(e)); } catch (_) {}
  }
}

export function safeWriteJsonAtomicSync(filePath: string, obj: any) {
  try {
    ensureParentDir(filePath);
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { console.warn('[safe-fs] safeWriteJsonAtomicSync failed for', filePath, String(e)); } catch (_) {}
  }
}
