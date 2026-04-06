const { spawn } = require("child_process");

function runQflushTool(tool, input) {
  return new Promise((resolve, reject) => {
    const inputJson = JSON.stringify(input || {});
    const child = spawn("qflush", ["tool-run", tool, inputJson], { shell: true });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(err || `qflush exited with code ${code}`));
      }
      try {
        const parsed = JSON.parse(out);
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = { runQflushTool };
