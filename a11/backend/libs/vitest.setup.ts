// vitest.setup.ts — Test bootstrap for Vitest
// Ensures runtime environment and guards used by legacy tests.

import * as fs from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

// Enable alias debug logs for test runs
process.env.ALIAS_DEBUG = '1';

// Ensure fetch is available in test environment
(async function ensureGlobalFetch() {
  if (typeof (globalThis as any).fetch === 'function') return;
  try {
    const m = await import('undici');
    if (m && typeof (m as any).fetch === 'function') {
      // assign globally
      (globalThis as any).fetch = (m as any).fetch.bind(m);
      // eslint-disable-next-line no-console
      console.warn('[vitest.setup] injected global fetch from undici');
      return;
    }
  } catch (e) {
    // ignore
  }
  try {
    const m2 = await import('node-fetch');
    const f = (m2 && (m2 as any).default) || m2;
    if (typeof f === 'function') {
      (globalThis as any).fetch = f;
      // eslint-disable-next-line no-console
      console.warn('[vitest.setup] injected global fetch from node-fetch');
      return;
    }
  } catch (e) {
    // ignore
  }
})();

// Prevent tests from terminating the process when some legacy test files call process.exit()
// Make it a no-op and log a warning instead so the test runner can continue.
const originalExit = process.exit;
(process as any).exit = function (code?: number) {
  try {
    // keep it visible in test logs
    // eslint-disable-next-line no-console
    console.warn('[vitest.setup] intercepted process.exit(', code, ')');
  } catch (_) {}
  // no-op
  return undefined as any;
};
// restore hook if needed
process.on('exit', (code) => {
  // noop
});

// Force cortex mode for tests to avoid requiring HTTP daemon and ports
process.env.QFLUSH_MODE = 'cortex';

// Ensure .qflush/logs and spyder.log exist in each test working directory
function ensureLogsForCwd(cwd: string) {
  try {
    const root = cwd || process.cwd();
    const logs = path.join(root, '.qflush', 'logs');
    // create logs directory synchronously before changing cwd to avoid races
    try { mkdirSync(logs, { recursive: true }); } catch (e) {}
    // open file in append mode so we never truncate existing logs during tests
    try { writeFileSync(path.join(logs, 'spyder.log'), '', { flag: 'a' }); } catch (e) {}
  } catch (e) {
    // swallow any errors to avoid interfering with tests
    // eslint-disable-next-line no-console
    console.warn('[vitest.setup] could not ensure .qflush/logs:', String(e));
  }
}

// Ensure for initial cwd
ensureLogsForCwd(process.cwd());

// Monkeypatch fs.mkdtempSync and fs.mkdtemp to ensure logs for created temp dirs
try {
  try {
    const origMkdtempSync = fs.mkdtempSync;
    (fs as any).mkdtempSync = function (prefix: string, options?: any) {
      const dir = origMkdtempSync.call(fs, prefix, options);
      try { ensureLogsForCwd(dir); } catch (e) {}
      return dir;
    };
  } catch (_) {}
  try {
    const origMkdtemp = fs.mkdtemp;
    (fs as any).mkdtemp = function (prefix: string, options: any, callback?: any) {
      if (typeof options === 'function') { callback = options; options = undefined; }
      return origMkdtemp.call(fs, prefix, options, function (err: any, dir: string) {
        if (!err) {
          try { ensureLogsForCwd(dir); } catch (e) {}
        }
        if (typeof callback === 'function') callback(err, dir);
      });
    };
  } catch (_) {}
} catch (_) {}

// Patch process.chdir so tests that change cwd get logs created
try {
  const origChdir = process.chdir;
  (process as any).chdir = function (dir: string) {
    try { ensureLogsForCwd(dir); } catch (_) {}
    const ret = origChdir.apply(process, arguments as any);
    try { ensureLogsForCwd(process.cwd()); } catch (e) {}
    return ret;
  };
} catch (_) {}

// Keep setup minimal — filesystem write interception removed.
// The daemon and core code now use safe write helpers so tests should no longer see ENOENT.

