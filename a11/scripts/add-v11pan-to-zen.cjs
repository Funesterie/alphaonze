'use strict';
/**
 * add-v11pan-to-zen.cjs — Ajoute le master V11 pan integrale dans chaque .zen.
 *
 * Reprend les archives deja ecrites, sort l'audio d'origine, le passe dans la
 * chaine consolidee d40 + V10 Boom + V11 spatial (celle de vivy.funesterie.me,
 * route /api/double-harmonic/v10boom/process), et reecrit le .zen avec les deux
 * masters : l'original intact et le rendu V11.
 *
 * L'original n'est jamais remplace. On ajoute un rendu, on ne perd pas la source.
 *
 * Usage :
 *   JUKEBOX_ZEN_KEY=... node a11/scripts/add-v11pan-to-zen.cjs --dir <archives> [--limit N]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '../backend/apps/server');
const jukeboxZen = require(path.join(SERVER, 'src/clips/jukebox-zen.cjs'));
const boom = require(path.join(SERVER, 'src/audio/v10-boom.cjs'));
const v8 = require(path.join(SERVER, 'src/audio/double-harmonic-closed-phase-v8.cjs'));
const d40 = require(path.join(SERVER, 'src/audio/double-harmonic-d40.cjs'));

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const DIR = arg('--dir', 'D:/funesterie-archive/catalogue-zen');
const LIMIT = Number(arg('--limit', '0')) || 0;
const PROFILE = arg('--profile', 'blend');

/** Chaine integrale : V10 Boom a besoin du processeur V9, comme en production. */
async function renderV11Pan(inputPath, outputPath) {
  return boom.processV10BoomD40({
    inputPath,
    outputPath,
    profile: PROFILE,
    processV9Turbo: v8.processTurboD40V9,
    runFfmpeg: d40.runFfmpeg,
  });
}

async function main() {
  if (!process.env.JUKEBOX_ZEN_KEY) {
    console.error('JUKEBOX_ZEN_KEY absente.');
    process.exit(1);
  }
  let files = fs.readdirSync(DIR).filter((name) => name.endsWith('.zen')).sort();
  if (LIMIT > 0) files = files.slice(0, LIMIT);
  console.log(`${files.length} archives a traiter (profil ${PROFILE})`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v11pan-'));
  const report = { ok: [], dejaFait: [], echecs: [] };

  for (let i = 0; i < files.length; i += 1) {
    const name = files[i];
    const zenPath = path.join(DIR, name);
    const label = `[${i + 1}/${files.length}] ${name.slice(0, 48)}`;
    try {
      const track = jukeboxZen.decodeTrack(fs.readFileSync(zenPath));
      if ((track.masters || []).some((master) => master.id === 'v11pan')) {
        console.log(`${label} — deja fait`);
        report.dejaFait.push(name);
        continue;
      }

      const inPath = path.join(tmpDir, 'in.mp3');
      const outPath = path.join(tmpDir, 'out.mp3');
      fs.writeFileSync(inPath, track.audio.buffer);
      const result = await renderV11Pan(inPath, outPath);
      const rendered = fs.readFileSync(outPath);

      const buffer = jukeboxZen.encodeTrack({
        audioBuffer: track.audio.buffer,
        audioFilename: track.audio.filename,
        audioMimeType: track.audio.mimeType,
        title: track.title,
        artist: track.artist,
        lyrics: track.lyrics,
        coverBuffer: track.cover ? track.cover.buffer : null,
        coverMimeType: track.cover ? track.cover.mimeType : 'image/png',
        durationSeconds: track.durationSeconds,
        metadata: { ...track.metadata, v11PanAddedAt: new Date().toISOString() },
        masters: [{
          id: 'v11pan',
          label: 'V11 pan integrale',
          chain: 'd40 + v10boom + v11 spatial',
          mimeType: 'audio/mpeg',
          buffer: rendered,
          params: {
            profile: PROFILE,
            boom: result && result.boom ? result.boom.config : null,
          },
        }],
      });

      // Relecture avant remplacement : on ne touche a l'archive existante que si
      // la nouvelle se rouvre et rend les deux masters intacts.
      const back = jukeboxZen.decodeTrack(buffer);
      if (!back.integrityOk || back.masters.length !== 1) {
        throw new Error('relecture incoherente');
      }
      fs.writeFileSync(zenPath, buffer);

      console.log(`${label} — +${Math.round(rendered.length / 1024)}Ko V11 pan, total ${Math.round(buffer.length / 1024)}Ko`);
      report.ok.push(name);
    } catch (error) {
      console.log(`${label} — ECHEC : ${error.message}`);
      report.echecs.push({ name, error: error.message });
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\n===== BILAN V11 PAN =====');
  console.log('traites  :', report.ok.length);
  console.log('deja fait:', report.dejaFait.length);
  console.log('echecs   :', report.echecs.length);
  report.echecs.forEach((e) => console.log('  -', e.name, ':', e.error));
  fs.writeFileSync(path.join(DIR, '_bilan-v11pan.json'), JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('Interrompu :', error.message);
  process.exit(1);
});
