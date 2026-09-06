const { createGatekeeper } = require("./comfyui-gatekeeper.cjs");
const fs = require("fs");
const logFile = "D:\\IA\\comfy\\gatekeeper.log";

const gatekeeper = createGatekeeper({
  env: process.env,
  log: (entry) => {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(logFile, line, "utf8");
  },
});

gatekeeper.ecouter().then((port) => {
  console.log("[portier] ecoute sur 127.0.0.1:" + port);
  console.log("[portier] cible: " + (process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188"));
  console.log("[portier] jeton: " + (process.env.COMFYUI_TUNNEL_TOKEN ? "configure" : "MANQUANT"));
}).catch((err) => {
  console.error("[portier] erreur: " + err.message);
  process.exit(1);
});
