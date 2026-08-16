#!/bin/bash
# Rebuild vivy-songs-catalog.json from the double-harmonic-d40 directory
# Scans all .mp3 files, extracts metadata, writes the catalog to agent-bus

SONG_DIR="/app/runtime/double-harmonic-d40"
CATALOG="/agent-bus/vivy-songs-catalog.json"

if [ ! -d "$SONG_DIR" ]; then
  echo '{"songs":[],"error":"song dir not found"}' > "$CATALOG"
  exit 0
fi

node -e "
const fs = require('fs');
const path = require('path');

const dir = '$SONG_DIR';
const files = fs.readdirSync(dir)
  .filter(f => {
    if (!f.endsWith('.mp3') && !f.endsWith('.m4a') && !f.endsWith('.wav')) return false;
    // Skip intermediate files (v10boom-input = pre-mix, keep only final v11pan outputs)
    if (f.includes('-v10boom-input.')) return false;
    return true;
  })
  .sort((a, b) => {
    // Sort by timestamp in filename (descending = newest first)
    const tsA = (a.match(/(\d{13})/) || [])[1] || '0';
    const tsB = (b.match(/(\d{13})/) || [])[1] || '0';
    return Number(tsB) - Number(tsA);
  });

const songs = files.map(filename => {
  const filePath = path.join(dir, filename);
  const stat = fs.statSync(filePath);
  const sizeMb = Math.round(stat.size / 1048576 * 10) / 10;
  const date = stat.mtime.toISOString().slice(0, 10);

  // Extract title from filename: remove prefix, timestamps, hashes, extensions
  let title = filename
    .replace(/^v\d+[a-z]*_\d+_[0-9a-f]+-/, '')  // remove v11pan_timestamp_hash-
    .replace(/[-_]funesterie[-_]d\d+[-_]v\d+[a-z]*[-_]v\d+[a-z]*\.mp3$/i, '')
    .replace(/\.mp3$|\.m4a$|\.wav$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  // Capitalize first letter of each word
  title = title.split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 60);

  if (!title) title = filename.slice(0, 40);

  return { title, filename, size_mb: sizeMb, date, path: filePath };
});

const catalog = { count: songs.length, songs, generatedAt: new Date().toISOString() };
fs.writeFileSync('$CATALOG', JSON.stringify(catalog, null, 2));
console.log('Catalog rebuilt:', songs.length, 'songs');
"
