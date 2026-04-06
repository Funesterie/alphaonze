// Compatibility shim: components import "./vsbridge" but actual implementation is in src/vsbridge-frontend.ts
// Re-export everything so the import resolves correctly.
import { vsBridge as vsBridgeInstance } from "../vsbridge-frontend";

export const vsBridge = vsBridgeInstance;
export { vsBridgeInstance as default };
