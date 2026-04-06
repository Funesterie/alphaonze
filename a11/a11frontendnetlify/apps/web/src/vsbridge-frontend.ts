// A11 Visual Studio Extension Bridge
// Communication bidirectionnelle entre React et Visual Studio

interface VSMessage {
  type: string;
  data: any;
}

class VSBridge {
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  private isConnected: boolean = false;

  constructor() {
    // Make receiveFromVS available globally for C# to call
    (window as any).receiveFromVS = this.receiveFromVS.bind(this);
    
    // Check connection
    this.isConnected = !!(window as any).chrome?.webview;
    console.log('[VSBridge] Initialized, connected:', this.isConnected);
    
    if (this.isConnected) {
      console.log('[VSBridge] WebView2 detected, bridge is active');

      // Listen to messages coming from host via PostWebMessageAsString/Json
      try {
        (window as any).chrome.webview.addEventListener('message', (event: any) => {
          try {
            console.log('[VSBridge] Host → Page message (raw):', event?.data);
            let payload = event?.data;
            if (typeof payload === 'string') {
              try { payload = JSON.parse(payload); } catch {}
            }
            this.receiveFromVS(payload);
          } catch (e) {
            console.warn('[VSBridge] Failed to handle host message:', e);
          }
        });
        console.log('[VSBridge] Host message listener attached');
      } catch (err) {
        console.warn('[VSBridge] Failed to attach host message listener:', err);
      }
    } else {
      console.warn('[VSBridge] Not running in WebView2, standalone mode');
    }
    
    // Make bridge globally accessible for debugging
    (window as any).vsBridge = this;
  }

  /**
   * Send a message to Visual Studio C# code
   */
  sendToVS(type: string, data: any) {
    const message: VSMessage = { type, data };
    
    console.log('[VSBridge] Sending to VS:', message);
    
    if ((window as any).chrome?.webview) {
      try {
        (window as any).chrome.webview.postMessage(JSON.stringify(message));
        console.log('[VSBridge] ✅ Message sent successfully');
      } catch (error) {
        console.error('[VSBridge] ❌ Error sending message:', error);
      }
    } else {
      console.warn('[VSBridge] ⚠️  VS Bridge not available. Message:', message);
    }
  }

  /**
   * Receive a message from Visual Studio C# code
   */
  private receiveFromVS(message: VSMessage | string) {
    console.log('[VSBridge] Received from VS (raw):', message);
    
    // Handle string or object
    const msg: VSMessage = typeof message === 'string' ? JSON.parse(message) : message;
    
    console.log('[VSBridge] Parsed message:', msg);
    
    const handler = this.messageHandlers.get(msg.type);
    if (handler) {
      console.log(`[VSBridge] ✅ Handler found for type: ${msg.type}, executing...`);
      try {
        handler(msg.data);
        console.log(`[VSBridge] ✅ Handler executed successfully`);
      } catch (error) {
        console.error(`[VSBridge] ❌ Handler error:`, error);
      }
    } else {
      console.warn('[VSBridge] ⚠️  No handler registered for type:', msg.type);
      console.warn('[VSBridge] Available handlers:', Array.from(this.messageHandlers.keys()));
    }
  }

  /**
   * Register a handler for messages from VS
   */
  on(type: string, handler: (data: any) => void) {
    console.log(`[VSBridge] Registering handler for type: ${type}`);
    this.messageHandlers.set(type, handler);
  }

  /**
   * Remove a handler
   */
  off(type: string) {
    this.messageHandlers.delete(type);
    console.log(`[VSBridge] Removed handler for type: ${type}`);
  }

  /**
   * Send a chat message to A11 backend via VS
   */
  sendMessage(message: string) {
    console.log('[VSBridge] sendMessage called with:', message);
    this.sendToVS('sendMessage', { message });
  }

  /**
   * Request settings from VS
   */
  getSettings() {
    console.log('[VSBridge] getSettings called');
    this.sendToVS('getSettings', {});
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

// Export singleton instance
export const vsBridge = new VSBridge();

console.log('[VSBridge] Module loaded, instance exported');
