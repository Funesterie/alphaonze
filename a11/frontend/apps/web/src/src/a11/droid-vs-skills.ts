import { registerHorn } from "../core/horn";
import { vsOpenFile, vsBuildSolution, vsPing } from "../../../apps/server/a11-vs-bridge.cjs";

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
// import { vsOpenFile, vsBuildSolution, vsPing } from "../../../apps/server/a11-vs-bridge.cjs";
