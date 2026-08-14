"use strict";
/**
 * clip-vivy-director.cjs — Vivy analyse les paroles et génère les scènes du clip.
 *
 * Ce module est appelé par clip-generator avant de soumettre les vidéos.
 * Il récupère les paroles de la chanson et demande au LLM local de créer
 * 6 prompts visuels cohérents avec le contenu de la musique.
 *
 * Flow :
 *   1. Récupérer les paroles (depuis le store Vivy ou le titre)
 *   2. Envoyer au LLM local (gemma4 via /api/chat)
 *   3. Retourner un array de sections {name, visual, duration}
 */
const http = require("http");
const https = require("https");

const CHAT_URL = "http://127.0.0.1:3000/api/chat";
const SONGS_URL = "http://127.0.0.1:3000/api/vivy/stream/songs.json";
const TIMEOUT_MS = 30000;

function postJsonInternal(url, data) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data);
    var parsed = new URL(url);
    var mod = parsed.protocol === "https:" ? https : http;
    var req = mod.request(parsed, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-service": "a11-internal",
        "content-length": Buffer.byteLength(body)
      },
      timeout: TIMEOUT_MS
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

function getJsonInternal(url) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var mod = parsed.protocol === "https:" ? https : http;
    mod.get(parsed, { headers: { "x-internal-service": "a11-internal" }, timeout: 10000 }, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { resolve(null); }
      });
    }).on("error", reject);
  });
}

/**
 * Cherche les paroles d'une chanson par titre dans le store Vivy.
 */
async function findLyrics(title, songUrl) {
  try {
    var data = await getJsonInternal(SONGS_URL);
    if (!data || !data.songs) return null;
    var song = data.songs.find(function(s) {
      if (songUrl && s.trackUrl && songUrl.includes(s.trackUrl)) return true;
      var t = (s.trackTitle || s.title || "").toLowerCase();
      return t && title && t.includes(title.toLowerCase().slice(0, 20));
    });
    if (song && song.sharePath) {
      // Essayer de récupérer les paroles
      try {
        var lyricsUrl = "http://127.0.0.1:3000" + song.sharePath + "/paroles.txt";
        var lyricsData = await getJsonInternal(lyricsUrl);
        if (lyricsData && typeof lyricsData === "string") return lyricsData;
      } catch (e) { /* pas de paroles texte */ }
    }
    // Fallback : utiliser le coverPrompt qui contient souvent une description de la chanson
    if (song && song.coverPrompt) {
      // Extraire la partie pertinente du coverPrompt
      var match = song.coverPrompt.match(/Idée à représenter.*?:(.*?)(?:Lecture|Direction|Référence)/s);
      if (match) return match[1].trim();
      return song.coverPrompt.slice(0, 500);
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Demande au LLM de générer 6 scènes visuelles pour le clip.
 */
async function generateVisualScenes(title, lyrics, style) {
  var prompt = `Tu es Vivy, directrice artistique de clips musicaux pour Funesterie/NOSSEN.

Tu dois créer exactement 6 scènes visuelles pour un clip anime cinématique.

CHANSON : "${title || "sans titre"}"
${lyrics ? "PAROLES / CONTEXTE :\n" + lyrics.slice(0, 1500) : "Pas de paroles disponibles — base-toi sur le titre."}
${style ? "STYLE DEMANDÉ : " + style : ""}

RÈGLES :
- Chaque scène = 1 phrase en anglais décrivant un plan visuel précis
- Style anime cinématique, volumétrique, détaillé
- Les scènes doivent raconter une histoire cohérente avec les paroles
- Inclure des personnages : Djeff (homme, cheveux courts foncés, hoodie noir circuits) et/ou Vivy (cheveux longs dégradé violet-cyan, yeux lumineux, combinaison blanche violet)
- PAS de texte/mots dans l'image, PAS de titre
- Varier les plans : large, moyen, gros plan, mouvement

Réponds UNIQUEMENT avec un JSON array de 6 objets :
[{"name":"Nom court","visual":"Description anglais du plan visuel"}]

JSON :`;

  try {
    var response = await postJsonInternal(CHAT_URL, {
      message: prompt,
      model: "gemma4:e4b",
      stream: false
    });

    // Extraire le JSON de la réponse
    var text = response.message || response.content || response.response || response.raw || "";
    if (typeof text !== "string") text = JSON.stringify(text);
    
    // Chercher un array JSON dans la réponse
    var jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      var scenes = JSON.parse(jsonMatch[0]);
      if (Array.isArray(scenes) && scenes.length >= 3) {
        return scenes.slice(0, 6).map(function(s) {
          return {
            name: String(s.name || s.n || "Scène").slice(0, 20),
            visual: String(s.visual || s.v || s.description || "").slice(0, 300),
            duration: 15
          };
        });
      }
    }
  } catch (e) {
    console.warn("[clip-director] LLM indisponible :", e.message);
  }

  return null;
}

/**
 * Point d'entrée principal : analyse la chanson et retourne les scènes.
 * Fallback sur des scènes génériques si le LLM est indisponible.
 */
async function directClipScenes(config) {
  var title = config.title || "";
  var songUrl = config.songUrl || "";
  var style = config.style || "";
  var existingSections = config.sections;

  // Si des sections sont déjà fournies et non vides, les utiliser
  if (Array.isArray(existingSections) && existingSections.length > 0 && existingSections[0].visual) {
    console.log("[clip-director] Sections fournies par le client, on les garde.");
    return existingSections;
  }

  console.log("[clip-director] Analyse de la chanson : " + title);

  // 1. Chercher les paroles
  var lyrics = await findLyrics(title, songUrl);
  console.log("[clip-director] Paroles " + (lyrics ? "trouvées (" + lyrics.length + " chars)" : "non trouvées"));

  // 2. Demander au LLM
  var scenes = await generateVisualScenes(title, lyrics, style);
  if (scenes && scenes.length >= 3) {
    console.log("[clip-director] Vivy a généré " + scenes.length + " scènes visuelles");
    return scenes;
  }

  // 3. Fallback : scènes génériques basées sur le mood du titre
  console.log("[clip-director] Fallback : scènes génériques");
  return [
    { name: "Intro", visual: "Dark atmospheric opening, city lights in distance, figure silhouette, anticipation building, purple-cyan ambient glow", duration: 15 },
    { name: "Verse", visual: "Djeff in dark hoodie with circuit patterns, walking through neon-lit corridor, determined expression, volumetric light beams", duration: 15 },
    { name: "Hook", visual: "Vivy appears with flowing purple-to-cyan gradient hair, glowing eyes, singing into holographic microphone, particles swirling", duration: 15 },
    { name: "Build", visual: "Both characters on rooftop overlooking cyberpunk city, energy crackling between them, dramatic wind, camera orbiting", duration: 15 },
    { name: "Peak", visual: "Explosive climax, stage erupts with holographic effects, crowd silhouettes, confetti and laser beams, maximum energy", duration: 15 },
    { name: "Outro", visual: "Calm resolution, dawn light breaking through clouds, characters walking into golden horizon, peaceful, hopeful", duration: 15 }
  ];
}

module.exports = { directClipScenes, findLyrics, generateVisualScenes };
