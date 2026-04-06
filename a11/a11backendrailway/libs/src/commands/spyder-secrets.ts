import * as path from 'path';
import { loadSecretScanner } from '../spyder/decoders/loadSecretsScanner.js';

type SecretFinding = {
  file: string;
  line: number;
  rule: string;
  match: string;
  severity: 'low' | 'medium' | 'high';
};

export async function spyderSecretsCommand(dumpPath?: string): Promise<number> {
  const file = dumpPath ?? path.join(process.cwd(), 'parts', 'qflush-code-dump.txt');

  try {
    const scanner = await loadSecretScanner();

    if (!scanner || typeof scanner.scanFileForSecrets !== 'function') {
      console.log('[SPYDER] No scanner available, skipping');
      return 0;
    }

    const findings: SecretFinding[] = await scanner.scanFileForSecrets(file as any);

    if (!findings || findings.length === 0) {
      console.log('[SPYDER] Aucun secret détecté ✅');
      return 0;
    }

    console.log(`[SPYDER] ${findings.length} secrets potentiels trouvés :`);
    for (const f of findings) {
      console.log(
        `  - ${f.file}:${f.line} [${f.severity}] ${f.rule} → ${f.match.slice(0, 80)}`
      );
    }

    return 0;
  } catch (e) {
    console.error('[SPYDER] Erreur pendant le scan :', String(e));
    return 1;
  }
}

// allow running directly
if (typeof require !== 'undefined' && require.main === module) {
  const arg = process.argv[2];
  spyderSecretsCommand(arg).then((code) => process.exit(code));
}