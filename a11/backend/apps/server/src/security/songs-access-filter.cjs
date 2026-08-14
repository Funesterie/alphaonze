"use strict";
/**
 * songs-access-filter.cjs — Filtrage des chansons par utilisateur côté serveur.
 *
 * Ce module wrap l'endpoint /api/vivy/stream/songs.json pour ne retourner
 * que les chansons appartenant à l'utilisateur authentifié.
 *
 * Logique :
 *   - Admin (ZEN_GATE_ADMIN_EMAILS) → voit tout
 *   - Utilisateur authentifié → voit ses chansons (filtre par requestedBy)
 *   - Non authentifié → liste vide (pas d'erreur, juste 0 résultat)
 *
 * Usage : montez ce middleware AVANT le store vivy-stream :
 *   const { filterSongsByUser } = require('./src/security/songs-access-filter.cjs');
 *   app.get('/api/nossen/my-songs', filterSongsByUser(getVivyStore));
 */

const ADMIN_EMAILS = (process.env.ZEN_GATE_ADMIN_EMAILS || "cellaurojeffrey@gmail.com")
  .split(",").map(function(e) { return e.trim().toLowerCase(); });

/**
 * Détermine si un utilisateur est admin.
 */
function isAdminUser(user) {
  if (!user || !user.email) return false;
  return ADMIN_EMAILS.includes(user.email.toLowerCase());
}

/**
 * Détermine si une chanson appartient à un utilisateur.
 */
function songBelongsToUser(song, user) {
  if (!user || !user.email) return false;
  var requestedBy = (song.requestedBy || "").toLowerCase();
  if (!requestedBy) return false;
  var email = user.email.toLowerCase();
  var prefix = email.split("@")[0];
  var displayName = (user.displayName || user.name || "").toLowerCase();
  return requestedBy === email
    || requestedBy === prefix
    || (displayName && requestedBy === displayName)
    || requestedBy.indexOf(prefix) !== -1;
}

/**
 * Crée un handler Express qui retourne les chansons filtrées.
 * @param {Function} getStore - Fonction qui retourne le store Vivy (avec .getState())
 */
function filterSongsByUser(getStore) {
  return function(req, res) {
    var user = req.user || (req.session && req.session.user) || null;
    var store = getStore();
    var state = store ? store.getState() : {};
    var allSongs = Array.isArray(state.songs) ? state.songs : [];

    var filteredSongs;
    if (user && isAdminUser(user)) {
      filteredSongs = allSongs;
    } else if (user) {
      filteredSongs = allSongs.filter(function(s) { return songBelongsToUser(s, user); });
    } else {
      filteredSongs = [];
    }

    res.set("Cache-Control", "private, no-store");
    res.json({
      ok: true,
      songs: filteredSongs,
      count: filteredSongs.length,
      total: allSongs.length,
      filtered: !user || !isAdminUser(user),
      serverNow: new Date().toISOString(),
    });
  };
}

/**
 * Middleware standalone qui filtre un tableau songs déjà résolu.
 */
function filterSongsArray(songs, user) {
  if (!user) return [];
  if (isAdminUser(user)) return songs;
  return songs.filter(function(s) { return songBelongsToUser(s, user); });
}

module.exports = {
  filterSongsByUser,
  filterSongsArray,
  isAdminUser,
  songBelongsToUser,
};
