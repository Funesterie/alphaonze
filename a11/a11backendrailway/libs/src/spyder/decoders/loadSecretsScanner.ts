import type { SecretScanner } from './types.js';
import { localSecretScanner } from './secrets-local.js';

export async function loadSecretScanner(): Promise<SecretScanner> {
  // Prefer local scanner shipped in this repo. If an external spyder package is installed,
  // attempt to load it at runtime but don't keep a static reference that TypeScript must resolve.
  try {
    // dynamic require via eval to avoid TypeScript resolving this module name at compile time
    // eslint-disable-next-line no-eval
    const maybe = eval("typeof require !== 'undefined' ? require('@funeste38/spyder/decoders/secrets') : undefined");
    if (maybe && typeof maybe.scanFileForSecrets === 'function') {
      return { scanFileForSecrets: (filePath: string, options?: any) => Promise.resolve(maybe.scanFileForSecrets(filePath, options)) } as SecretScanner;
    }
  } catch {
    // ignore any errors and fall back to local scanner
  }

  return localSecretScanner;
}
