import * as path from 'path';

// Repo root
const ROOT = path.resolve(__dirname, "../..");

function local(...segments: string[]) {
  return path.join(ROOT, ...segments);
}

export const SERVICE_MAP = {
  spyder: {
    name: "spyder",
    candidates: [
      local("src/spyder"),
      local("spyder/apps/spyder-core"),
      "node_modules/@funeste38/spyder",
    ],
    entry: "dist/index.js",
  },

  qflush: {
    name: "qflush",
    candidates: [local("dist")],
    entry: "index.js",
  },

  cortex: {
    name: "cortex",
    candidates: [local("src/cortex")],
    entry: "index.ts",
  },
} as const;

export default SERVICE_MAP;
