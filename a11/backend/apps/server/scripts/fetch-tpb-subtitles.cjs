#!/usr/bin/env node
'use strict';

/**
 * Local operator wrapper for TPB subtitle fetching.
 *
 * The full fetcher lives in the operator Desktop toolbox because it may rely on
 * local OpenSubtitles credentials. This wrapper keeps repo commands stable while
 * avoiding credential storage in git.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function firstExisting(paths = []) {
  for (const filePath of paths) {
    try {
      if (filePath && fs.existsSync(filePath)) return filePath;
    } catch {}
  }
  return '';
}

const home = os.homedir();
const localFetcher = firstExisting([
  process.env.FUNESTERIE_TPB_FETCHER,
  path.join(home, 'Desktop', 'TPB_SCRIPTS', 'fetch-tpb-subtitles.cjs'),
  path.join(home, 'OneDrive', 'Bureau', 'TPB_SCRIPTS', 'fetch-tpb-subtitles.cjs'),
  path.join(home, 'Bureau', 'TPB_SCRIPTS', 'fetch-tpb-subtitles.cjs'),
]);

if (!localFetcher) {
  console.error(JSON.stringify({
    ok: false,
    error: 'local_tpb_fetcher_missing',
    hint: 'Place fetch-tpb-subtitles.cjs in Desktop/TPB_SCRIPTS or set FUNESTERIE_TPB_FETCHER. In production, run ingest-detente-humour-library.cjs against an existing local reference pool.',
  }, null, 2));
  process.exit(1);
}

const result = spawnSync(process.execPath, [localFetcher, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? (result.error ? 1 : 0));
