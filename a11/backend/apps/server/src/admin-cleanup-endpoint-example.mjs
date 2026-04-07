// Example: Secure admin endpoint for test/smoke/demo data cleanup
import express from 'express';
import { runCleanupTestData } from '../../apps/server/scripts/cleanup-test-smoke-data-lib.mjs';

const router = express.Router();

// Middleware: require admin authentication (replace with your real logic)
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// POST /admin/cleanup-test-data (dry-run or apply)
router.post('/admin/cleanup-test-data', requireAdmin, async (req, res) => {
  const { apply } = req.body || {};
  const dryRun = !apply;
  try {
    const result = await runCleanupTestData({
      dryRun,
      verbose: true,
      connectionString: process.env.PGURL || process.env.DATABASE_URL,
    });
    res.json({
      dryRun,
      totalPlanned: result.totalPlanned,
      plans: result.plans,
      deleted: result.deleted,
      message: dryRun
        ? 'Dry-run complete. No data deleted.'
        : 'Cleanup complete. Data deleted.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
