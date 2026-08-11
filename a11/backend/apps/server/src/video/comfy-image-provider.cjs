"use strict";

/**
 * Génération d'images de scène par ComfyUI, pour le pipeline FULL CLIP.
 *
 * POURQUOI CE FICHIER EXISTE
 * full-clip.cjs annonce depuis le début, ligne 8 de son en-tête : « Chaque scène →
 * image (ComfyUI si dispo, sinon dégradé de couleur persona) ». La branche ComfyUI
 * n'avait jamais été écrite : le code appelait generateFallbackImage() sans
 * condition. Chaque clip produit jusqu'ici était donc une suite de rectangles de
 * couleur avec le nom de la section écrit dessus — alors que buildScenePrompt()
 * fabriquait déjà, pour chaque scène, un prompt visuel complet (palette de la
 * persona, ambiance, progression narrative, première ligne de paroles). Ce prompt
 * était calculé puis jeté. Constaté le 2026-08-10.
 *
 * CE MODULE NE FAIT QUE COMBLER CE TROU. Il ne remplace pas le dégradé : il passe
 * devant. Toute erreur — ComfyUI éteint, modèle absent, VRAM saturée — laisse
 * l'appelant retomber sur le dégradé, qui reste une sortie valable.
 *
 * RÉSOLUTION : on demande 1344x768 et non 1280x720. SDXL est entraîné autour du
 * mégapixel avec des paliers d'aspect, et 1344x768 en est un ; 1280x720 n'en est
 * pas un et sort des cadrages mous. L'écart d'aspect (1,75 contre 1,78) est absorbé
 * par le recadrage de createMotionLoop(), qui zoome de toute façon dans l'image.
 *
 * VRAM : mesuré le 2026-08-10 sur RTX 5070 12 Go, un rendu LTX-Video de 25 images
 * laissait 0,9 Go libre. Les modèles restent chargés entre deux prompts. Enchaîner
 * une dizaine de scènes suppose donc soit d'accepter la lenteur, soit d'ajouter
 * POST /free à la liste blanche du portier — il n'y est pas, volontairement.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { createComfyClient, isComfyEnabled } = require("./comfyui-client.cjs");

// Paliers d'aspect SDXL. 1344x768 est le plus proche du 16:9 du clip.
const LARGEUR_DEFAUT = 1344;
const HAUTEUR_DEFAUT = 768;

// SDXL base donne son meilleur rapport qualité/temps vers 28 pas et cfg 7.
const PAS_DEFAUT = 28;
const CFG_DEFAUT = 7.0;

// Ce que le prompt de scène ne dit pas mais qu'on ne veut jamais dans un clip.
// buildScenePrompt() demande déjà « no text overlay » côté positif ; le négatif
// est ce qui l'empêche réellement d'arriver.
const NEGATIF_DEFAUT =
  "text, letters, words, watermark, logo, signature, caption, subtitles, " +
  "blurry, low quality, jpeg artifacts, deformed, extra limbs, distorted face";

/**
 * Sonde de vie courte et bornée, à appeler UNE FOIS par clip.
 *
 * Pourquoi elle est indispensable : isComfyEnabled() ne teste que la présence de
 * COMFYUI_BASE_URL, pas qu'il y ait quelqu'un au bout. Or en production cette
 * variable pointe sur le tunnel comfy.funesterie.me, et la machine qui porte la
 * carte graphique n'est pas le serveur — le tunnel n'est donc pas toujours monté.
 * Sans cette sonde, chaque scène paie le délai complet du client (quatre minutes)
 * avant de retomber sur le dégradé : une demi-heure d'attente pour un clip de huit
 * scènes qui finira en rectangles de couleur de toute façon.
 *
 * On n'utilise pas client.health() : son timeoutMs ne borne que waitFor(), pas la
 * requête elle-même, donc un hôte silencieux peut la faire pendre. AbortSignal
 * donne une borne dure.
 */
