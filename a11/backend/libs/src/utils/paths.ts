import { existsSync } from "fs";
import { join } from "path";

// Map service names to npm package names and local folder candidates
export const SERVICE_MAP: Record<string, { pkg: string; candidates: string[] }> = {
  rome: { pkg: "@funeste38/rome", candidates: ["./rome", "./Rome"] },
  nezlephant: { pkg: "@funeste38/nezlephant", candidates: ["./nezlephant", "./Nezlephant"] },
  envaptex: { pkg: "@funeste38/envaptex", candidates: ["./envaptex", "./Envaptex"] },
  freeland: { pkg: "@funeste38/freeland", candidates: ["./freeland", "./Freeland"] },
  bat: { pkg: "@funeste38/bat", candidates: ["./bat", "./BAT"] },
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
