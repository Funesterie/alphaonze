'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-music-mux-'));
process.env.NOSSEN_CLIPS_DIR = root;
const { generateClip } = require('../src/clips/clip-generator-v2.cjs');

// Le runner GitHub n'a pas ffmpeg : le test est ignore la-bas, jamais maquille en succes.
let ffmpegDisponible = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (_) { ffmpegDisponible = false; }

test('le clip garde la musique meme si la scene contient sa propre piste stereo', { skip: ffmpegDisponible ? false : 'ffmpeg absent sur cette machine' }, async () => {
  const scene = path.join(root, 'input.mp4');
  const song = path.join(root, 'song.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=1800:duration=2', '-ac', '2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', scene]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', song]);
  const result = await generateClip({ songUrl: song, title: 'Musique prioritaire' }, {
    materializeMedia: async (source, destination) => fs.copyFileSync(source, destination),
    loadDirectorImpl: () => ({ directClip: async () => ({ scenes: [{ visual: 'Blue scene' }] }) }),
    generateVideoImpl: async () => scene,
    resolveVideoModelsImpl: async () => ({ t2v: 'fixture', decouvert: true }),
    sleepImpl: async () => {},
  });
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', result.path, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']);
  function energy(hz) {
    let real = 0, imaginary = 0;
    for (let i = 800; i < 8800; i++) {
      const sample = pcm.readFloatLE(i * 4);
      const phase = 2 * Math.PI * hz * i / 8000;
      real += sample * Math.cos(phase); imaginary += sample * Math.sin(phase);
    }
    return real * real + imaginary * imaginary;
  }
  assert.ok(energy(440) > energy(1800) * 1000, 'la chanson doit dominer et le son de scene etre absent');
});

test('un plan refuse pour son audio est rejoue une fois avec une ambiance neutre, puis livre', { skip: ffmpegDisponible ? false : 'ffmpeg absent sur cette machine' }, async () => {
  const scene = path.join(root, 'input.mp4');
  const song = path.join(root, 'song.mp3');
  if (!fs.existsSync(scene)) {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=2', '-c:v', 'libx264', scene]);
  }
  if (!fs.existsSync(song)) execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', song]);
  const prompts = [];
  const optionsRecues = [];
  const result = await generateClip({ songUrl: song, title: 'Refus audio' }, {
    materializeMedia: async (source, destination) => fs.copyFileSync(source, destination),
    loadDirectorImpl: () => ({ directClip: async () => ({ scenes: [{ visual: 'Blue scene' }] }) }),
    generateVideoImpl: async (prompt, _index, _attente, _identite, options = {}) => {
      prompts.push(prompt);
      optionsRecues.push(options);
      if (prompts.length === 1) throw new Error('clip_video_generation_failed: Task failed: {"error": {"code": "OutputAudioSensitiveContentDetected"}}');
      return scene;
    },
    resolveVideoModelsImpl: async () => ({ t2v: 'fixture', decouvert: true }),
    sleepImpl: async () => {},
  });
  assert.equal(prompts.length, 2, 'un seul second essai');
  assert.ok(!optionsRecues[0].sansAudio, 'le premier essai garde le son du modele');
  assert.equal(optionsRecues[1].sansAudio, true, 'le second essai demande une video silencieuse');
  assert.ok(!prompts[0].includes('ambient room tone'), 'le premier essai garde le prompt d origine');
  assert.ok(prompts[1].includes('ambient room tone'), 'le second essai decrit une ambiance neutre');
  assert.ok(fs.existsSync(result.path), 'le clip est livre');
  assert.ok(!String(result.warning || '').includes('clip_partial'), 'aucun plan perdu');
});
