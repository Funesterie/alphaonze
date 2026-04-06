// ROME-TAG: 0xC8C1C0

import { Request } from 'express';

export function isAdminAuthorized(req: Request): boolean {
  const token = process.env.NEZ_ADMIN_TOKEN;
  const user = process.env.NPZ_ADMIN_USER;
  const pass = process.env.NPZ_ADMIN_PASS;
  const allowIps = (process.env.NPZ_ADMIN_ALLOW_IPS || '').split(',').map(s => s.trim()).filter(Boolean);

  // IP allowlist
  if (allowIps.length > 0) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    for (const a of allowIps) {
      if (ip && ip.includes(a)) return true;
    }
  }

  // x-admin-token header
  const providedToken = (req.headers['x-admin-token'] as string) || (req.query && (req.query as any).token);
  if (token && providedToken && providedToken === token) return true;

  // Authorization: Bearer <token>
  const auth = req.headers['authorization'] as string | undefined;
  if (auth && auth.startsWith('Bearer ')) {
    const b = auth.slice(7).trim();
    if (token && b === token) return true;
  }

  // Basic auth
  if (auth && auth.startsWith('Basic ')) {
    try {
      const payload = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const [u, p] = payload.split(':');
      if (user && pass && u === user && p === pass) return true;
    } catch (e) {
      // ignore
    }
  }

  return false;
}

export default { isAdminAuthorized };
