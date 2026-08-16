'use strict';

const path = require('node:path');

// This path is bind-mounted by the production compose file. Keeping a single
// default avoids writing jobs in an ephemeral image layer while serving clips
// from a different directory.
const DEFAULT_CLIPS_DIR = '/app/runtime/clips';

function resolveClipsDir(env = process.env) {
  const configured = String(env?.NOSSEN_CLIPS_DIR || '').trim();
  if (!configured) return DEFAULT_CLIPS_DIR;
  if (!path.isAbsolute(configured)) {
    throw new Error('NOSSEN_CLIPS_DIR must be an absolute path');
  }
  return path.normalize(configured);
}

const CLIPS_DIR = resolveClipsDir();

module.exports = {
  CLIPS_DIR,
  DEFAULT_CLIPS_DIR,
  resolveClipsDir,
};
