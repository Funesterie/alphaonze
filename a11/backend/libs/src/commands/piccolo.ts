import { logger } from "../utils/logger.js";
import { runDoctor } from "./doctor.js";
import { repairImportsAndDeps } from "../piccolo/repairs-imports.js";
import { repairTsConfig } from "../piccolo/repairs-tsconfig.js";
import { repairWorkflows } from "../piccolo/repairs-ci.js";
import { runTestsSafe } from "../piccolo/tests-safe.js";
import * as fs from "node:fs";
import * as path from "node:path";

export async function runPiccolo(argv: string[] = []) {
  logger.info("PICCOLO: self-regen starting...");

  // 1) snapshot de l’état
  const snapshot = {
    date: new Date().toISOString(),
    cwd: process.cwd(),
    services: [],
    ports: [],
    env: process.env,
  };
  fs.writeFileSync(
    path.join(process.cwd(), ".qflush", "piccolo-snapshot.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );

  // 2) doctor + auto-fix
  await runDoctor(["--piccolo"]);

  // 3) réparations ciblées
  await repairImportsAndDeps();
  await repairTsConfig();
  await repairWorkflows();

  // 4) tests en mode “safe”
  const ok = await runTestsSafe();
  logger.info(`PICCOLO: regen ${ok ? "OK" : "incomplete (tests red)"}`);

  logger.info("PICCOLO: self-regen terminé (squelette, à compléter)");
}
