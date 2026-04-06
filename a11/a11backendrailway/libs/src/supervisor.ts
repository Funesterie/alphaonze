// Re-export supervisor API implemented in src/supervisor/index.ts
export {
  startProcess,
  stopProcess,
  stopAll,
  clearState,
  listRunning
} from './supervisor/index.js';
