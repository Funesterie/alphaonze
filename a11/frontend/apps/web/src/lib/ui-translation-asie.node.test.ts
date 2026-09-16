import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { UI_TEXT_JA_ZH } from "./ui-translation-asie.ts";

// Chaque phrase française du dictionnaire A11 doit avoir son japonais et son chinois :
// sans ça, la page choisie en japonais retombe en silence sur le français.
function frenchSources(): string[] {
  const source = readFileSync(new URL("./ui-translation.ts", import.meta.url), "utf8");
  const start = source.indexOf("const LEGACY_UI_TEXT_ENTRIES");
  const open = source.indexOf("[", source.indexOf("=", start));
  const close = source.indexOf("\n];", open);
  const entries = new Function("tr", `return ${source.slice(open, close + 2)};`)(
    (fr: string) => fr,
  ) as string[];
  return entries;
}

test("chaque phrase de l'interface A11 a son japonais et son chinois", () => {
  const sources = frenchSources();
  assert.ok(sources.length > 250, `dictionnaire lu : ${sources.length} phrases`);
  const missing = sources.filter((fr) => !UI_TEXT_JA_ZH[fr]?.ja || !UI_TEXT_JA_ZH[fr]?.zh);
  assert.deepEqual(missing, []);
});

test("aucune traduction japonaise ou chinoise n'est restée en français", () => {
  for (const [fr, { ja, zh }] of Object.entries(UI_TEXT_JA_ZH)) {
    // Les noms propres identiques (Google, NOSSEN...) sont permis ; une phrase avec
    // des accents français recopiée telle quelle ne l'est pas.
    if (/[éèàùçêô]/i.test(fr)) {
      assert.notEqual(ja, fr, `ja non traduit : ${fr}`);
      assert.notEqual(zh, fr, `zh non traduit : ${fr}`);
    }
  }
});
