"use strict";

const {
  processProtectMixD40,
  D40_PROFILES,
} = require("../audio/double-harmonic-d40.cjs");

function registerVivyLayerRoute(router, getRequireAuth, deps) {
  const express = deps.express;
  const cleanOneLine = deps.cleanOneLine;
  const materializeVivyPreviewInstrumentalPath = deps.materializeVivyPreviewInstrumentalPath;
  const getVivyPreviewAssetFilename = deps.getVivyPreviewAssetFilename;
  const getEmergencyMediaAssetPath = deps.getEmergencyMediaAssetPath;
  const crypto = deps.crypto;
  const fs = deps.fs;
  const path = deps.path;

  async function runVivyLayerApply(audioUrl, profile, intensity) {
    const safeProfile = D40_PROFILES && Object.prototype.hasOwnProperty.call(D40_PROFILES, profile) ? profile : "blend";
    let sourcePath = String();
    try {
      sourcePath = await materializeVivyPreviewInstrumentalPath(audioUrl);
    } catch (error) {
      const wrapped = new Error(String((error && error.message) || "vivy_layer_source_denied"));
      wrapped.status = (error && error.status) || 400;
      throw wrapped;
    }
    if (!sourcePath) {
      const fallbackName = getVivyPreviewAssetFilename(audioUrl);
      const fallbackPath = fallbackName ? getEmergencyMediaAssetPath(fallbackName) : String();
      if (fallbackPath && fs.existsSync(fallbackPath) && fs.statSync(fallbackPath).isFile()) {
        sourcePath = fallbackPath;
      }
    }
    if (!sourcePath) {
      const error = new Error("vivy_layer_source_invalid");
      error.status = 400;
      throw error;
    }
    const digest = crypto.createHash("sha1").update(sourcePath + "\n" + safeProfile + "\n" + String(Date.now())).digest("hex").slice(0, 10);
    const filename = "vivy-layer-" + Date.now() + "-" + digest + ".mp3";
    const outputPath = getEmergencyMediaAssetPath(filename);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const seal = await processProtectMixD40({ inputPath: sourcePath, outputPath, profile: safeProfile, intensity });
    if (!fs.existsSync(outputPath)) {
      const error = new Error("vivy_layer_output_missing");
      error.status = 500;
      throw error;
    }
    const url = "/api/vivy/studio/assets/" + encodeURIComponent(filename);
    return {
      ok: true,
      kind: "audio",
      provider: "vivy-d40-layer",
      filename,
      url,
      audioUrl: url,
      audio_url: url,
      content_type: "audio/mpeg",
      voiceManifest: seal,
    };
  }

  router.post("/apply-vivy-layer", (req, res, next) => {
    const auth = getRequireAuth();
    if (typeof auth === "function") return auth(req, res, next);
    return next();
  }, express.json({ limit: "16kb" }), async (req, res) => {
    try {
      const audioUrl = cleanOneLine(req.body && req.body.audioUrl, String(), 1000);
      const profile = cleanOneLine(req.body && req.body.profile, String(), 40);
      const intensity = Number(req.body && req.body.intensity);
      const media = await runVivyLayerApply(audioUrl, profile, Number.isFinite(intensity) ? intensity : undefined);
      return res.json(Object.assign({ ok: true, media }, media));
    } catch (error) {
      return res.status(error && error.status ? error.status : 500).json({
        ok: false,
        error: "vivy_layer_apply_failed",
        message: String((error && error.message) || error),
      });
    }
  });
}

module.exports = { registerVivyLayerRoute };