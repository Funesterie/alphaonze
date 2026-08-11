'use strict';
// Smoke test: with a FAKE token, verifyToken must return 401 (proves the client reaches the real CF API + auth is wired).
const cf = require('../src/index.cjs');
(async () => {
  const r = await cf.verifyToken('INVALID_TOKEN_FOR_SMOKE');
  if (r.status === 401 || (r.json && r.json.success === false)) {
    console.log('cf smoke OK: client reaches Cloudflare API (got ' + r.status + ' for a fake token, as expected).');
  } else {
    console.log('cf smoke UNEXPECTED:', r.status, JSON.stringify(r.json).slice(0, 200));
    process.exit(1);
  }
})().catch(e => { console.error('cf smoke FAILED:', e.message); process.exit(1); });
