"use strict";
/**
 * storage-box.cjs — Interface avec la Hetzner Storage Box vivy-archive.
 *
 * Le pipeline NOSSEN garde le fichier de travail sur le serveur local. La Storage Box
 * sert ensuite d'archive durable; elle ne doit jamais etre necessaire pour mesurer,
 * masteriser ou mixer un morceau.
 *
 * Aucun secret n'est embarque ici: la cle SSH reste un fichier du serveur.
 */
const { execFileSync, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const BOX_HOST = process.env.STORAGE_BOX_HOST || "u647261.your-storagebox.de";
const BOX_USER = process.env.STORAGE_BOX_USER || "u647261";
const BOX_PORT = String(process.env.STORAGE_BOX_PORT || "23");
const BOX_KEY = process.env.STORAGE_BOX_KEY || "/home/deploy/.ssh/storagebox_ed25519";
const BOX_BASE_DIR = process.env.STORAGE_BOX_DIR || "/vivy-archive";

const DIRS = {
  uploads: BOX_BASE_DIR + "/uploads",
  clips: BOX_BASE_DIR + "/clips",
  songs: BOX_BASE_DIR + "/songs",
};

function commonArgs() {
  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
  ];
  if (BOX_KEY && fs.existsSync(BOX_KEY)) args.push("-i", BOX_KEY);
  return args;
}

function sshArgs() {
  // ssh utilise -p (minuscule). -P etait accepte par scp, pas par ssh.
  return [...commonArgs(), "-p", BOX_PORT];
}

function scpArgs() {
  // scp utilise -P (majuscule).
  return [...commonArgs(), "-P", BOX_PORT];
}

function safeRemoteRelativePath(value = "") {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, "_"))
    .filter(Boolean)
    .join("/");
  return normalized;
}

function resolveRemotePath(remotePath = "") {
  const relative = safeRemoteRelativePath(remotePath);
  if (!relative) return "";
  if (/^(?:uploads|clips|songs)\//.test(relative)) return `${BOX_BASE_DIR}/${relative}`;
  return `${BOX_BASE_DIR}/${relative}`;
}

function ensureLocalFile(localPath) {
  const candidate = path.resolve(String(localPath || ""));
  if (!candidate || !fs.existsSync(candidate)) return "";
  try {
    return fs.statSync(candidate).isFile() && fs.statSync(candidate).size > 0 ? candidate : "";
  } catch {
    return "";
  }
}

function ensureRemoteParent(remotePath) {
  const parent = path.posix.dirname(remotePath);
  if (!parent || parent === ".") return true;
  try {
    execFileSync(
      "ssh",
      [...sshArgs(), `${BOX_USER}@${BOX_HOST}`, "mkdir", "-p", parent],
      { timeout: 15000, stdio: "pipe" }
    );
    return true;
  } catch (err) {
    console.warn("[storage-box] Creation dossier distant echouee :", err.message);
    return false;
  }
}

/** Upload synchrone d'un fichier LOCAL apres le traitement. */
function uploadToBox(localPath, remotePath) {
  const source = ensureLocalFile(localPath);
  const destination = resolveRemotePath(remotePath);
  if (!source || !destination) return false;
  if (!ensureRemoteParent(destination)) return false;
  const fullRemote = `${BOX_USER}@${BOX_HOST}:${destination}`;
  try {
    execFileSync("scp", [...scpArgs(), source, fullRemote], { timeout: 120000, stdio: "pipe" });
    console.log("[storage-box] Upload OK :", destination);
    return true;
  } catch (err) {
    console.error("[storage-box] Upload echoue :", err.message);
    return false;
  }
}

/** Upload non bloquant. Le fichier local n'est jamais supprime en cas d'echec. */
function uploadToBoxAsync(localPath, remotePath, callback) {
  const source = ensureLocalFile(localPath);
  const destination = resolveRemotePath(remotePath);
  if (!source || !destination) {
    const error = new Error("storage_box_source_or_destination_invalid");
    if (callback) callback(error);
    return;
  }
  if (!ensureRemoteParent(destination)) {
    const error = new Error("storage_box_remote_directory_unavailable");
    if (callback) callback(error);
    return;
  }
  const fullRemote = `${BOX_USER}@${BOX_HOST}:${destination}`;
  execFile("scp", [...scpArgs(), source, fullRemote], { timeout: 180000 }, function(err) {
    if (err) {
      console.error("[storage-box] Upload async echoue :", err.message);
      if (callback) callback(err);
    } else {
      console.log("[storage-box] Upload async OK :", destination);
      if (callback) callback(null);
    }
  });
}

function archiveSongAsync(localPath, filename, callback) {
  const safeName = path.basename(String(filename || localPath || "song.mp3"))
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
  uploadToBoxAsync(localPath, `songs/${safeName || "song.mp3"}`, callback);
}

function initBoxDirs() {
  try {
    execFileSync(
      "ssh",
      [...sshArgs(), `${BOX_USER}@${BOX_HOST}`, "mkdir", "-p", DIRS.uploads, DIRS.clips, DIRS.songs],
      { timeout: 15000, stdio: "pipe" }
    );
    console.log("[storage-box] Repertoires initialises sur la box");
    return true;
  } catch (err) {
    console.warn("[storage-box] Init dirs echoue :", err.message);
    return false;
  }
}

function checkBoxConnectivity() {
  try {
    const result = execFileSync(
      "ssh",
      [...sshArgs(), `${BOX_USER}@${BOX_HOST}`, "echo", "OK"],
      { timeout: 10000, stdio: "pipe", encoding: "utf8" }
    ).trim();
    return result === "OK";
  } catch {
    return false;
  }
}

function listBoxDir(dir) {
  const allowed = Object.values(DIRS).includes(dir) ? dir : "";
  if (!allowed) return "";
  try {
    return execFileSync(
      "ssh",
      [...sshArgs(), `${BOX_USER}@${BOX_HOST}`, "ls", "-la", allowed],
      { timeout: 10000, stdio: "pipe", encoding: "utf8" }
    );
  } catch {
    return "";
  }
}

module.exports = {
  BOX_HOST,
  BOX_PORT,
  BOX_USER,
  DIRS,
  archiveSongAsync,
  checkBoxConnectivity,
  initBoxDirs,
  listBoxDir,
  resolveRemotePath,
  safeRemoteRelativePath,
  uploadToBox,
  uploadToBoxAsync,
};
