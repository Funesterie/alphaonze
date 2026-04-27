const express = require('express');
const { createRequireAdminAccess } = require('../security/admin-access.cjs');

function createA11MemoryWriteRouter({
  isAdminRequest,
  verifyJWT,
  writeMemoryKeyValue,
} = {}) {
  const router = express.Router();
  const requireAdminAccess = createRequireAdminAccess({
    isAdminRequest,
    verifyJWT,
  });

  router.post('/a11/memory/write', express.json(), requireAdminAccess, (req, res) => {
    if (typeof writeMemoryKeyValue !== 'function') {
      return res.status(500).json({
        ok: false,
        error: 'memory_write_unavailable',
      });
    }

    const { key, value } = req.body || {};
    if (!key) {
      return res.status(400).json({
        ok: false,
        error: 'Missing key',
      });
    }

    const result = writeMemoryKeyValue(key, value);
    if (!result?.ok) {
      return res.status(500).json(result);
    }

    return res.json(result);
  });

  return router;
}

module.exports = createA11MemoryWriteRouter;
