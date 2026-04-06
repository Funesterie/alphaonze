import { randomBytes } from "crypto";

export function generateToken(len = 24) {
  return randomBytes(len).toString("hex");
}

export function resolveTokens(existing: Record<string, any> = {}) {
  const out: Record<string, string> = {};
  for (const name of ["A-11", "SPYDER", "BAT", "KEYKEY", "NEZLEPHANT"]) {
    out[name] = existing[name] || generateToken(12);
  }
  return out;
}
