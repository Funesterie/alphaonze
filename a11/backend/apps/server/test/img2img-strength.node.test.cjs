const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveImg2ImgStrengthPlan,
  resolveStrengthDirective,
} = require('../src/image/img2img-strength.cjs');

test('resolveStrengthDirective treats an omitted strength as auto by default', () => {
  const result = resolveStrengthDirective(undefined);

  assert.equal(result.mode, 'auto');
  assert.equal(result.numericValue, null);
});

test('resolveImg2ImgStrengthPlan maps explicit numeric strength to manual mode', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 0.41,
    prompt: 'zelda avec une couronne differente',
  });

  assert.equal(result.mode, 'manual');
  assert.equal(result.profile, 'manual');
  assert.equal(result.reason, 'explicit_numeric_strength');
  assert.equal(result.strength, 0.41);
  assert.equal(result.components?.identity?.strength, 0.41);
  assert.equal(result.components?.background?.strength, 0.41);
});

test('resolveImg2ImgStrengthPlan prefers preserve for direct reference preservation', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 'auto',
    prompt: 'princesse zelda portrait propre',
    scene: { sceneKey: 'solo_face' },
    initSourceMode: 'web_reference_subject',
    taskType: 'image_generate',
  });

  assert.equal(result.mode, 'auto');
  assert.equal(result.profile, 'preserve');
  assert.match(String(result.reason || ''), /preservation/i);
});

test('resolveImg2ImgStrengthPlan prefers restyle when the prompt asks for strong stylization', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 'auto',
    prompt: 'goku en reinterpretation forte, heavily stylized watercolor restyle',
    scene: { sceneKey: 'solo_subject' },
  });

  assert.equal(result.profile, 'restyle');
  assert.equal(result.reason, 'explicit_strong_stylization');
  assert.ok(result.strength >= 0.36);
});

test('resolveImg2ImgStrengthPlan uses motion_continuity for video frame-to-frame continuity', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 'auto',
    prompt: 'goku se transforme',
    taskType: 'video_frame_sequence',
    initSourceMode: 'previous_frame',
    motionProfile: 'transformation_rise',
    modelProfile: 'sd35large',
  });

  assert.equal(result.profile, 'motion_continuity');
  assert.equal(result.reason, 'video_frame_to_frame_continuity');
  assert.ok(result.strength >= 0.42);
  assert.ok(result.strength <= 0.62);
});

test('resolveImg2ImgStrengthPlan keeps room for scene rewrite on web subject bootstraps in video', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 'auto',
    prompt: 'Princesse Zelda marchant sur un sentier dans la foret',
    scene: { sceneKey: 'solo_subject' },
    taskType: 'video_reference_bootstrap',
    initSourceMode: 'web_reference_subject',
    motionProfile: 'walk_cycle',
  });

  assert.equal(result.profile, 'balanced');
  assert.equal(result.reason, 'video_subject_reference_scene_rewrite');
  assert.ok(result.strength >= 0.26);
});

test('resolveImg2ImgStrengthPlan increases preserve strength slightly for anime-style reference rewrites', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 'auto',
    prompt: 'style dragonball z, portrait photorealiste',
    scene: {},
    initSourceMode: 'init_image_url',
    taskType: 'image_generate',
    modelProfile: 'sd35large',
  });

  assert.equal(result.profile, 'preserve');
  assert.equal(result.reason, 'reference_source_preservation');
  assert.ok(result.strength >= 0.3);
});

test('resolveImg2ImgStrengthPlan keeps identity-locked reference scene rewrites in preserve mode', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 'auto',
    prompt: 'keep the same face and hairstyle, keep the same outfit, James Bond 007 style, equipped with a silenced pistol, 007 movie introduction decor',
    scene: { sceneKey: 'solo_face' },
    initSourceMode: 'uploaded_image',
    taskType: 'image_generate',
    modelProfile: 'sd35large',
  });

  assert.equal(result.profile, 'preserve');
  assert.equal(result.reason, 'reference_subject_identity_lock');
  assert.ok(result.strength >= 0.24);
  assert.ok(result.strength <= 0.26);
  assert.equal(result.components?.identity?.profile, 'preserve');
  assert.equal(result.components?.anatomy?.profile, 'preserve');
  assert.equal(result.components?.outfit?.profile, 'preserve');
  assert.equal(result.components?.background?.profile, 'restyle');
  assert.equal(result.components?.props?.profile, 'balanced');
  assert.ok(Number(result.components?.background?.strength || 0) > Number(result.components?.identity?.strength || 0));
  assert.ok(Number(result.components?.props?.strength || 0) > Number(result.components?.identity?.strength || 0));
});

test('resolveImg2ImgStrengthPlan treats recognizable-face reference prompts as identity-locked photo transformations', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 'auto',
    prompt: 'maintain the recognizable face, the same facial structure, the same body type, and the overall identity from the reference image while changing the costume and background',
    scene: { sceneKey: 'solo_subject' },
    initSourceMode: 'uploaded_image',
    taskType: 'image_generate',
    modelProfile: 'sd35large',
  });

  assert.equal(result.profile, 'preserve');
  assert.equal(result.reason, 'reference_subject_identity_lock');
  assert.ok(result.strength >= 0.25);
  assert.ok(result.strength <= 0.27);
  assert.equal(result.components?.identity?.profile, 'preserve');
  assert.equal(result.components?.background?.profile, 'restyle');
});

test('resolveImg2ImgStrengthPlan keeps exact-lock Joker reference transforms in preserve mode', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 'auto',
    prompt: 'the exact same person from the reference image in a Joker-style transformation, keep exactly the same face and identity, custom bat clearly visible, Harlem-inspired street',
    scene: { sceneKey: 'solo_subject' },
    initSourceMode: 'uploaded_image',
    taskType: 'image_generate',
    modelProfile: 'sd35large',
  });

  assert.equal(result.profile, 'preserve');
  assert.equal(result.reason, 'reference_subject_exact_lock');
  assert.ok(result.strength >= 0.23);
  assert.ok(result.strength <= 0.25);
  assert.equal(result.components?.identity?.profile, 'preserve');
  assert.equal(result.components?.anatomy?.profile, 'preserve');
  assert.equal(result.components?.background?.profile, 'restyle');
});

test('resolveImg2ImgStrengthPlan keeps softer Joker reference transforms in balanced mode when exact-lock wording is absent', () => {
  const result = resolveImg2ImgStrengthPlan({
    explicitStrength: 'auto',
    prompt: 'the same person from the reference image in a Joker-style transformation, keep the recognizable face, custom bat clearly visible, Harlem-inspired street',
    scene: { sceneKey: 'solo_subject' },
    initSourceMode: 'uploaded_image',
    taskType: 'image_generate',
    modelProfile: 'sd35large',
  });

  assert.equal(result.profile, 'balanced');
  assert.equal(result.reason, 'reference_subject_joker_transformation');
  assert.ok(result.strength >= 0.48);
  assert.ok(result.strength <= 0.5);
  assert.equal(result.components?.identity?.profile, 'preserve');
  assert.equal(result.components?.background?.profile, 'restyle');
});
