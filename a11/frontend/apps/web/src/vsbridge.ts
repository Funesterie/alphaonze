// A11 Visual Studio Extension Bridge
// Place this file in your Vite frontend project (e.g., src/vsbridge.ts)

interface VSMessage {
  type: string;
  data: any;
}

class VSBridge {
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor() {
    // Make receiveFromVS available globally for C# to call
    (window as any).receiveFromVS = this.receiveFromVS.bind(this);
  }

  /**
   * Send a message to Visual Studio C# code
   */
  sendToVS(type: string, data: any) {
    const message: VSMessage = { type, data };
    
    if ((window as any).chrome?.webview) {
      // WebView2 communication
      (window as any).chrome.webview.postMessage(JSON.stringify(message));
    } else {
      console.warn('VS Bridge not available. Message:', message);
    }
  }

  /**
   * Receive a message from Visual Studio C# code
   */
  private receiveFromVS(message: VSMessage) {
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message.data);
    } else {
      console.warn('No handler for VS message type:', message.type);
    }
  }

  /**
   * Register a handler for messages from VS
   */
  on(type: string, handler: (data: any) => void) {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Send a chat message to A11 backend via VS
   */
  sendMessage(message: string) {
    this.sendToVS('sendMessage', { message });
  }

  /**
   * Request settings from VS
   */
  getSettings() {
    this.sendToVS('getSettings', {});
  }
}

// Export singleton instance
export const vsBridge = new VSBridge();

// Example usage in your frontend:
//
// import { vsBridge } from './vsbridge';
//
// // Listen for responses from backend
// vsBridge.on('messageResponse', (data) => {
//   console.log('Response from A11:', data.response);
//   // Update your UI with the response
// });
//
// vsBridge.on('error', (data) => {
//   console.error('Error from VS:', data.message);
// });
//
// vsBridge.on('settings', (data) => {
//   console.log('A11 endpoint:', data.endpoint);
// });
//
// // Send a message to A11
// vsBridge.sendMessage('Hello A11!');
//
// // Get settings
// vsBridge.getSettings();
