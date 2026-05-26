import "./tools/web";
import { buildPipeline, executePipeline } from "./chain/smartChain.js";
import { showHelp } from "./cli/help.js";
import { runCompose } from "./commands/compose.js";
import { runDoctor } from "./commands/doctor.js";
import { runToolRun } from "./commands/tool-run.js";
import { readFileSync } from "fs";
import { join } from "path";

export * as horn from "./core/horn";

export async function runCli(argv = process.argv.slice(2)) {
  const first = argv[0];

  if (first === "version" || argv.includes("--version") || argv.includes("-v")) {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
      console.log(pkg.version);
    } catch (e) {
      console.log("4.0.1");
    }
    return;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    showHelp();
    return;
  }

  if (first === "compose") {
    await runCompose(argv.slice(1));
    return;
  }
  if (first === "doctor") {
    await runDoctor(argv.slice(1));
    return;
  }
  if (first === "horn") {
    try {
      // @ts-ignore
      const player = require("play-sound")();
      const path = require("path");
      const mp3Path = path.join(__dirname, "../examples/rire-joker-04.mp3");
      await new Promise<void>((resolve, reject) => {
        player.play(mp3Path, function (err: any) {
          if (err) {
            reject(err);
          } else {
            console.log("Corne de brume Funesterie !");
            resolve();
          }
        });
      });
      return;
    } catch (e) {
      console.error("Impossible de jouer le son:", e);
      process.exit(1);
    }
  }
  if (first === "daemon") {
    console.warn("Daemon mode has been removed. Use QFlush in cortex mode.");
    return;
  }
  if (first === "tool-run") {
    await runToolRun(argv.slice(1));
    return;
  }

  const { pipeline, options } = buildPipeline(argv);
  await executePipeline(pipeline, options);
}
