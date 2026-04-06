import { promises as fs } from "fs";
import * as path from "path";
import { registerTool } from "./registry.js";
import type { ToolContext } from "./types.js";
import "./web-search";
import "./fs-search";

registerTool({
  name: "web.fetch",
  dangerLevel: "safe",
  handler: async (input: any, ctx: ToolContext) => {
    const fetch = (await import("node-fetch")).default;
    let JSDOM;
    try {
      JSDOM = (await import("jsdom")).JSDOM;
    } catch (e) {
      throw new Error("jsdom is required for web.fetch tool. Please install it with 'npm install jsdom'.");
    }
    const url = String(input?.url || "").trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("Only http/https URLs are allowed");
    }
    ctx.log(`[web.fetch] GET ${url}`);
    const res = await fetch(url, { redirect: "follow" });
    const html = await res.text();
    const dom = new JSDOM(html);
    const text = dom.window.document.body?.textContent || "";
    const shortText = text.slice(0, 20000);
    return {
      ok: true,
      status: res.status,
      url: res.url,
      title: dom.window.document.title || "",
      text: shortText,
    };
  },
});
