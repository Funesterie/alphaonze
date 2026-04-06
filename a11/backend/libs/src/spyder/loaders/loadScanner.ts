import type { SecretScanner } from '../types.js';
import { localSecretScanner } from '../core/scanner.js';

export async function loadSecretScanner(): Promise<SecretScanner> {
  try {
    const external = await import('@funeste38/spyder/decoders/secrets');
    if (external && typeof external.scanFileForSecrets === 'function') {
      return { scanFileForSecrets: external.scanFileForSecrets } as any;
    }
  } catch {
    // ignore
  }
  return localSecretScanner;
}