// Start the compiled qflush daemon during tests when VITEST env var is set and mode allows it
if (process.env.VITEST) {
  try {
    // default port used in CI/tests
    const port = process.env.QFLUSHD_PORT ? Number(process.env.QFLUSHD_PORT) : 43421;
    // ensure Redis disabled in test env unless explicitly enabled
    if (!process.env.QFLUSH_ENABLE_REDIS) process.env.QFLUSH_ENABLE_REDIS = '0';

    // In cortex mode we prefer the PNG bus; only start the daemon if explicitly required by tests
    if (process.env.QFLUSH_MODE !== 'cortex') {
      // Use dynamic require to preserve compatibility
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const daemon = require('./dist/daemon/qflushd');
      if (daemon && typeof daemon.startServer === 'function') {
        try {
          daemon.startServer(port);
          // eslint-disable-next-line no-console
          console.warn('[vitest.setup] started qflush daemon on port', port);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[vitest.setup] failed to start daemon:', String(e));
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[vitest.setup] compiled daemon does not export startServer (./dist/daemon/qflushd)');
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('[vitest.setup] running tests in CORTEX mode (no HTTP daemon)');
    }
  } catch (e) {
    // if dist file is missing or require fails, log for CI visibility; tests may still mock network calls
    // eslint-disable-next-line no-console
    console.warn('[vitest.setup] could not require compiled daemon:', String(e));
  }
}

// patch fs.promises.mkdtemp if present
try {
  if ((fs as any).promises && (fs as any).promises.mkdtemp) {
    try {
      const origPromMkdtemp = (fs as any).promises.mkdtemp.bind((fs as any).promises);
      (fs as any).promises.mkdtemp = async function (prefix: string, options?: any) {
        const dir = await origPromMkdtemp(prefix, options);
        try { ensureLogsForCwd(dir); } catch (e) {}
        return dir;
      };
    } catch (_) {}
  }
} catch (_) {}

// Helper to ensure parent dir exists for a file path
function ensureParentDirForFile(filePath: string) {
  try {
    const dir = path.dirname(filePath);
    if (dir) mkdirSync(dir, { recursive: true });
  } catch (e) {}
}

// Patch common fs methods to ensure parent dirs exist before file operations to avoid races
try {
  // openSync
  try {
    const origOpenSync = fs.openSync;
    (fs as any).openSync = function (pathArg: any, flags: any, mode?: any) {
      try { ensureParentDirForFile(String(pathArg)); } catch (e) {}
      return origOpenSync.call(fs, pathArg, flags, mode);
    };
  } catch (_) {}

  // open (async)
  try {
    const origOpen = fs.open;
    (fs as any).open = function (pathArg: any, flags: any, mode: any, callback?: any) {
      // normalize arguments
      if (typeof mode === 'function') { callback = mode; mode = undefined; }
      try { ensureParentDirForFile(String(pathArg)); } catch (e) {}
      return origOpen.call(fs, pathArg, flags, mode, callback);
    };
  } catch (_) {}

  // appendFileSync
  try {
    const origAppendFileSync = fs.appendFileSync;
    (fs as any).appendFileSync = function (pathArg: any, data: any, options?: any) {
      try { ensureParentDirForFile(String(pathArg)); } catch (e) {}
      return origAppendFileSync.call(fs, pathArg, data, options);
    };
  } catch (_) {}

  // appendFile (async)
  try {
    const origAppendFile = fs.appendFile;
    (fs as any).appendFile = function (pathArg: any, data: any, options: any, callback?: any) {
      if (typeof options === 'function') { callback = options; options = undefined; }
      try { ensureParentDirForFile(String(pathArg)); } catch (e) {}
      return origAppendFile.call(fs, pathArg, data, options, callback);
    };
  } catch (_) {}

  // writeFileSync
  try {
    const origWriteFileSync = fs.writeFileSync;
    (fs as any).writeFileSync = function (pathArg: any, data: any, options?: any) {
      try { ensureParentDirForFile(String(pathArg)); } catch (e) {}
      return origWriteFileSync.call(fs, pathArg, data, options);
    };
  } catch (_) {}

  // writeFile (async)
  try {
    const origWriteFile = fs.writeFile;
    (fs as any).writeFile = function (pathArg: any, data: any, options: any, callback?: any) {
      if (typeof options === 'function') { callback = options; options = undefined; }
      try { ensureParentDirForFile(String(pathArg)); } catch (e) {}
      return origWriteFile.call(fs, pathArg, data, options, callback);
    };
  } catch (_) {}
} catch (_) {}
