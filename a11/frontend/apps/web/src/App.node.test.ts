import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

test("NOSSEN seed validation accepts the production minimum while retaining chorus protection", () => {
  const validationBlock = appSource.match(/function isValidVivyNossenSongSeed\(value = ""\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(validationBlock, /sectionCount >= 3/);
  assert.match(validationBlock, /chorusCount >= 2/);
  assert.match(validationBlock, /lyricLineCount >= 10/);
  assert.match(validationBlock, /sanitizeVivyNossenSongSeed/);
  assert.match(validationBlock, /oui\\s\+je\\s\+te\\s\+suis/);
});

test("D40 downloads prefer the token-bearing share URL", () => {
  assert.match(
    appSource,
    /const d40DownloadUrl = String\(d40\.shareUrl \|\| d40\.audioUrl \|\| ""\)\.trim\(\);/
  );
});
