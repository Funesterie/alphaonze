'use strict';
function haveNeed(manifest, store) {
  const have = [], need = [];
  for (const c of manifest.chunks) (store.has(c.sha256) ? have : need).push(c);
  return { have, need };
}
module.exports = { haveNeed };
