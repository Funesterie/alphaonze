#!/usr/bin/env node
import { runCli } from "./index.js";

runCli().catch((err) => {
  console.error("qflush: fatal", err);
  process.exit(1);
});
