declare module '@funeste38/spyder/decoders/secrets' {
  import type { SecretFinding } from '../types.js';
  export function scanFileForSecrets(path: string): Promise<SecretFinding[]>;
}
