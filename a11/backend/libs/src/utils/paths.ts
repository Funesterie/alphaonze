import { existsSync } from "fs";
import { join } from "path";

// Map service names to npm package names and local folder candidates
export const SERVICE_MAP: Record<string, { pkg: string; candidates: string[] }> = {
  rome: { pkg: "@nossen/rome", candidates: ["./rome", "./Rome"] },
  nezlephant: { pkg: "@nossen/nezlephant", candidates: ["./nezlephant", "./Nezlephant"] },
  envaptex: { pkg: "@nossen/envaptex", candidates: ["./envaptex", "./Envaptex"] },
  freeland: { pkg: "@nossen/freeland", candidates: ["./freeland", "./Freeland"] },
  bat: { pkg: "@nossen/bat", candidates: ["./bat", "./BAT"] },
};

export function resolvePaths(detected: any = {}) {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(SERVICE_MAP)) {
    if (detected && detected[key] && detected[key].path) {
      out[key] = detected[key].path;
      continue;
    }
    const tries = SERVICE_MAP[key].candidates;
    for (const t of tries) {
      const p = join(process.cwd(), t);
      if (existsSync(p)) {
        out[key] = p;
        break;
      }
    }
  }
  return out;
}
