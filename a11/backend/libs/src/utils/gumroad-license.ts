// ROME-TAG: 0xC4BE64

import * as fs from 'fs';
import * as path from 'path';

async function resolveFetch() {
  if (typeof (globalThis as any).fetch === 'function') return (globalThis as any).fetch;
  try {
    const m = await import('node-fetch');
    return (m && (m as any).default) || m;
  } catch (e) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const undici = require('undici');
      if (undici && typeof undici.fetch === 'function') return undici.fetch;
    } catch (_) {}
  }
  throw new Error('No fetch implementation available (install node-fetch or undici)');
}

const DEFAULT_STORAGE = path.join(process.cwd(), '.qflush', 'license.json');

export type LicenseRecord = {
  key: string;
  product_id: string;
  createdAt: number;
  expiresAt?: number | null;
  recurring?: boolean;
  lastVerified?: number;
  metadata?: Record<string, any>;
};

function getStoragePath() {
  return process.env.GUMROAD_LICENSE_PATH || DEFAULT_STORAGE;
}

function ensureDir(storagePath: string) {
  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function saveLicense(rec: LicenseRecord) {
  const storage = getStoragePath();
  ensureDir(storage);
  fs.writeFileSync(storage, JSON.stringify(rec, null, 2), 'utf8');
}

export function loadLicense(): LicenseRecord | null {
  try {
    const storage = getStoragePath();
    if (!fs.existsSync(storage)) return null;
    const raw = fs.readFileSync(storage, 'utf8');
    return JSON.parse(raw) as LicenseRecord;
  } catch (e) {
    return null;
  }
}

export function readTokenFromFile(): string | null {
  const p = process.env.GUMROAD_TOKEN_FILE;
  if (!p) return null;
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8').trim();
  } catch (e) {
    return null;
  }
}

export async function verifyWithGumroad(product_id: string, licenseKey: string, token: string) {
  const url = 'https://api.gumroad.com/v2/licenses/verify';
  const body = { product_id, license_key: licenseKey };
  const fetch = await resolveFetch();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gumroad API returned ${res.status}`);
  const json: any = await res.json();
  return json;
}

export function isLicenseValid(rec: LicenseRecord | null) {
  if (!rec) return false;
  if (rec.expiresAt && Date.now() > rec.expiresAt) return false;
  return true;
}

export async function activateLicense(product_id: string, licenseKey: string, token: string) {
  const data: any = await verifyWithGumroad(product_id, licenseKey, token);
  if (data && data.success) {
    const purchase = (data as any).purchase || {};
    const now = Date.now();
    const recurring = !!purchase.subscription_ended_at || !!purchase.subscription_cancelled_at ? false : !!purchase.subscription_id;
    const expiresAt = recurring ? null : now + 365 * 24 * 3600 * 1000; // 1 year default
    const rec = {
      key: licenseKey,
      product_id,
      createdAt: now,
      expiresAt,
      recurring,
      lastVerified: now,
      metadata: purchase,
    };
    saveLicense(rec as LicenseRecord);
    return rec;
  }
  throw new Error('License verification failed');
}

export function clearLicense() {
  try {
    const storage = getStoragePath();
    if (fs.existsSync(storage)) fs.unlinkSync(storage);
  } catch (e) {}
}

export default { saveLicense, loadLicense, verifyWithGumroad, activateLicense, isLicenseValid, clearLicense, readTokenFromFile };
