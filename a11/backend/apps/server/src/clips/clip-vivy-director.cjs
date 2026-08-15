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

// Nombre de plans demandes a Sol. Le generateur cycle dessus pour couvrir la
// duree, donc six plans varies suffisent meme sur un full clip.
const PLAN_COUNT = 6;

// A11 relit le montage, K44 le scenario. Modeles verifies par appel reel.
const MONTAGE_MODEL = process.env.NOSSEN_MONTAGE_MODEL || "openai/gpt-4o";
const SCENARIO_MODEL = process.env.NOSSEN_SCENARIO_MODEL || "x-ai/grok-4.3";

// Claude decortique les paroles. Identifiants verifies par appel reel le
// 15/08/2026 : claude-opus-4-5-20251101 et claude-sonnet-4-5-20250929 repondent,
// claude-3-5-sonnet-20241022 est en 404. Sonnet par defaut : la decortication
// tourne une fois par morceau et le catalogue en compte 120.
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const LYRICS_MODEL = process.env.NOSSEN_LYRICS_MODEL || "claude-sonnet-4-5-20250929";

function callClaude(prompt, maxTokens) {
  if (!CLAUDE_KEY) return Promise.reject(new Error("CLAUDE_API_KEY manquante"));
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: LYRICS_MODEL,
      max_tokens: maxTokens || 1500,
      messages: [{ role: "user", content: prompt }],
    });
    var req = https.request(new URL(CLAUDE_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
        "content-length": Buffer.byteLength(body),
      },
      timeout: TIMEOUT_MS,
    }, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        var raw = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          var detail = "";
          try { var err = JSON.parse(raw); detail = (err.error && err.error.message) || ""; } catch (e) {}
          return reject(new Error("HTTP " + res.statusCode + " sur " + LYRICS_MODEL
            + (detail ? " : " + detail.slice(0, 160) : "")));
        }
        try {
          var data = JSON.parse(raw);
          var text = (data.content || []).map(function(part) { return part.text || ""; }).join("");
          resolve(text || "");
        } catch (e) { reject(new Error("Reponse illisible de " + LYRICS_MODEL)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", function() { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

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
 * Couleur du persona = humeur, pas decor.
 *
 * La couleur ne s'invente pas par morceau : elle derive de la matiere de la
 * chanson par la courbe C1 du canon (src/music/vivy-prime-color.cjs) et rend un
 * etat -- Indigo "le profond", son complement, sa texture et son mouvement.
 * Deux chansons differentes donnent deux etats; la meme chanson donne toujours
 * le meme.
 *
 * C'est cet etat qui doit teindre le clip, comme humeur du personnage, pas comme
 * papier peint du decor.
 */
function resolveSonicColor(title, lyrics, style) {
  try {
    var prime = require("../music/vivy-prime-color.cjs");
    var signature = prime.deriveSonicSignature({
      title: title || "",
      lyrics: lyrics || "",
      style: style || "",
    });
    if (!signature || !signature.color) return null;
    console.log("[clip-director] Couleur persona: " + signature.color.name
      + " (" + signature.color.function + "), complement " + signature.color.complement);
    return signature;
  } catch (e) {
    console.warn("[clip-director] Couleur persona indisponible:", e.message);
    return null;
  }
}

/**
 * Grok ne choisit plus la couleur : il traduit l'etat canonique en direction
 * emotionnelle jouable. Sans etat, il retombe sur une lecture du titre.
 *
 * Un echec ici n'est jamais bloquant : sans mood, Sol travaille avec l'etat brut.
 */
async function generateMood(title, lyrics, signature) {
  if (!OPENROUTER_KEY) {
    console.log("[clip-director] Grok non configure (OPENROUTER_API_KEY), mood ignore.");
    return "";
  }
  var etat = signature && signature.color
    ? "ETAT EMOTIONNEL DU PERSONA (donne, non negociable) :\n"
      + "- couleur : " + signature.color.name + " — fonction : " + signature.color.function + "\n"
      + "- complement : " + signature.color.complement + "\n"
      + (signature.texture ? "- texture sonore : " + signature.texture + "\n" : "")
      + (signature.mouvement ? "- mouvement : " + signature.mouvement + "\n" : "")
      + "\n"
    : "";
  var prompt = "Tu traduis l'etat emotionnel d'une interprete en direction de jeu pour un clip.\n\n" +
    "TITRE : \"" + (title || "sans titre") + "\"\n" +
    (lyrics ? "PAROLES :\n" + lyrics.slice(0, 1200) + "\n\n" : "") +
    etat +
    "La couleur est l'humeur de l'interprete, pas la peinture du decor. " +
    "Dis en 2 phrases maximum, en anglais, ce que cet etat fait ressentir et " +
    "comment il se joue : posture, regard, tension du corps, rapport a l'espace, " +
    "et comment la lumiere accompagne cette humeur. " +
    "Ne redige pas de palette de decor, ne decris pas l'apparence physique, " +
    "pas d'intrigue, pas de texte a l'image.";
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

/**
 * Bloc de casting.
 *
 * Sans lui, Sol ignorait qu'un personnage etait distribue et ecrivait des plans
 * de paysage; l'identite arrivait ensuite collee a chaque segment, ce qui
 * revenait a dire "garde le visage de Vivy" sur un plan d'ocean vide.
 *
 * On donne le nom, jamais l'apparence : Sol decide ce qui se passe, le registre
 * visual-identities decide a quoi la personne ressemble. Laisser Sol decrire des
 * cheveux ou une tenue entrerait en conflit avec la reference.
 */
function buildCastBlock(cast = []) {
  var names = (Array.isArray(cast) ? cast : []).filter(Boolean);
  if (!names.length) return "";
  var subject = names.length === 1 ? names[0] : names.join(" et ");
  return "CASTING : " + subject + " " + (names.length === 1 ? "est présent" : "sont présents")
    + " et joue" + (names.length === 1 ? "" : "nt") + " le morceau. "
    + "Doit apparaître dans au moins 4 des 6 scènes, comme personne vivante dans le plan "
    + "(chant, geste, regard, déplacement).\n"
    + "Ne décris PAS l'apparence physique, ni cheveux, ni vêtements, ni visage : "
    + "appelle simplement par le nom. L'apparence est fixée ailleurs.\n\n";
}

/**
 * Claude : decortication des paroles.
 *
 * extractSectionLabels ne lit que des etiquettes deja ecrites entre crochets.
 * Quand elles manquent -- ou quand le texte stocke est une consigne d'ecriture
 * au lieu des paroles -- l'arc repart sur un squelette generique et le clip
 * suit une structure qui n'est pas celle du morceau.
 *
 * On demande ici un decoupage argumente : quelles sections, ou basculent-elles,
 * quelle est l'image forte de chacune. Pas de reecriture des paroles, pas
 * d'invention : si le texte ne dit rien, on rend une liste vide plutot qu'un
 * decoupage plausible.
 */
async function decorticateLyrics(title, lyrics, teardown) {
  if (!CLAUDE_KEY) {
    console.log("[clip-director] Claude non configure (CLAUDE_API_KEY), décortication ignorée.");
    return null;
  }
  if (!lyrics || lyrics.trim().length < 40) {
    console.log("[clip-director] Pas de paroles à décortiquer.");
    return null;
  }
  var mesure = teardown && Array.isArray(teardown.sections) && teardown.sections.length
    ? "STRUCTURE MESURÉE SUR L'AUDIO (bornes réelles, à respecter) :\n"
      + teardown.sections.map(function(s, i) {
        return "  " + (i + 1) + ". " + s.startSeconds + "s → " + s.endSeconds + "s — "
          + s.label + " (énergie " + s.energy + ")";
      }).join("\n") + "\n\n"
    : "";
  var prompt = "Décortique les paroles de cette chanson pour un découpage de clip.\n\n"
    + "TITRE : \"" + (title || "sans titre") + "\"\n\n"
    + "PAROLES :\n" + lyrics.slice(0, 4000) + "\n\n"
    + mesure
    + "Rends le découpage réel du texte : quelles sections, dans quel ordre, et pour "
    + "chacune l'intention et l'image la plus forte.\n"
    + "Si les bornes audio sont données, aligne tes sections dessus.\n"
    + "N'invente rien : si le texte est trop court ou n'est pas des paroles "
    + "(par exemple une consigne d'écriture), rends une liste vide.\n\n"
    + "JSON strict, rien d'autre :\n"
    + "{\"sections\":[{\"label\":\"intro|couplet|pre-refrain|refrain|pont|outro\","
    + "\"intention\":\"ce que dit la section, en français, une phrase\","
    + "\"image\":\"l'image visuelle la plus forte, en anglais, une phrase\"}]}";
  try {
    var text = await callClaude(prompt);
    var match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    var parsed = JSON.parse(match[0]);
    var sections = Array.isArray(parsed.sections) ? parsed.sections : [];
    if (!sections.length) {
      console.log("[clip-director] Claude : texte non exploitable comme paroles.");
      return null;
    }
    console.log("[clip-director] Claude (" + LYRICS_MODEL + ") — "
      + sections.length + " sections : " + sections.map(function(s) { return s.label; }).join(", "));
    return sections;
  } catch (e) {
    console.warn("[clip-director] Claude indisponible:", e.message);
    return null;
  }
}

/**
 * Vivy en soutien : l'arc du morceau, section par section.
 *
 * Sol est chef operateur, il ne connait pas la chanson. Vivy si : son arc
 * dynamique (src/music/vivy-dynamic-arc.cjs) donne pour chaque section son
 * intensite, sa couleur interieure, son bras de croix et sa matiere sonore.
 *
 * C'est ce qui decide COMBIEN de plans et LESQUELS : un plan par section, et
 * l'echelle suit l'intensite. Un nombre fixe de plans ignorait l'intonation --
 * six plans identiques sur une intro depouillee et un refrain plein.
 */
function resolveVivyArc(lyrics, fallbackSections) {
  try {
    var arcMod = require("../music/vivy-dynamic-arc.cjs");
    var labels = [];
    // Priorite au decoupage de Claude : il lit le texte, extractSectionLabels ne
    // lit que des etiquettes deja ecrites entre crochets.
    if (Array.isArray(fallbackSections) && fallbackSections.length) {
      labels = fallbackSections
        .map(function(s) { return typeof s === "string" ? s : s.label; })
        .filter(Boolean);
    }
    if (!labels.length && lyrics) {
      try { labels = arcMod.extractSectionLabels(lyrics) || []; } catch (e) { labels = []; }
    }
    if (!labels.length) {
      labels = ["intro", "couplet", "pre-refrain", "refrain", "pont", "refrain", "outro"];
    }
    var arc = arcMod.buildVivyDynamicArc(labels);
    var steps = (arc && arc.steps) || [];
    if (!steps.length) return null;
    console.log("[clip-director] Vivy — arc " + steps.length + " sections, intensité "
      + steps[0].intensity + " → " + Math.max.apply(null, steps.map(function(s) { return s.intensity; })));
    return steps;
  } catch (e) {
    console.warn("[clip-director] Arc Vivy indisponible:", e.message);
    return null;
  }
}

function buildArcBlock(steps) {
  if (!Array.isArray(steps) || !steps.length) return "";
  var lines = steps.map(function(s, i) {
    return "  " + (i + 1) + ". " + s.label
      + " — intensité " + Number(s.intensity).toFixed(2)
      + ", lumière intérieure " + s.color
      + ", matière : " + s.matiere;
  });
  return "ARC DU MORCEAU, donné par Vivy qui connaît la chanson (" + steps.length + " sections) :\n"
    + lines.join("\n") + "\n"
    + "Fais UN plan par section, dans cet ordre. L'échelle et le mouvement suivent l'intensité :\n"
    + "  intensité basse (< 0,45) → plan serré, caméra posée, geste retenu, peu de monde visible\n"
    + "  intensité moyenne → plan moyen, léger mouvement, présence du public\n"
    + "  intensité haute (> 0,80) → plan large ou contre-plongée, mouvement ample, foule pleine\n"
    + "La lumière intérieure indiquée est celle qui émane de l'interprète à ce moment, "
    + "elle change avec la section.\n\n";
}

/**
 * Consigne de l'artiste.
 *
 * La signature derive du TITRE, pas du son : pour un morceau de club sans
 * paroles en base, elle a rendu "cordes frottees graves, aucune percussion" et
 * Sol a place Vivy au piano dans un studio feutre. Aucune quantite de prompt ne
 * rattrape une chaine qui n'ecoute pas la musique.
 *
 * Tant que l'analyse audio n'alimente pas la direction, celui qui connait le
 * morceau doit pouvoir imposer le decor et la mise en scene. Ce qui est donne
 * ici n'est pas negociable et passe avant tout ce que les modeles deduisent.
 */
function buildArtistDirection(lieu, direction) {
  var parts = [];
  if (lieu) {
    parts.push("LIEU IMPOSÉ PAR L'ARTISTE (ne pas en choisir un autre) : " + lieu);
  }
  if (direction) {
    parts.push("MISE EN SCÈNE IMPOSÉE PAR L'ARTISTE : " + direction);
  }
  if (!parts.length) return "";
  return parts.join("\n") + "\n"
    + "Ces consignes priment sur l'ambiance déduite du titre ou de l'état sonore. "
    + "Si elles contredisent la texture annoncée, suis les consignes.\n\n";
}

async function generateVisualScenes(title, lyrics, style, mood, cast, signature, lieu, direction, arcSteps) {
  var etat = signature && signature.color
    ? "ETAT DU PERSONA : " + signature.color.name + " — " + signature.color.function
      + " (complement " + signature.color.complement + "). "
      + "Cette couleur est son humeur, pas la peinture du decor : elle transparait dans "
      + "la lumiere qui la touche et dans son jeu, pas en repeignant chaque paysage.\n\n"
    : "";
  // Un clip se tourne dans UN lieu. On demande donc a Sol de choisir le decor
  // d'abord, puis d'y decouper des PLANS -- angle, echelle, mouvement, moment.
  // Avant, il rendait six scenes dans six endroits differents : ocean, foret,
  // toit, champ... Sur douze segments ca donne un diaporama, pas un clip, et le
  // modele video n'a aucune continuite a tenir.
  var prompt = "Tu es chef opérateur. Tu découpes UN clip musical en plans.\n\n" +
    "CHANSON : \"" + (title || "sans titre") + "\"\n" +
    (lyrics ? "PAROLES :\n" + lyrics.slice(0, 1500) + "\n\n" : "Base-toi sur le titre.\n\n") +
    etat +
    (mood ? "HUMEUR DE L'INTERPRÈTE (à incarner) :\n" + mood + "\n\n" : "") +
    buildCastBlock(cast) +
    buildArtistDirection(lieu, direction) +
    buildArcBlock(arcSteps) +
    "RÈGLE DE TOURNAGE, la plus importante :\n" +
    (lieu
      ? "1. Le lieu est déjà fixé ci-dessus. Reprends-le tel quel dans le champ lieu.\n"
      : "1. Choisis UN SEUL lieu, cohérent avec la chanson. Un club, un studio, un toit, une salle — un seul.\n") +
    "2. TOUS les plans se tournent dans ce lieu unique. On ne change jamais d'endroit.\n" +
    "3. Ce qui varie, c'est le PLAN : échelle (large, moyen, gros plan, très gros plan), " +
    "angle (face, profil, contre-plongée, plongée, dos), mouvement de caméra (fixe, travelling, " +
    "panoramique, orbite lente), et le moment de la performance.\n" +
    "4. Décris chaque plan comme une consigne de tournage, pas comme un nouveau décor. " +
    "Rappelle brièvement le lieu dans chaque plan pour la continuité.\n\n" +
    "Chaque plan = 1 phrase anglaise.\n" +
    "Style anime cinématique.\n\n" +
    "JSON strict :\n" +
    "{\"lieu\":\"description courte du décor unique, en anglais\"," +
    "\"plans\":[{\"name\":\"Nom du plan\",\"visual\":\"English shot description\"}]}";

  try {
    var text = await callOpenRouter(SEQUENCE_MODEL, [{ role: "user", content: prompt }]);
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      var parsed = JSON.parse(jsonMatch[0]);
      var plans = Array.isArray(parsed.plans) ? parsed.plans : [];
      var lieu = String(parsed.lieu || "").slice(0, 300);
      if (plans.length >= 3) {
        console.log("[clip-director] Sol (" + SEQUENCE_MODEL + ") — lieu unique : " + lieu.slice(0, 80));
        console.log("[clip-director] " + plans.length + " plans dans ce lieu");
        var maxPlans = Array.isArray(arcSteps) && arcSteps.length ? arcSteps.length : PLAN_COUNT;
        var scenes = plans.slice(0, maxPlans).map(function(s) {
          return {
            name: String(s.name || "Plan").slice(0, 24),
            visual: String(s.visual || "").slice(0, 300),
            duration: 15,
          };
        });
        scenes.lieu = lieu;
        return scenes;
      }
    }
    console.warn("[clip-director] Sol réponse inutilisable:", text.slice(0, 80));
  } catch (e) {
    console.warn("[clip-director] Sol erreur:", e.message);
  }
  return null;
}

/**
 * A11 — montage. K44 — scenario et coherence.
 *
 * Sol ecrit les plans mais ne verifie rien apres coup : il ne sait pas si ses
 * coupes tombent sur les vraies bornes du morceau, ni si la suite se lit comme
 * une histoire. Ce sont les deux roles canoniques d'A11 (coherence semantique)
 * et de K44 (clarte publique), appliques au decoupage.
 *
 * Les deux passes ne reecrivent que ce qu'elles justifient : une correction sans
 * plan cible ni remplacement est ignoree. Elles peuvent -- et doivent -- rendre
 * une liste vide quand le decoupage tient.
 */
function formatPlansForReview(scenes, lieu) {
  return (lieu ? "LIEU : " + lieu + "\n\n" : "")
    + scenes.map(function(s, i) { return i + ". [" + s.name + "] " + s.visual; }).join("\n");
}

function applyReview(scenes, corrections, who) {
  if (!Array.isArray(corrections) || !corrections.length) {
    console.log("[clip-director] " + who + " : rien à corriger.");
    return scenes;
  }
  var applied = 0;
  corrections.forEach(function(c) {
    var index = Number(c.plan);
    if (!Number.isInteger(index) || index < 0 || index >= scenes.length) return;
    var replacement = String(c.remplacement || "").trim();
    if (replacement.length < 20) return;
    console.log("[clip-director] " + who + " corrige le plan " + index + " : "
      + String(c.raison || "").slice(0, 90));
    scenes[index] = Object.assign({}, scenes[index], { visual: replacement.slice(0, 300) });
    applied += 1;
  });
  if (!applied) console.log("[clip-director] " + who + " : aucune correction exploitable.");
  return scenes;
}

async function reviewMontageA11(scenes, lieu, teardown, arcSteps) {
  if (!Array.isArray(scenes) || !scenes.length) return scenes;
  var bornes = teardown && Array.isArray(teardown.sections) && teardown.sections.length
    ? "BORNES MESURÉES SUR L'AUDIO :\n" + teardown.sections.map(function(s, i) {
      return "  " + (i + 1) + ". " + s.startSeconds + "s → " + s.endSeconds + "s, "
        + s.label + ", énergie " + s.energy;
    }).join("\n") + "\n\n"
    : "";
  var arc = Array.isArray(arcSteps) && arcSteps.length
    ? "INTENSITÉ ATTENDUE PAR SECTION :\n" + arcSteps.map(function(s, i) {
      return "  " + i + ". " + s.label + " — " + Number(s.intensity).toFixed(2);
    }).join("\n") + "\n\n"
    : "";
  var prompt = "Tu es A11, responsable du montage. Tu relis un découpage de clip.\n\n"
    + formatPlansForReview(scenes, lieu) + "\n\n" + bornes + arc
    + "Vérifie trois choses, et rien d'autre :\n"
    + "1. l'échelle de chaque plan correspond à l'intensité de sa section "
    + "(serré quand c'est creux, large quand c'est plein);\n"
    + "2. deux plans consécutifs ne se ressemblent pas au point d'être redondants;\n"
    + "3. aucun plan ne quitte le lieu unique.\n\n"
    + "Ne réécris que ce qui cloche vraiment. Si le découpage tient, rends une liste vide.\n\n"
    + "JSON strict :\n{\"corrections\":[{\"plan\":0,\"raison\":\"en français, court\","
    + "\"remplacement\":\"English shot description\"}]}";
  try {
    var text = await callOpenRouter(MONTAGE_MODEL, [{ role: "user", content: prompt }]);
    var match = text.match(/\{[\s\S]*\}/);
    if (!match) return scenes;
    return applyReview(scenes, JSON.parse(match[0]).corrections, "A11 (montage)");
  } catch (e) {
    console.warn("[clip-director] A11 montage indisponible:", e.message);
    return scenes;
  }
}

async function reviewScenarioK44(scenes, lieu, title, lyricsSections) {
  if (!Array.isArray(scenes) || !scenes.length) return scenes;
  var intentions = Array.isArray(lyricsSections) && lyricsSections.length
    ? "CE QUE DIT LA CHANSON, SECTION PAR SECTION :\n" + lyricsSections.map(function(s, i) {
      return "  " + i + ". " + s.label + " — " + s.intention;
    }).join("\n") + "\n\n"
    : "";
  var prompt = "Tu es K44, garante du scénario et de la clarté pour le public.\n\n"
    + "CHANSON : \"" + (title || "sans titre") + "\"\n\n"
    + formatPlansForReview(scenes, lieu) + "\n\n" + intentions
    + "Vérifie deux choses, et rien d'autre :\n"
    + "1. la suite des plans raconte quelque chose de lisible pour quelqu'un qui "
    + "découvre le morceau, avec un début et une fin qui se répondent;\n"
    + "2. aucun plan ne contredit ce que dit la chanson à ce moment-là.\n\n"
    + "Ne réécris que ce qui casse la lecture. Si ça se tient, rends une liste vide.\n\n"
    + "JSON strict :\n{\"corrections\":[{\"plan\":0,\"raison\":\"en français, court\","
    + "\"remplacement\":\"English shot description\"}]}";
  try {
    var text = await callOpenRouter(SCENARIO_MODEL, [{ role: "user", content: prompt }]);
    var match = text.match(/\{[\s\S]*\}/);
    if (!match) return scenes;
    return applyReview(scenes, JSON.parse(match[0]).corrections, "K44 (scénario)");
  } catch (e) {
    console.warn("[clip-director] K44 scénario indisponible:", e.message);
    return scenes;
  }
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
      // Noms lisibles a donner a Sol pour qu'il ecrive des plans habites.
      castLabels: (pack.identities || []).map(function(i) { return i.label || i.id; }),
      prompt: pack.prompt || "",
      negativePrompt: pack.negativePrompt || "",
      referenceImageUrls: pack.referenceImageUrls || [],
    };
  } catch (e) {
    console.warn("[clip-director] Identités visuelles indisponibles:", e.message);
    return { identityIds: [], castLabels: [], prompt: "", negativePrompt: "", referenceImageUrls: [] };
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

  // L'etat du persona vient du canon, Grok le traduit en jeu, Sol l'incarne.
  var signature = config.signature !== undefined ? config.signature : resolveSonicColor(title, lyrics, style);
  var mood = config.mood !== undefined ? config.mood : await generateMood(title, lyrics, signature);
  var arcSteps = config.arcSteps !== undefined ? config.arcSteps : resolveVivyArc(lyrics, null);
  var scenes = await generateVisualScenes(title, lyrics, style, mood, config.cast, signature, config.lieu, config.direction, arcSteps);
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
  // L'identite est resolue AVANT le sequencage : Sol doit savoir qui est
  // distribue pour ecrire des plans habites plutot que des paysages vides.
  var identity = resolveClipIdentity({
    title: cfg.title || "",
    lyrics: lyrics || "",
    style: cfg.style || "",
  });
  var signature = resolveSonicColor(cfg.title || "", lyrics, cfg.style || "");
  var mood = await generateMood(cfg.title || "", lyrics, signature);

  // Claude decoupe le texte; ses sections priment sur le squelette par defaut.
  var lyricsSections = cfg.lyricsSections !== undefined
    ? cfg.lyricsSections
    : await decorticateLyrics(cfg.title || "", lyrics, cfg.teardown);
  var arcSteps = resolveVivyArc(lyrics, lyricsSections);

  var scenes = await directClipScenes(Object.assign({}, cfg, {
    lyrics: lyrics,
    mood: mood,
    signature: signature,
    arcSteps: arcSteps,
    cast: identity.castLabels,
    lieu: cfg.lieu || '',
    direction: cfg.direction || '',
  }));
  var lieu = (scenes && scenes.lieu) || cfg.lieu || "";

  // Relecture : A11 sur le montage, K44 sur le scenario. Les deux peuvent ne
  // rien corriger, c'est le cas nominal quand le decoupage tient.
  if (Array.isArray(scenes) && scenes.length && cfg.review !== false) {
    scenes = await reviewMontageA11(scenes, lieu, cfg.teardown, arcSteps);
    scenes = await reviewScenarioK44(scenes, lieu, cfg.title || "", lyricsSections);
  }

  return {
    scenes: scenes,
    lieu: lieu,
    identity: identity,
    lyrics: lyrics,
    lyricsSections: lyricsSections,
    arcSteps: arcSteps,
    mood: mood,
    signature: signature,
  };
}

module.exports = {
  directClip,
  directClipScenes,
  resolveClipIdentity,
  resolveSonicColor,
  findLyrics,
  generateMood,
  generateVisualScenes,
  getTextInternal,
  callOpenRouter,
  callClaude,
  decorticateLyrics,
  SEQUENCE_MODEL,
  LYRICS_MODEL,
  MONTAGE_MODEL,
  SCENARIO_MODEL,
  reviewMontageA11,
  reviewScenarioK44,
  MOOD_MODEL,
};
