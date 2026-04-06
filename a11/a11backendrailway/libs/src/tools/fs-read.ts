// src/tools/fs-read.ts
import { promises as fs } from "fs";
import * as path from "path";
import { registerTool } from "./registry";
import type { ToolContext } from "./types";

type FsReadInput = {
  path: string;
  maxBytes?: number;
};

type FsReadOutput = {
  path: string;
  absolutePath: string;
  size: number;
  truncated: boolean;
  content: string;
};

function ensureSafeRelativePath(p: string): string {
  if (!p || typeof p !== "string") {
    throw new Error("fs.read: 'path' must be a non-empty string");
  }
  if (path.isAbsolute(p)) {
    throw new Error("fs.read: absolute paths are not allowed");
  }
  if (p.includes("..")) {
    throw new Error("fs.read: paths containing '..' are not allowed");
  }
  return p;
}

registerTool({
  name: "fs.read",
  dangerLevel: "safe",
  handler: async (input: FsReadInput, ctx: ToolContext): Promise<FsReadOutput> => {
    const relPath = ensureSafeRelativePath(input?.path);
    const maxBytes = input?.maxBytes ?? 65536;

    const absPath = path.resolve(ctx.cwd, relPath);
    ctx.log(`[fs.read] ${absPath} (maxBytes=${maxBytes})`);

    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      throw new Error(`fs.read: not a file: ${relPath}`);
    }

    const raw = await fs.readFile(absPath, "utf8");
    let content = raw;
    let truncated = false;

    if (Buffer.byteLength(content, "utf8") > maxBytes) {
      content = content.slice(0, maxBytes);
      truncated = true;
    }

    return {
      path: relPath,
      absolutePath: absPath,
      size: stat.size,
      truncated,
      content,
    };
  },
});
