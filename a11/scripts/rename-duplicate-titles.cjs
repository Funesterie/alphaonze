"use strict";
/**
 * Worker: Renommage automatique des chansons avec titres doublons.
 * 
 * Scanne le catalogue Vivy, trouve les titres génériques/doublons
 * ("Session Principale", "Sans titre", etc.) et utilise le LLM local
 * (Ollama qwen2.5:7b) pour proposer un titre basé sur le contexte du fichier.
 * 
 * Usage: node rename-duplicate-titles.cjs [--dry-run]
 * 
 * Ce worker est conçu pour être lancé par Vivy quand elle s'ennuie,
 * ou en cron toutes les heures.
 */
const fs = require("fs");
const path = require("path");

const CATALOG_FILE = "/agent-bus/vivy-songs-catalog.json";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.RENAME_MODEL || "qwen2.5:7b";
const DRY_RUN = process.argv.includes("--dry-run");

// Titres considérés comme génériques (doublons à renommer)
const GENERIC_TITLES = [
  "session principale",
  "sans titre",
  "untitled",
  "nouveau",
  "test",
  "brouillon",
];

function isGenericTitle(title) {
  const lower = (title || "").toLowerCase().trim();
  return GENERIC_TITLES.some(g => lower === g || lower.startsWith(g + " "));
}

function countDuplicates(songs) {
  const counts = {};
  songs.forEach(s => {
    const key = (s.title || "").toLowerCase().trim();
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

async function askOllama(prompt) {
  try {
    const response = await fetch(OLLAMA_URL + "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.7, num_predict: 30 },
      }),
    });
    if (!response.ok) throw new Error("Ollama " + response.status);
    const data = await response.json();
    return (data.response || "").trim();
  } catch (err) {
    console.warn("[rename] Ollama indisponible :", err.message);
    return null;
  }
}

function extractContextFromFilename(filename) {
  // Extraire le texte brut du nom de fichier (après le hash, avant le suffixe)
  let text = filename
    .replace(/^v\d+[a-z]*_\d+_[0-9a-f]+-/, "")  // v11pan_timestamp_hash-
    .replace(/[-_]funesterie[-_]d\d+[-_]v\d+[a-z]*[-_]v\d+[a-z]*\.mp3$/i, "")
    .replace(/[-_]v10boom[-_]input\.mp3$/i, "")
    .replace(/\.mp3$|\.m4a$|\.wav$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return text;
}

async function suggestTitle(song) {
  const context = extractContextFromFilename(song.filename);
  
  // Si le contexte du filename est déjà riche, l'utiliser directement
  if (context.length > 10 && context.toLowerCase() !== "session principale") {
    // Demander au LLM de transformer en titre court et poétique
    const prompt = `Tu es Vivy, artiste musicale. Voici un extrait du contexte d'une chanson : "${context}".
Propose UN titre court (2-4 mots max) en français, poétique et évocateur. Pas de guillemets, juste le titre.`;
    
    const suggestion = await askOllama(prompt);
    if (suggestion && suggestion.length > 1 && suggestion.length < 50) {
      // Nettoyer
      return suggestion.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\.$/, "");
    }
    // Fallback : formatter le contexte comme titre
    return context.split(" ").slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
  
  // Si le contexte est pauvre, utiliser la date + un numéro
  const date = song.date || new Date().toISOString().slice(0, 10);
  const hash = (song.filename.match(/[0-9a-f]{8}/) || [""])[0].slice(0, 4);
  return "Vivy " + date + (hash ? " #" + hash : "");
}

async function main() {
  console.log("[rename] Chargement du catalogue…");
  
  if (!fs.existsSync(CATALOG_FILE)) {
    console.log("[rename] Catalogue introuvable :", CATALOG_FILE);
    process.exit(0);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
  const songs = catalog.songs || [];
  
  if (!songs.length) {
    console.log("[rename] Catalogue vide.");
    process.exit(0);
  }

  const counts = countDuplicates(songs);
  const toRename = songs.filter(s => {
    const key = (s.title || "").toLowerCase().trim();
    return isGenericTitle(s.title) || (counts[key] || 0) > 1;
  });

  console.log("[rename] " + toRename.length + " chanson(s) à renommer sur " + songs.length + " au total.");
  
  if (!toRename.length) {
    console.log("[rename] Rien à faire.");
    process.exit(0);
  }

  let renamed = 0;
  for (const song of toRename) {
    const newTitle = await suggestTitle(song);
    if (!newTitle || newTitle === song.title) continue;
    
    console.log("[rename] " + (DRY_RUN ? "(dry) " : "") + '"' + song.title + '" → "' + newTitle + '"');
    
    if (!DRY_RUN) {
      song.title = newTitle;
      renamed++;
    }
  }

  if (!DRY_RUN && renamed > 0) {
    catalog.songs = songs;
    catalog.lastRenamed = new Date().toISOString();
    catalog.renameCount = (catalog.renameCount || 0) + renamed;
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
    console.log("[rename] Catalogue mis à jour : " + renamed + " titre(s) renommé(s).");
  } else {
    console.log("[rename] " + (DRY_RUN ? "Dry run terminé." : "Aucun changement."));
  }
}

main().catch(err => {
  console.error("[rename] Erreur :", err.message);
  process.exit(1);
});
