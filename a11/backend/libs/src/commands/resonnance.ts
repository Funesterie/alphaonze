export default async function runResonnance() {
  // Prefer the in-repo CORTEX resonnance implementation when available
  try {
    // try import cortex resonnance helper
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cortexMod = require('../cortex/resonnance');
    if (cortexMod && typeof cortexMod.resonnance === 'function') {
      await cortexMod.resonnance();
      return 0;
    }
  } catch (e) {
    // ignore and fallback to daemon start
  }

  // Fallback: start compiled daemon if cortex path not available
  try {
    const port = process.env.QFLUSHD_PORT ? Number(process.env.QFLUSHD_PORT) : 4500;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const daemon = require('../../dist/daemon/qflushd');
    if (!daemon || typeof daemon.startServer !== 'function') {
      throw new Error('no resonnance implementation available');
    }
    await daemon.startServer(port);
    console.log('[resonnance] qflushd started on', port);
    return 0;
  } catch (e) {
    console.error('[resonnance] failed to start', e);
    throw e;
  }
}
