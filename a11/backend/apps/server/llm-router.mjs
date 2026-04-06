#!/usr/bin/env node
// Deprecated compatibility wrapper.
// Keep the legacy .mjs entrypoint available while all callers migrate to the
// canonical standalone runner.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

console.warn("[Cerbere] llm-router.mjs is deprecated. Redirecting to llm-router-runner.cjs.");
require("./llm-router-runner.cjs");
