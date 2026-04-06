// src/tools/web-download.ts
import { promises as fs } from "fs";
import * as path from "path";
import { registerTool } from "./registry.js";
import type { ToolContext } from "./types.js";

type WebDownloadInput = {
  url: string;
  path: string;
  maxBytes?: number;
  overwrite?: boolean;
};

type WebDownloadOutput = {
  url: string;
  path: string;
  absolutePath: string;
  size: number;
  truncated: boolean;
  contentType?: string;
};

registerTool({
  name: "web.download",
  dangerLevel: "write",
  handler: async (input: WebDownloadInput, ctx: ToolContext): Promise<WebDownloadOutput> => {
    const fetch = (await import("node-fetch")).default;
    const { buffer } = await import("stream/consumers");
    const url = (input?.url || "").toString().trim();
    if (!url) throw new Error("web.download: 'url' is required");
    if (!url.startsWith("http://") && !url.startsWith("https://")) throw new Error("web.download: only http/https URLs are allowed");
    const relPath = input?.path;
    if (!relPath) throw new Error("web.download: 'path' is required");
    if (path.isAbsolute(relPath) || relPath.includes("..")) throw new Error("web.download: path must be relative and not contain '..'");
    const absPath = path.resolve(ctx.cwd, relPath);
    const maxBytes = input?.maxBytes ?? 50 * 1024 * 1024;
    const overwrite = input?.overwrite ?? false;
    ctx.log(`[web.download] GET ${url} -> ${absPath} (maxBytes=${maxBytes}, overwrite=${overwrite})`);
    let exists = false;
    try { await fs.access(absPath); exists = true; } catch { exists = false; }
    if (exists && !overwrite) throw new Error(`web.download: file already exists: ${relPath}`);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`web.download: request failed with status ${res.status}`);
    const contentType = res.headers.get("content-type") || undefined;
    // Consomme le stream Node.js en buffer
    let fileData = await buffer(res.body);
    let truncated = false;
    if (fileData.length > maxBytes) {
      fileData = fileData.subarray(0, maxBytes);
      truncated = true;
    }
    await fs.writeFile(absPath, fileData);
    const stat = await fs.stat(absPath);
    return {
      url,
      path: relPath,
      absolutePath: absPath,
      size: stat.size,
      truncated,
      contentType,
    };
  },
});
