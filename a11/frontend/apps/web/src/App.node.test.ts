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


test("sanitizeVivyNossenSongSeed normalise les traits d''union Unicode (U+2011) en ASCII", () => {
  // gpt-oss emet U+2011 (non-breaking hyphen) dans [Pre\u2011Chorus]; le parseur de sections
  // a trait d''union ASCII ne le matchait pas -> paroles_vivy_invalides. Vu en prod 29/07/2026.
  assert.ok(appSource.includes("replace(/[\\u2010-\\u2015"), "normalisation des traits d''union Unicode absente de sanitizeVivyNossenSongSeed");
});
