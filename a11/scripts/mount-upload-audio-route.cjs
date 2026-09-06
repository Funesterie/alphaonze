"use strict";
/**
 * Route: POST /api/mcp-bridge/upload-audio
 * Accepts multipart/form-data with a "file" field (audio).
 * Saves to /app/runtime/uploads/ and returns the URL.
 * Requires multer (bundled in the backend).
 */
const fs = require("fs");
const path = require("path");

const UPLOAD_DIR = "/app/runtime/uploads";
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

function mountUploadAudioRoute(app) {
  // Ensure upload dir exists
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (size > MAX_SIZE) {
        return res.status(413).json({ ok: false, error: "Fichier trop volumineux (max 50 Mo)" });
      }

      const buffer = Buffer.concat(chunks);
      // Parse multipart boundary
      const boundary = contentType.split("boundary=")[1];
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

      // Save
      const safeName = Date.now() + "-" + filename;
      const filePath = path.join(UPLOAD_DIR, safeName);
      fs.writeFileSync(filePath, fileBuffer);

      const publicUrl = "/api/mcp-bridge/play-upload/" + safeName;
      console.log("[upload-audio] Saved:", safeName, "(" + Math.round(fileBuffer.length / 1024) + " Ko)");

      res.json({ ok: true, url: publicUrl, filename: safeName, size: fileBuffer.length });
    });

    req.on("error", (err) => {
      res.status(500).json({ ok: false, error: "Erreur réseau : " + err.message });
    });
  });

  // Serve uploaded audio files
  app.get("/api/mcp-bridge/play-upload/:filename", (req, res) => {
    const filename = (req.params.filename || "").replace(/[^a-zA-Z0-9._-]/g, "");
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Fichier introuvable" });
    }
    const ext = path.extname(filename).toLowerCase();
    const mimeMap = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac" };
    res.set("Content-Type", mimeMap[ext] || "audio/mpeg");
    res.set("Cache-Control", "public, max-age=3600");
    fs.createReadStream(filePath).pipe(res);
  });

  console.log("[upload-audio] Route montée : POST /api/mcp-bridge/upload-audio + GET /api/mcp-bridge/play-upload/:filename");
}

module.exports = { mountUploadAudioRoute };
