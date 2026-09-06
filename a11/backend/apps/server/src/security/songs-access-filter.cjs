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

const GENERIC_TITLES = ["session principale", "sans titre", "untitled", "nouveau", "test", "vivy 2026", "morceau vivy", "vivy live"];

/**
 * Détecte les titres génériques.
 */
function isGenericTitle(title) {
  if (!title) return true;
  var lower = title.toLowerCase().trim();
  return GENERIC_TITLES.some(function(g) { return lower === g || lower.startsWith(g + " "); });
}

/**
 * Extrait un titre depuis le coverPrompt ou les métadonnées de la chanson.
 */
function inferTitleFromSong(song) {
  // Essayer le coverPrompt (contient souvent "Idée à représenter : ...")
  if (song.coverPrompt) {
    var m = song.coverPrompt.match(/Idée.*?:\s*(.+?)(?:\.|Lecture|Direction|Référence|\n)/is);
    if (m && m[1]) {
      var inferred = m[1].trim().slice(0, 50).replace(/["""]/g, "");
      if (inferred.length >= 3 && !isGenericTitle(inferred)) {
        return inferred.charAt(0).toUpperCase() + inferred.slice(1);
      }
    }
  }
  // Essayer le filename
  if (song.filename || (song.trackUrl && song.trackUrl.includes("/"))) {
    var filename = song.filename || song.trackUrl.split("/").pop() || "";
    var cleaned = filename
      .replace(/\.\w{2,4}$/, "")
      .replace(/^v\d+[a-z]*_\d+_[0-9a-f]+-/i, "")
      .replace(/[-_]funesterie.*$/i, "")
      .replace(/^\d{10,}-/, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (cleaned.length >= 3 && !isGenericTitle(cleaned)) {
      return cleaned.split(" ").slice(0, 5).map(function(w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }).join(" ");
    }
  }
  return null;
}

/**
 * Déduplique par trackUrl et corrige les titres génériques.
 */
function deduplicateAndFixTitles(songs) {
  var seen = new Set();
  var result = [];
  for (var i = 0; i < songs.length; i++) {
    var song = songs[i];
    var key = song.trackUrl || song.id || ("idx-" + i);
    if (seen.has(key)) continue;
    seen.add(key);

    // Corriger le titre générique à la volée
    var title = song.trackTitle || song.title;
    if (isGenericTitle(title)) {
      var better = inferTitleFromSong(song);
      if (better) {
        song = Object.assign({}, song, { trackTitle: better, title: better });
      }
    }
    result.push(song);
  }
  return result;
}

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

    // Dédupliquer par trackUrl et corriger les titres génériques
    filteredSongs = deduplicateAndFixTitles(filteredSongs);

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
  deduplicateAndFixTitles,
  isAdminUser,
  songBelongsToUser,
  isGenericTitle,
  inferTitleFromSong,
};
