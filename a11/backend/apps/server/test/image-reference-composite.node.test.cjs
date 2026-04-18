const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildImageReferenceComposite,
  shouldBuildImageReferenceComposite,
} = require('../src/knowledge/image-reference-composite.cjs');

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

test('shouldBuildImageReferenceComposite requires a multi-part reference pack', () => {
  assert.equal(shouldBuildImageReferenceComposite({
    mask: { intent: 'image.generate' },
    referencePack: {
      references: [{ role: 'subject', imageUrl: 'https://images.example.com/a.png' }],
    },
  }), false);
});

test('buildImageReferenceComposite creates a local init image from subject and accessory references', async (t) => {
  if (!sharp) {
    t.skip('sharp_unavailable');
    return;
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'a11-refcomp-'));
  const subjectPath = path.join(tempDir, 'subject.png');
  const hatPath = path.join(tempDir, 'hat.png');

  await sharp({
    create: {
      width: 640,
      height: 960,
      channels: 4,
      background: { r: 30, g: 120, b: 220, alpha: 1 },
    },
  }).png().toFile(subjectPath);
  await sharp({
    create: {
      width: 420,
      height: 280,
      channels: 4,
      background: { r: 220, g: 180, b: 40, alpha: 1 },
    },
  }).png().toFile(hatPath);

  const result = await buildImageReferenceComposite({
    mask: {
      intent: 'image.generate',
      raw: 'genere une image de luffy avec un grand sombrero mexicain',
    },
    referencePack: {
      references: [
        {
          role: 'subject',
          label: 'Luffy',
          imageUrl: subjectPath,
          width: 640,
          height: 960,
        },
        {
          role: 'accessory',
          label: 'grand sombrero mexicain',
          placement: 'head',
          imageUrl: hatPath,
          width: 420,
          height: 280,
        },
      ],
    },
    outDir: tempDir,
  });

  assert.equal(result?.mode, 'web-reference-composite');
  assert.equal(result?.reason, 'reference_pack_composite');
  assert.ok(fs.existsSync(result?.initImagePath));
  assert.ok(result?.width >= 640);
  assert.ok(result?.height >= 960);
});
