const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeVideoRequest } = require('../src/video/video-generate-runtime.cjs');

test('normalizeVideoRequest allows per-request sequence planner overrides', () => {
  const previousEnv = {
    A11_VIDEO_SEQUENCE_PLANNER: process.env.A11_VIDEO_SEQUENCE_PLANNER,
    A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE: process.env.A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE,
    A11_VIDEO_SEQUENCE_PLANNER_TIMEOUT_MS: process.env.A11_VIDEO_SEQUENCE_PLANNER_TIMEOUT_MS,
  };

  process.env.A11_VIDEO_SEQUENCE_PLANNER = 'heuristic';
  process.env.A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE = 'true';
  process.env.A11_VIDEO_SEQUENCE_PLANNER_TIMEOUT_MS = '20000';

  try {
    const request = normalizeVideoRequest({
      prompt: 'genere une video de mario',
      sequencePlanner: 'janus',
      sequencePlannerImageAware: 'false',
      sequencePlannerTimeoutMs: 120000,
    });

    assert.equal(request.config.sequencePlanner, 'janus');
    assert.equal(request.config.sequencePlannerImageAware, false);
    assert.equal(request.config.sequencePlannerTimeoutMs, 120000);
  } finally {
    if (previousEnv.A11_VIDEO_SEQUENCE_PLANNER === undefined) delete process.env.A11_VIDEO_SEQUENCE_PLANNER;
    else process.env.A11_VIDEO_SEQUENCE_PLANNER = previousEnv.A11_VIDEO_SEQUENCE_PLANNER;
    if (previousEnv.A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE === undefined) delete process.env.A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE;
    else process.env.A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE = previousEnv.A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE;
    if (previousEnv.A11_VIDEO_SEQUENCE_PLANNER_TIMEOUT_MS === undefined) delete process.env.A11_VIDEO_SEQUENCE_PLANNER_TIMEOUT_MS;
    else process.env.A11_VIDEO_SEQUENCE_PLANNER_TIMEOUT_MS = previousEnv.A11_VIDEO_SEQUENCE_PLANNER_TIMEOUT_MS;
  }
});
