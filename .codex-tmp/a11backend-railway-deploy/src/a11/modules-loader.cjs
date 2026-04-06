const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");

function isSafeToolName(name) {
  return typeof name === "string" && /^[a-z][a-z0-9_]{1,63}$/i.test(name);
}

async function loadModulesTools(modulesRoot) {
  const TOOL_IMPL = {};
  const TOOL_MANIFEST = {};

  if (!modulesRoot || !fs.existsSync(modulesRoot)) {
    return { TOOL_IMPL, TOOL_MANIFEST, loaded: [], errors: [] };
  }

  const errors = [];
  const loaded = [];

  const entries = await fsp.readdir(modulesRoot, { withFileTypes: true });
  const moduleDirs = entries.filter(e => e.isDirectory());

  for (const dir of moduleDirs) {
    const modPath = path.join(modulesRoot, dir.name);
    // Accept both module.manifest.json and module.json for retrocompat
    const manifestPath = fs.existsSync(path.join(modPath, "module.manifest.json"))
      ? path.join(modPath, "module.manifest.json")
      : path.join(modPath, "module.json");
    if (!fs.existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    } catch (e) {
      errors.push({ module: dir.name, error: "Invalid manifest: " + e.message });
      continue;
    }

    if (!Array.isArray(manifest.tools)) continue;

    for (const tool of manifest.tools) {
      if (!isSafeToolName(tool.name)) {
        errors.push({ module: dir.name, error: `Unsafe tool name: ${tool.name}` });
        continue;
      }
      const entryPath = path.join(modPath, tool.entry || "index.js");
      if (!fs.existsSync(entryPath)) {
        errors.push({ module: dir.name, error: `Entry not found: ${entryPath}` });
        continue;
      }
      try {
        const mod = require(entryPath);
        if (typeof mod[tool.export] !== "function") {
          errors.push({ module: dir.name, error: `Export not found: ${tool.export}` });
          continue;
        }
        TOOL_IMPL[tool.name] = mod[tool.export];
        TOOL_MANIFEST[tool.name] = { ...tool, module: dir.name, entry: entryPath };
        loaded.push(tool.name);
      } catch (e) {
        errors.push({ module: dir.name, error: "Load error: " + e.message });
      }
    }
  }

  return { TOOL_IMPL, TOOL_MANIFEST, loaded, errors };
}

module.exports = { loadModulesTools };
