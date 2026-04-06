#!/usr/bin/env node
import "./tools/web";
import { buildPipeline, executePipeline } from "./chain/smartChain.js";
import { showHelp } from "./cli/help.js";
import { runCompose } from "./commands/compose.js";
import { runDoctor } from "./commands/doctor.js";
import { runToolRun } from "./commands/tool-run.js";
import { readFileSync } from "fs";
import { join } from "path";

export * as horn from "./core/horn";

const argv = process.argv.slice(2);
const first = argv[0];

if (first === "version" || argv.includes("--version") || argv.includes("-v")) {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
    console.log(pkg.version);
  } catch (e) {
    console.log("4.0.1");
  }
  process.exit(0);
}

if (argv.includes("--help") || argv.includes("-h")) {
  showHelp();
  process.exit(0);
}

if (first === "compose") {
  void runCompose(argv.slice(1));
  process.exit(0);
}
if (first === "doctor") {
  void runDoctor(argv.slice(1));
  process.exit(0);
}
if (first === "horn") {
  try {
    // @ts-ignore
    const player = require("play-sound")();
    const path = require("path");
    const mp3Path = path.join(__dirname, "../examples/rire-joker-04.mp3");
    player.play(mp3Path, function (err: any) {
      if (err) {
        console.error("Erreur lors de la lecture du son:", err);
        process.exit(1);
      } else {
        console.log("🦄 Corne de brume Funesterie !");
        process.exit(0);
      }
    });
  } catch (e) {
    console.error("Impossible de jouer le son:", e);
    process.exit(1);
  }
}
if (first === "daemon") {
  console.warn("Daemon mode has been removed. Use QFlush in cortex mode.");
  process.exit(0);
}
if (first === "tool-run") {
  runToolRun(argv.slice(1));
  process.exit(0);
}

const { pipeline, options } = buildPipeline(argv);

executePipeline(pipeline, options).catch((err) => {
  console.error("qflash: fatal", err);
  process.exit(1);
});
