const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  classifyImg2ImgSource,
  enrichImg2ImgDraft,
  probeImg2ImgSource,
  resolveImg2ImgStrength,
} = require('../src/image/img2img-source-guard.cjs');

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

test('classifyImg2ImgSource keeps a tall solo character portrait out of duo_group mode', () => {
  const result = classifyImg2ImgSource({
    prompt: 'goku en pied, sujet unique',
    draft: {
      title: 'Goku full body character art',
      mode: 'web_reference_subject',
    },
    sourceMeta: {
      width: 1152,
      height: 2048,
      contentType: 'image/png',
    },
  });

  assert.equal(result.sceneKey, 'solo_subject');
  assert.equal(result.sceneType, 'sujet solo');
  assert.equal(result.disableMonoSubjectHeuristics, false);
});

test('classifyImg2ImgSource still detects explicit multi-subject references as duo_group', () => {
  const result = classifyImg2ImgSource({
    prompt: 'goku et vegeta',
    draft: {
      title: 'Goku and Vegeta duo artwork',
      mode: 'web_reference_subject',
    },
    sourceMeta: {
      width: 1152,
      height: 2048,
      contentType: 'image/png',
    },
  });

  assert.equal(result.sceneKey, 'duo_group');
  assert.equal(result.sceneType, 'duo/groupe');
  assert.equal(result.disableMonoSubjectHeuristics, true);
});

test('classifyImg2ImgSource ignores stale scene metadata and noisy source urls for tall solo portraits', () => {
  const result = classifyImg2ImgSource({
    prompt: 'joker en pied, sujet unique, personnage seul',
    draft: {
      title: 'Joker full body character art',
      query: 'joker full body portrait',
      reason: 'keep the same single subject from the reference image',
      mode: 'source_scene_multi_subject',
      sourceUrl: 'https://images.example.com/group/poster/joker-reference.png',
      sourceDomain: 'group-posters.example.com',
      sceneType: 'duo/groupe',
    },
    sourceMeta: {
      width: 1206,
      height: 2622,
      contentType: 'image/png',
    },
  });

  assert.equal(result.sceneKey, 'solo_subject');
  assert.equal(result.sceneType, 'sujet solo');
  assert.equal(result.disableMonoSubjectHeuristics, false);
});

test('resolveImg2ImgStrength gives solo subjects more rewrite headroom than group scenes', () => {
  const solo = resolveImg2ImgStrength({
    scene: { sceneKey: 'solo_subject' },
    prompt: 'goku se transforme',
  });
  const group = resolveImg2ImgStrength({
    scene: { sceneKey: 'duo_group' },
    prompt: 'goku se transforme',
  });

  assert.ok(solo.strength > group.strength);
  assert.ok(solo.retryStrength > group.retryStrength);
  assert.equal(solo.mode, 'auto');
  assert.equal(solo.profile, 'balanced');
  assert.equal(solo.rationale, 'solo_subject_balanced_rewrite');
});

test('probeImg2ImgSource derives effective portrait bounds from a letterboxed square source', { skip: !sharp }, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-img2img-probe-'));
  const imagePath = path.join(tempRoot, 'letterboxed.png');

  try {
    const portrait = await sharp({
      create: {
        width: 480,
        height: 900,
        channels: 3,
        background: { r: 220, g: 180, b: 140 },
      },
    }).png().toBuffer();

    await sharp({
      create: {
        width: 1200,
        height: 1200,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([{ input: portrait, left: 360, top: 150 }])
      .png()
      .toFile(imagePath);

    const sourceMeta = await probeImg2ImgSource({ imagePath });
    const classified = classifyImg2ImgSource({
      prompt: 'portrait du meme personnage, sujet unique',
      draft: {
        mode: 'web-image-draft',
      },
      sourceMeta,
    });

    assert.equal(sourceMeta?.ok, true);
    assert.equal(sourceMeta?.width, 1200);
    assert.equal(sourceMeta?.height, 1200);
    assert.equal(sourceMeta?.trimApplied, true);
    assert.ok(Number(sourceMeta?.effectiveWidth || 0) < sourceMeta.width);
    assert.ok(Number(sourceMeta?.effectiveHeight || 0) < sourceMeta.height);
    assert.ok(Number(sourceMeta?.effectiveHeight || 0) > Number(sourceMeta?.effectiveWidth || 0));
    assert.equal(classified.sceneKey, 'solo_face');
    assert.equal(classified.canvasType, 'portrait');
    assert.ok(Number(classified.sourceRatio || 0) < 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('enrichImg2ImgDraft materializes a cropped init image for screenshot-like chat sources', { skip: !sharp }, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-img2img-screenshot-'));
  const imagePath = path.join(tempRoot, 'mobile-screenshot.png');
  let preparedImagePath = '';

  try {
    const centerPhoto = await sharp({
      create: {
        width: 900,
        height: 1100,
        channels: 3,
        background: { r: 170, g: 165, b: 155 },
      },
    }).png().toBuffer();

    await sharp({
      create: {
        width: 900,
        height: 1600,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        { input: centerPhoto, left: 0, top: 220 },
        {
          input: await sharp({
            create: {
              width: 120,
              height: 16,
              channels: 3,
              background: { r: 255, g: 255, b: 255 },
            },
          }).png().toBuffer(),
          left: 40,
          top: 40,
        },
        {
          input: await sharp({
            create: {
              width: 200,
              height: 18,
              channels: 3,
              background: { r: 255, g: 255, b: 255 },
            },
          }).png().toBuffer(),
          left: 350,
          top: 92,
        },
        {
          input: await sharp({
            create: {
              width: 260,
              height: 20,
              channels: 3,
              background: { r: 255, g: 255, b: 255 },
            },
          }).png().toBuffer(),
          left: 320,
          top: 1470,
        },
      ])
      .png()
      .toFile(imagePath);

    const sourceMeta = await probeImg2ImgSource({ imagePath });
    assert.equal(sourceMeta?.ok, true);
    assert.equal(sourceMeta?.edgeBandCropApplied, true);
    assert.ok(Number(sourceMeta?.effectiveHeight || 0) < Number(sourceMeta?.height || 0));

    const enriched = await enrichImg2ImgDraft({
      webImageDraft: {
        mode: 'uploaded_image',
        fromChatSourceImage: true,
        initImagePath: imagePath,
        width: 900,
        height: 1600,
      },
      mask: {
        raw: 'same person joker inspired portrait',
        meta: {},
        options: {},
      },
    });

    assert.equal(enriched?.sourcePreparedApplied, true);
    assert.equal(String(enriched?.sourceCropReason || ''), 'edge_band_crop');
    assert.notEqual(String(enriched?.initImagePath || ''), imagePath);
    assert.equal(fs.existsSync(String(enriched?.initImagePath || '')), true);
    preparedImagePath = String(enriched?.initImagePath || '');

    const croppedMeta = await sharp(String(enriched?.initImagePath || '')).metadata();
    assert.ok(Number(croppedMeta?.height || 0) < 1600);
  } finally {
    if (preparedImagePath && fs.existsSync(preparedImagePath)) {
      fs.unlinkSync(preparedImagePath);
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
