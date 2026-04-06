import { exec } from "child_process";
import { logger } from "./logger.js";
import { SERVICE_MAP } from "./paths.js";
import { resolvePackagePath } from "./package.js";

export async function detectModules() {
  const out: Record<string, any> = {};
  for (const name of Object.keys(SERVICE_MAP))
    out[name] = { running: false, installed: false, path: undefined, bin: undefined };

  for (const name of Object.keys(SERVICE_MAP)) {
    try {
      const pkgPath = resolvePackagePath(SERVICE_MAP[name].pkg);
      if (pkgPath) {
        out[name].installed = true;
        out[name].path = pkgPath;
        try {
          const pkgJson = require(require('path').join(pkgPath, 'package.json'));
          if (pkgJson && pkgJson.bin) {
            out[name].bin = typeof pkgJson.bin === 'string' ? pkgJson.bin : Object.values(pkgJson.bin)[0];
          }
        } catch {}
      }
    } catch {}
  }

  await new Promise<void>((resolve) => {
    exec(process.platform === "win32" ? "tasklist" : "ps aux", (err, stdout) => {
      if (err) {
        logger.warn(`Failed to list processes: ${err.message}`);
        return resolve();
      }
      const s = stdout.toString();
      for (const name of Object.keys(SERVICE_MAP)) {
        const regex = new RegExp(name, "i");
        if (regex.test(s)) {
          out[name].running = true;
        }
      }
      resolve();
    });
  });
  return out;
}

export async function findAndKill() {
  const names = Object.keys(SERVICE_MAP);
  const killed: number[] = [];
  for (const n of names) {
    try {
      if (process.platform === "win32") {
        exec(`taskkill /IM ${n}.exe /F`, (err) => {});
      } else {
        exec(`pkill -f ${n}`, (err) => {});
      }
    } catch (err) {
      // ignore
    }
  }
  return killed;
}
