"use strict";
/**
 * Worker: Renommage automatique des chansons avec titres doublons/génériques.
 *
 * Utilise le LLM local via /api/chat (qui route vers Ollama gemma4)
 * pour analyser les paroles et proposer un titre poétique.
 *
 * Usage: node rename-duplicate-titles.cjs [--dry-run]
 */
const fs = require("fs");
const http = require("http");

const CATALOG_FILE = "/agent-bus/vivy-songs-catalog.json";
const SONGS_API = "http://127.0.0.1:3000/api/vivy/stream/songs.json";
const OLLAMA_URL = process.env.OLLAMA_BASE || process.env.A11_OLLAMA_BASE || "http://a11-ollama:11434";
const OLLAMA_MODEL = process.env.LOCAL_DEFAULT_MODEL || "gemma4:e4b";
const DRY_RUN = process.argv.includes("--dry-run");

const GENERIC_TITLES = [
  "session principale",
  "sans titre",
  "untitled",
  "nouveau",
  "test",
  "vivy 2026",
];

function isGenericTitle(title) {
  var lower = (title || "").toLowerCase().trim();
  return GENERIC_TITLES.some(function(g) { return lower === g || lower.startsWith(g); });
}

function postJson(url, data) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data);
    var parsed = new URL(url);
    var req = http.request(parsed, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-service": "a11-internal",
        "content-length": Buffer.byteLength(body)
      },
      timeout: 45000
    }, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { resolve({ raw: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", function() { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

function getJson(url) {
  return new Promise(function(resolve, reject) {
    http.get(url, { headers: { "x-internal-service": "a11-internal" }, timeout: 10000 }, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { resolve(null); }
      });
    }).on("error", reject);
  });
}

async function findLyricsForSong(song) {
  // Chercher les paroles via le sharePath dans le store Vivy
  try {
    var data = await getJson(SONGS_API);
    if (!data || !data.songs) return null;
    var match = data.songs.find(function(s) {
      var t = (s.trackTitle || s.title || "").toLowerCase();
      // Match par URL ou par date+taille similaire
      if (song.path && s.trackUrl && song.path.includes(s.trackUrl.split("/").pop())) return true;
      if (song.filename && s.trackUrl && s.trackUrl.includes(song.filename.slice(0, 20))) return true;
      return false;
    });
    if (match && match.sharePath) {
      try {
        var lyricsResp = await getJson("http://127.0.0.1:3000" + match.sharePath + ".json");
        if (lyricsResp && lyricsResp.lyrics) return lyricsResp.lyrics;
      } catch (e) {}
    }
    // Fallback: coverPrompt contient souvent le sujet
    if (match && match.coverPrompt) {
      var m = match.coverPrompt.match(/Idée à représenter.*?:(.*?)(?:Lecture|Direction|Référence)/s);
      return m ? m[1].trim().slice(0, 500) : null;
    }
  } catch (e) {}
  return null;
}

