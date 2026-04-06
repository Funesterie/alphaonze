// src/tools/fs-search.ts
import { promises as fs } from "fs";
import * as path from "path";
import { registerTool } from "./registry";
import type { ToolContext } from "./types";

type FsSearchInput = {
  pattern: string;
  root?: string;
  maxResults?: number;
  includeExtensions?: string[];
  excludeDirs?: string[];
};

type FsSearchMatch = {
  file: string;
  line: number;
  preview: string;
};

type FsSearchOutput = {
  pattern: string;
  root: string;
  results: FsSearchMatch[];
  truncated: boolean;
};

async function walkDir(
  dir: string,
  options: {
    excludeDirs: Set<string>;
  }
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (options.excludeDirs.has(entry.name)) continue;
      const sub = await walkDir(full, options);
      files.push(...sub);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }

  return files;
}

async function searchFile(
  filePath: string,
  pattern: string
): Promise<FsSearchMatch[]> {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const lowerPattern = pattern.toLowerCase();

  const matches: FsSearchMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (lineText.toLowerCase().includes(lowerPattern)) {
      matches.push({
        file: filePath,
        line: i + 1,
        preview: lineText.trim().slice(0, 200),
      });
    }
  }

  return matches;
}

registerTool({
  name: "fs.search",
  dangerLevel: "safe",
  handler: async (input: FsSearchInput, ctx: ToolContext): Promise<FsSearchOutput> => {
    const pattern = (input?.pattern || "").toString().trim();
    if (!pattern) {
      throw new Error("fs.search: 'pattern' is required");
    }

    const root = path.resolve(ctx.cwd, input.root || ".");
    const maxResults = input.maxResults ?? 100;
    const includeExt = input.includeExtensions ?? [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".json",
      ".md",
      ".txt",
      ".cjs",
      ".mjs"
    ];

    const excludeDirs = new Set(
      input.excludeDirs ?? ["node_modules", ".git", ".qflush", "dist", "build"]
    );

    ctx.log(`[fs.search] pattern="${pattern}" root="${root}"`);

    const allFiles = await walkDir(root, { excludeDirs });

    const filteredFiles = allFiles.filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return includeExt.includes(ext);
    });

    const results: FsSearchMatch[] = [];
    let truncated = false;

    for (const file of filteredFiles) {
      if (results.length >= maxResults) {
        truncated = true;
        break;
      }

      try {
        const fileMatches = await searchFile(file, pattern);
        for (const m of fileMatches) {
          results.push(m);
          if (results.length >= maxResults) {
            truncated = true;
            break;
          }
        }
      } catch (e) {
        ctx.log(`[fs.search] error reading ${file}: ${(e as Error).message}`);
      }
    }

    // on renvoie les chemins relatifs à root pour que ce soit plus lisible
    const relResults = results.map((m) => ({
      ...m,
      file: path.relative(root, m.file),
    }));

    return {
      pattern,
      root,
      results: relResults,
      truncated,
    };
  },
});
