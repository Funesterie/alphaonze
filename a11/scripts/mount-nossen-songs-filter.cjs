"use strict";
/**
 * Monte GET /api/nossen/my-songs — retourne les chansons filtrées par utilisateur.
 * Utilise le même store Vivy mais avec filtrage côté serveur.
 */
const { filterSongsArray, isAdminUser } = require("/app/src/security/songs-access-filter.cjs");

function mountNossenSongsFilter(app, getVivyStore) {
  app.get("/api/nossen/my-songs", (req, res) => {
    const user = req.user || (req.session && req.session.user) || null;
    let allSongs = [];

    // Essayer le store Vivy
    if (typeof getVivyStore === "function") {
      try {
        const store = getVivyStore();
        const state = store ? store.getState() : {};
        allSongs = Array.isArray(state.songs) ? state.songs : [];
      } catch (e) { /* fallback */ }
    }

    // Filtrer
    const filtered = filterSongsArray(allSongs, user);

    res.set("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      songs: filtered,
      count: filtered.length,
      total: allSongs.length,
      filtered: !user || !isAdminUser(user),
      authenticated: !!(user && user.email),
    });
  });

  console.log("[nossen] Route filtrée montée : GET /api/nossen/my-songs");
}

module.exports = { mountNossenSongsFilter };
