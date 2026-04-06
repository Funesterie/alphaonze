import * as fs from 'fs';
import * as path from 'path';

// Remove dated subfolders named YYYY-MM older than keepMonths
export function cleanupDatedArchives(baseDir: string, keepMonths = 6) {
  try {
    if (!fs.existsSync(baseDir)) return;
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const now = new Date();
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      const m = /^([0-9]{4})-([0-9]{2})$/.exec(name);
      if (!m) continue;
      const year = Number(m[1]);
      const month = Number(m[2]);
      if (!year || !month) continue;
      const dirDate = new Date(year, month - 1, 1);
      const monthsDiff = (now.getFullYear() - dirDate.getFullYear()) * 12 + (now.getMonth() - dirDate.getMonth());
      if (monthsDiff > keepMonths) {
        // remove directory recursively
        try {
          fs.rmSync(path.join(baseDir, name), { recursive: true, force: true });
        } catch (e) {
          try {
            // fallback for older Node: use custom rm
            const rimraf = (p: string) => {
              if (!fs.existsSync(p)) return;
              for (const f of fs.readdirSync(p)) {
                const fp = path.join(p, f);
                const st = fs.statSync(fp);
                if (st.isDirectory()) rimraf(fp);
                else fs.unlinkSync(fp);
              }
              fs.rmdirSync(p);
            };
            rimraf(path.join(baseDir, name));
          } catch (e2) {}
        }
      }
    }
  } catch (e) {
    // ignore errors
  }
}

export default { cleanupDatedArchives };
