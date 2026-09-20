"use strict";
/**
 * script-director.cjs — Pipeline narratif « script → manga/film ».
 *
 * Au lieu d'un MP3, l'utilisateur soumet un SCRIPT (texte ou lien). Deux rôles :
 *
 *   1. K44 écrit le SCÉNARIO global (structure, arc, personnages, lieux, ton).
 *      C'est le rôle canonique de K44 : garante du scénario et de la clarté.
 *   2. A11 découpe le scénario en SCRIPTS DE SCÈNE (un plan visuel par scène).
 *      C'est le rôle canonique d'A11 : cohérence sémantique et montage.
 *
 * La sortie a le MÊME contrat que directClip() du clip musical :
 *   { scenes:[{name, visual, duration, section, acte}], lieu, identity, ... }
 * de sorte que la boucle Seedance et l'assemblage FFmpeg restent inchangés.
 *
 * Le rendu (render:'anime' → manga, sinon film) est géré en aval par le
 * générateur, comme pour les clips.
 */

const director = require("./clip-vivy-director.cjs");

// K44 écrit le scénario, A11 le découpe. Mêmes modèles que la relecture clip :
// K44 sur Grok (clarté publique), A11 sur GPT (cohérence). Réglables sans
// redémarrer. Un scénario complet est plus long qu'une relecture, d'où les
// budgets de jetons plus larges.
const SCENARIO_MODEL = process.env.NOSSEN_SCRIPT_SCENARIO_MODEL || process.env.NOSSEN_SCENARIO_MODEL || "x-ai/grok-4.3";
const SCENE_MODEL = process.env.NOSSEN_SCRIPT_SCENE_MODEL || process.env.NOSSEN_MONTAGE_MODEL || "gpt-5.6-terra";

// Bornes : un manga/film court reste lisible. La page peut demander plus via
// sceneCount, plafonné pour ne pas exploser le budget Seedance.
const MIN_SCENES = 3;
const MAX_SCENES = 40;
const DEFAULT_SCENES = 8;

function clampSceneCount(value) {
  var n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SCENES;
  return Math.max(MIN_SCENES, Math.min(MAX_SCENES, n));
}

function extractJson(text) {
  if (!text) return null;
  var match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (e) { return null; }
}

/**
 * K44 — scénario global.
 *
 * Reçoit le script brut (synopsis, note d'intention, dialogue, ou juste une
 * idée). Rend une structure : logline, lieu principal, ton, personnages, et un
 * enchaînement d'actes. C'est du TEXTE narratif, pas encore des plans caméra.
 */
async function writeGlobalScenarioK44(scriptText, options) {
  var opts = options || {};
  var title = opts.title || "sans titre";
  var render = String(opts.render || "").trim().toLowerCase();
  var medium = render === "anime" ? "un manga animé (style anime cinématique)" : "un film en prises de vue réelles";
  var sceneCount = clampSceneCount(opts.sceneCount);

  var prompt = "Tu es K44, scénariste et garante de la clarté pour le public.\n\n"
    + "On veut tirer " + medium + " du matériau ci-dessous. Écris le SCÉNARIO.\n\n"
    + "TITRE : \"" + title + "\"\n\n"
    + "MATÉRIAU (script, synopsis, note d'intention ou idée brute) :\n"
    + String(scriptText || "").slice(0, 6000) + "\n\n"
    + "Ta mission :\n"
    + "1. Dégage une logline claire (une phrase) : qui, veut quoi, contre quoi.\n"
    + "2. Fixe UN lieu principal cohérent (le décor où l'essentiel se joue).\n"
    + "3. Nomme les personnages et leur rôle en une ligne chacun.\n"
    + "4. Découpe l'histoire en " + sceneCount + " ACTES qui se suivent : "
    + "un début qui pose, un milieu qui monte, une fin qui répond au début.\n"
    + "Chaque acte = une intention narrative en français, courte et concrète "
    + "(ce qui se passe et pourquoi ça compte), PAS encore un plan caméra.\n\n"
    + "JSON strict :\n"
    + "{\"logline\":\"...\",\"lieu\":\"description courte du décor principal, en anglais\","
    + "\"ton\":\"...\",\"personnages\":[{\"nom\":\"...\",\"role\":\"...\"}],"
    + "\"actes\":[{\"titre\":\"...\",\"intention\":\"...\"}]}";

  var text = await director.callOpenRouter(
    SCENARIO_MODEL,
    [{ role: "user", content: prompt }],
    Math.min(16000, 1200 + 220 * sceneCount),
    sceneCount > 10 ? 180000 : 90000
  );
  var parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.actes) || parsed.actes.length < MIN_SCENES) {
    throw new Error("K44 n'a pas rendu de scénario exploitable (au moins " + MIN_SCENES + " actes).");
  }
  parsed.actes = parsed.actes.slice(0, MAX_SCENES).map(function(a, i) {
    return {
      titre: String((a && a.titre) || ("Acte " + (i + 1))).slice(0, 60),
      intention: String((a && a.intention) || "").slice(0, 400),
    };
  }).filter(function(a) { return a.intention.length >= 8; });
  parsed.lieu = String(parsed.lieu || "").slice(0, 300);
  parsed.logline = String(parsed.logline || "").slice(0, 300);
  parsed.ton = String(parsed.ton || "").slice(0, 200);
  parsed.personnages = Array.isArray(parsed.personnages)
    ? parsed.personnages.slice(0, 12).map(function(p) {
      return { nom: String((p && p.nom) || "").slice(0, 60), role: String((p && p.role) || "").slice(0, 160) };
    }).filter(function(p) { return p.nom; })
    : [];
  console.log("[script-director] K44 (" + SCENARIO_MODEL + ") — logline : " + parsed.logline.slice(0, 80));
  console.log("[script-director] " + parsed.actes.length + " actes, lieu : " + parsed.lieu.slice(0, 60));
  return parsed;
}

