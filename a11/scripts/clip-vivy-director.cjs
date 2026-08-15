"use strict";
/**
 * clip-vivy-director.cjs — Vivy analyse les paroles et génère les scènes du clip.
 *
 * LLM Sol (via OpenRouter) pour le séquençage visuel.
 * LLM Grok (via OpenRouter) pour la couleur sonore/mood.
 */
const http = require("http");
const https = require("https");

const SONGS_URL = "http://127.0.0.1:3000/api/vivy/stream/songs.json";
const TIMEOUT_MS = 45000;

// Sol = séquençage visuel, Grok = couleur sonore — les deux via OpenRouter
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const SEQUENCE_MODEL = process.env.NOSSEN_SEQUENCE_MODEL || "openai/gpt-4o";
const MOOD_MODEL = process.env.NOSSEN_MOOD_MODEL || "xai/grok-3-mini";

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

function callOpenRouter(model, messages) {
  if (!OPENROUTER_KEY) return Promise.reject(new Error("OPENROUTER_API_KEY manquante"));
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({ model: model, messages: messages, max_tokens: 800, temperature: 0.7 });
    var parsed = new URL(OPENROUTER_URL);
    var req = https.request(parsed, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + OPENROUTER_KEY, "content-length": Buffer.byteLength(body) },
      timeout: TIMEOUT_MS
    }, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        try {
          var data = JSON.parse(Buffer.concat(chunks).toString());
          var text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
          resolve(text || "");
        } catch (e) { resolve(""); }
      });
    });
    req.on("error", reject);
    req.on("timeout", function() { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

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
      try {
        var lyricsData = await getJsonInternal("http://127.0.0.1:3000" + song.sharePath + "/paroles.txt");
        if (lyricsData && typeof lyricsData === "string") return lyricsData;
      } catch (e) {}
    }
    if (song && song.coverPrompt) {
      var match = song.coverPrompt.match(/Idée à représenter.*?:(.*?)(?:Lecture|Direction|Référence)/s);
      if (match) return match[1].trim();
      return song.coverPrompt.slice(0, 500);
    }
  } catch (e) {}
  return null;
}

async function generateVisualScenes(title, lyrics, style) {
  var prompt = "Crée 6 scènes visuelles pour un clip anime cinématique.\n\n" +
    "CHANSON : \"" + (title || "sans titre") + "\"\n" +
    (lyrics ? "PAROLES :\n" + lyrics.slice(0, 1500) + "\n\n" : "Base-toi sur le titre.\n\n") +
    "Chaque scène = 1 phrase anglaise, plan visuel précis.\n" +
    "Les visuels illustrent le sujet des paroles.\n" +
    "Style anime cinématique, plans variés.\n\n" +
    "JSON array de 6 objets :\n[{\"name\":\"Nom\",\"visual\":\"English visual description\"}]";

  try {
    var text = await callOpenRouter(SEQUENCE_MODEL, [{ role: "user", content: prompt }]);
    var jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      var scenes = JSON.parse(jsonMatch[0]);
      if (Array.isArray(scenes) && scenes.length >= 3) {
        console.log("[clip-director] Sol (" + SEQUENCE_MODEL + ") a généré " + scenes.length + " scènes");
        return scenes.slice(0, 6).map(function(s) {
          return { name: String(s.name || "Scène").slice(0, 20), visual: String(s.visual || "").slice(0, 300), duration: 15 };
        });
      }
    }
    console.warn("[clip-director] Sol réponse inutilisable:", text.slice(0, 80));
  } catch (e) {
    console.warn("[clip-director] Sol erreur:", e.message);
  }
  return null;
}

async function directClipScenes(config) {
  var title = config.title || "";
  var songUrl = config.songUrl || "";
  var style = config.style || "";
  var existingSections = config.sections;

  if (Array.isArray(existingSections) && existingSections.length > 0 && existingSections[0].visual) {
    console.log("[clip-director] Sections client, on les garde.");
    return existingSections;
  }

  console.log("[clip-director] Analyse : " + title + " (Sol=" + SEQUENCE_MODEL + ")");
  var lyrics = await findLyrics(title, songUrl);
  console.log("[clip-director] Paroles " + (lyrics ? "trouvées (" + lyrics.length + " chars)" : "non trouvées"));

  var scenes = await generateVisualScenes(title, lyrics, style);
  if (scenes && scenes.length >= 3) return scenes;

  console.log("[clip-director] Fallback génériques");
  return [
    { name: "Intro", visual: "Dark atmospheric opening, city lights in distance, silhouette, anticipation building", duration: 15 },
    { name: "Verse", visual: "Main character walking through lit corridor, determined expression, volumetric light", duration: 15 },
    { name: "Hook", visual: "Energy burst, dynamic movement, particles swirling, dramatic lighting shift", duration: 15 },
    { name: "Build", visual: "Wide shot cityscape from rooftop, wind blowing, dramatic clouds, camera orbiting", duration: 15 },
    { name: "Peak", visual: "Explosive climax, maximum visual energy, holographic effects, laser beams", duration: 15 },
    { name: "Outro", visual: "Calm resolution, dawn light breaking through clouds, walking into golden horizon", duration: 15 }
  ];
}

module.exports = { directClipScenes, findLyrics, generateVisualScenes, callOpenRouter, SEQUENCE_MODEL, MOOD_MODEL };
