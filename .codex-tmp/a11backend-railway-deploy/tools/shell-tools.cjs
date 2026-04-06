const child_process = require('child_process');

function shell_exec(args) {
  const cmd = args.command;
  const cwd = args.cwd || process.cwd();
  if (!cmd) throw new Error('shell_exec: missing command');
  try {
    const out = child_process.execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return { ok: true, command: cmd, output: out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { shell_exec };