declare module '@nossen/spyder/decoders/secrets' {
  import type { SecretFinding } from '../types.js';
  export function scanFileForSecrets(path: string): Promise<SecretFinding[]>;
}
