#!/usr/bin/env node
'use strict';

const { installCanonicalVivyProfile } = require('../src/persona/vivy-canonical-profile.cjs');

try {
  const result = installCanonicalVivyProfile(process.env);
  console.log(`[persona] Vivy canonical profile ${result.action}; active=${result.active}; source=${result.sourceSha256 || 'custom'}`);
} catch (error) {
  console.error(`[persona] Vivy canonical profile installation failed: ${error?.message || String(error)}`);
  process.exitCode = 1;
}
