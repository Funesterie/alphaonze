export interface SecretFinding {
  file: string;
  line: number;
  rule: string;
  match: string;
  severity: 'low' | 'medium' | 'high';
}

export interface SecretScanOptions {
  maxFileSizeBytes?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface SecretScanner {
  scanFileForSecrets(filePath: string, options?: SecretScanOptions): Promise<SecretFinding[]>;
}