/**
 * A11 — découpe en scripts de scène (plans caméra).
 *
 * Reçoit le scénario de K44 et le transforme en une liste de PLANS visuels,
 * un par acte (ou plusieurs si l'acte est dense), tous dans le lieu unique.
 * Sortie = le contrat { name, visual } attendu par le générateur.
 */
async function splitScenesA11(scenario, options) {
  var opts = options || {};
  var render = String(opts.render || "").trim().toLowerCase();
  var styleLigne = render === "anime"
    ? "Style anime cinématique, cadrage manga, cases dynamiques.\n"
    : "Style film photoréaliste, acteurs réels, grain 35 mm.\n";

  var persos = Array.isArray(scenario.personnages) && scenario.personnages.length
    ? "PERSONNAGES :\n" + scenario.personnages.map(function(p) { return "  - " + p.nom + " : " + p.role; }).join("\n") + "\n\n"
    : "";
  var actes = scenario.actes.map(function(a, i) {
    return "  " + i + ". [" + a.titre + "] " + a.intention;
  }).join("\n");

  var prompt = "Tu es A11, responsable du montage et de la cohérence.\n\n"
    + "Tu transformes un scénario en PLANS filmables. Un plan = une consigne de tournage.\n\n"
    + (scenario.logline ? "LOGLINE : " + scenario.logline + "\n" : "")
    + (scenario.ton ? "TON : " + scenario.ton + "\n" : "")
    + "LIEU UNIQUE : " + (scenario.lieu || "à déduire des actes") + "\n\n"
    + persos
    + "ACTES DU SCÉNARIO (K44) :\n" + actes + "\n\n"
    + "Règles :\n"
    + "1. Un plan par acte, dans l'ordre. Si un acte est dense, tu peux le couper en deux plans.\n"
    + "2. TOUS les plans se tournent dans le lieu unique. On ne change jamais d'endroit.\n"
    + "3. Ce qui varie : échelle (large, moyen, gros plan), angle (face, profil, plongée, dos), "
    + "mouvement de caméra (fixe, travelling, panoramique, orbite lente), et le moment de l'action.\n"
    + "4. Chaque plan reste fidèle à l'intention de son acte et ne contredit pas les personnages.\n"
    + "5. Chaque plan = 1 phrase ANGLAISE, descriptive, filmable.\n"
    + "6. DIALOGUE : au plus une replique par plan, EN FRANCAIS, 90 caracteres au maximum, "
    + "avec le nom de qui parle. Une case muette vaut mieux qu'une replique forcee : laisse vide.\n"
    + "   Le dessin ne porte AUCUN texte : la bulle est posee ensuite sur l'image.\n\n"
    + styleLigne + "\n"
    + "JSON strict :\n"
    + "{\"lieu\":\"description courte du décor unique, en anglais\","
    + "\"plans\":[{\"name\":\"Nom du plan\",\"visual\":\"English shot description\",\"acte\":\"intention en une phrase\","
    + "\"dialogue\":\"replique en francais, ou chaine vide\",\"locuteur\":\"qui parle, ou chaine vide\"}]}";

  var text = await director.callOpenRouter(
    SCENE_MODEL,
    [{ role: "user", content: prompt }],
    Math.min(16000, 1800 + 180 * scenario.actes.length),
    scenario.actes.length > 10 ? 240000 : 120000
  );
  var parsed = extractJson(text);
  var plans = parsed && Array.isArray(parsed.plans)
    ? parsed.plans.filter(function(p) { return p && typeof p.visual === "string" && p.visual.trim().length >= 10; })
    : [];
  if (plans.length < MIN_SCENES) {
    throw new Error("A11 n'a pas rendu au moins " + MIN_SCENES + " plans exploitables.");
  }
  var lieu = String((parsed && parsed.lieu) || scenario.lieu || "").slice(0, 300);
  var scenes = plans.slice(0, MAX_SCENES).map(function(p, i) {
    return {
      name: String(p.name || ("Plan " + (i + 1))).slice(0, 24),
      visual: String(p.visual || "").slice(0, 300),
      duration: 15,
      section: scenario.actes[i] ? scenario.actes[i].titre : undefined,
      acte: String(p.acte || (scenario.actes[i] ? scenario.actes[i].intention : "")).slice(0, 200) || undefined,
      // La replique voyage jusqu'au generateur, qui POSE la bulle sur l'image :
      // un modele d'image ecrit mal, et en anglais (constate le 20/09/2026).
      dialogue: String(p.dialogue || "").trim().slice(0, 120) || undefined,
      locuteur: String(p.locuteur || "").trim().slice(0, 40) || undefined,
    };
  });
  scenes.lieu = lieu;
  console.log("[script-director] A11 (" + SCENE_MODEL + ") — " + scenes.length + " plans, lieu : " + lieu.slice(0, 60));
  return scenes;
}

