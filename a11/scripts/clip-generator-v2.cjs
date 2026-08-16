'use strict';

// Compatibility entrypoint kept for operator scripts. The implementation lives
// in one place so storage, auth and media-input guards cannot drift apart.
module.exports = require('../backend/apps/server/src/clips/clip-generator-v2.cjs');
