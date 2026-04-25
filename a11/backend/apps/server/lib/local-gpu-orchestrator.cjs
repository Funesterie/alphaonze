let tail = Promise.resolve();

function runExclusiveLocalGpuTask(_label, task) {
  const work = typeof task === 'function' ? task : async () => task;
  const next = tail.then(() => work());
  tail = next.catch(() => {});
  return next;
}

function resetLocalGpuOrchestratorForTests() {
  tail = Promise.resolve();
}

module.exports = {
  runExclusiveLocalGpuTask,
  resetLocalGpuOrchestratorForTests,
};
