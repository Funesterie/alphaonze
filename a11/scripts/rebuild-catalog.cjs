"use strict";
const fs = require("fs");
const path = require("path");

const dir = "/app/runtime/double-harmonic-d40";
const catalog = "/agent-bus/vivy-songs-catalog.json";

if (!fs.existsSync(dir)) {
  fs.writeFileSync(catalog, JSON.stringify({ songs: [], error: "dir not found" }));
  process.exit(0);
}

const files = fs.readdirSync(dir)
  .filter(f => (f.endsWith(".mp3") || f.endsWith(".m4a")) && !f.includes("-v10boom-input."))
  .sort((a, b) => {
    const tsA = (a.match(/(\d{13})/) || [])[1] || "0";
    const tsB = (b.match(/(\d{13})/) || [])[1] || "0";
    return Number(tsB) - Number(tsA);
  });

const songs = files.map(filename => {
  const fp = path.join(dir, filename);
  const stat = fs.statSync(fp);
  const sizeMb = Math.round(stat.size / 1048576 * 10) / 10;
  const date = stat.mtime.toISOString().slice(0, 10);

  let title = filename
    .replace(/^v\d+[a-z]*_\d+_[0-9a-f]+-/, "")
    .replace(/[-_]funesterie[-_]d\d+[-_]v\d+[a-z]*[-_]v\d+[a-z]*\.mp3$/i, "")
    .replace(/\.mp3$|\.m4a$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  title = title.split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 60);

  if (!title) title = filename.slice(0, 40);

  return { title, filename, size_mb: sizeMb, date, path: fp };
});

const data = { count: songs.length, songs, generatedAt: new Date().toISOString() };
fs.writeFileSync(catalog, JSON.stringify(data, null, 2));
console.log("Catalog rebuilt:", songs.length, "songs");
