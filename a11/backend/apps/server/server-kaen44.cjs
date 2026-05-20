#!/usr/bin/env node
'use strict';

// Kaen44 dedicated runtime entrypoint.
// Kaen44 is the client-facing assistant surface; A11 remains the heavier remote brain.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

function loadProfileEnv(profileName) {
  const profilePath = path.resolve(__dirname, 'profiles', `${profileName}.env`);
  const overridePath = String(process.env.KAEN44_PROFILE_ENV || process.env.A11_PROFILE_ENV || '').trim();
  const envPath = overridePath || profilePath;
  if (!fs.existsSync(envPath)) return;
  dotenv.config({
    path: envPath,
    override: ['1', 'true', 'yes', 'on'].includes(String(process.env.A11_PROFILE_ENV_OVERRIDE || '').trim().toLowerCase()),
  });
  process.env.A11_PROFILE_ENV_LOADED = '1';
  console.log(`[A11] Runtime profile env loaded: ${envPath}`);
}

function setDefault(name, value) {
  if (!String(process.env[name] || '').trim()) {
    process.env[name] = value;
  }
}

loadProfileEnv('kaen44');

setDefault('A11_PRODUCT', 'kaen44');
setDefault('A11_INSTANCE_NAME', 'Kaen44');
setDefault('A11_RUNTIME_PROFILE', 'kaen44');
setDefault('A11_PUBLIC_HOST', 'k44.funesterie.me');
setDefault('PUBLIC_APP_URL', 'https://k44.funesterie.me');
setDefault('API_URL', 'https://k44.funesterie.me');
setDefault('PORT', '3001');
setDefault('SERVE_STATIC', 'true');
setDefault('A11_USAGE_GUARD_ADMIN_EMAIL', 'funeste38@gmail.com');
setDefault('KAEN44_MODE', '1');
setDefault('A11_ALLOW_DEV_ROUTES', 'false');
setDefault('A11_ENABLE_LEGACY_WORD_INTENT_DETECTORS', 'false');
setDefault('A11_RESPONDER_MODE', 'off');

require('./server.cjs');
