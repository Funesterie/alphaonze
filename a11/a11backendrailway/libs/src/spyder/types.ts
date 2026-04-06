export interface SecretFinding {
  file: string;
  line: number;
  rule: string;
  match: string;
  severity: 'low' | 'medium' | 'high';
}

export interface SecretScanner {
  scanFileForSecrets(path: string): Promise<SecretFinding[]>;
}
