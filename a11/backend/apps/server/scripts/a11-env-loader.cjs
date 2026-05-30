'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PASS_FILE = 'C:\\Users\\Djeff\\Desktop\\pass.txt';

function loadEnvFile(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    if (options.override || process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

function loadRouterEnv() {
  loadEnvFile(path.join(SERVER_ROOT, '.env'));
  loadEnvFile(path.join(SERVER_ROOT, '.env.local'), { override: true });
  loadEnvFile(process.env.A11_MEMORY_PASS_FILE || DEFAULT_PASS_FILE, { override: true });
}

module.exports = {
  loadEnvFile,
  loadRouterEnv,
};
