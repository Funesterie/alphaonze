'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildSemanticMediaRoulette,
  collectMediaCandidates,
  redactSensitiveText,
} = require('../lib/semantic-media-roulette.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function touchFile(filePath, content = 'demo') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('semantic media roulette ranks media from user creative context', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-media-roulette-'));
  const workspaceRoot = path.join(root, 'a11');
  const runtimeRoot = path.join(workspaceRoot, 'runtime');
  fs.mkdirSync(runtimeRoot, { recursive: true });

  writeJson(path.join(runtimeRoot, 'music', 'vivy-songs.json'), {
    tracks: [
      {
        title: 'Vivy Nuit Claire',
        artist: 'Funesterie',
        audioUrl: 'https://files.funesterie.test/vivy-nuit.mp3',
        audioFormat: 'mp3',
        tags: ['vivy', 'voix', 'clip', 'poetique'],
        enabled: true,
      },
    ],
  });

  writeJson(path.join(runtimeRoot, 'vision-memory', 'img_demo.vision.json'), {
    id: 'img_demo',
    imageId: 'img_demo',
    imagePath: 'files/uploads/img_demo.png',
    prompt: 'scene lumineuse pour Vivy',
    createdAt: new Date().toISOString(),
    source: 'generated',
    vision: {
      description: 'Scene musicale nocturne avec voix et lumiere douce.',
      subject: 'Vivy scene',
      tags: ['vivy', 'scene', 'voix'],
      mood: 'calme creatif',
      style: 'cinematic',
      colors: ['blue'],
    },
  });

  touchFile(path.join(root, 'runtime', 'Corpus', 'Vagues Psy by Jeffrey Cellauro.mp3'));
  fs.mkdirSync(path.join(workspaceRoot, 'a11_memory', 'conversations'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'a11_memory', 'conversations', '20260514.jsonl'), `${JSON.stringify({
    request: {
      messages: [
        { role: 'user', content: 'Je veux une selection Vivy voix clip poetique pour Jeffrey.' },
      ],
    },
  })}\n`, 'utf8');

  const result = buildSemanticMediaRoulette({
    workspaceRoot,
    runtimeRoot,
    query: 'clip Vivy voix',
    userContext: {
      preference: 'musique poetique et scene lumineuse',
      token: 'sk-test-abcdefghijkl',
    },
    seed: 'test-seed',
    randomize: false,
    limit: 3,
    includeProfileSnippets: true,
  });

  assert.equal(result.ok, true);
  assert.ok(result.sources.mediaCount >= 3);
  assert.ok(result.selected.length >= 1);
  assert.match(result.selected[0].title, /Vivy/i);
  assert.ok(result.profile.terms.some((entry) => entry.term === 'vivy'));
  assert.doesNotMatch(JSON.stringify(result.profile.snippets), /sk-test-abcdefghijkl/);
});

test('redactSensitiveText masks common token forms', () => {
  const redacted = redactSensitiveText('token=abc password=def api_key=ghi sk-test-abcdefghijkl');
  assert.doesNotMatch(redacted, /password=def/);
  assert.doesNotMatch(redacted, /api_key=ghi/);
  assert.doesNotMatch(redacted, /sk-test-abcdefghijkl/);
});

test('collectMediaCandidates scans mounted runtime Corpus in containers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-media-runtime-corpus-'));
  const workspaceRoot = path.join(root, 'app');
  const runtimeRoot = path.join(workspaceRoot, 'runtime');
  touchFile(path.join(runtimeRoot, 'Corpus', 'vivy-deep-reference-20260704', 'jeff joker.jpg'));

  const candidates = collectMediaCandidates({
    workspaceRoot,
    runtimeRoot,
    includeLocalPath: true,
    maxPerDirectory: 20,
  });

  const candidate = candidates.find((item) => item.title === 'jeff joker');
  assert.ok(candidate, 'expected runtime Corpus reference image to be discovered');
  assert.equal(candidate.source, 'runtime:corpus');
  assert.match(candidate.localPath, /vivy-deep-reference-20260704/);
});
