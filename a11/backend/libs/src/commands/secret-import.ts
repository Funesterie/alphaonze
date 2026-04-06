import { spawnSync } from 'child_process';
import * as path from 'path';

export default async function runSecretImport(argv: string[] = []) {
  // usage: qflush secret import [--env <path>] [--no-acl]
  let envPath: string | undefined;
  let restrictAcl = true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--env' || a === '-e') && i < argv.length - 1) {
      envPath = argv[i + 1];
      i++;
      continue;
    }
    if (a === '--no-acl') {
      restrictAcl = false;
      continue;
    }
  }

  // default envPath to Desktop .env
  if (!envPath) {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    envPath = path.join(home, 'Desktop', '.env');
  }

  const script = path.join(process.cwd(), 'scripts', 'import-env-to-secrets.ps1');
  const pwsh = process.env.PWSH || 'pwsh';

  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-EnvPath', envPath];
  if (restrictAcl) args.push('-RestrictFileAcl');

  console.log('Running import script:', pwsh, args.join(' '));

  const res = spawnSync(pwsh, args, { stdio: 'inherit' });
  if (res.error) {
    console.error('Failed to execute import script:', res.error);
    return 2;
  }
  return res.status ?? 0;
}
