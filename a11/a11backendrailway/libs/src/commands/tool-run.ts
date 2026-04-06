import "../tools/web";
import { getTool } from "../tools/registry.js";

export async function runToolRun(argv: string[]) {
  const name = argv[0];
  const inputJson = argv[1] || "{}";
  const tool = getTool(name);
  if (!tool) {
    console.error(JSON.stringify({ error: "Unknown tool", name }));
    process.exit(1);
  }

  const input = JSON.parse(inputJson);
  const output = await tool.handler(input, {
    cwd: process.cwd(),
    env: process.env,
    log: (msg: string) => console.error("[tool]", msg),
  });

  console.log(JSON.stringify({ ok: true, name, output }, null, 2));
}
