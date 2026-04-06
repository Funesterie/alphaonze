/**
 * A11Host Bridge - Global accessor for VSIX integration
 * Call setA11HostBridge from WebView2 to initialize
 */

const { setA11HostBridge } = require('../a11host.cjs');

// Expose globally for WebView2 context
if (typeof globalThis !== 'undefined') {
  globalThis.setA11HostBridge = setA11HostBridge;
}

// Also expose via window if in browser context
if (typeof window !== 'undefined') {
  window.setA11HostBridge = setA11HostBridge;
}

module.exports = {
  setA11HostBridge
};