async function askLlmForTitle(context, filename) {
  var prompt = "Tu es Vivy, artiste musicale Funesterie. " +
    "Propose UN titre court (2 à 4 mots maximum) pour cette chanson. " +
    "Le titre doit être poétique, évocateur, en français. " +
    "Pas de guillemets, pas de numéro, pas de date, juste le titre.\n\n";

  if (context) {
    prompt += "Contexte/paroles de la chanson :\n" + context.slice(0, 800) + "\n\n";
  } else {
    // Extraire du filename
    var raw = filename
      .replace(/^v\d+[a-z]*_\d+_[0-9a-f]+-/, "")
      .replace(/[-_]funesterie[-_]d\d+[-_]v\d+[a-z]*[-_]v\d+[a-z]*\.mp3$/i, "")
      .replace(/\.mp3$|\.m4a$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (raw && raw.toLowerCase() !== "session principale") {
      prompt += "Mots-clés extraits du fichier : " + raw + "\n\n";
    } else {
      prompt += "Aucune info disponible. Invente un titre original et mystérieux.\n\n";
    }
  }

  prompt += "Titre :";

  try {
    var response = await postJson(OLLAMA_URL + "/api/generate", {
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      options: { temperature: 0.7, num_predict: 30 }
    });
    var text = response.response || response.message || "";
    if (typeof text !== "string") text = JSON.stringify(text);
    // Nettoyer la réponse
    var title = text
      .replace(/^["'\s*-]+|["'\s.*-]+$/g, "")
      .replace(/\n.*/s, "")
      .replace(/^titre\s*:\s*/i, "")
      .replace(/["""]/g, "")
      .trim();
    // Valider
    if (title.length >= 2 && title.length <= 50 && !/session principale/i.test(title)) {
      // Filtrer les réponses parasites du LLM (se présente au lieu de titrer)
      if (/^(je suis|je m'appelle|je me|bonjour|voici|bien sûr|certainement|avec plaisir)/i.test(title)) return null;
      if (/^(titre|voilà|ok|d'accord|hmm)/i.test(title)) return null;
      if (title.split(" ").length > 6) return null; // Trop long = pas un titre
      // Capitalize proprement
      return title.charAt(0).toUpperCase() + title.slice(1);
    }
  } catch (e) {
    console.warn("[rename] LLM erreur :", e.message);
  }
  return null;
}

async function main() {
  console.log("[rename] Chargement du catalogue…");

  if (!fs.existsSync(CATALOG_FILE)) {
    console.log("[rename] Catalogue introuvable");
    process.exit(0);
  }

  var catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
  var songs = catalog.songs || [];

  if (!songs.length) {
    console.log("[rename] Catalogue vide");
    process.exit(0);
  }

  // Trouver les doublons et les titres génériques
  var counts = {};
  songs.forEach(function(s) { var k = (s.title || "").toLowerCase().trim(); counts[k] = (counts[k] || 0) + 1; });

  var toRename = songs.filter(function(s) {
    var key = (s.title || "").toLowerCase().trim();
    return isGenericTitle(s.title) || (counts[key] || 0) > 1;
  });

  console.log("[rename] " + toRename.length + " chanson(s) à renommer sur " + songs.length);

  if (!toRename.length) {
    console.log("[rename] Rien à faire");
    process.exit(0);
  }

  var renamed = 0;
  var usedTitles = new Set(songs.map(function(s) { return (s.title || "").toLowerCase(); }));

  for (var i = 0; i < toRename.length; i++) {
    var song = toRename[i];

    // Chercher les paroles
    var lyrics = await findLyricsForSong(song);

    // Demander au LLM
    var newTitle = await askLlmForTitle(lyrics, song.filename);

    // S'assurer que le titre est unique
    if (newTitle && usedTitles.has(newTitle.toLowerCase())) {
      // Ajouter un suffixe léger basé sur la date
      var dateSuffix = song.date ? " (" + song.date.slice(5) + ")" : "";
      newTitle = newTitle + dateSuffix;
    }

    if (!newTitle) {
      // Dernier fallback : extrait du filename sans numéros
      var raw = song.filename
        .replace(/^v\d+[a-z]*_\d+_[0-9a-f]+-/, "")
        .replace(/[-_]funesterie.*$/i, "")
        .replace(/[-_]+/g, " ")
        .trim()
        .slice(0, 30);
      if (raw && raw.toLowerCase() !== "session principale") {
        newTitle = raw.split(" ").slice(0, 4).map(function(w) {
          return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).join(" ");
      }
    }

    if (!newTitle || newTitle === song.title) continue;

    console.log("[rename] " + (DRY_RUN ? "(dry) " : "") + "\"" + song.title + "\" → \"" + newTitle + "\"");
    usedTitles.add(newTitle.toLowerCase());

    if (!DRY_RUN) {
      song.title = newTitle;
      renamed++;
    }

    // Petit délai entre les appels LLM pour pas surcharger
    await new Promise(function(r) { setTimeout(r, 1500); });
  }

  if (!DRY_RUN && renamed > 0) {
    catalog.songs = songs;
    catalog.lastRenamed = new Date().toISOString();
    catalog.renameCount = (catalog.renameCount || 0) + renamed;
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
    console.log("[rename] " + renamed + " titre(s) renommé(s)");
  } else {
    console.log("[rename] " + (DRY_RUN ? "Dry run terminé" : "Aucun changement"));
  }
}

main().catch(function(err) {
  console.error("[rename] Erreur :", err.message);
  process.exit(1);
});
