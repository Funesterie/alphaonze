"use strict";
/**
 * storage-box.cjs — Interface avec la Hetzner Storage Box vivy-archive.
 *
 * Storage Box : u647261.your-storagebox.de (port SSH 23)
 * Utilisé pour :
 *   - Archiver les clips produits
 *   - Stocker les uploads audio des utilisateurs
 *   - Servir les fichiers via SFTP/HTTPS
 *
 * Méthode : SCP via le binaire ssh (port 23) depuis le serveur EX44.
 * La clé SSH du serveur doit être autorisée sur la Storage Box.
 */
const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const BOX_HOST = process.env.STORAGE_BOX_HOST || "u647261.your-storagebox.de";
const BOX_USER = process.env.STORAGE_BOX_USER || "u647261";
const BOX_PORT = process.env.STORAGE_BOX_PORT || "23";
const BOX_KEY = process.env.STORAGE_BOX_KEY || "/home/deploy/.ssh/storagebox_ed25519";
const BOX_BASE_DIR = process.env.STORAGE_BOX_DIR || "/vivy-archive";

// Répertoires sur la box
const DIRS = {
  uploads: BOX_BASE_DIR + "/uploads",
  clips: BOX_BASE_DIR + "/clips",
  songs: BOX_BASE_DIR + "/songs",
};

function sshOpts() {
  var opts = "-o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10";
  if (fs.existsSync(BOX_KEY)) {
    opts += " -i " + BOX_KEY;
  }
  return opts + " -P " + BOX_PORT;
}

function scpOpts() {
  var opts = "-o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10";
  if (fs.existsSync(BOX_KEY)) {
    opts += " -i " + BOX_KEY;
  }
  return opts + " -P " + BOX_PORT;
}

/**
 * Upload un fichier local vers la Storage Box.
 * @param {string} localPath - Chemin local du fichier
 * @param {string} remotePath - Chemin relatif sur la box (ex: "uploads/mon-audio.mp3")
 * @returns {boolean} succès
 */
function uploadToBox(localPath, remotePath) {
  var fullRemote = BOX_USER + "@" + BOX_HOST + ":" + remotePath;
  var cmd = "scp " + scpOpts() + " " + JSON.stringify(localPath) + " " + JSON.stringify(fullRemote);
  try {
    execSync(cmd, { timeout: 60000, stdio: "pipe" });
    console.log("[storage-box] Upload OK :", remotePath);
    return true;
  } catch (err) {
    console.error("[storage-box] Upload échoué :", err.message);
    return false;
  }
}

/**
 * Upload un fichier en arrière-plan (non-bloquant).
 */
function uploadToBoxAsync(localPath, remotePath, callback) {
  var fullRemote = BOX_USER + "@" + BOX_HOST + ":" + remotePath;
  var cmd = "scp " + scpOpts() + " " + JSON.stringify(localPath) + " " + JSON.stringify(fullRemote);
  exec(cmd, { timeout: 120000 }, function(err) {
    if (err) {
      console.error("[storage-box] Upload async échoué :", err.message);
      if (callback) callback(err);
    } else {
      console.log("[storage-box] Upload async OK :", remotePath);
      if (callback) callback(null);
    }
  });
}

/**
 * Initialise les répertoires sur la Storage Box.
 */
function initBoxDirs() {
  var sshCmd = "ssh " + sshOpts() + " " + BOX_USER + "@" + BOX_HOST;
  try {
    execSync(sshCmd + " 'mkdir -p " + DIRS.uploads + " " + DIRS.clips + " " + DIRS.songs + "'", { timeout: 15000, stdio: "pipe" });
    console.log("[storage-box] Répertoires initialisés sur la box");
    return true;
  } catch (err) {
    console.warn("[storage-box] Init dirs échoué (normal si pas de clé) :", err.message);
    return false;
  }
}

/**
 * Vérifie la connectivité avec la Storage Box.
 */
function checkBoxConnectivity() {
  var sshCmd = "ssh " + sshOpts() + " " + BOX_USER + "@" + BOX_HOST + " 'echo OK'";
  try {
    var result = execSync(sshCmd, { timeout: 10000, stdio: "pipe" }).toString().trim();
    return result === "OK";
  } catch (err) {
    return false;
  }
}

/**
 * Liste les fichiers d'un répertoire sur la box.
 */
function listBoxDir(dir) {
  var sshCmd = "ssh " + sshOpts() + " " + BOX_USER + "@" + BOX_HOST + " 'ls -la " + dir + " 2>/dev/null'";
  try {
    return execSync(sshCmd, { timeout: 10000, stdio: "pipe" }).toString();
  } catch (err) {
    return "";
  }
}

module.exports = {
  BOX_HOST,
  BOX_PORT,
  BOX_USER,
  DIRS,
  checkBoxConnectivity,
  initBoxDirs,
  listBoxDir,
  uploadToBox,
  uploadToBoxAsync,
};