/**
 * Point d'entrée : script brut → scènes prêtes pour Seedance.
 *
 * Renvoie le même objet que directClip() du clip musical, moins tout ce qui
 * dépend de l'audio (mood/arc/teardown restent à null). Le générateur consomme
 * `scenes`, `lieu` et `identity` de la même façon.
 */
async function directScript(config) {
  var cfg = config || {};
  var progress = function(stage, message) {
    if (typeof cfg.onProgress === "function") cfg.onProgress({ stage: "director:" + stage, message: message });
  };

  var scriptText = String(cfg.scriptText || "").trim();
  if (scriptText.length < 20) {
    throw new Error("Script trop court : fournis au moins un synopsis ou une note d'intention.");
  }

  // Raccourci : scènes déjà découpées côté client (comme le clip musical).
  if (Array.isArray(cfg.sections) && cfg.sections.length > 0 && cfg.sections[0].visual) {
    console.log("[script-director] Sections client, on les garde.");
    var direct = cfg.sections.slice();
    direct.lieu = cfg.lieu || "";
    return {
      scenes: direct,
      lieu: cfg.lieu || "",
      identity: resolveIdentityFromScript(cfg, scriptText),
      scenario: null,
    };
  }

  progress("scenario", "K44 écrit le scénario");
  var scenario = await writeGlobalScenarioK44(scriptText, {
    title: cfg.title || "",
    render: cfg.render || "",
    sceneCount: cfg.sceneCount || cfg.planCount,
  });

  progress("sequencing", "A11 découpe le scénario en scènes");
  var scenes = await splitScenesA11(scenario, { render: cfg.render || "" });
  var lieu = (scenes && scenes.lieu) || scenario.lieu || cfg.lieu || "";

  // Identité visuelle : mêmes personnages canoniques, résolus depuis le titre +
  // le texte du scénario (K44 a pu nommer Djeff, Vivy, etc.).
  var identity = resolveIdentityFromScript(cfg, scriptText + " " + (scenario.logline || "")
    + " " + scenario.personnages.map(function(p) { return p.nom; }).join(" "));

  return {
    scenes: scenes,
    lieu: lieu,
    identity: identity,
    scenario: scenario,
    lyrics: null,
    lyricsSections: null,
    arcSteps: null,
    beats: null,
    teardown: null,
    mood: null,
    signature: null,
  };
}

function resolveIdentityFromScript(cfg, text) {
  try {
    return director.resolveClipIdentity({
      title: cfg.title || "",
      lyrics: String(text || ""),
      style: cfg.style || "",
      casting: cfg.casting || "",
      castArtists: Array.isArray(cfg.castArtists) ? cfg.castArtists : [],
      render: cfg.render || "",
    });
  } catch (e) {
    console.warn("[script-director] Identité indisponible:", e.message);
    return { identityIds: [], castLabels: [], prompt: "", nomsFilm: [], negativePrompt: "", referenceImageUrls: [], description: "" };
  }
}

module.exports = {
  directScript,
  writeGlobalScenarioK44,
  splitScenesA11,
  clampSceneCount,
};
