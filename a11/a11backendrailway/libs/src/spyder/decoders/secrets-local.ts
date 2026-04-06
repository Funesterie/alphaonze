import * as fs from 'fs/promises';
import * as path from 'path';
import { SecretFinding, SecretScanOptions, SecretScanner } from './types.js';

const DEFAULT_MAX_SIZE = 1024 * 1024; // 1 MB

const RULES: { rule: string; pattern: RegExp; severity: SecretFinding['severity'] }[] = [
  {
    rule: 'possible_api_key',
    pattern: /(api[_-]?key|token|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
    severity: 'high',
  },
  {
    rule: 'aws_access_key',
    pattern: /AKIA[0-9A-Z]{16}/,
    severity: 'high',
  },
  {
    rule: 'private_key_block',
    pattern: /-----BEGIN (RSA )?PRIVATE KEY-----/,
    severity: 'high',
  },
];

export const localSecretScanner: SecretScanner = {
  async scanFileForSecrets(filePath: string, options?: SecretScanOptions) {
    const maxSize = options?.maxFileSizeBytes ?? DEFAULT_MAX_SIZE;

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return [];
    }

    if (!stat.isFile() || stat.size > maxSize) {
      return [];
    }

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      return [];
    }

    const findings: SecretFinding[] = [];
    const lines = content.split(/\r?\n/);

    lines.forEach((line, idx) => {
      for (const rule of RULES) {
        const m = rule.pattern.exec(line);
        if (m) {
          findings.push({
            file: path.resolve(filePath),
            line: idx + 1,
            rule: rule.rule,
            match: (m[0] || '').slice(0, 200),
            severity: rule.severity,
          });
        }
      }
    });

    return findings;
  },
};
