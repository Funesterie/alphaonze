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

// Sol = séquençage visuel via OpenAI direct, Grok = couleur sonore via OpenRouter
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_KEY = process.env.NOSSEN_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
// Identifiants verifies par appel reel le 15/08/2026 depuis le conteneur de prod.
// Les precedents ne repondaient pas : "chatgpt-4o-latest" -> 404 pas d'acces sur
// cette cle, "xai/grok-3" -> 400 identifiant invalide (le prefixe OpenRouter est
// "x-ai/", et grok-3 puis grok-4 sont deprecies au profit de grok-4.3).
const SEQUENCE_MODEL = process.env.NOSSEN_SEQUENCE_MODEL || "gpt-4o";
const MOOD_MODEL = process.env.NOSSEN_MOOD_MODEL || "x-ai/grok-4.3";

function getTextInternal(url) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var mod = parsed.protocol === "https:" ? https : http;
    mod.get(parsed, { headers: { "x-internal-service": "a11-internal" }, timeout: 10000 }, function(res) {
      if (res.statusCode >= 400) { res.resume(); return resolve(null); }
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() { resolve(Buffer.concat(chunks).toString("utf8")); });
    }).on("error", reject);
  });
}

// paroles.txt est servi en text/plain : le passer par JSON.parse le perdait
// silencieusement et le director retombait sur coverPrompt (prompt de pochette).
function getJsonInternal(url) {
  return getTextInternal(url).then(function(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  });
}

function callOpenRouter(model, messages) {
  // Sol utilise l'API OpenAI directe, Grok utilise OpenRouter
  var isOpenAI = !model.includes("/"); // "chatgpt-4o-latest" vs "xai/grok-3"
  var url = isOpenAI ? OPENAI_URL : OPENROUTER_URL;
  var key = isOpenAI ? OPENAI_KEY : OPENROUTER_KEY;
  if (!key) return Promise.reject(new Error(isOpenAI ? "NOSSEN_OPENAI_API_KEY manquante" : "OPENROUTER_API_KEY manquante"));
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({ model: model, messages: messages, max_tokens: 800, temperature: 0.7 });
    var parsed = new URL(url);
    var req = https.request(parsed, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + key, "content-length": Buffer.byteLength(body) },
      timeout: TIMEOUT_MS
    }, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        var body = Buffer.concat(chunks).toString();
        // Un statut d'erreur doit remonter. Avant, tout echec devenait une chaine
        // vide et ressortait en "reponse inutilisable" : un modele inexistant, un
        // quota depasse et une cle revoquee etaient indiscernables.
        if (res.statusCode !== 200) {
          var detail = "";
          try { var err = JSON.parse(body); detail = (err.error && (err.error.message || err.error.code)) || ""; } catch (e) {}
          return reject(new Error("HTTP " + res.statusCode + " sur " + model + (detail ? " : " + String(detail).slice(0, 160) : "")));
        }
        try {
          var data = JSON.parse(body);
          var text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
          resolve(text || "");
        } catch (e) { reject(new Error("Reponse illisible de " + model)); }
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
        var lyricsText = await getTextInternal("http://127.0.0.1:3000" + song.sharePath + "/paroles.txt");
        if (lyricsText && lyricsText.trim().length > 40) return lyricsText.trim();
      } catch (e) {}
    }
    if (song && song.lyrics && String(song.lyrics).trim().length > 40) return String(song.lyrics).trim();
    if (song && song.coverPrompt) {
      var match = song.coverPrompt.match(/Idée à représenter.*?:(.*?)(?:Lecture|Direction|Référence)/s);
      if (match) return match[1].trim();
      return song.coverPrompt.slice(0, 500);
    }
  } catch (e) {}
  return null;
}

/**
 * Couleur sonore par Grok.
 *
 * MOOD_MODEL etait declare et exporte depuis le debut, mais aucun appel ne
 * l'utilisait : la "couleur sonore" annoncee n'existait pas. Grok lit les
 * paroles et rend une direction visuelle courte (palette, lumiere, energie) que
 * Sol recoit ensuite comme contrainte de sequencage.
 *
 * Un echec ici n'est jamais bloquant : sans mood, Sol travaille comme avant.
 */
