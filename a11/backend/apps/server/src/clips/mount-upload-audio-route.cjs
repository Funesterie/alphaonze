"use strict";
/**
 * Route: POST /api/mcp-bridge/upload-audio
 * Accepts multipart/form-data with a "file" field (audio).
 * Saves to /app/runtime/uploads/ and returns the URL.
 */
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const UPLOAD_DIR = path.join(process.env.A11_RUNTIME_ROOT || "/app/runtime", "uploads");
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"]);

function mountUploadAudioRoute(app, { uploadDir = UPLOAD_DIR } = {}) {
  // Ensure upload dir exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Simple multipart handler without multer (raw buffer approach)
  app.post("/api/mcp-bridge/upload-audio", (req, res) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({ ok: false, error: "multipart/form-data requis" });
    }

    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        chunks.length = 0;
        if (!res.headersSent) res.status(413).json({ ok: false, error: "Fichier trop volumineux (max 50 Mo)" });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (res.headersSent) return;
      if (size > MAX_SIZE) {
        return res.status(413).json({ ok: false, error: "Fichier trop volumineux (max 50 Mo)" });
      }

      const buffer = Buffer.concat(chunks);
      // Parse multipart boundary
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
      const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]);
      if (!boundary) {
        return res.status(400).json({ ok: false, error: "Boundary multipart manquant" });
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
        return res.status(400).json({ ok: false, error: "Aucun fichier audio trouvé dans la requête" });
      }

      if (!AUDIO_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
        return res.status(415).json({ ok: false, error: "Format audio requis : mp3, m4a, aac, wav, ogg ou flac" });
      }
      // Une page d'erreur sauvegardée en .mp3 ne devient pas un fichier audio.
      if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|\{\s*"(?:error|message)")/i.test(fileBuffer.subarray(0, 512).toString("utf8"))) {
        return res.status(415).json({ ok: false, error: "Ce fichier contient une page d'erreur, pas du son. Télécharge à nouveau le fichier audio." });
      }

      // Save
      const safeName = Date.now() + "-" + randomUUID().slice(0, 8) + "-" + filename;
      const filePath = path.join(uploadDir, safeName);
      try {
        fs.writeFileSync(filePath, fileBuffer, { flag: "wx", mode: 0o600 });
      } catch (err) {
        console.error("[upload-audio] Stockage impossible:", err.code || "unknown");
        return res.status(500).json({ ok: false, error: "Impossible de sauvegarder le fichier audio" });
      }

      const publicUrl = "/api/mcp-bridge/play-upload/" + safeName;
      console.log("[upload-audio] Saved:", safeName, "(" + Math.round(fileBuffer.length / 1024) + " Ko)");

      res.json({ ok: true, url: publicUrl, filename: safeName, size: fileBuffer.length });
    });

    req.on("error", (err) => {
      if (!res.headersSent && !res.destroyed) res.status(500).json({ ok: false, error: "Erreur réseau pendant l'import audio" });
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
