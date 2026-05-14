#!/usr/bin/env node
/**
 * Standalone runner for the canonical Cerbere router.
 *
 * Use this file when Cerbere must run as its own process. The routing logic
 * still lives in `llm-router.cjs`, which remains the canonical implementation.
 */

const path = require("path");
const fs = require("fs");

// Charge .env.local en priorité, puis .env comme fallback
const envLocalPath = path.resolve(__dirname, ".env.local");
const envPath = path.resolve(__dirname, ".env");
if (fs.existsSync(envLocalPath)) {
  require("dotenv").config({ path: envLocalPath, override: true });
} else {
  require("dotenv").config({ path: envPath, override: true });
}

const express = require("express");
const cors = require("cors");
const { router } = require("./llm-router.cjs");

const app = express();
const PORT = Number(process.env.CERBERE_PORT || process.env.LLM_ROUTER_PORT || 4545);

app.use(cors());
app.use(router);
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cerbere-router",
    routerKind: "standalone-runner",
    routerEntrypoint: "llm-router.cjs",
    runnerFile: "llm-router-runner.cjs",
    canonical: true,
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Cerbere] Standalone canonical router listening on http://127.0.0.1:${PORT}`);
});
