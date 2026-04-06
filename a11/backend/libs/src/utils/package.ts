import { join } from "path";
import { existsSync } from "fs";
import { readFileSync } from "fs";

export function resolvePackagePath(pkgName: string) {
  try {
    const resolved = require.resolve(pkgName);
    // walk up to package root
    let dir = resolved;
    while (dir && !existsSync(join(dir, "package.json"))) {
      const p = require("path").dirname(dir);
      if (p === dir) break;
      dir = p;
    }
    if (existsSync(join(dir, "package.json"))) return dir;
  } catch {}
  // fallback: node_modules path
  const guess = join(process.cwd(), "node_modules", pkgName);
  if (existsSync(join(guess, "package.json"))) return guess;
  return undefined;
}

export function readPackageJson(pkgPath: string) {
  try {
    const content = readFileSync(join(pkgPath, "package.json"), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
