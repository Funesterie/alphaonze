import * as fs from 'fs';

export type SecretOpts = {
  fileEnv?: string; // env var that points to a file containing the secret
  required?: boolean; // throw if not found
  cliAlias?: string; // --alias=value
};

export function getSecret(name: string, opts?: SecretOpts): string | undefined {
  // 1) CLI arg form --name=value or --alias=value
  const alias = opts?.cliAlias || name.toLowerCase();
  const cliExact = process.argv.find((a) => a === `--${alias}`);
  if (cliExact) {
    // next arg is the value
    const idx = process.argv.indexOf(cliExact);
    if (idx >= 0 && idx < process.argv.length - 1) return process.argv[idx + 1];
  }
  const cli = process.argv.find((a) => a.startsWith(`--${alias}=`));
  if (cli) return cli.split('=')[1];

  // 2) environment variables (exact name or upper-case)
  if (process.env[name]) return process.env[name];
  const up = name.toUpperCase();
  if (process.env[up]) return process.env[up];
  const low = name.toLowerCase();
  if (process.env[low]) return process.env[low];

  // 3) file referenced by env var
  if (opts && opts.fileEnv) {
    const p = process.env[opts.fileEnv];
    if (p && typeof p === 'string' && fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, 'utf8').trim();
      } catch (e) {
        // ignore read errors
      }
    }
  }

  if (opts && opts.required) throw new Error(`${name} required but not provided`);
  return undefined;
}
