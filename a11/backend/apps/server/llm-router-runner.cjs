#!/usr/bin/env node
/**
 * Standalone runner for the canonical Cerbere router.
 *
 * Use this file when Cerbere must run as its own process. The routing logic
 * still lives in `llm-router.cjs`, which remains the canonical implementation.
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { router } = require("./llm-router.cjs");

const app = express();
const PORT = Number(process.env.CERBERE_PORT || process.env.LLM_ROUTER_PORT || process.env.PORT || 4545);

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
