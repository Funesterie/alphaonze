/**
 * Frontend interaction test handler
 * Listens for test messages from VS and logs responses
 */

let vsBridge: any = null;
try {
  // Optional integration with VS bridge (may not exist in all environments)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vsBridge = require('../../../vsbridge-frontend');
} catch (e) {
  // not critical — fallback to CustomEvent listener below
  vsBridge = null;
}

let testResponseCount = 0;

/**
 * Setup listeners for interaction tests from VS
 */
export function setupInteractionTestListener(): void {
  console.log('[InteractionTest] 🔧 Setting up listeners for VS test messages');

  // Listener 1: Direct vsBridge callback
  if (vsBridge && typeof vsBridge.on === 'function') {
    vsBridge.on('testInteraction', (data: any) => {
      testResponseCount++;
      const message = data?.message || '(no message)';
      const response = `[Frontend Response #${testResponseCount}] Received: ${message}`;
      
      console.log(`[InteractionTest] 📨 ${response}`);
      console.log('[InteractionTest] Data received:', data);
      
      // Send confirmation back to VS
      vsBridge.sendToVS('testInteractionResponse', {
        count: testResponseCount,
        received: message,
        timestamp: new Date().toISOString(),
        fromFrontend: true
      });
      
      console.log(`[InteractionTest] ✅ Response #${testResponseCount} sent back to VS`);
    });
  }

  // Listener 2: Fallback CustomEvent listener (in case receiveFromVS is missing)
  window.addEventListener('a11-vs-message', (event: Event) => {
    const customEvent = event as CustomEvent<string>;
    const payload = customEvent.detail;
    
    testResponseCount++;
    console.log(`[InteractionTest] 🎤 CustomEvent received: ${payload}`);
    
    try {
      const parsed = JSON.parse(payload);
      const message = parsed?.data?.message || parsed?.message || '(no message)';
      const response = `[CustomEvent Response #${testResponseCount}] Received: ${message}`;
      
      console.log(`[InteractionTest] 📨 ${response}`);
      console.log('[InteractionTest] Parsed data:', parsed);
      
      // Send confirmation back to VS
      vsBridge.sendToVS('testInteractionResponse', {
        count: testResponseCount,
        received: message,
        timestamp: new Date().toISOString(),
        fromFrontend: true,
        viaCustomEvent: true
      });
      
      console.log(`[InteractionTest] ✅ CustomEvent Response #${testResponseCount} sent back to VS`);
    } catch (e) {
      console.error('[InteractionTest] ❌ Failed to parse CustomEvent payload:', e);
    }
  });

  console.log('[InteractionTest] ✅ Listeners ready - waiting for VS test messages (via receiveFromVS or CustomEvent)');
}

/**
 * Send a test message from frontend to VS (for testing bidirectional communication)
 */
export function sendTestToVS(testMessage: string = 'Hello from Frontend'): void {
  console.log(`[InteractionTest] 📤 Sending test message to VS: ${testMessage}`);
  vsBridge.sendToVS('testMessage', { message: testMessage });
}

/**
 * Get the count of test interactions received
 */
export function getTestInteractionCount(): number {
  return testResponseCount;
}
