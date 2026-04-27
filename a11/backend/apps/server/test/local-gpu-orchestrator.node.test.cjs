const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runExclusiveLocalGpuTask,
  resetLocalGpuOrchestratorForTests,
} = require('../lib/local-gpu-orchestrator.cjs');

test('runExclusiveLocalGpuTask serializes GPU jobs in submission order', async () => {
  resetLocalGpuOrchestratorForTests();
  const timeline = [];

  const first = runExclusiveLocalGpuTask('janus:vision', async () => {
    timeline.push('first:start');
    await new Promise((resolve) => setTimeout(resolve, 30));
    timeline.push('first:end');
    return 'first-result';
  });

  const second = runExclusiveLocalGpuTask('sd:render', async () => {
    timeline.push('second:start');
    await new Promise((resolve) => setTimeout(resolve, 5));
    timeline.push('second:end');
    return 'second-result';
  });

  const results = await Promise.all([first, second]);

  assert.deepEqual(results, ['first-result', 'second-result']);
  assert.deepEqual(timeline, [
    'first:start',
    'first:end',
    'second:start',
    'second:end',
  ]);
});
