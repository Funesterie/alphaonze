// src/tools/fs-write.ts
import { promises as fs } from "fs";
import * as path from "path";
import { registerTool } from "./registry";
import type { ToolContext } from "./types";

type FsWriteMode = "create" | "overwrite" | "upsert";

type FsWriteInput = {
  path: string;
  content: string;
  mode?: FsWriteMode;
};

type FsWriteOutput = {
  path: string;
  absolutePath: string;
  mode: FsWriteMode;
  created: boolean;
  overwritten: boolean;
  size: number;
};

function ensureSafeRelativePath(p: string): string {
  if (!p || typeof p !== "string") {
    throw new Error("fs.write: 'path' must be a non-empty string");
  }
  if (path.isAbsolute(p)) {
    throw new Error("fs.write: absolute paths are not allowed");
  }
  if (p.includes("..")) {
    throw new Error("fs.write: paths containing '..' are not allowed");
  }
  return p;
}

registerTool({
  name: "fs.write",
  dangerLevel: "write",
  handler: async (input: FsWriteInput, ctx: ToolContext): Promise<FsWriteOutput> => {
    const relPath = ensureSafeRelativePath(input?.path);
    const mode: FsWriteMode = input?.mode ?? "upsert";
    const content = (input?.content ?? "").toString();

    if (!content && content !== "") {
      throw new Error("fs.write: 'content' must be provided");
    }

    const absPath = path.resolve(ctx.cwd, relPath);
    const dir = path.dirname(absPath);

    ctx.log(`[fs.write] ${absPath} mode=${mode}`);

    await fs.mkdir(dir, { recursive: true });

    let exists = false;
    try {
      await fs.access(absPath);
      exists = true;
    } catch {
      exists = false;
    }

    if (mode === "create" && exists) {
      throw new Error(`fs.write: file already exists: ${relPath}`);
    }
    if (mode === "overwrite" && !exists) {
      throw new Error(`fs.write: file does not exist: ${relPath}`);
    }

    await fs.writeFile(absPath, content, "utf8");
    const stat = await fs.stat(absPath);

    return {
      path: relPath,
      absolutePath: absPath,
      mode,
      created: !exists,
      overwritten: exists,
      size: stat.size,
    };
  },
});
