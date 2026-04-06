import { spawn } from 'child_process';

export default async function runSafeRun(argv: string[] = []) {
  // parse options
  let timeoutSec = 10;
  let detach = false;
  const args: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--detach') {
      detach = true;
      continue;
    }
    if (a === '--timeout' && i < argv.length - 1) {
      const v = Number(argv[i + 1]);
      if (!Number.isNaN(v) && v > 0) timeoutSec = Math.max(1, Math.floor(v));
      i++;
      continue;
    }
    // collect remaining as command args
    args.push(a);
  }

  if (args.length === 0) {
    console.log('usage: qflush safe-run [--detach] [--timeout N] <qflush-subcommand> [args...]');
    console.log('example: qflush safe-run --detach start --service rome');
    return 1;
  }

  // Default behavior: run the built daemon CLI: node dist/index.js <args...>
  const node = process.execPath;
  const childArgs = ['dist/index.js', ...args];

  if (detach) {
    try {
      const c = spawn(node, childArgs, { detached: true, stdio: 'ignore' });
      c.unref();
      console.log(`qflush safe-run: started detached pid=${c.pid}`);
      return 0;
    } catch (e) {
      console.error('safe-run detach failed', e);
      return 2;
    }
  }

  // Not detached: run with watchdog timeout
  return await new Promise<number>((resolve) => {
    const child = spawn(node, childArgs, { stdio: 'inherit' as any });
    let finished = false;

    const onExit = (code: number | null) => {
      if (finished) return;
      finished = true;
      resolve(code === null ? 0 : code);
    };

    child.on('exit', onExit);
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      console.error('safe-run child error', err);
      resolve(3);
    });

    const timer = setTimeout(() => {
      if (finished) return;
      console.warn(`[safe-run] timeout ${timeoutSec}s reached — sending SIGINT to pid=${child.pid}`);
      try { child.kill('SIGINT'); } catch (err) { console.warn('[safe-run] SIGINT failed:', err); }

      // wait short then force kill
      setTimeout(() => {
        if (finished) return;
        console.warn(`[safe-run] still running — forcing kill pid=${child.pid}`);
        try { child.kill('SIGTERM'); } catch (err) {
          try { child.kill(); } catch (err2) { console.warn('[safe-run] SIGTERM/SIGKILL fallback failed:', err2); }
        }
      }, 2000);
    }, timeoutSec * 1000);

    // clear timer on finish
    (child as any).once && (child as any).once('exit', () => { clearTimeout(timer); });
  });
}
