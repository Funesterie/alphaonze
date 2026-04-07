const express = require('express');

function createAdminRouter({ verifyJWT, isAdminRequest } = {}) {
	const router = express.Router();

	router.post(
		'/cleanup-test-data',
		express.json({ limit: '2mb' }),
		(req, res, next) => {
			if (typeof verifyJWT !== 'function') {
				return res.status(500).json({ ok: false, error: 'admin_auth_not_configured' });
			}
			return verifyJWT(req, res, next);
		},
		(req, res, next) => {
			if (typeof isAdminRequest !== 'function') {
				return res.status(500).json({ ok: false, error: 'admin_guard_not_configured' });
			}
			if (!isAdminRequest(req)) {
				return res.status(403).json({ ok: false, error: 'admin_required' });
			}
			return next();
		},
		async (req, res) => {
			const { apply } = req.body || {};
			const dryRun = !apply;

			try {
				const { runCleanupTestData } = await import('../../scripts/cleanup-test-smoke-data-lib.mjs');
				const result = await runCleanupTestData({
					dryRun,
					verbose: true,
					connectionString: process.env.PGURL || process.env.DATABASE_URL,
				});

				return res.json({
					ok: true,
					dryRun,
					totalPlanned: result.totalPlanned,
					plans: result.plans,
					deleted: result.deleted,
					message: dryRun
						? 'Dry-run complete. No data deleted.'
						: 'Cleanup complete. Data deleted.',
				});
			} catch (err) {
				return res.status(500).json({
					ok: false,
					error: String(err?.message || err),
				});
			}
		}
	);

	return router;
}

module.exports = createAdminRouter;