async function generateMood(title, lyrics) {
  if (!OPENROUTER_KEY) {
    console.log("[clip-director] Grok non configure (OPENROUTER_API_KEY), mood ignore.");
    return "";
  }
  var prompt = "Tu donnes la couleur visuelle d'un clip a partir d'une chanson.\n\n" +
    "TITRE : \"" + (title || "sans titre") + "\"\n" +
    (lyrics ? "PAROLES :\n" + lyrics.slice(0, 1200) + "\n\n" : "Base-toi sur le titre.\n\n") +
    "Reponds en 2 phrases maximum, en anglais, uniquement sur : palette de couleurs, " +
    "qualite de lumiere, niveau d'energie et rythme de montage. " +
    "Pas de personnages, pas d'intrigue, pas de texte a l'image.";
  try {
    var text = await callOpenRouter(MOOD_MODEL, [{ role: "user", content: prompt }]);
    var mood = String(text || "").trim().slice(0, 400);
    if (mood) console.log("[clip-director] Grok (" + MOOD_MODEL + ") mood: " + mood.slice(0, 80));
    return mood;
  } catch (e) {
    console.warn("[clip-director] Grok mood indisponible:", e.message);
    return "";
  }
}

async function generateVisualScenes(title, lyrics, style, mood) {
  var prompt = "Crée 6 scènes visuelles pour un clip anime cinématique.\n\n" +
    "CHANSON : \"" + (title || "sans titre") + "\"\n" +
    (lyrics ? "PAROLES :\n" + lyrics.slice(0, 1500) + "\n\n" : "Base-toi sur le titre.\n\n") +
    (mood ? "COULEUR SONORE (à respecter sur les 6 scènes) :\n" + mood + "\n\n" : "") +
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

/**
 * Identité visuelle des personnages (Vivy, Djeff, A11, K44, Marvin, Jean).
 *
 * On réutilise le registre canonique src/vivy/visual-identities.cjs — celui qui
 * sert déjà au clip Twitch — au lieu de redécrire les personnages ici. Il porte
 * la description de référence ET les URLs d'images de référence servies par
 * vivy.funesterie.me.
 *
 * Un personnage n'est injecté que s'il est réellement nommé dans le titre ou les
 * paroles : une chanson qui ne parle pas de Vivy ne la fait pas apparaître.
 */
function resolveClipIdentity(config) {
  var input = {
    title: config.title || "",
    songTitle: config.title || "",
    text: [config.title || "", config.lyrics || "", config.style || ""].join(" "),
  };
  try {
    var mod = require("../vivy/visual-identities.cjs");
    var pack = mod.buildVivyVisualIdentityPack(input);
    var ids = (pack.identities || []).map(function(i) { return i.id; });
    if (ids.length) {
      console.log("[clip-director] Identités visuelles: " + ids.join(", ")
        + " (" + (pack.referenceImageUrls || []).length + " réf. images)");
    } else {
      console.log("[clip-director] Aucun personnage nommé, pas d'identité forcée.");
    }
    return {
      identityIds: ids,
      prompt: pack.prompt || "",
      negativePrompt: pack.negativePrompt || "",
      referenceImageUrls: pack.referenceImageUrls || [],
    };
  } catch (e) {
    console.warn("[clip-director] Identités visuelles indisponibles:", e.message);
    return { identityIds: [], prompt: "", negativePrompt: "", referenceImageUrls: [] };
  }
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
  var lyrics = config.lyrics || await findLyrics(title, songUrl);
  console.log("[clip-director] Paroles " + (lyrics ? "trouvées (" + lyrics.length + " chars)" : "non trouvées"));

  // Grok donne la couleur, Sol sequence dedans.
  var mood = config.mood !== undefined ? config.mood : await generateMood(title, lyrics);
  var scenes = await generateVisualScenes(title, lyrics, style, mood);
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

/**
 * Point d'entrée complet : scènes + identité visuelle + paroles réellement lues.
 * Le générateur passe par ici pour que chaque segment porte la même identité.
 */
async function directClip(config) {
  var cfg = config || {};
  var lyrics = await findLyrics(cfg.title || "", cfg.songUrl || "");
  var mood = await generateMood(cfg.title || "", lyrics);
  var scenes = await directClipScenes(Object.assign({}, cfg, { lyrics: lyrics, mood: mood }));
  var identity = resolveClipIdentity({
    title: cfg.title || "",
    lyrics: lyrics || "",
    style: cfg.style || "",
  });
  return { scenes: scenes, identity: identity, lyrics: lyrics, mood: mood };
}

module.exports = {
  directClip,
  directClipScenes,
  resolveClipIdentity,
  findLyrics,
  generateMood,
  generateVisualScenes,
  getTextInternal,
  callOpenRouter,
  SEQUENCE_MODEL,
  MOOD_MODEL,
};
