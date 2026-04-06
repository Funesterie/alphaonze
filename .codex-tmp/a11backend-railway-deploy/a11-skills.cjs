"use strict";

// apps/server/a11-skills.cjs
// Routes /v1/a11/skill* qui délèguent à Qflush si disponible.

function getQflush() {
  // récupère infos mises dans globalThis par server.cjs
  const mod = globalThis.__QFLUSH_MODULE;
  const path = globalThis.__QFLUSH_PATH;
  const available = !!globalThis.__QFLUSH_AVAILABLE;
  return { available, mod, path };
}

/**
 * Attache les routes liées aux skills A-11
 * @param {import('express').Express} app
 */
function attachA11SkillsRoutes(app) {
  const { available, mod } = getQflush();

  if (!available) {
    console.log("[A11][SKILLS] Qflush non disponible, routes limitées.");
  } else {
    console.log("[A11][SKILLS] Qflush détecté, activation des routes skill.");
  }

  // ping simple
  app.get("/v1/a11/skills/health", (req, res) => {
    const { available } = getQflush();
    res.json({
      ok: true,
      qflush_available: available,
    });
  });

  // exécuter une skill via Qflush (si dispo)
  app.post("/v1/a11/skill", async (req, res) => {
    const { available, mod } = getQflush();
    if (!available || !mod) {
      return res
        .status(501)
        .json({ ok: false, error: "qflush_not_available" });
    }

    const body = req.body || {};
    const skill = body.skill;
    const payload = body.payload || {};

    if (!skill) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_skill_name" });
    }

    try {
      const fn = mod.scream || mod.runSkill || mod.default;
      if (typeof fn !== "function") {
        return res
          .status(500)
          .json({ ok: false, error: "qflush_entrypoint_not_found" });
      }

      const result = await fn(skill, payload);
      res.json({ ok: true, result });
    } catch (e) {
      console.error("[A11][SKILLS] skill error:", e && e.message);
      res.status(500).json({ ok: false, error: String(e && e.message || e) });
    }
  });
}

module.exports = {
  attachA11SkillsRoutes,
};