async function probeComfyAlive(env = process.env, timeoutMs = 6000) {
  const base = String(env.COMFYUI_BASE_URL || env.COMFY_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return { alive: false, reason: "COMFYUI_BASE_URL absente" };
  const jeton = String(env.COMFYUI_TUNNEL_TOKEN || "").trim();
  try {
    const r = await fetch(`${base}/system_stats`, {
      headers: jeton ? { authorization: `Bearer ${jeton}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { alive: false, reason: `HTTP ${r.status}` };
    const j = await r.json().catch(() => null);
    return { alive: true, version: j?.system?.comfyui_version || "?" };
  } catch (e) {
    return { alive: false, reason: e?.name === "TimeoutError" ? `pas de reponse en ${timeoutMs} ms` : String(e?.message || e) };
  }
}

/**
 * Nettoie le prompt de scène avant de l'envoyer au modèle d'image.
 *
 * Mesure du 2026-08-11, première scène rendue : SDXL avait dessiné une enseigne au
 * néon où on lisait « NOSEN ». La cause n'est pas le modèle, c'est le prompt.
 * buildScenePrompt() produit « music video for "NOSSEN" » — un titre ENTRE
 * GUILLEMETS, ce qui est exactement l'instruction qu'un modèle d'image interprète
 * comme « écris ces lettres ». Le prompt négatif atténue sans empêcher.
 *
 * On retire donc les fragments méta et les guillemets, en gardant les mots qui
 * portent une image. « music video for X » ne décrit rien de visible ; le vers de
 * paroles, lui, est utile — on le garde, dépouillé de ses guillemets.
 */
function sanitizePromptForImage(prompt) {
  let p = String(prompt || "");
  p = p.replace(/,?\s*music video for\s*"[^"]*"/gi, "");
  p = p.replace(/,?\s*inspired by:\s*"([^"]*)"/gi, ", $1");
  // « no text overlay » est déjà couvert, et plus solidement, par le négatif.
  p = p.replace(/,?\s*no text overlay/gi, "");
  return p
    .replace(/\s{2,}/g, " ")
    .replace(/(\s*,\s*){2,}/g, ", ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
}

/**
 * Choisit le checkpoint image parmi ceux que ComfyUI déclare réellement.
 *
 * On ne code pas un nom en dur : l'installation évolue. On écarte en revanche les
 * checkpoints vidéo, qui apparaissent dans la même liste et n'ont pas d'encodeur
 * de texte utilisable ici — c'est l'erreur « clip input is invalid: None » qu'on
 * s'est prise en tentant LTX-Video comme modèle d'image.
 */
async function resolveImageCheckpoint(client, env = process.env) {
  const impose = String(env.COMFYUI_IMAGE_CHECKPOINT || "").trim();
  if (impose) return impose;

  const info = await client.describeNode("CheckpointLoaderSimple");
  const noeud = info?.CheckpointLoaderSimple || info;
  const choix = noeud?.input?.required?.ckpt_name?.[0];
  const liste = Array.isArray(choix) ? choix.map(String) : [];
  if (!liste.length) throw new Error("comfy-image: aucun checkpoint declare par ComfyUI");

  const estVideo = (n) => /ltx|ltxv|mochi|wan|hunyuan|svd|animatediff|video/i.test(n);
  const candidats = liste.filter((n) => !estVideo(n) && /\.(safetensors|ckpt|sft)$/i.test(n));
  if (!candidats.length) {
    throw new Error(
      `comfy-image: aucun checkpoint d'image parmi [${liste.join(", ")}] — ` +
        "il n'y a peut-etre que des modeles video installes"
    );
  }

  // Préférence explicite : SDXL, puis FLUX, puis le premier venu.
  return (
    candidats.find((n) => /sd_?xl|sdxl/i.test(n)) ||
    candidats.find((n) => /flux/i.test(n)) ||
    candidats[0]
  );
}

/**
 * Graphe texte→image standard. Les noms de nœuds sont ceux du cœur de ComfyUI,
 * aucun nœud personnalisé n'est requis.
 */
function buildTextToImageGraph(options = {}) {
  const {
    checkpoint,
    prompt,
    negative = NEGATIF_DEFAUT,
    width = LARGEUR_DEFAUT,
    height = HAUTEUR_DEFAUT,
    steps = PAS_DEFAUT,
    cfg = CFG_DEFAUT,
    seed,
    samplerName = "dpmpp_2m",
    scheduler = "karras",
    filenamePrefix = "fullclip-scene",
  } = options;

  if (!checkpoint) throw new Error("comfy-image: checkpoint absent");
  if (!String(prompt || "").trim()) throw new Error("comfy-image: prompt vide");

  const graine =
    Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : crypto.randomInt(0, 2 ** 31 - 1);

  return {
    1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    2: { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: String(prompt) } },
    3: { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: String(negative) } },
    4: {
      class_type: "EmptyLatentImage",
      inputs: { width: Math.round(width), height: Math.round(height), batch_size: 1 },
    },
    5: {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed: graine,
        steps: Math.round(steps),
        cfg,
        sampler_name: samplerName,
        scheduler,
        denoise: 1.0,
      },
    },
    6: { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    7: {
      class_type: "SaveImage",
      inputs: { images: ["6", 0], filename_prefix: String(filenamePrefix) },
    },
  };
}

/**
 * Produit l'image d'une scène et l'écrit dans workDir. Rend le chemin du fichier.
 *
 * Lève en cas d'échec : c'est voulu. L'appelant doit pouvoir retomber sur le
 * dégradé de couleur sans que l'échec d'une scène fasse tomber tout le clip.
 */
async function generateSceneImage(scene, options = {}) {
  const env = options.env || process.env;
  if (!isComfyEnabled(env)) throw new Error("comfy-image: ComfyUI non configure (COMFYUI_BASE_URL absente)");

  const workDir = options.workDir || require("node:os").tmpdir();
  const brut = String(scene?.prompt || "").trim();
  if (!brut) throw new Error("comfy-image: la scene ne porte pas de prompt");
  const prompt = sanitizePromptForImage(brut);

  const client = createComfyClient({
    env,
    // Une image fixe se compte en dizaines de secondes, pas en minutes comme un
    // plan video. Un budget plus court fait remonter une panne plus tot.
    timeoutMs: Number(options.timeoutMs) || 4 * 60 * 1000,
  });

  const checkpoint = options.checkpoint || (await resolveImageCheckpoint(client, env));
  const graphe = buildTextToImageGraph({
    checkpoint,
    prompt,
    negative: options.negative,
    width: options.width,
    height: options.height,
    steps: options.steps,
    cfg: options.cfg,
    seed: options.seed,
    filenamePrefix: `fullclip-${String(scene.sceneId || "scene").replace(/[^\w-]/g, "")}`,
  });

  // submit() rend l'identifiant sous forme de CHAINE et leve en cas de refus, avec
  // le detail des erreurs de noeud. Ne pas attendre d'objet {ok, promptId} : c'est
  // l'erreur que j'ai faite en premier jet, et elle faisait echouer une soumission
  // reussie sur un « sans raison » incomprehensible.
  const promptId = await client.submit(graphe);
  if (!promptId) throw new Error("comfy-image: aucun identifiant de prompt rendu");

  const fini = await client.waitFor(promptId);
  if (!fini?.ok || fini.state !== "done") {
    throw new Error(`comfy-image: rendu echoue (${fini?.raison || fini?.state || "inconnu"})`);
  }

  const fichier = client.firstOutputFile(fini.outputs);
  if (!fichier?.filename) throw new Error("comfy-image: aucun fichier produit");

  const octets = await client.fetchOutput(fichier);
  if (!octets?.length) throw new Error("comfy-image: fichier produit vide");

  const cible = path.join(
    workDir,
    `${scene.sceneId || "scene"}-${crypto.randomBytes(4).toString("hex")}.png`
  );
  fs.writeFileSync(cible, octets);
  return { imagePath: cible, checkpoint, bytes: octets.length };
}

module.exports = {
  generateSceneImage,
  probeComfyAlive,
  resolveImageCheckpoint,
  buildTextToImageGraph,
  sanitizePromptForImage,
  NEGATIF_DEFAUT,
  LARGEUR_DEFAUT,
  HAUTEUR_DEFAUT,
};
