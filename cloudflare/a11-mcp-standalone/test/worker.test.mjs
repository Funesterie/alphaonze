import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const base = "https://example.test";
const env = { MCP_BEARER_TOKEN: "test-only-token" };
const call = (path, { method = "GET", auth = false, body, type = "application/json" } = {}) =>
  worker.fetch(new Request(base + path, {
    method,
    headers: { ...(auth ? { authorization: "Bearer test-only-token" } : {}), ...(body !== undefined ? { "content-type": type } : {}) },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {})
  }), env);
const rpc = (method, id = 1) => ({ jsonrpc: "2.0", id, method, params: {} });

test("health works without PC or token", async () => {
  const res = await call("/health");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).backend, "cloudflare-worker");
});
test("MCP requires a configured secret", async () => {
  const res = await worker.fetch(new Request(base + "/mcp", { method: "POST" }), {});
  assert.equal(res.status, 503);
});
test("MCP rejects anonymous callers", async () => {
  assert.equal((await call("/mcp", { method: "POST", body: rpc("initialize") })).status, 401);
});
test("MCP initialize and empty tools/list", async () => {
  const init = await call("/mcp", { method: "POST", auth: true, body: rpc("initialize") });
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.serverInfo.name, "a11-mcp-standalone");
  const tools = await call("/mcp", { method: "POST", auth: true, body: rpc("tools/list") });
  assert.deepEqual((await tools.json()).result.tools, []);
});
test("malformed JSON rejected", async () => {
  const res = await call("/mcp", { method: "POST", auth: true, body: "{" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32700);
});
test("unknown methods rejected", async () => {
  const res = await call("/mcp", { method: "POST", auth: true, body: rpc("dangerous/action") });
  assert.equal((await res.json()).error.code, -32601);
});
