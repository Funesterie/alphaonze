import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

test("NOSSEN seed validation rejects empty or skeletal sections", () => {
  const validationBlock = appSource.match(/function isValidVivyNossenSongSeed\([\s\S]*?\n\}/)?.[0] || "";
  assert.ok(validationBlock, "le bloc de validation doit etre trouve");

  assert.match(validationBlock, /sectionCount >= 5/);
  assert.match(validationBlock, /chorusCount >= 2/);
  assert.match(validationBlock, /lyricLineCount >= 16/);
  assert.match(validationBlock, /verseSections\.length >= 2/);
  assert.match(validationBlock, /section\.lyricLines >= 4/);
  assert.match(validationBlock, /completeVerses && completeChoruses/);
  assert.match(validationBlock, /sanitizeVivyNossenSongSeed/);
  assert.match(validationBlock, /oui\\s\+je\\s\+te\\s\+suis/);
});

test("NOSSEN seed validation ne reclame pas de refrain a un cypher", () => {
  // Regression du 03/08 : la formule exigeait deux refrains de TOUT morceau. Un
  // cypher n'en a pas — c'est sa definition — donc des que Djeff rappait seul, la
  // validation echouait par construction, quoi que Vivy ecrive, et NOSSEN
  // s'arretait sur paroles_vivy_invalides sans designer la vraie cause.
  const validationBlock = appSource.match(/function isValidVivyNossenSongSeed\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(validationBlock, /isFlowFormSongSeed\(context\)/, "le genre doit etre consulte");
  // Sur ces formes on lache le refrain, PAS la matiere : lignes et couplets pleins restent exiges.
  assert.match(validationBlock, /sectionCount >= 3 && lyricLineCount >= 16/);
  assert.match(validationBlock, /verseSections\.every\(\(section\) => section\.lyricLines >= 4\)/);

  const flowForm = appSource.match(/function isFlowFormSongSeed\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(flowForm, /cypher\|freestyle\|spoken/);
  // Un morceau confie au seul Djeff est un rap, meme si le brief ne le dit pas.
  assert.match(flowForm, /cast\.length === 1 && cast\[0\] === "djeff"/);

  // Le contexte doit reellement etre transmis a l'appel, sinon la correction est morte.
  assert.match(
    appSource,
    /isValidVivyNossenSongSeed\(authoredVocalLyrics, \{ brief: prompt, cast: effectiveSongArtists \}\)/
  );
  const nossenStart = appSource.indexOf("async function launchNossenBanger");
  const nossenEnd = appSource.indexOf("async function onVivyVoiceReferenceChange", nossenStart);
  const nossenBlock = appSource.slice(nossenStart, nossenEnd);
  assert.match(nossenBlock, /isValidVivyNossenSongSeed\(vocalLyricsForProduction, \{/);
  assert.match(nossenBlock, /cast: artists/);
  assert.match(nossenBlock, /songMaxTokens: 2200/);
  assert.match(nossenBlock, /songResponseMaxChars: VIVY_STUDIO_SONG_MAX_CHARS/);
  assert.match(nossenBlock, /allowEmergencySongcraftFallback: lyricsAttempt === 3/);
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
  assert.match(simpleBlock, /const lyricsPayload = await chatWithVivy/);
  assert.match(simpleBlock, /disableSongcraftFallback: true/);
  assert.match(simpleBlock, /cleanLyrics: authoredVocalLyrics/);
  assert.match(simpleBlock, /publicLyrics: authoredPublicLyrics/);
  assert.match(simpleBlock, /paroles_vivy_invalides_avant_suno/);
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

test("les paroles simples retirent les annotations de schema de rimes avant Suno", () => {
  const sanitizeStart = appSource.indexOf("function sanitizeVivyNossenSongSeed");
  const sanitizeEnd = appSource.indexOf("function strengthenVivyNossenSoloSectionLabels", sanitizeStart);
  const sanitizeBlock = appSource.slice(sanitizeStart, sanitizeEnd);
  assert.match(sanitizeBlock, /rhymeSchemeMarkerCount/);
  assert.match(sanitizeBlock, /hasRhymeSchemeAnnotations/);
  assert.match(sanitizeBlock, /\\\(\[A-H\]\\\)/);

  const simpleStart = appSource.indexOf("async function produceSimpleVivySong");
  const simpleEnd = appSource.indexOf("async function askVivy", simpleStart);
  const simpleBlock = appSource.slice(simpleStart, simpleEnd);
  assert.match(simpleBlock, /Do not output rhyme-scheme letters such as A\/B/);
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
  assert.doesNotMatch(launchBlock, /writeVivyStudioDraft\(\{[\s\S]*songMood:\s*vivyRoutedColor/);
});

test("la couleur sonore affichee repart vide et ne se restaure pas depuis le brouillon", () => {
  assert.match(appSource, /const \[songMood, setSongMood\] = useState\(""\);/);
  const persistenceStart = appSource.indexOf("useEffect(() => {\n    writeVivyStudioDraft");
  const persistenceEnd = appSource.indexOf("useEffect(() => {\n    writeVivySessionSunoKey", persistenceStart);
  const persistenceBlock = appSource.slice(persistenceStart, persistenceEnd);
  assert.match(persistenceBlock, /songMood:\s*""/);
  assert.doesNotMatch(persistenceBlock, /^\s+songMood,\s*$/m);
});
