// @ts-ignore
const { vsOpenFile, vsBuildSolution, vsPing } = require("../../a11-vs-bridge.cjs");

import { registerHorn } from "../core/horn";

registerHorn("a11d.vs.ping", async () => {
  const res = await vsPing();
  return res;
});

registerHorn("a11d.vs.openFile", async (payload: { path: string; line?: number; column?: number }) => {
  if (!payload?.path) {
    throw new Error("Missing path for a11d.vs.openFile");
  }
  const res = await vsOpenFile(payload.path, payload.line ?? 0, payload.column ?? 0);
  return res;
});

registerHorn("a11d.vs.buildSolution", async () => {
  const res = await vsBuildSolution();
  return res;
});

// Node.js/TypeScript imports should use correct relative paths, e.g.:
// const { vsOpenFile, vsBuildSolution, vsPing } = require("../../a11-vs-bridge.cjs");

// Exemple de fonctions exportées pour le backend
export async function dummyAction1(): Promise<any> {
  return { ok: true, action: "dummyAction1" };
}

export async function dummyAction2(param?: string): Promise<any> {
  return { ok: true, action: "dummyAction2", param };
}
