'use strict';

// Audit des prompts de la chaine des clips, 12/09/2026.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-audit-'));
const { styleVideo } = require('../src/clips/clip-generator-v2.cjs');
const { formatPlansForReview } = require('../src/clips/clip-vivy-director.cjs');

// Style reellement envoye par la page le 12/09 (job clip-1789220681432-aa0858).
const STYLE_PAGE = 'Live-action cinematic music video inspired by the song, photorealistic, real actors. '
  + 'Analyze the mood of: FIGHTERZ CLUB Sous-sol beton, un neon qui grelotte. '
  + 'Choose colors, lighting and camera movement that match the emotion. Rich detail, volumetric lighting.';

test('le titre et les consignes pour LLM ne partent plus vers la camera', () => {
  const s = styleVideo(STYLE_PAGE, 'FIGHTERZ CLUB Sous-sol be…');
  assert.doesNotMatch(s, /FIGHTERZ/i, 'le titre declenche le filtre copyright');
  assert.doesNotMatch(s, /Analyze|Choose/, 'un modele video n execute pas des ordres');
  assert.match(s, /Live-action/, 'la description visuelle reste');
  assert.match(s, /volumetric lighting/);
});

test('un style sans titre ni consigne passe tel quel, borne', () => {
  assert.equal(styleVideo('Neon rain, rich detail.', 'Autre'), 'Neon rain, rich detail.');
  assert.equal(styleVideo('', 'T'), '');
  assert.ok(styleVideo('x '.repeat(400), '').length <= 300);
});

test('les relecteurs voient la section et le theme de chaque plan', () => {
  const texte = formatPlansForReview([
    { name: 'P1', visual: 'Close-up hands on the bag.', section: 'couplet', acte: 'il se prepare au combat' },
    { name: 'P2', visual: 'Wide shot of the room.' },
  ], 'basement gym');
  assert.match(texte, /\[P1 — section couplet\]/);
  assert.match(texte, /thème des paroles : il se prepare au combat/);
  assert.match(texte, /1\. \[P2\] Wide shot/, 'un plan sans section reste lisible');
});

test('la fiche d identite envoyee a la camera est en anglais et courte', () => {
  const { resolveClipIdentity } = require('../src/clips/clip-vivy-director.cjs');
  const djeff = resolveClipIdentity({ title: 'FIGHTERZ CLUB', lyrics: '', style: '', casting: 'auto', castArtists: [] });
  assert.deepEqual(djeff.identityIds, ['djeff']);
  assert.ok(djeff.prompt.length < 450, 'etait ~870 caracteres : ' + djeff.prompt.length);
  assert.match(djeff.prompt, /square jaw/, 'les traits de ressemblance restent');
  assert.match(djeff.prompt, /beard and moustache/);
  assert.doesNotMatch(djeff.prompt, /[éèàçù]|Référence/, 'plus de francais melange a un prompt anglais');
  assert.match(djeff.negativePrompt, /clean shaven Djeff/, 'les interdits restent dans le negatif');
});

test('chaque personnage a sa fiche video, et les autres usages gardent la fiche francaise', () => {
  const ids = require('../src/vivy/visual-identities.cjs');
  for (const def of ids.IDENTITY_DEFINITIONS) {
    assert.ok(def.videoPrompt && def.videoPrompt.length < 400, def.id + ' : fiche video presente et courte');
    assert.doesNotMatch(def.videoPrompt, /[éèàçù]/, def.id + ' : en anglais');
  }
  const pack = ids.buildVivyVisualIdentityPack({ artists: ['djeff'], forceVocalCastVisualIdentity: true });
  assert.match(pack.prompt, /Référence visuelle/, 'Twitch et images gardent la fiche complete');
  assert.match(pack.videoPrompt, /Djeff, the creator/);
});

test('le duo Djeff x Vivy garde deux personnages distincts, en anglais', () => {
  const { resolveClipIdentity } = require('../src/clips/clip-vivy-director.cjs');
  const duo = resolveClipIdentity({ title: 'T', lyrics: '', style: '', casting: 'duo-djeff-vivy', castArtists: ['djeff', 'vivy'], render: 'anime' });
  assert.deepEqual([...duo.identityIds].sort(), ['djeff', 'vivy']);
  assert.match(duo.prompt, /Two distinct characters/);
  assert.match(duo.prompt, /Djeff, the creator/);
  assert.match(duo.prompt, /Vivy, the AI singer/);
  assert.doesNotMatch(duo.prompt, /[éèàçù]/);
  assert.ok(duo.prompt.length < 900, 'duo complet : ' + duo.prompt.length);
  assert.match(duo.negativePrompt, /Vivy clone/);
});

test('en film, Vivy est une actrice reelle et son nom ne part pas a la camera', () => {
  const { resolveClipIdentity } = require('../src/clips/clip-vivy-director.cjs');
  const { effacerNomsFilm } = require('../src/clips/clip-generator-v2.cjs');
  const film = resolveClipIdentity({ title: 'T', lyrics: '', style: '', casting: 'auto', castArtists: ['vivy'], render: 'film' });
  assert.deepEqual(film.identityIds, ['vivy']);
  assert.match(film.prompt, /real human actress/);
  assert.match(film.prompt, /twin tails with dark magenta highlights/, 'le costume reste');
  assert.doesNotMatch(film.prompt, /AI singer|\bVivy\b/, 'le nom et « AI singer » tirent vers l anime');
  assert.deepEqual(film.nomsFilm, { Vivy: 'the singer' });
  const plan = effacerNomsFilm("Close shot of Vivy at the desk, Vivy's hands on the keys.", film.nomsFilm);
  assert.equal(plan, "Close shot of the singer at the desk, the singer's hands on the keys.");

  const defaut = resolveClipIdentity({ title: 'T', lyrics: '', style: '', casting: 'auto', castArtists: ['vivy'] });
  assert.match(defaut.prompt, /real human actress/, 'sans rendu precise, le film est le defaut');

  const manga = resolveClipIdentity({ title: 'T', lyrics: '', style: '', casting: 'auto', castArtists: ['vivy'], render: 'anime' });
  assert.match(manga.prompt, /Vivy, the AI singer/, 'le clip manga garde la fiche d origine');
  assert.deepEqual(manga.nomsFilm, {});
  assert.equal(effacerNomsFilm('Vivy sings.', manga.nomsFilm), 'Vivy sings.');
});
