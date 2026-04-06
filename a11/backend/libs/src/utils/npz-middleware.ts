// ROME-TAG: 0x381550

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { npzRoute } from './npz-router.js';
import npzStore from './npz-store.js';
import npz from './npz.js';
import { logger } from './logger.js';
import client from 'prom-client';
import { getNpzNamespace } from './npz-config.js';

const NS = getNpzNamespace();
const requestDuration = new client.Histogram({
  name: `${NS}_request_duration_seconds`,
  help: 'Duration of NPZ handled requests',
  labelNames: ['gate', 'lane', 'npz_id', 'namespace'] as string[],
});

export type NpzMiddlewareOptions = {
  lanes?: any[];
  cookieName?: string;
  cookieMaxAge?: number;
};

export function npzMiddleware(opts: NpzMiddlewareOptions = {}) {
  const cookieName = opts.cookieName || `${NS}_lane`;
  const lanes = opts.lanes || undefined;
  const maxAge = opts.cookieMaxAge || 24 * 3600; // seconds

  return async function (req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime();
    try {
      // assign npz_id
      const npz_id = (req.headers['x-npz-id'] as string) || req.cookies?.['npz_id'] || uuidv4();
      res.cookie('npz_id', npz_id, { maxAge: maxAge * 1000, httpOnly: true });
      await npzStore.createRequestRecord(npz_id, { path: req.path, method: req.method });

      const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;

      const report = await npzRoute({ method: req.method, url: fullUrl, headers: req.headers as any, body: (req as any).body });

      if (report && (report.status || report.body || report.error)) {
        // update record with lane if stored via router
        const rec = await npzStore.getRequestRecord(npz_id);
        const lane = rec?.laneId;
        if (lane !== undefined) {
          res.cookie(cookieName, String(lane), { maxAge: maxAge * 1000 });
        }

        // metrics
        const diff = process.hrtime(start);
        const duration = diff[0] + diff[1] / 1e9;
        const gate = (report as any).gate || 'unknown';
        const laneId = (report as any).laneId !== undefined ? String((report as any).laneId) : String(lane || 'unknown');
        requestDuration.labels(gate, laneId, npz_id, NS).observe(duration);

        logger.info(`NPZ npz_id=${npz_id} gate=${gate} lane=${laneId} duration=${duration.toFixed(3)}s`);

        if (report.status) res.status(report.status);
        // set headers (careful with set-cookie)
        if (report.headers) {
          try {
            for (const [k, v] of Object.entries(report.headers)) {
              if (k.toLowerCase() === 'set-cookie') continue;
              res.setHeader(k, v as any);
            }
          } catch (e) {}
        }
        res.send(report.body || (report.error ? String((report as any).error) : ''));
        return;
      }

      next();
    } catch (err) {
      logger.warn(`npz-middleware: error ${err}`);
      next();
    }
  };
}

export default npzMiddleware;
