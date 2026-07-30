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

test("V10 Boom is the canonical D40 default across Studio and Suno production", () => {
  assert.match(appSource, /const DEFAULT_D40_PROCESS_MODE: DoubleHarmonicProcessMode = "v10boom";/);
  assert.match(appSource, /useState<DoubleHarmonicProcessMode>\(DEFAULT_D40_PROCESS_MODE\)/);
  assert.match(appSource, /mode: DEFAULT_D40_PROCESS_MODE/);
  assert.match(appSource, /provider: "funesterie-d40-v10boom"/);
  assert.match(appSource, /Auto-DJ — routage automatique du casting et de la couleur depuis le canevas/);

  const simpleStart = appSource.indexOf("async function produceSimpleVivySong");
  const simpleEnd = appSource.indexOf("async function askVivy", simpleStart);
  const simpleBlock = appSource.slice(simpleStart, simpleEnd);
  assert.match(simpleBlock, /americanMode: songAmericanMode/);
  assert.match(simpleBlock, /songArtists: effectiveSongArtists/);
  assert.match(simpleBlock, /applyDefaultV10BoomToVivyMedia/);

  const nossenStart = appSource.indexOf("async function launchNossenBanger");
  const nossenEnd = appSource.indexOf("async function onVivyVoiceReferenceChange", nossenStart);
  assert.match(appSource.slice(nossenStart, nossenEnd), /applyDefaultV10BoomToVivyMedia/);
});


test("sanitizeVivyNossenSongSeed normalise les traits d''union Unicode (U+2011) en ASCII", () => {
  // gpt-oss emet U+2011 (non-breaking hyphen) dans [Pre\u2011Chorus]; le parseur de sections
  // a trait d''union ASCII ne le matchait pas -> paroles_vivy_invalides. Vu en prod 29/07/2026.
  assert.ok(appSource.includes("replace(/[\\u2010-\\u2015"), "normalisation des traits d''union Unicode absente de sanitizeVivyNossenSongSeed");
});


test("par defaut la couleur sonore est libre: pas d'inference injectee a la place de Vivy", () => {
  const contractStart = appSource.indexOf("function buildVivyNossenCompositionContract");
  const contractEnd = appSource.indexOf("function buildVivyNossenLyricsRequest", contractStart);
  const contractBlock = appSource.slice(contractStart, contractEnd);
  // Le contrat de composition ne verrouille QUE le choix route par Vivy; sans routage,
  // le canevas reste libre (« choisir depuis la matiere »), pas une couleur inferée.
  assert.doesNotMatch(contractBlock, /inferVivyNossenSonicMood\(readiness,\s*artists\)/);
  assert.match(contractBlock, /options\.routedMood \|\| ""/);

  const lyricsStart = appSource.indexOf("function buildVivyNossenLyricsRequest");
  const lyricsEnd = appSource.indexOf("function buildVivyNossenBangerProductionBrief", lyricsStart);
  const lyricsBlock = appSource.slice(lyricsStart, lyricsEnd);
  assert.match(lyricsBlock, /routedMood = ""/);
  assert.doesNotMatch(lyricsBlock, /inferVivyNossenSonicMood\(readiness,\s*artists\)/);

  const briefStart = appSource.indexOf("function buildVivyNossenBangerProductionBrief");
  const briefEnd = appSource.indexOf("function sanitizeVivyNossenSongSeed", briefStart);
  const briefBlock = appSource.slice(briefStart, briefEnd);
  assert.match(briefBlock, /routedMood = ""/);
  assert.doesNotMatch(briefBlock, /inferVivyNossenSonicMood\(readiness,\s*artists\)/);

  // Le lancement passe le choix de Vivy (routedMood) aux deux briefs, pas une inference.
  const launchStart = appSource.indexOf("async function launchNossenBanger");
  const launchEnd = appSource.indexOf("async function onVivyVoiceReferenceChange", launchStart);
  const launchBlock = appSource.slice(launchStart, launchEnd);
  assert.match(launchBlock, /buildVivyNossenLyricsRequest\(routedReadiness,\s*artists,\s*sharedCompositionContract,\s*routedMood\)/);
  assert.match(launchBlock, /buildVivyNossenBangerProductionBrief\(routedReadiness,\s*artists,\s*sharedCompositionContract,\s*routedMood\)/);
  // La couleur sonore de production envoyee a Suno est le choix route par Vivy, libre sinon.
  assert.match(launchBlock, /const songMood = routedMood \|\| undefined;/);
  assert.match(launchBlock, /const vivyRoutedColor = \(routedMood \|\| ""\)\.trim\(\);/);
});
