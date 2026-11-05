// Minimal, independent MCP endpoint. No local A11 dependency and no privileged tools.
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
});
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET")
      return json({ service: "a11-mcp-standalone", status: "ok", mode: "read-only-empty", backend: "cloudflare-worker" });
    if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404);
    if (!env.MCP_BEARER_TOKEN) return json({ error: "server_not_configured" }, 503);
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${env.MCP_BEARER_TOKEN}`) return json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json"))
      return json({ error: "unsupported_media_type" }, 415);
    let body;
    try { body = await request.json(); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }
    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string" || Array.isArray(body))
      return json(rpcError(body?.id ?? null, -32600, "Invalid Request"), 400);
    if (body.id === undefined) return new Response(null, { status: 202 });
    const id = body.id;
    if (body.method === "initialize") return json({ jsonrpc: "2.0", id, result: {
      protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "a11-mcp-standalone", version: "0.1.0" }
    } });
    if (body.method === "ping") return json({ jsonrpc: "2.0", id, result: {} });
    if (body.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: [] } });
    return json(rpcError(id, -32601, "Method not found"), 404);
  }
};
