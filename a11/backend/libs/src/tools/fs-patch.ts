// src/tools/fs-patch.ts
import { promises as fs } from "fs";
import * as path from "path";
import { registerTool } from "./registry";
import type { ToolContext } from "./types";

type FsPatchInput = {
  path: string;
  originalSnippet: string;
  newSnippet: string;
  occurrence?: number;
  maxBytes?: number;
};

type FsPatchOutput = {
  path: string;
  absolutePath: string;
  occurrence: number;
  replaced: boolean;
  sizeBefore: number;
  sizeAfter: number;
};

function ensureSafeRelativePath(p: string): string {
  if (!p || typeof p !== "string") {
    throw new Error("fs.patch: 'path' must be a non-empty string");
  }
  if (path.isAbsolute(p)) {
    throw new Error("fs.patch: absolute paths are not allowed");
  }
  if (p.includes("..")) {
    throw new Error("fs.patch: paths containing '..' are not allowed");
  }
  return p;
}

registerTool({
  name: "fs.patch",
  dangerLevel: "write",
  handler: async (input: FsPatchInput, ctx: ToolContext): Promise<FsPatchOutput> => {
    const relPath = ensureSafeRelativePath(input?.path);
    const absPath = path.resolve(ctx.cwd, relPath);

    const originalSnippet = (input?.originalSnippet ?? "").toString();
    const newSnippet = (input?.newSnippet ?? "").toString();
    const occurrence = input?.occurrence ?? 1;
    const maxBytes = input?.maxBytes ?? 256 * 1024;

    if (!originalSnippet) {
      throw new Error("fs.patch: 'originalSnippet' is required");
    }
    if (occurrence < 1) {
      throw new Error("fs.patch: 'occurrence' must be >= 1");
    }

    ctx.log(`[fs.patch] ${absPath} occurrence=${occurrence}`);

    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      throw new Error(`fs.patch: not a file: ${relPath}`);
    }
    if (stat.size > maxBytes) {
      throw new Error(
        `fs.patch: file too large (${stat.size} bytes > ${maxBytes}). Increase maxBytes if needed.`
      );
    }

    const content = await fs.readFile(absPath, "utf8");
    const sizeBefore = Buffer.byteLength(content, "utf8");

    let index = -1;
    let from = 0;
    for (let i = 0; i < occurrence; i++) {
      index = content.indexOf(originalSnippet, from);
      if (index === -1) break;
      from = index + originalSnippet.length;
    }

    if (index === -1) {
      throw new Error("fs.patch: originalSnippet not found at requested occurrence");
    }

    const before = content.slice(0, index);
    const after = content.slice(index + originalSnippet.length);
    const newContent = before + newSnippet + after;
    const sizeAfter = Buffer.byteLength(newContent, "utf8");

    await fs.writeFile(absPath, newContent, "utf8");

    return {
      path: relPath,
      absolutePath: absPath,
      occurrence,
      replaced: true,
      sizeBefore,
      sizeAfter,
    };
  },
});
