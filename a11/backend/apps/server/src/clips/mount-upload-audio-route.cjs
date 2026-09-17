"use strict";
/**
 * Route: POST /api/mcp-bridge/upload-audio
 * Accepts multipart/form-data with a "file" field (audio).
 * Saves to /app/runtime/uploads/ and returns the URL.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { randomUUID } = require("crypto");
const { messageServeur } = require("../i18n/messages-serveur.cjs");

const UPLOAD_DIR = path.join(process.env.A11_RUNTIME_ROOT || "/app/runtime", "uploads");
// 95 Mo : une video d'iPhone passe, et on reste sous le plafond de 100 Mo par
// requete de Cloudflare devant le site.
const MAX_SIZE = 95 * 1024 * 1024;
// Extensions servies par /play-upload (les anciens imports m4a/aac restent lisibles).
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"]);
// Gardees telles quelles a l'import.
const DIRECT_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac"]);
// Converties en MP3 a l'import (17/09/2026, Djeff) : ce que produit un iPhone
// (memos vocaux m4a/ALAC, caf, aiff, 3gp, amr) et les videos (mov, mp4), dont on
// ne garde que le son. Le clip, le lecteur et Suno recoivent toujours un MP3.
const CONVERTED_EXTENSIONS = new Set([
  ".m4a", ".aac", ".caf", ".aif", ".aiff", ".3gp", ".3g2", ".amr", ".opus", ".webm",
  ".mov", ".mp4", ".m4v", ".qt",
]);

function convertToMp3(input, output, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      String(process.env.FFMPEG_BIN || "ffmpeg").trim() || "ffmpeg",
      ["-v", "error", "-y", "-i", input, "-vn", "-map", "0:a:0", "-c:a", "libmp3lame", "-q:a", "2", output],
      { timeout: timeoutMs, windowsHide: true },
      (error) => (error ? reject(error) : resolve())
    );
  });
}

function mountUploadAudioRoute(app, { uploadDir = UPLOAD_DIR, convertImpl = convertToMp3 } = {}) {
  // Ensure upload dir exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Simple multipart handler without multer (raw buffer approach)
  app.post("/api/mcp-bridge/upload-audio", (req, res) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({ ok: false, error: "multipart/form-data requis", message: messageServeur(req, "upload.multipartRequired") });
    }

    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        chunks.length = 0;
        if (!res.headersSent) res.status(413).json({ ok: false, error: "Fichier trop volumineux (max 95 Mo)", message: messageServeur(req, "upload.tooLarge") });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", async () => {
      if (res.headersSent) return;
      if (size > MAX_SIZE) {
        return res.status(413).json({ ok: false, error: "Fichier trop volumineux (max 95 Mo)", message: messageServeur(req, "upload.tooLarge") });
      }

      const buffer = Buffer.concat(chunks);
      // Parse multipart boundary
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
      const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]);
      if (!boundary) {
        return res.status(400).json({ ok: false, error: "Boundary multipart manquant", message: messageServeur(req, "upload.noBoundary") });
      }

      // Find file content between boundaries
      const boundaryBuf = Buffer.from("--" + boundary);
      const parts = [];
      let start = 0;

      while (true) {
        const idx = buffer.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        if (start > 0) parts.push(buffer.slice(start, idx));
        start = idx + boundaryBuf.length;
      }

      // Find the part with filename
      let fileBuffer = null;
      let filename = "upload-" + Date.now() + ".mp3";

      for (const part of parts) {
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd === -1) continue;
        const header = part.slice(0, headerEnd).toString("utf8");
        if (header.includes("filename=")) {
          const match = header.match(/filename="([^"]+)"/);
          if (match) {
            // Sanitize filename
            filename = match[1].replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
          }
          // Skip \r\n\r\n and trailing \r\n
          fileBuffer = part.slice(headerEnd + 4);
          // Remove trailing \r\n
          if (fileBuffer.length >= 2 && fileBuffer[fileBuffer.length - 2] === 13 && fileBuffer[fileBuffer.length - 1] === 10) {
            fileBuffer = fileBuffer.slice(0, -2);
          }
          break;
        }
      }

      if (!fileBuffer || fileBuffer.length < 100) {
        return res.status(400).json({ ok: false, error: "Aucun fichier audio trouvé dans la requête", message: messageServeur(req, "upload.noFile") });
      }

      const ext = path.extname(filename).toLowerCase();
      if (!DIRECT_EXTENSIONS.has(ext) && !CONVERTED_EXTENSIONS.has(ext)) {
        return res.status(415).json({ ok: false, error: "Format non pris en charge", message: messageServeur(req, "upload.badFormat") });
      }
      // Une page d'erreur sauvegardée en .mp3 ne devient pas un fichier audio.
      if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|\{\s*"(?:error|message)")/i.test(fileBuffer.subarray(0, 512).toString("utf8"))) {
        return res.status(415).json({ ok: false, error: "Ce fichier contient une page d'erreur, pas du son. Télécharge à nouveau le fichier audio.", message: messageServeur(req, "upload.htmlPage") });
      }

      const stamp = Date.now() + "-" + randomUUID().slice(0, 8) + "-";
      const converted = CONVERTED_EXTENSIONS.has(ext);
      const safeName = stamp + (converted ? path.basename(filename, path.extname(filename)) + ".mp3" : filename);
      const filePath = path.join(uploadDir, safeName);
      const sourcePath = converted ? path.join(uploadDir, ".source-" + stamp + "import" + ext) : filePath;
      try {
        fs.writeFileSync(sourcePath, fileBuffer, { flag: "wx", mode: 0o600 });
      } catch (err) {
        console.error("[upload-audio] Stockage impossible:", err.code || "unknown");
        return res.status(500).json({ ok: false, error: "Impossible de sauvegarder le fichier audio", message: messageServeur(req, "upload.saveFailed") });
      }

      if (converted) {
        try {
          await convertImpl(sourcePath, filePath);
          if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 100) throw new Error("sortie vide");
        } catch (err) {
          fs.rmSync(filePath, { force: true });
          console.warn("[upload-audio] Conversion impossible (" + ext + "):", String(err && err.message || err).slice(0, 160));
          return res.status(415).json({ ok: false, error: "Aucune piste audio lisible dans ce fichier", message: messageServeur(req, "upload.noAudioTrack") });
        } finally {
          fs.rmSync(sourcePath, { force: true });
        }
      }

      const savedSize = fs.statSync(filePath).size;
      const publicUrl = "/api/mcp-bridge/play-upload/" + safeName;
      console.log("[upload-audio] Saved:", safeName, "(" + Math.round(savedSize / 1024) + " Ko)" + (converted ? " converti depuis " + ext : ""));

      res.json({ ok: true, url: publicUrl, filename: safeName, size: savedSize, ...(converted ? { converted: true, sourceFormat: ext.slice(1) } : {}) });
    });

    req.on("error", (err) => {
      if (!res.headersSent && !res.destroyed) res.status(500).json({ ok: false, error: "Erreur réseau pendant l'import audio", message: messageServeur(req, "upload.network") });
    });
  });

  // Serve uploaded audio files
  app.get("/api/mcp-bridge/play-upload/:filename", (req, res) => {
    const filename = req.params.filename || "";
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(filename) || !AUDIO_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
      return res.status(404).json({ error: "Fichier introuvable" });
    }
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) {
      return res.status(404).json({ error: "Fichier introuvable" });
    }
    const ext = path.extname(filename).toLowerCase();
    const mimeMap = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac" };
    res.set("Content-Type", mimeMap[ext] || "audio/mpeg");
    res.set("Cache-Control", "public, max-age=3600");
    // Content-Length et Range permettent au lecteur de calculer la durée et
    // de chercher dans le morceau. Le flux brut laissait certains MP3 à Infinity.
    res.sendFile(path.resolve(filePath), { acceptRanges: true }, (err) => {
      if (err && !res.headersSent) res.status(err.statusCode || 500).end();
    });
  });

  console.log("[upload-audio] Route montée : POST /api/mcp-bridge/upload-audio + GET /api/mcp-bridge/play-upload/:filename");
}

module.exports = { mountUploadAudioRoute };
