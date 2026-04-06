// ROME-TAG: 0x3C04E4

import * as fs from 'fs';
import * as path from 'path';
// do not statically import node-fetch (may be ESM); use dynamic import when needed

const STORE = path.join(process.cwd(), '.qflush', 'license.json');

export type LicenseRecord = {
  key: string;
  product_id?: string;
  valid?: boolean;
  expires_at?: string | null;
  verifiedAt?: number;
};

function ensureDir() {
  const dir = path.dirname(STORE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readLicense(): LicenseRecord | null {
  try {
    if (!fs.existsSync(STORE)) return null;
    const raw = fs.readFileSync(STORE, 'utf8');
    return JSON.parse(raw) as LicenseRecord;
  } catch (e) {
    return null;
  }
}

export function saveLicense(rec: LicenseRecord) {
  try {
    ensureDir();
    fs.writeFileSync(STORE, JSON.stringify(rec, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

async function verifyWithGumroad(key: string, productId?: string) {
  const token = process.env.GUMROAD_TOKEN;
  if (!token) throw new Error('GUMROAD_TOKEN not configured');
  const url = `https://api.gumroad.com/v2/licenses/verify`;
  const body = new URLSearchParams();
  body.append('product_permalink', productId || '');
  body.append('license_key', key);

  // Dynamic import to support both CJS and ESM environments
  let fetchFn: any = undefined;
  try {
    const m = await import('node-fetch');
    fetchFn = (m && (m as any).default) || m;
  } catch (e) {
    // node-fetch not available or cannot be imported; try global fetch / undici fallback handled by caller
    try {
      // try undici dynamic require as fallback
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const undici = require('undici');
      if (undici && typeof undici.fetch === 'function') fetchFn = undici.fetch;
    } catch (_) {
      // ignore
    }
  }

  if (!fetchFn && typeof (globalThis as any).fetch === 'function') fetchFn = (globalThis as any).fetch;
  if (!fetchFn) throw new Error('No fetch implementation available (install node-fetch or undici)');

  const res = await fetchFn(url, { method: 'POST', body, headers: { Authorization: `Bearer ${token}` } });
  const json: any = await res.json();
  return json;
}

export async function activateLicense(key: string, productId?: string) {
  const resp: any = await verifyWithGumroad(key, productId);
  if (resp && (resp as any).success) {
    const purchase = (resp as any).purchase || {};
    const lic = { key, product_id: purchase.product_id || productId, valid: true, expires_at: purchase ? purchase.license_expires_at : null, verifiedAt: Date.now() } as LicenseRecord;
    saveLicense(lic);
    return { ok: true, license: lic, raw: resp };
  }
  // failure
  const lic = { key, product_id: productId, valid: false, verifiedAt: Date.now() } as LicenseRecord;
  saveLicense(lic);
  return { ok: false, error: resp };
}

export default { readLicense, saveLicense, activateLicense };
