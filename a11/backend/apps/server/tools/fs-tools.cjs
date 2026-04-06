const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const DATA_ROOT = process.env.A11_DATA_ROOT || "D:/A12";

function resolveSafe(relPath = ".") {
  const base = path.resolve(DATA_ROOT);
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base)) {
    throw new Error(`fs-tools: tentative de sortie de la racine: ${full}`);
  }
  return full;
}

async function fs_list(args = {}) {
  const relPath = args.path || ".";
  const full = resolveSafe(relPath);

  let dir;
  try {
    dir = await fsp.readdir(full, { withFileTypes: true });
  } catch (e) {
    return {
      ok: false,
      error: `Impossible de lister le dossier ${relPath}: ${e.message}`,
    };
  }

  // Limite facultative pour éviter de spammer
  const limit = typeof args.limit === "number" ? args.limit : 200;

  const items = [];
  for (const d of dir.slice(0, limit)) {
    const itemPath = path.join(full, d.name);
    let size = null;
    try {
      const stats = await fsp.stat(itemPath);
      size = stats.isDirectory() ? null : stats.size;
    } catch {
      size = null;
    }

    items.push({
      name: d.name,
      type: d.isDirectory() ? "dir" : "file",
      size,
      path: path.join(relPath, d.name).replace(/\\/g, "/"),
    });
  }

  return {
    ok: true,
    root: DATA_ROOT,
    path: relPath.replace(/\\/g, "/"),
    count: items.length,
    items,
  };
}

async function fs_read(args = {}) {
  const relPath = args.path;
  if (!relPath) {
    return { ok: false, error: "fs_read: 'path' est requis" };
  }

  const full = resolveSafe(relPath);

  try {
    const content = await fsp.readFile(full, "utf8");
    return {
      ok: true,
      path: relPath.replace(/\\/g, "/"),
      content,
    };
  } catch (e) {
    return {
      ok: false,
      error: `fs_read: impossible de lire ${relPath}: ${e.message}`,
    };
  }
}

async function fs_write(args = {}) {
  const relPath = args.path;
  const content = args.content ?? "";
  if (!relPath) {
    return { ok: false, error: "fs_write: 'path' est requis" };
  }

  const full = resolveSafe(relPath);
  try {
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content, "utf8");
    return {
      ok: true,
      path: relPath.replace(/\\/g, "/"),
      size: Buffer.byteLength(content, "utf8"),
    };
  } catch (e) {
    return {
      ok: false,
      error: `fs_write: impossible d'écrire ${relPath}: ${e.message}`,
    };
  }
}

module.exports = {
  fs_list,
  fs_read,
  fs_write,
};