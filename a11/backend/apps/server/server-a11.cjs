#!/usr/bin/env node
'use strict';

// Alpha Onze / A11 dedicated runtime entrypoint.
// Keep this file small: it sets product defaults, then loads the shared server.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

function loadProfileEnv(profileName) {
  const profilePath = path.resolve(__dirname, 'profiles', `${profileName}.env`);
  const overridePath = String(process.env.A11_PROFILE_ENV || '').trim();
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

loadProfileEnv('a11');

setDefault('A11_PRODUCT', 'a11');
setDefault('A11_INSTANCE_NAME', 'Alpha Onze');
setDefault('A11_RUNTIME_PROFILE', 'prod');
setDefault('A11_PUBLIC_HOST', 'a11.funesterie.me');
setDefault('PUBLIC_APP_URL', 'https://a11.funesterie.me');
setDefault('API_URL', 'https://a11.funesterie.me');
setDefault('PORT', '3000');
setDefault('SERVE_STATIC', 'true');
setDefault('A11_USAGE_GUARD_ADMIN_EMAIL', 'cellaurojeffrey@gmail.com');

require('./server.cjs');
