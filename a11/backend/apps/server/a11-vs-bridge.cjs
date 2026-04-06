// apps/server/a11-vs-bridge.cjs
// Bridge HTTP vers la VSIX A11 (VS toolwindow)

const VS_PORT = process.env.A11_VS_PORT || 4050;
const VS_URL = process.env.A11_VS_URL || `http://127.0.0.1:${VS_PORT}`;

/**
 * POST JSON vers le mini serveur VS (A11.VsixHost)
 */
async function postJson(path, body) {
  const url = `${VS_URL}${path.startsWith("/") ? path : "/" + path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error_) {
    throw new Error(`Invalid JSON from VS: ${text}`, { cause: error_ });
  }

  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `VS error HTTP ${res.status}`);
  }

  return json;
}

/**
 * Ping simple de la VSIX
 */
async function vsPing() {
  return await postJson("/vs/ping", {});
}

/**
 * Ouvrir un fichier dans Visual Studio
 */
async function vsOpenFile(path, line = 0, column = 0) {
  return await postJson("/vs/open-file", { path, line, column });
}

/**
 * Lancer un build de la solution active
 */
async function vsBuildSolution() {
  return await postJson("/vs/build-solution", {});
}

// Export CJS pour pouvoir faire require() depuis Node et TS compilé
module.exports = {
  vsPing,
  vsOpenFile,
  vsBuildSolution,
};
