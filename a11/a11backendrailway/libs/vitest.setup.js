// Prevent tests from terminating the process when some legacy test files call process.exit()
// Make it a no-op and log a warning instead so the test runner can continue.
const originalExit = process.exit;
process.exit = function(code) {
  try {
    console.warn('[vitest.setup] intercepted process.exit(', code, ')');
  } catch (_) {}
  return undefined;
};
// restore hook if needed
process.on('exit', (code) => {
  // noop
});

// Force cortex mode for tests to avoid requiring HTTP daemon and ports
process.env.QFLUSH_MODE = 'cortex';

// Start the compiled qflush daemon during tests when VITEST env var is set and mode allows it
if (process.env.VITEST) {
  try {
    // default port used in CI/tests
    const port = process.env.QFLUSHD_PORT ? Number(process.env.QFLUSHD_PORT) : 43421;
    // ensure Redis disabled in test env unless explicitly enabled
    if (!process.env.QFLUSH_ENABLE_REDIS) process.env.QFLUSH_ENABLE_REDIS = '0';

    // In cortex mode we prefer the PNG bus; only start the daemon if explicitly required by tests
    if (process.env.QFLUSH_MODE !== 'cortex') {
      const daemon = require('./dist/daemon/qflushd');
      if (daemon && typeof daemon.startServer === 'function') {
        // only start if not already running
        try {
          daemon.startServer(port);
          console.warn('[vitest.setup] started qflush daemon on port', port);
        } catch (e) {
          console.warn('[vitest.setup] failed to start daemon:', String(e));
        }
      } else {
        console.warn('[vitest.setup] compiled daemon does not export startServer (./dist/daemon/qflushd)');
      }
    } else {
      console.warn('[vitest.setup] running tests in CORTEX mode (no HTTP daemon)');
    }
  } catch (e) {
    // if dist file is missing or require fails, log for CI visibility; tests may still mock network calls
    console.warn('[vitest.setup] could not require compiled daemon:', String(e));
  }
}
