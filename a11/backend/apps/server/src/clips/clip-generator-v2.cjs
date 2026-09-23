'use strict';
/**
 * clip-generator-v2.cjs — Générateur de clips séquentiel avec continuité.
 *
 * Principes :
 *   - UNE vidéo à la fois (séquentielle, jamais parallèle)
 *   - Continuité visuelle : même style, même ambiance sur tout le clip
 *   - Nombre de segments adapté à la durée (pas 24 vidéos, plutôt 4-8)
 *   - Le Vivy Director donne LE thème, pas 6 thèmes différents
 */
const crypto = require('node:crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const { CLIPS_DIR } = require('./clip-storage.cjs');
const { materializeClipMedia } = require('./clip-input.cjs');
const clipCredits = require('./clip-credits.cjs');
const { judgeContinuity: malcolmJudgeContinuity, buildToileSvg: malcolmBuildToileSvg } = require('./malcolm-continuity.cjs');
const { writeMalcolmCheckpoint: malcolmWriteCheckpoint } = require('./malcolm-checkpoints.cjs');
const BRIDGE_URL = 'http://127.0.0.1:3000/api/mcp-bridge/call';
const BRIDGE_RESPONSE_MAX_BYTES = 1024 * 1024;
if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function sanitizeDiagnostic(value, maxLength = 400) {
  let text = String(value || '');
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
    try {
      const url = new URL(raw.replace(/[),.;]+$/, ''));
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return '[url masquée]';
    }
  });
  text = text
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[masqué]')
    .replace(/\b(api[_ -]?key|authorization|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[masqué]');
  return text.trim().slice(0, maxLength);
}

// ─── Malcolm : validation post-rendu ───────────────────────────────────────
//
// Branchement du 23/09/2026 (Djeff : "on peut brancher un llm a malcolm avec
// vision d'image pour detecter les incoherences ? puis le brancher"). Malcolm
// (src/clips/malcolm-continuity.cjs) regarde CE QUI A ETE REELLEMENT RENDU,
// pas seulement le texte du plan — la couche qui manquait entierement avant
// aujourd'hui (voir le commentaire au-dessus de generateClip). Desactivable
// sans toucher au code (incident, cout, latence) via NOSSEN_MALCOLM_ENABLED.
function isMalcolmEnabled(env = process.env) {
  return !['0', 'false', 'no', 'off'].includes(String(env.NOSSEN_MALCOLM_ENABLED ?? 'true').trim().toLowerCase());
}

// Une frame representative, pas la video entiere : Malcolm juge une image,
// comme le reste de l'infrastructure vision deja en prod (verify-generated-
// image-with-llm.cjs). 1 s dans le segment evite la plupart des frames noires
// d'ouverture sans avoir besoin de connaitre la duree exacte.
function extractFrameForMalcolm(execFileSyncImpl, videoPath, outPath) {
  try {
    execFileSyncImpl('ffmpeg', ['-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-q:v', '4', outPath], { timeout: 20_000, windowsHide: true });
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 0 ? outPath : null;
  } catch (error) {
    console.warn(`[clip] Malcolm: extraction de frame échouée (${sanitizeDiagnostic(error.message, 120)})`);
    return null;
  }
}

function bridgeError(code, detail = '', { ambiguous = false } = {}) {
  const safeDetail = sanitizeDiagnostic(detail, 300);
  const error = new Error(safeDetail ? `${code}: ${safeDetail}` : code);
  error.code = code;
  error.ambiguous = ambiguous;
  return error;
}

function postJson(url, data, {
  timeoutMs = parseBoundedInteger(process.env.NOSSEN_CLIP_BRIDGE_TIMEOUT_MS, 120_000, 1_000, 180_000),
  maxResponseBytes = BRIDGE_RESPONSE_MAX_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    const internalKey = String(process.env.MCP_BRIDGE_INTERNAL_KEY || '');
    if (Buffer.byteLength(internalKey, 'utf8') < 32) {
      reject(new Error('mcp_bridge_internal_key_missing_or_too_short'));
      return;
    }
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback(value);
    };
    const req = mod.request(parsed, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-service': internalKey, 'content-length': Buffer.byteLength(body) }
    }, (res) => {
      let chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxResponseBytes) {
          req.destroy(bridgeError('mcp_bridge_response_too_large'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', () => {
        if (settled) return;
        const raw = Buffer.concat(chunks, total).toString('utf8');
        if (Number(res.statusCode || 0) < 200 || Number(res.statusCode || 0) >= 300) {
          finish(reject, bridgeError(`mcp_bridge_http_${Number(res.statusCode) || 'failed'}`, raw.slice(0, 300)));
          return;
        }
        try {
          finish(resolve, JSON.parse(raw));
        } catch {
          finish(reject, bridgeError('mcp_bridge_response_invalid', raw.slice(0, 200)));
        }
      });
      res.on('aborted', () => finish(reject, bridgeError('mcp_bridge_response_aborted')));
      res.on('error', (error) => finish(reject, bridgeError('mcp_bridge_response_failed', error.message)));
    });
    req.setTimeout(timeoutMs, () => req.destroy(bridgeError('mcp_bridge_timeout', '', { ambiguous: true })));
    const deadline = setTimeout(() => {
      req.destroy(bridgeError('mcp_bridge_timeout', '', { ambiguous: true }));
    }, timeoutMs);
    deadline.unref?.();
    req.on('error', (error) => {
      if (!error.code) error.code = 'mcp_bridge_request_failed';
      // Once the request body is written, a transport failure cannot prove
      // that a paid provider submission was not accepted upstream.
      if (req.writableEnded) error.ambiguous = true;
      finish(reject, error);
    });
    req.write(body);
    req.end();
  });
}

function getBridgeToolResult(response) {
  return response && typeof response === 'object' && response.result && typeof response.result === 'object'
    ? response.result
    : response;
}

function getBridgeText(response) {
  const inner = getBridgeToolResult(response);
  const content = Array.isArray(inner?.content) ? inner.content : [];
  return content.filter((item) => item?.type === 'text' || typeof item?.text === 'string')
    .map((item) => String(item.text || ''))
    .join('\n')
    .trim();
}

function getBridgeStructuredContent(response) {
  const inner = getBridgeToolResult(response);
  return inner?.structuredContent && typeof inner.structuredContent === 'object'
    ? inner.structuredContent
    : null;
}

function findStructuredValue(value, wantedKeys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return null;
  for (const [key, candidate] of Object.entries(value)) {
    if (wantedKeys.has(String(key).toLowerCase()) && (typeof candidate === 'string' || typeof candidate === 'number')) {
      const normalized = String(candidate).trim();
      if (normalized) return normalized;
    }
  }
  for (const candidate of Object.values(value)) {
    if (candidate && typeof candidate === 'object') {
      const found = findStructuredValue(candidate, wantedKeys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractComfyPromptId(response) {
  const structured = getBridgeStructuredContent(response);
  const fromStructured = findStructuredValue(structured, new Set(['prompt_id', 'promptid']));
  if (fromStructured) return fromStructured;
  const match = getBridgeText(response).match(/prompt_id\s*[:=]\s*([a-z0-9-]+)/i);
  return match ? match[1] : '';
}

function normalizeComfyJobStatus(value) {
  const status = String(value || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  if (['succeeded', 'completed', 'complete', 'success', 'done'].includes(status)) return 'completed';
  if (['failed', 'failure', 'error', 'cancelled', 'canceled', 'rejected'].includes(status)) return 'failed';
  if (['pending', 'queued', 'waiting', 'in_progress', 'running', 'processing', 'executing', 'generating'].includes(status)) return 'pending';
  return null;
}

function readExplicitComfyJobStatus(response) {
  const readStatus = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 6) return null;
    // Le statut du job prime sur les sous-resultats et messages explicatifs.
    for (const wantedKey of ['job_status', 'status', 'state']) {
      for (const [key, candidate] of Object.entries(value)) {
        if (key.toLowerCase() !== wantedKey || typeof candidate !== 'string') continue;
        const status = normalizeComfyJobStatus(candidate);
        if (status) return status;
      }
    }
    for (const candidate of Object.values(value)) {
      const status = readStatus(candidate, depth + 1);
      if (status) return status;
    }
    return null;
  };
  const structuredStatus = readStatus(getBridgeStructuredContent(response));
  if (structuredStatus) return structuredStatus;

  const text = getBridgeText(response);
  // Certains outils MCP ne renvoient le JSON que dans content[].text.
  const jsonText = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const status = readStatus(JSON.parse(jsonText));
    if (status) return status;
  } catch {}
  const literalStatus = normalizeComfyJobStatus(text);
  if (literalStatus) return literalStatus;
  const matches = text.matchAll(/(?:^|[\n{,(])\s*["']?(?:job[_ ]?status|status|state)["']?\s*[:=]\s*["']?([a-z]+(?:[_ -][a-z]+)?)/gi);
  for (const match of matches) {
    const status = normalizeComfyJobStatus(match[1]);
    if (status) return status;
  }
  // Ne jamais prendre « wait until completed » pour un statut courant.
  return null;
}

function extractComfyJobStatus(response) {
  return readExplicitComfyJobStatus(response) || 'pending';
}

function isComfyOutputPending(response) {
  const status = readExplicitComfyJobStatus(response);
  if (status) return status === 'pending';
  return /\b(?:job has not finished yet|outputs? (?:are|is) not ready)\b/i.test(getBridgeText(response));
}

function extractComfyOutputUrl(response) {
  const structured = getBridgeStructuredContent(response);
  const candidates = [];
  const resultCollections = [
    structured?.results,
    structured?.result?.results,
    structured?.data?.results,
  ].filter(Array.isArray);
  for (const results of resultCollections) {
    for (const result of results) {
      if (typeof result?.url === 'string') candidates.push(result.url.trim());
      if (typeof result?.inline_url === 'string') candidates.push(result.inline_url.trim());
    }
  }
  const collect = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 6) return;
    for (const preferredKey of ['url', 'inline_url']) {
      const candidate = value[preferredKey];
      if (typeof candidate === 'string') candidates.push(candidate.trim());
    }
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') collect(nested, depth + 1);
    }
  };
  collect(structured);
  for (const candidate of candidates) {
    if (/^https?:\/\//i.test(candidate)) {
      try {
        if (/\.(mp4|webm|mov|mkv)$/i.test(new URL(candidate).pathname)) return candidate;
      } catch {}
    }
    if (/^\/api\/s\//i.test(candidate)) return `https://cloud.comfy.org${candidate}`;
  }

  const text = getBridgeText(response);
  const absolute = [...text.matchAll(/https:\/\/[^\s"'<>]+/gi)]
    .map((match) => match[0].replace(/[),.;]+$/, ''))
    .find((candidate) => {
      try { return /\.(mp4|webm|mov|mkv)$/i.test(new URL(candidate).pathname); }
      catch { return false; }
    });
  if (absolute) return absolute;
  const short = text.match(/\/api\/s\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/, '');
  return short ? `https://cloud.comfy.org${short}` : '';
}

// Element recurrent (17/09/2026) : la moto d'un clip moto changeait de modele d'un plan a
// l'autre. Sans image de reference (aucun i2v chez Comfy), le texte est la seule
// continuite : la meme description est donnee au Director et repetee dans chaque plan.
function elementRecurrentBrief(config = {}) {
  const element = String((config && config.elementRecurrent) || '').trim();
  return element ? ` The exact same ${element} appears in every shot with the identical model, colors and details.` : '';
}

function directionAvecElementRecurrent(config = {}) {
  const element = String((config && config.elementRecurrent) || '').trim();
  const direction = String((config && config.direction) || '').trim();
  const imposition = element ? `Element recurrent obligatoire dans chaque plan, toujours identique : ${element}.` : '';
  return [direction, imposition].filter(Boolean).join(' ');
}

function emitProgress(callback, event) {
  if (typeof callback !== 'function') return;
  // Le callback persiste aussi le prompt_id du fournisseur. S'il échoue, on
  // arrête avant toute nouvelle soumission plutôt que de créer un job payant
  // devenu impossible à récupérer après un crash.
  callback(Object.freeze({ ...event }));
}

/**
 * Le pont MCP repond 200 avec { ok: true } meme quand l'outil amont a echoue :
 * l'echec est porte par result.isError, et le VRAI motif par content[0].text.
 * Ne regarder que `result.ok` fait donc perdre le seul message qui explique la
 * panne. Vecu le 2026-09-07 : une cle Comfy expiree (« API key is invalid or
 * expired, 403 on /api/prompt ») arrivait jusqu'ici intacte, et ressortait en
 * « No prompt_id in response » — un message qui envoie chercher un bug de
 * parsing pendant que la cause est ecrite en toutes lettres dans la reponse.
 *
 * Rend le motif d'echec, ou null si la reponse est exploitable.
 */
function describeBridgeFailure(response) {
  if (!response) return 'reponse vide du pont MCP';
  if (response.ok === false) return sanitizeDiagnostic(response.error || 'appel du pont refuse');
  const inner = getBridgeToolResult(response);
  if (inner && inner.isError) {
    const texte = getBridgeText(response);
    // Plafonne : ce motif finit affiche dans la page, il doit rester lisible.
    return texte ? sanitizeDiagnostic(texte) : 'echec amont sans message';
  }
  return null;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Le catalogue de modeles video du fournisseur bouge, et un identifiant ecrit en
// dur devient faux sans prevenir. Le 09/09/2026 "byteplus/seedance-2.0-i2v" a
// disparu: chaque clip portant un personnage nomme basculait sur l'image-to-video
// et mourait au premier segment ("unknown model"), tandis qu'un clip anonyme
// passait. On lit donc le catalogue, une fois par clip, au lieu de le supposer.
const T2V_DEFAUT = 'byteplus/seedance-2.0-t2v';

function estModeleVideoPartenaire(entree) {
  return entree
    && String(entree.source || '') === 'partner'
    && String(entree.type || '') === 'video'
    && typeof entree.model_name === 'string'
    && entree.model_name.length > 0;
}

function estImageVersVideo(entree) {
  const tags = Array.isArray(entree.tags) ? entree.tags.map((t) => String(t).toLowerCase()) : [];
  if (tags.some((t) => t === 'image-to-video' || t === 'i2v')) return true;
  if (tags.some((t) => t === 'text-to-video' || t === 't2v')) return false;
  return /(?:^|[-_/])i2v(?:$|[-_])/i.test(entree.model_name);
}

/**
 * Choisit les deux modeles a partir du catalogue. Partie pure: c'est elle qui
 * porte la regle, donc c'est elle qu'on teste.
 *
 * @returns {{t2v: string, i2v: string|null}} i2v vaut null quand le fournisseur
 *   n'en propose aucun -- l'appelant doit alors renoncer a la reference image
 *   plutot que de soumettre un modele inexistant.
 */
function pickVideoModels(catalogue = [], env = process.env) {
  const partenaires = (Array.isArray(catalogue) ? catalogue : []).filter(estModeleVideoPartenaire);
  const noms = partenaires.map((m) => m.model_name);
  const t2vDisponibles = partenaires.filter((m) => !estImageVersVideo(m)).map((m) => m.model_name);
  const i2vDisponibles = partenaires.filter(estImageVersVideo).map((m) => m.model_name);

  const t2vDemande = String(env.NOSSEN_CLIP_T2V_MODEL || '').trim();
  const i2vDemande = String(env.NOSSEN_CLIP_I2V_MODEL || '').trim();

  // Un modele demande explicitement n'est retenu que s'il existe vraiment.
  const t2v = (t2vDemande && noms.includes(t2vDemande) && t2vDemande)
    || (noms.includes(T2V_DEFAUT) && T2V_DEFAUT)
    || t2vDisponibles[0]
    || T2V_DEFAUT;
  const i2v = (i2vDemande && noms.includes(i2vDemande) && i2vDemande) || i2vDisponibles[0] || null;
  return { t2v, i2v };
}

function parseCatalogueModeles(reponse) {
  try {
    const texte = getBridgeText(reponse);
    const donnees = JSON.parse(texte);
    return Array.isArray(donnees?.data) ? donnees.data : [];
  } catch (_) {
    return [];
  }
}

/**
 * Interroge le pont une fois par clip. Une panne de decouverte ne doit jamais
 * empecher un clip: on retombe sur le t2v par defaut, sans reference image.
 */
async function resolveVideoModels({ postJsonImpl = postJson, env = process.env } = {}) {
  try {
    const reponse = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__search_models', args: { query: 'video' } });
    const catalogue = parseCatalogueModeles(reponse);
    if (!catalogue.length) return { t2v: T2V_DEFAUT, i2v: null, decouvert: false };
    return { ...pickVideoModels(catalogue, env), decouvert: true };
  } catch (_) {
    return { t2v: T2V_DEFAUT, i2v: null, decouvert: false };
  }
}




function choisirReference(identity, env = process.env) {
  const liste = identity && Array.isArray(identity.referenceImageUrls) ? identity.referenceImageUrls : [];
  if (!liste.length) return null;
  const demande = Number(env.NOSSEN_CLIP_REFERENCE_INDEX);
  const rang = Number.isInteger(demande) && demande >= 0 && demande < liste.length ? demande : 0;
  return liste[rang] || null;
}

// Le fournisseur video enfouit la vraie cause. Le premier bloc qu'il rend est une
// notice generique -- "the specific cause is in error.message" -- et c'est ELLE
// qu'on affichait, tronquee a 300 caracteres. Il fallait interroger le job a la
// main pour lire le code reel. On le remonte, en partant du dernier bloc.
function extractComfyErrorDetail(response) {
  try {
    const inner = getBridgeToolResult(response);
    const items = Array.isArray(inner && inner.content) ? inner.content : [];
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const brut = String((items[i] && items[i].text) || '').trim();
      if (brut.charAt(0) !== '{') continue;
      let objet;
      try { objet = JSON.parse(brut); } catch (e) { continue; }
      const err = objet && objet.error;
      if (err && (err.code || err.message)) {
        return [err.code, err.message].filter(Boolean).join(' : ').slice(0, 300);
      }
    }
  } catch (e) { /* un diagnostic ne doit jamais casser la generation */ }
  return '';
}

// Un refus de politique de contenu est deterministe POUR CE PLAN, pas pour le
// clip: le 09/09/2026, sur un meme clip, le plan 0 est passe et le plan 1 a ete
// refuse, avec la meme identite et le meme style. S'arreter au premier refus
// condamne donc un clip de 26 plans a n'en rendre qu'un seul.
function estRefusDePolitique(message) {
  return /PolicyViolation|SensitiveContent|copyright restriction|possible copyright match|rejected the audio track/i.test(String(message || ''));
}

// Le 12/09/2026 (clip normal depuis le telephone), Seedance a refuse un plan pour
// son AUDIO : "OutputAudioSensitiveContentDetected". Or la piste son des scenes
// est jetee au montage, la chanson la remplace. Ce refus ne dit donc rien de
// l'image : le plan merite un second essai, avec une ambiance sonore neutre
// decrite en positif. Le meme jour, sur un Full Clip, Comfy a formule le refus
// autrement ("rejected the audio track ... Turn off generate_audio to get a
// silent video") : c'est le fournisseur lui-meme qui designe generate_audio, que
// le catalogue ne documente pas pour Seedance. Il n'est donc envoye qu'au second
// essai d'un plan deja refuse, jamais au premier.
function estRefusAudio(message) {
  return /OutputAudioSensitiveContent|output audio may contain sensitive|rejected the audio track/i.test(String(message || ''));
}
const CONSIGNE_AUDIO_NEUTRE = ' Sound: soft ambient room tone and distant wind only.';

// Rendu de l'image. C'etait "Cinematic anime quality" en dur ; le 12/09/2026
// Djeff a vu son Full Clip sortir en manga et le veut en film. Le film est donc le
// defaut, l'anime reste possible par NOSSEN_CLIP_RENDER=anime.
const RENDUS_VISUELS = {
  film: 'Live-action cinematic film, photorealistic, shot on 35mm with natural film grain and real skin texture, volumetric lighting, smooth camera movement.',
  anime: 'Cinematic anime quality, volumetric lighting, smooth camera movement.',
  // Manga : planche fixe, pas de mouvement de caméra. Encre noire, trames,
  // cases nettes. Utilisé par le mode image-par-image (une planche par scène).
  // Trois defauts vus sur le premier vrai chapitre (Djeff, 20/09/2026) : une
  // bulle de texte en ANGLAIS (le modele ecrit mal et dans la mauvaise langue),
  // la tenue qui change a chaque case, et l'age qui bouge. Le texte se posera
  // dans les bulles apres coup ; ici on demande des cases muettes et stables.
  // Quatre defauts vus sur la 2e prise (Djeff, 20/09/2026) : du lettrage
  // invente sur les reservoirs, cuisine et garage fusionnes dans une seule
  // piece, les cheveux qui changent, les pieds nus dans un garage. Les
  // negations ne sont pas lues par Comfy : chaque consigne est affirmative,
  // elle dit ce qu'il faut dessiner, pas ce qu'il faut eviter.
  manga: 'Black and white manga panel, clean ink lines, screentone shading, dynamic paneling, expressive line art, high contrast, comic book composition. '
    + 'Every surface is blank: bare fuel tanks, plain walls, unmarked signs, smooth clothing. The image is wordless, the lettering is added later. '
    + 'Keep every character exactly the same age, face, hairstyle and outfit as described, in every panel. '
    + 'One single room per panel, with only the furniture that belongs to that room. '
    + 'Everyone wears ordinary flat-soled shoes with plain rubber soles, indoors and in the garage.',
};
// Le style envoyé par la page est une consigne pour le Director, pas pour la
// caméra. Audit du 12/09/2026 : « Analyze the mood of: <titre>. Choose colors… »
// partait tel quel dans CHAQUE plan envoyé à Seedance -- des ordres qu'un modèle
// vidéo ne sait pas exécuter, et surtout le TITRE, qui déclenche le filtre
// copyright sur tout le clip (FIGHTERZ CLUB, 09/09). Sol reçoit toujours le style
// complet ; la caméra n'en garde que la description visuelle, sans titre.
function styleVideo(style, title) {
  const phrases = String(style || '')
    .split(/(?<=[.!?])\s+/)
    .filter((phrase) => !/^(analy[sz]e|choose|pick|describe|match)\b/i.test(phrase.trim()));
  let s = phrases.join(' ');
  const t = String(title || '').replace(/…$/, '').trim();
  if (t.length >= 3) {
    const bas = t.toLowerCase();
    let i = s.toLowerCase().indexOf(bas);
    while (i >= 0) {
      s = s.slice(0, i) + s.slice(i + t.length);
      i = s.toLowerCase().indexOf(bas);
    }
  }
  return s.replace(/\s{2,}/g, ' ').trim().slice(0, 300);
}

// Le choix fait sur la page pour CE clip prime ; la variable ne regle que le defaut.
// Fiche des personnages d'une planche manga. Deux sources possibles : le
// registre des identites visuelles (toujours l'adulte d'aujourd'hui) et la
// fiche ecrite pour ce chapitre-la. Elles ne se cumulent jamais — voir le
// commentaire du mode manga dans generateClip.
function briefIdentiteManga({ fichesPersonnages = '', ageDesPersonnages = '', identityPrompt = '', env = process.env } = {}) {
  const fiche = String(fichesPersonnages || '').trim();
  const age = String(ageDesPersonnages || env?.NOSSEN_CLIP_AGE_OVERRIDE || '').trim();
  const identiteRetenue = fiche || String(identityPrompt || '').trim();
  return {
    identiteRetenue,
    mangaIdentityBrief: identiteRetenue
      ? ` Character identity to preserve exactly across every panel: ${identiteRetenue}`
      : '',
    // Avec une fiche de chapitre, les ages y sont deja ecrits : les repeter
    // apres coup redonnerait au modele deux descriptions a concilier.
    mangaAgeBrief: (age && !fiche) ? ` Ages in THIS chapter override the character sheets: ${age}` : '',
  };
}

function renduVisuel(env = process.env, choixDuClip = '') {
  const choix = String(choixDuClip || env?.NOSSEN_CLIP_RENDER || '').trim().toLowerCase();
  return RENDUS_VISUELS[choix] || RENDUS_VISUELS.film;
}

// En film, le nom d'un personnage d'anime (Vivy) suffit a faire basculer le
// modele video en anime, meme quand tout le reste du prompt dit « live action ».
// Sol l'ecrit dans ses plans ; on le remplace dans le prompt camera seulement.
function effacerNomsFilm(texte, nomsFilm) {
  let s = String(texte || '');
  for (const [nom, remplacement] of Object.entries(nomsFilm || {})) {
    if (!nom || !remplacement) continue;
    const motif = new RegExp(`\\b${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    s = s.replace(motif, remplacement);
  }
  return s;
}

// Garde-fou de cout: si le filtre refuse tout, on ne paie pas 26 refus d'affilee.
const PLAFOND_REFUS_POLITIQUE = Math.max(1, Number(process.env.NOSSEN_CLIP_MAX_POLICY_REFUSALS) || 4);

// Un refus d'autorisation du compte Comfy est intermittent : le 11/09/2026, sur
// FIGHTERZ CLUB, quatre plans sont passes avec la meme cle, puis le cinquieme a
// recu "Unauthorized: Please login first to use this node" ; le 09/09, un clip
// normal est mort ainsi des son premier plan. Le noeud refuse AVANT de generer :
// un seul nouvel essai apres une pause, puis on s'arrete en le disant.
function estRefusAutorisation(message) {
  return /Unauthorized|Please login first|Unable to verify account access/i.test(String(message || ''));
}
// « Payment Required » (12/09/2026, Funesterie va Briller arrete a 2/28) : Comfy a
// deux reserves, les credits mensuels de l'abonnement et les credits bonus achetes
// a part, et c'est lui qui choisit laquelle debiter. Le refus est tombe alors que
// l'une des deux pouvait encore payer. Le noeud refuse AVANT de generer : un nouvel
// essai ne coute rien. On relit donc le solde : s'il reste de quoi payer un plan,
// on laisse a Comfy le temps de basculer de reserve et on reessaie le meme plan ;
// si les deux sont vides, on s'arrete tout de suite en le disant.
function estRefusPaiement(message) {
  return /Payment Required|add credits to your account|insufficient (credits|balance)|comfy_credits_epuises/i.test(String(message || ''));
}
const PAUSES_REPRISE_PAIEMENT_MS = (() => {
  const brut = String(process.env.NOSSEN_CLIP_PAYMENT_RETRY_PAUSES_MS || '60000,180000');
  const pauses = brut.split(',').map((x) => Number(x.trim())).filter((v) => Number.isFinite(v) && v >= 0)
    .map((v) => Math.min(v, 600000)).slice(0, 3);
  return pauses.length ? pauses : [60000, 180000];
})();
const PAUSE_REPRISE_AUTORISATION_MS = (() => {
  const brut = process.env.NOSSEN_CLIP_AUTH_RETRY_PAUSE_MS;
  const v = brut === undefined || brut === '' ? NaN : Number(brut);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 300000) : 30000;
})();
// Soumettre UNE vidéo et ATTENDRE qu'elle soit prête
async function generateOneVideo(prompt, index, maxWaitMs = 600000, identity = null, {
  postJsonImpl = postJson,
  sleepImpl = sleep,
  onProgress,
  pollIntervalMs = parseBoundedInteger(process.env.NOSSEN_CLIP_POLL_INTERVAL_MS, 11_000, 250, 60_000),
  models = null,
  sansAudio = false,
} = {}) {
  console.log(`[clip] Vidéo ${index}: ${prompt.slice(0, 60)}...${sansAudio ? ' (generate_audio=false)' : ''}`);
  emitProgress(onProgress, { stage: 'video:submitting', status: 'generating', segmentIndex: index });

  // Image de référence : si un personnage canonique est en jeu, on bascule sur
  // l'image-to-video pour verrouiller son visage au lieu de le redécrire.
  // Quelle reference parmi celles de l'identite. C'etait [0] en dur, sans que rien
  // ne le dise: pour djeff les cinq references vont de 240x240 (4 Ko) a 720x720
  // (49 Ko), et une vignette de 240 pixels ne verrouille pas un visage. Le rang
  // se choisit donc, et un rang hors bornes retombe sur la premiere plutot que
  // de perdre la reference en silence.
  const referenceImage = choisirReference(identity, process.env);
  const modeles = models && models.t2v ? models : { t2v: T2V_DEFAUT, i2v: null };
  const referenceVoulue = Boolean(referenceImage) && process.env.NOSSEN_CLIP_USE_REFERENCE !== '0';
  // Une reference sans modele image-to-video ne se soumet pas: on renonce a la
  // reference, on garde le clip. Le personnage reste decrit par le texte de sa
  // fiche d'identite, ce qui degrade la ressemblance sans tuer la generation.
  const useReference = referenceVoulue && Boolean(modeles.i2v);
  if (referenceVoulue && !useReference) {
    console.log(`[clip] Vidéo ${index}: aucun modèle image-to-video au catalogue, référence abandonnée (personnage décrit en texte)`);
  }

  const args = useReference
    ? {
        type: 'video',
        model: modeles.i2v,
        prompt,
        image: referenceImage,
        client_os: 'linux',
        confirm: true,
        params: { model: 'Seedance 2.0 Fast' },
      }
    : {
        type: 'video',
        model: modeles.t2v,
        prompt,
        client_os: 'linux',
        confirm: true,
        params: { model: 'Seedance 2.0 Fast' },
      };
  // Pas de `negative_prompt` : Seedance n'a pas ce champ, le pont Comfy le
  // transmettait sans effet. Les interdits d'une fiche ne protegeaient rien.
  // Jamais de son genere (13/09/2026) : la piste des plans est jetee au montage,
  // seule la chanson reste. La generer ne servait qu'a declencher des refus
  // « possible copyright match » -- quatre dans « oui tu lui a repondu ? », qui ont
  // vide le plafond de refus et coupe le clip a 18/36 alors que chaque image etait
  // bonne. Comfy estime le plan au meme prix avec ou sans son (136 credits).
  args.params.generate_audio = false;
  if (useReference) console.log(`[clip] Vidéo ${index}: référence ${referenceImage.slice(0, 60)}`);

  // Une soumission vidéo peut être facturée même si la réponse réseau se perd.
  // Elle n'est donc jamais répétée automatiquement, ni remplacée silencieusement
  // par un second modèle : un seul appel payant par segment.
  let result;
  try {
    result = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__partner_generate', args });
  } catch (error) {
    const prefix = error?.ambiguous ? 'clip_video_submission_ambiguous' : 'clip_video_submission_failed';
    throw new Error(`${prefix}: ${error.message}`);
  }
  const echecAmont = describeBridgeFailure(result);
  if (echecAmont) throw new Error(echecAmont);
  const text = getBridgeText(result);
  const promptId = extractComfyPromptId(result);
  // Sans prompt_id, on cite la reponse : c'est elle qui dit pourquoi.
  if (!promptId) throw new Error('Pas de prompt_id dans la reponse : ' + (sanitizeDiagnostic(text, 300) || 'reponse vide'));
  emitProgress(onProgress, { stage: 'video:accepted', status: 'generating', segmentIndex: index, promptId });

  // Attendre
  const startTime = Date.now();
  let firstPoll = true;
  while (Date.now() - startTime < maxWaitMs) {
    if (!firstPoll) await sleepImpl(pollIntervalMs);
    firstPoll = false;
    const status = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__get_job_status', args: { prompt_id: promptId } });
    const statusFailure = describeBridgeFailure(status);
    if (statusFailure) throw new Error(`clip_video_status_failed: ${extractComfyErrorDetail(status) || statusFailure}`);
    const state = extractComfyJobStatus(status);
    if (state === 'completed') {
      // Télécharger
      const output = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__get_output', args: { prompt_id: promptId, client_os: 'linux' } });
      // Le statut et la disponibilite des sorties peuvent etre decales. Dans
      // ce cas on suit le MEME prompt_id, sans resoumettre de video payante.
      if (!isComfyOutputPending(output)) {
        const outputFailure = describeBridgeFailure(output);
        if (outputFailure) throw new Error(`clip_video_output_failed: ${outputFailure}`);
        const outputUrl = extractComfyOutputUrl(output);
        if (outputUrl) return outputUrl;
        throw new Error(`clip_video_output_url_missing: ${sanitizeDiagnostic(getBridgeText(output), 300) || 'reponse vide'}`);
      }
    }
    if (state === 'failed') {
      throw new Error(`clip_video_generation_failed: ${extractComfyErrorDetail(status) || sanitizeDiagnostic(getBridgeText(status), 300) || 'statut amont en echec'}`);
    }
    console.log(`[clip] Vidéo ${index} en cours... (${Math.round((Date.now() - startTime) / 1000)}s)`);
    emitProgress(onProgress, {
      stage: 'video:polling',
      status: 'generating',
      segmentIndex: index,
      promptId,
      elapsedMs: Date.now() - startTime,
    });
  }
  throw new Error(`clip_video_wait_timeout: segment ${index}`);
}

// Modèle image par défaut pour les planches manga. Réglable sans redémarrer.
// Un modèle t2i au catalogue Comfy ; on part sur un modèle rapide et fiable.
// 19/09/2026 : Comfy a retire « bytedance/seedream-4.0-t2i » (« unknown model ») ;
// Seedream passe par le modele partenaire « byteplus/images-generations », qui
// exige la version interne dans params.model — meme schema que Seedance en video.
const T2I_DEFAUT = process.env.NOSSEN_MANGA_IMAGE_MODEL || 'byteplus/images-generations';
const T2I_VERSION_DEFAUT = process.env.NOSSEN_MANGA_IMAGE_VERSION || 'seedream-4-0-250828';

// generateOnePanel — une PLANCHE (image) pour une scène, via le même pont Comfy
// que la vidéo mais en type:'image'. Pas de son, pas de mouvement : une case.
// Renvoie l'URL de l'image générée. Calqué sur generateOneVideo pour la robustesse
// (un seul appel payant, poll du même prompt_id, pas de resoumission auto).
async function generateOnePanel(prompt, index, maxWaitMs = 300_000, identity = {}, {
  postJsonImpl = postJson,
  sleepImpl = sleep,
  onProgress,
  pollIntervalMs = parseBoundedInteger(process.env.NOSSEN_CLIP_POLL_INTERVAL_MS, 8_000, 250, 60_000),
  model = null,
} = {}) {
  console.log(`[manga] Planche ${index}: ${prompt.slice(0, 60)}...`);
  emitProgress(onProgress, { stage: 'panel:submitting', status: 'generating', segmentIndex: index });

  const args = {
    type: 'image',
    model: model || T2I_DEFAUT,
    prompt,
    client_os: 'linux',
    confirm: true,
  };
  if (!model && T2I_VERSION_DEFAUT) args.params = { model: T2I_VERSION_DEFAUT };

  let result;
  try {
    result = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__partner_generate', args });
  } catch (error) {
    const prefix = error?.ambiguous ? 'manga_panel_submission_ambiguous' : 'manga_panel_submission_failed';
    throw new Error(`${prefix}: ${error.message}`);
  }
  const echecAmont = describeBridgeFailure(result);
  if (echecAmont) throw new Error(echecAmont);
  const text = getBridgeText(result);
  const promptId = extractComfyPromptId(result);
  if (!promptId) throw new Error('Pas de prompt_id dans la reponse : ' + (sanitizeDiagnostic(text, 300) || 'reponse vide'));
  emitProgress(onProgress, { stage: 'panel:accepted', status: 'generating', segmentIndex: index, promptId });

  const startTime = Date.now();
  let firstPoll = true;
  while (Date.now() - startTime < maxWaitMs) {
    if (!firstPoll) await sleepImpl(pollIntervalMs);
    firstPoll = false;
    const status = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__get_job_status', args: { prompt_id: promptId } });
    const statusFailure = describeBridgeFailure(status);
    if (statusFailure) throw new Error(`manga_panel_status_failed: ${extractComfyErrorDetail(status) || statusFailure}`);
    const state = extractComfyJobStatus(status);
    if (state === 'completed') {
      const output = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__get_output', args: { prompt_id: promptId, client_os: 'linux' } });
      if (!isComfyOutputPending(output)) {
        const outputFailure = describeBridgeFailure(output);
        if (outputFailure) throw new Error(`manga_panel_output_failed: ${outputFailure}`);
        const outputUrl = extractComfyOutputUrl(output);
        // On renvoie l'URL ET le prompt_id : le prompt_id permet d'animer la
        // planche plus tard (manga → animé) via i2v Seedance sans re-héberger l'image.
        if (outputUrl) return { url: outputUrl, promptId };
        throw new Error(`manga_panel_output_url_missing: ${sanitizeDiagnostic(getBridgeText(output), 300) || 'reponse vide'}`);
      }
    }
    if (state === 'failed') {
      throw new Error(`manga_panel_generation_failed: ${extractComfyErrorDetail(status) || sanitizeDiagnostic(getBridgeText(status), 300) || 'statut amont en echec'}`);
    }
    console.log(`[manga] Planche ${index} en cours... (${Math.round((Date.now() - startTime) / 1000)}s)`);
    emitProgress(onProgress, { stage: 'panel:polling', status: 'generating', segmentIndex: index, promptId, elapsedMs: Date.now() - startTime });
  }
  throw new Error(`manga_panel_wait_timeout: planche ${index}`);
}

function loadClipDirector() {
  try { return require('./clip-vivy-director.cjs'); }
  catch (_) { return require('/app/clip-vivy-director.cjs'); }
}

// Modèle i2v par défaut pour animer une planche manga. Seedance anime l'image
// de départ ; réglable sans redémarrer.
const I2V_ANIME_DEFAUT = process.env.NOSSEN_MANGA_ANIMATE_MODEL || 'byteplus/seedance-2.0-t2v';

// animateOnePanel — anime UNE planche manga (image) en vidéo via i2v Seedance.
// La planche est fournie par son prompt_id Comfy (medias role:image) : pas besoin
// de la ré-héberger. Le prompt décrit le mouvement à insuffler à l'image.
async function animateOnePanel(prompt, panelPromptId, index, maxWaitMs = 600_000, {
  postJsonImpl = postJson,
  sleepImpl = sleep,
  onProgress,
  pollIntervalMs = parseBoundedInteger(process.env.NOSSEN_CLIP_POLL_INTERVAL_MS, 11_000, 250, 60_000),
  model = null,
} = {}) {
  console.log(`[animate] Scène ${index} depuis planche ${panelPromptId}: ${prompt.slice(0, 50)}...`);
  emitProgress(onProgress, { stage: 'animate:submitting', status: 'generating', segmentIndex: index });

  const args = {
    type: 'video',
    model: model || I2V_ANIME_DEFAUT,
    prompt,
    medias: [{ role: 'image', prompt_id: panelPromptId, output_index: 0 }],
    client_os: 'linux',
    confirm: true,
    params: { model: 'Seedance 2.0 Fast', generate_audio: false },
  };

  let result;
  try {
    result = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__partner_generate', args });
  } catch (error) {
    const prefix = error?.ambiguous ? 'manga_animate_submission_ambiguous' : 'manga_animate_submission_failed';
    throw new Error(`${prefix}: ${error.message}`);
  }
  const echecAmont = describeBridgeFailure(result);
  if (echecAmont) throw new Error(echecAmont);
  const text = getBridgeText(result);
  const promptId = extractComfyPromptId(result);
  if (!promptId) throw new Error('Pas de prompt_id dans la reponse : ' + (sanitizeDiagnostic(text, 300) || 'reponse vide'));
  emitProgress(onProgress, { stage: 'animate:accepted', status: 'generating', segmentIndex: index, promptId });

  const startTime = Date.now();
  let firstPoll = true;
  while (Date.now() - startTime < maxWaitMs) {
    if (!firstPoll) await sleepImpl(pollIntervalMs);
    firstPoll = false;
    const status = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__get_job_status', args: { prompt_id: promptId } });
    const statusFailure = describeBridgeFailure(status);
    if (statusFailure) throw new Error(`manga_animate_status_failed: ${extractComfyErrorDetail(status) || statusFailure}`);
    const state = extractComfyJobStatus(status);
    if (state === 'completed') {
      const output = await postJsonImpl(BRIDGE_URL, { tool: 'comfy__get_output', args: { prompt_id: promptId, client_os: 'linux' } });
      if (!isComfyOutputPending(output)) {
        const outputFailure = describeBridgeFailure(output);
        if (outputFailure) throw new Error(`manga_animate_output_failed: ${outputFailure}`);
        const outputUrl = extractComfyOutputUrl(output);
        if (outputUrl) return outputUrl;
        throw new Error(`manga_animate_output_url_missing: ${sanitizeDiagnostic(getBridgeText(output), 300) || 'reponse vide'}`);
      }
    }
    if (state === 'failed') {
      throw new Error(`manga_animate_generation_failed: ${extractComfyErrorDetail(status) || sanitizeDiagnostic(getBridgeText(status), 300) || 'statut amont en echec'}`);
    }
    console.log(`[animate] Scène ${index} en cours... (${Math.round((Date.now() - startTime) / 1000)}s)`);
    emitProgress(onProgress, { stage: 'animate:polling', status: 'generating', segmentIndex: index, promptId, elapsedMs: Date.now() - startTime });
  }
  throw new Error(`manga_animate_wait_timeout: scène ${index}`);
}

// animateMangaClip — anime un manga existant en clip vidéo. Lit le manifeste
// des planches (manga-panels.json), anime chaque planche en i2v, assemble en mp4.
async function animateMangaClip(config = {}, {
  materializeMedia = materializeClipMedia,
  animatePanelImpl = animateOnePanel,
  execFileSyncImpl = execFileSync,
  sleepImpl = sleep,
  nowImpl = Date.now,
  randomBytesImpl = crypto.randomBytes,
  judgeContinuityImpl = malcolmJudgeContinuity,
  buildToileSvgImpl = malcolmBuildToileSvg,
  writeMalcolmCheckpointImpl = malcolmWriteCheckpoint,
} = {}) {
  const { sourcePng, onProgress } = config;
  // On retrouve le manifeste : <planche>.panels.json à côté du .png public.
  const decoded = decodeURIComponent(String(sourcePng || '').replace(/^.*\/clips\//, ''));
  if (!decoded || /[/\\]/.test(decoded)) throw new Error('manga_animate_bad_source');
  const manifestPublic = path.join(CLIPS_DIR, decoded.replace(/\.png$/i, '.panels.json'));
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPublic, 'utf8'));
  } catch (e) {
    throw new Error('manga_animate_manifest_missing: ' + e.message);
  }
  const panels = (manifest.panels || []).filter((p) => p && p.promptId);
  if (!panels.length) throw new Error('manga_animate_no_prompt_ids: les planches de ce manga ne sont pas animables (générées avant le suivi des prompt_id).');

  const clipId = createClipId(nowImpl, randomBytesImpl);
  const clipDir = path.join(CLIPS_DIR, clipId);
  fs.mkdirSync(clipDir, { recursive: true });
  const identityBrief = manifest.identityPrompt
    ? ` Keep the character identity consistent: ${manifest.identityPrompt}`
    : '';
  const lieuBrief = manifest.lieu ? ` Same setting throughout: ${manifest.lieu}.` : '';

  const videoPaths = [];
  let dernierEchec = '';
  // Malcolm : troisieme chemin de rendu, meme grille que la video et le
  // manga statique (branchement du 23/09/2026, apres le constat qu'un clip
  // "manga anime" n'avait jamais ete couvert). Une frame extraite par scene,
  // comme pour la video : le rendu ici EST une video, pas une image fixe.
  const malcolmLog = [];
  const malcolmOn = isMalcolmEnabled(process.env);
  const castLabels = manifest.identityPrompt ? [manifest.identityPrompt] : [];
  emitProgress(onProgress, { stage: 'animate:planned', status: 'generating', progress: 10, totalSegments: panels.length });
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    // On anime la case : mouvement de caméra léger, personnages qui bougent,
    // en gardant la composition de la planche.
    const prompt = `Animate this manga panel into a moving anime shot. ${p.visual || ''}${lieuBrief}${identityBrief} Cinematic anime motion, subtle camera movement, characters come alive, smooth animation.`.trim();
    try {
      const videoUrl = await animatePanelImpl(prompt, p.promptId, i, 600_000, { onProgress });
      const dest = path.join(clipDir, `scene_${String(i).padStart(2, '0')}.mp4`);
      emitProgress(onProgress, { stage: 'animate:downloading', status: 'generating', segmentIndex: i });
      await materializeMedia(videoUrl, dest, { kind: 'video' });

      // Un seul nouvel essai si "rejete" -- jamais une boucle, jamais de
      // blocage de la scene sur son seul avis. Tout echec ici se journalise
      // et n'interrompt jamais la generation.
      if (malcolmOn) {
        try {
          const framePath = path.join(clipDir, `scene_${String(i).padStart(2, '0')}_malcolm.jpg`);
          const previousPanel = i > 0 ? panels[i - 1] : null;
          const judgeThisFrame = (imageUrl) => judgeContinuityImpl({
            imageUrl,
            planIndex: i,
            planName: p.name,
            planVisual: p.visual,
            previousPlanVisual: previousPanel ? previousPanel.visual : '',
            lieu: manifest.lieu || '',
            mood: '',
            title: manifest.title || '',
            castLabels,
            vehicleHints: Array.isArray(config.vehicleHints) ? config.vehicleHints : [],
          });

          const frame = extractFrameForMalcolm(execFileSyncImpl, dest, framePath);
          let jugement = frame ? await judgeThisFrame(frame) : { ok: false, skipped: true, reason: 'malcolm_frame_missing' };

          if (jugement.ok && jugement.verdict.verdict === 'rejete') {
            const motif = [jugement.verdict.raison_changement, jugement.verdict.suite_possible].filter(Boolean).join(' ');
            console.warn(`[animate] Malcolm: scène ${i} rejetée (${sanitizeDiagnostic(motif, 160)}), un seul nouvel essai.`);
            try {
              const correctedUrl = await animatePanelImpl(`${prompt} ${motif}`.trim(), p.promptId, i, 600_000, { onProgress });
              await materializeMedia(correctedUrl, dest, { kind: 'video' });
              const frame2 = extractFrameForMalcolm(execFileSyncImpl, dest, framePath);
              if (frame2) jugement = await judgeThisFrame(frame2);
            } catch (retryError) {
              console.warn(`[animate] Malcolm: nouvel essai de la scène ${i} échoué (${sanitizeDiagnostic(retryError.message, 120)}), premier rendu conservé.`);
            }
          }

          malcolmLog.push({
            planIndex: i,
            planName: p.name,
            skipped: !jugement.ok,
            reason: jugement.ok ? undefined : jugement.reason,
            verdict: jugement.ok ? jugement.verdict : null,
          });
        } catch (error) {
          console.warn(`[animate] Malcolm indisponible pour la scène ${i}: ${sanitizeDiagnostic(error.message, 120)}`);
          malcolmLog.push({ planIndex: i, planName: p.name, skipped: true, reason: 'malcolm_error' });
        }
      }

      videoPaths.push(dest);
      console.log(`[animate] Scène ${i} prête (${videoPaths.length}/${panels.length})`);
      emitProgress(onProgress, {
        stage: 'animate:ready', status: 'generating',
        progress: 15 + Math.round((videoPaths.length / panels.length) * 75),
        segments: videoPaths.length, totalSegments: panels.length,
      });
    } catch (error) {
      dernierEchec = sanitizeDiagnostic(error.message, 200);
      console.warn(`[animate] Scène ${i} échouée: ${dernierEchec}`);
    }
    if (i < panels.length - 1) await sleepImpl(2000);
  }
  if (!videoPaths.length) {
    fs.rmSync(clipDir, { recursive: true, force: true });
    throw new Error(`manga_animate_no_scenes: aucune scène animée — ${dernierEchec || 'cause inconnue'}`);
  }
  const partial = videoPaths.length < panels.length;
  const warning = partial ? `manga_animate_partial: ${videoPaths.length}/${panels.length} scènes` : null;
  emitProgress(onProgress, { stage: 'assembling', status: 'assembling', progress: 92, segments: videoPaths.length, totalSegments: panels.length, ...(warning ? { message: warning } : {}) });

  // La toile de Malcolm, meme principe que les deux autres modes de rendu.
  let malcolmSummary = null;
  if (malcolmOn && malcolmLog.length) {
    try {
      malcolmSummary = malcolmLog.reduce((acc, entry) => {
        const key = entry.skipped ? 'skipped' : ((entry.verdict && entry.verdict.verdict) || 'skipped');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, { coherent: 0, rupture_acceptee: 0, rejete: 0, skipped: 0 });
      const toileSvg = buildToileSvgImpl(malcolmLog, { title: manifest.title || 'anime' });
      fs.writeFileSync(path.join(clipDir, 'malcolm-toile.svg'), toileSvg);
      console.log(`[animate] Malcolm: ${JSON.stringify(malcolmSummary)}`);
    } catch (error) {
      console.warn(`[animate] Malcolm: toile non générée (${sanitizeDiagnostic(error.message, 120)})`);
    }
    try {
      await writeMalcolmCheckpointImpl({ clipId, title: manifest.title || 'anime', render: 'manga-anime', malcolmLog, malcolmSummary });
    } catch (error) {
      console.warn(`[animate] Malcolm: checkpoint non écrit (${sanitizeDiagnostic(error.message, 120)})`);
    }
  }

  // Assemblage : concat vidéo, muet (pas d'audio pour un manga animé).
  const baseName = (manifest.title || 'anime').replace(/[^a-zA-Z0-9àâéèêëïîôùûüç -]/gi, '').replace(/\s+/g, '-').slice(0, 40) || 'anime';
  const safeName = `${baseName}-anime`;
  const outputPath = path.join(clipDir, safeName + '.mp4');
  const concatFile = path.join(clipDir, 'concat.txt');
  fs.writeFileSync(concatFile, videoPaths.map((p) => `file '${p}'`).join('\n'));
  execFileSyncImpl('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    outputPath,
  ], { timeout: 300_000, windowsHide: true });
  const outputStats = fs.statSync(outputPath, { throwIfNoEntry: false });
  if (!outputStats?.isFile() || outputStats.size <= 0) throw new Error('manga_animate_output_missing');

  const publicFilename = `${safeName}-${clipId.slice('clip-'.length)}.mp4`;
  const publicPath = path.join(CLIPS_DIR, publicFilename);
  fs.copyFileSync(outputPath, publicPath);
  console.log(`[animate] Terminé: ${publicFilename} (${videoPaths.length} scènes)`);
  emitProgress(onProgress, { stage: 'complete', status: 'done', progress: 100 });
  return {
    ok: true,
    filename: publicFilename,
    url: 'https://a11.funesterie.me/clips/' + encodeURIComponent(publicFilename),
    path: publicPath,
    kind: 'anime',
    fromManga: decoded,
    scenes: videoPaths.length,
    requestedScenes: panels.length,
    partial,
    warning,
    malcolm: malcolmSummary,
  };
}

function requireDirectedScenes(directed) {
  if (!Array.isArray(directed?.scenes) || directed.scenes.length === 0) {
    throw new Error('clip_director_scenes_missing');
  }
  return directed.scenes.map((scene, index) => {
    const visual = String(scene?.visual || '').trim();
    if (!visual) throw new Error(`clip_director_scene_visual_missing: scene ${index + 1}`);
    return { ...scene, visual };
  });
}

function createClipId(nowImpl = Date.now, randomBytesImpl = crypto.randomBytes) {
  return `clip-${nowImpl()}-${randomBytesImpl(4).toString('hex')}`;
}

// Point d'entrée principal
async function generateClip(config = {}, {
  materializeMedia = materializeClipMedia,
  loadDirectorImpl = loadClipDirector,
  generateVideoImpl = generateOneVideo,
  generateOnePanelImpl = generateOnePanel,
  resolveVideoModelsImpl = resolveVideoModels,
  lireSoldeImpl = null,
  execFileSyncImpl = execFileSync,
  sleepImpl = sleep,
  nowImpl = Date.now,
  randomBytesImpl = crypto.randomBytes,
  judgeContinuityImpl = malcolmJudgeContinuity,
  buildToileSvgImpl = malcolmBuildToileSvg,
  writeMalcolmCheckpointImpl = malcolmWriteCheckpoint,
} = {}) {
  let { songUrl, title, sections, style = '', fullDuration, onProgress, casting = '', castArtists = [], render = '', identiteCompte = null } = config;
  // Mode script (16/09/2026) : au lieu d'un MP3, on soumet un SCRIPT. K44 écrit
  // le scénario, A11 le découpe en scènes. Pas d'audio, pas de durée mesurée :
  // le nombre de plans vient du découpage A11. Le clip vidéo est muet.
  const mode = String(config.mode || '').trim().toLowerCase();
  const isScriptMode = mode === 'script';
  const clipId = createClipId(nowImpl, randomBytesImpl);
  const clipDir = path.join(CLIPS_DIR, clipId);
  fs.mkdirSync(clipDir, { recursive: true });

  const audioPath = path.join(clipDir, 'audio.mp3');
  let audioDuration = 180;
  let numSegments;
  const SEGMENT_SECONDS = clipCredits.secondesParPlan();

  if (isScriptMode) {
    // Pas de média audio : le script est la source. On borne le nombre de plans
    // par sceneCount (ou 8 par défaut), le découpage A11 fixera le compte réel.
    numSegments = require('./script-director.cjs').clampSceneCount(config.sceneCount || config.planCount);
    // Plans vidéo (film/animé) : 24 au plus, comme la réservation de crédits de la route.
    if (render !== 'manga') numSegments = Math.min(24, numSegments);
    console.log(`[clip] Mode script : ${numSegments} scènes visées (muet)`);
    emitProgress(onProgress, { stage: 'audio:ready', status: 'validating', progress: 8 });
  } else {
    // 1. Valider et matérialiser l'audio AVANT le Director et avant tout appel
    // vidéo payant. Une page HTML ou un lien mort s'arrête donc sans crédit perdu.
    emitProgress(onProgress, { stage: 'audio:validating', status: 'validating', progress: 2 });
    try {
      await materializeMedia(songUrl, audioPath, { kind: 'audio' });
    } catch (error) {
      fs.rmSync(clipDir, { recursive: true, force: true });
      throw new Error(`clip_audio_preflight_failed: ${error.message}`);
    }
    console.log('[clip] Audio prêt');
    emitProgress(onProgress, { stage: 'audio:ready', status: 'validating', progress: 8 });

    // 2. Mesurer la durée -- AVANT le Director (12/09/2026) : c'est elle qui dit
    // combien de plans écrire. Avant, Sol écrivait un plan par section de l'arc
    // (~7) et un Full Clip de 26 segments repassait ces 7 plans quatre fois.
    // Le repli de 180 s ne survit que si la mesure est un nombre. Avant, l'affectation
    // se faisait AVANT toute verification : un ffprobe qui reussit en imprimant « N/A »
    // ou rien donnait NaN, sans exception, donc sans passer par le catch. numSegments
    // valait alors NaN, la boucle `i < NaN` ne tournait pas une seule fois, et l'erreur
    // finale disait « Aucune vidéo générée » sans que rien n'ait ete tente.
    try {
      const brut = execFileSyncImpl('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        audioPath,
      ], { timeout: 10_000, windowsHide: true }).toString().trim();
      const mesure = Math.ceil(parseFloat(brut));
      if (Number.isFinite(mesure) && mesure > 0) audioDuration = mesure;
      else console.warn(`[clip] Durée illisible (${brut || 'sortie vide'}), repli sur ${audioDuration}s`);
    } catch (e) {
      console.warn(`[clip] ffprobe indisponible (${e.message}), repli sur ${audioDuration}s`);
    }
    console.log(`[clip] Durée audio: ${audioDuration}s`);

    // 3. Calculer le nombre de segments (max 6 vidéos pour un clip normal, toute la durée pour full)
    // Seedance livre des plans de 7,1 s, pas 8 : mesure du 13/09/2026, 28 plans =
    // 198,9 s pour une chanson de 224 s. Le montage coupe au plus court (-shortest),
    // donc chaque Full Clip perdait la fin du morceau (25 s ici). On compte 7 s par
    // plan : un peu sous le reel, pour que les plans couvrent toujours toute la
    // chanson ; le surplus d'image est coupe a la fin de l'audio.
    if (fullDuration) {
      numSegments = Math.ceil(audioDuration / SEGMENT_SECONDS);
    } else {
      numSegments = Math.min(6, Math.ceil(audioDuration / SEGMENT_SECONDS));
    }
    console.log(`[clip] ${numSegments} vidéos à générer (${fullDuration ? 'full' : 'normal'})`);
  }

  // Vivy Director : scènes issues des paroles + identité visuelle des personnages.
  // Une erreur de modèle ou une réponse mal formée est propagée : on ne masque
  // plus un échec de scénarisation sous six plans génériques.
  let identity = { identityIds: [], prompt: '', negativePrompt: '', referenceImageUrls: [] };
  let lieu = '';
  const directorProgress = (event, details = {}) => {
    const payload = typeof event === 'string' ? { ...details, stage: event } : { ...(event || {}) };
    const substage = String(payload.stage || 'working').replace(/^director:/, '');
    emitProgress(onProgress, {
      ...payload,
      stage: `director:${substage}`,
      status: 'directing',
      progress: Number.isFinite(Number(payload.progress)) ? Number(payload.progress) : 12,
    });
  };
  emitProgress(onProgress, { stage: 'director:starting', status: 'directing', progress: 10 });
  let directed;
  try {
    if (isScriptMode) {
      // K44 écrit le scénario, A11 le découpe. Même contrat de sortie (scenes[].visual).
      const scriptDirector = require('./script-director.cjs');
      directed = await scriptDirector.directScript({
        title, style, sections, casting, castArtists, render, identiteCompte,
        scriptText: config.scriptText, scriptUrl: config.scriptUrl,
        sceneCount: numSegments, lieu: config.lieu, direction: directionAvecElementRecurrent(config),
        onProgress: directorProgress,
      });
      sections = requireDirectedScenes(directed);
      // Le découpage A11 fixe le vrai compte de plans, sans dépasser le nombre demandé :
      // les crédits ont été réservés pour ce nombre-là.
      if (Array.isArray(sections) && sections.length > numSegments) sections = sections.slice(0, numSegments);
      if (Array.isArray(sections) && sections.length) numSegments = sections.length;
    } else {
      const director = loadDirectorImpl();
      if (!director || typeof director.directClip !== 'function') throw new Error('directClip indisponible');
      directed = await director.directClip({ title, songUrl, audioPath, style, sections, casting, castArtists, render, identiteCompte,
        planCount: numSegments, durationSeconds: audioDuration,
        lyrics: config.lyrics, lieu: config.lieu, direction: directionAvecElementRecurrent(config), onProgress: directorProgress });
      sections = requireDirectedScenes(directed);
    }
  } catch (error) {
    throw new Error(`clip_director_failed: ${error.message}`);
  }
  console.log(`[clip] Director: ${sections.length} plans`);
  if (directed?.identity) identity = directed.identity;
  if (directed?.lieu) {
    lieu = directed.lieu;
    console.log(`[clip] Lieu unique: ${lieu.slice(0, 70)}`);
  }
  // Conserver le scenario propre a ce morceau pour diagnostiquer une derive avant/apres generation.
  fs.writeFileSync(path.join(clipDir, 'storyboard.json'), JSON.stringify({
    title, songUrl, lieu, identityIds: directed?.identity?.identityIds || [], scenes: directed?.scenes,
  }, null, 2));
  emitProgress(onProgress, { stage: 'director:ready', status: 'directing', progress: 18 });

  // --- MODE MANGA : planches images, pas de vidéo. Une image par scène, puis
  // on assemble une planche-contact verticale (webtoon) + on garde les cases.
  // C'est le chemin le plus simple/économe : pas de Seedance vidéo, pas d'audio.
  const isManga = String(render || '').trim().toLowerCase() === 'manga';
  if (isManga) {
    // Un chapitre d'enfance ne peut pas recevoir la fiche visuelle : elle decrit
    // toujours l'adulte (« un homme au debut de la trentaine, barbe courte,
    // tee-shirt a feuilles de palmier, chaine en or, bottes de moto »). Le
    // 20/09/2026 on a d'abord AJOUTE l'age apres la fiche, en esperant qu'il la
    // contredise : le modele a dessine les deux, l'adulte barbu ET l'ado, cote a
    // cote dans chaque case, et la bulle du pere sortait de la bouche de
    // l'adulte. Une fiche de chapitre REMPLACE donc la fiche du registre ; elle
    // n'est utilisee que par les chapitres qui en fournissent une.
    const fichesChapitre = String(config.fichesPersonnages || '').trim();
    const { identiteRetenue, mangaIdentityBrief, mangaAgeBrief } = briefIdentiteManga({
      fichesPersonnages: fichesChapitre,
      ageDesPersonnages: config.ageDesPersonnages,
      identityPrompt: identity.prompt,
    });
    if (fichesChapitre && identity.prompt) {
      console.log(`[manga] Fiche de chapitre : la fiche du registre (${(identity.identityIds || []).join(', ') || 'sans id'}) est remplacée, pas complétée.`);
    }
    const mangaLieuBrief = lieu ? ` Same setting across the whole story: ${lieu}.` : '';
    const panelPaths = [];
    // Chaque planche garde son prompt_id Comfy + le prompt de la scène : c'est
    // ce qui permet d'ANIMER le manga plus tard (manga → animé) en i2v Seedance.
    const panelsMeta = [];
    let dernierEchecPanel = '';
    // Malcolm : meme grille que la video (branchement du 23/09/2026), sur la
    // planche directement -- pas d'extraction de frame necessaire, la planche
    // EST l'image jugee. Les questions d'identite (personnages, vehicules)
    // comptent au moins autant ici : c'est en manga que l'age et la tenue d'un
    // personnage derivent case a case (voir le commentaire manga plus haut).
    const malcolmLog = [];
    const malcolmOn = isMalcolmEnabled(process.env);
    for (let i = 0; i < numSegments; i++) {
      const section = sections[i % sections.length];
      const prompt = effacerNomsFilm(
        `${section.visual}.${mangaLieuBrief} ${renduVisuel(process.env, 'manga')} ${styleVideo(style, title)}${mangaIdentityBrief}${mangaAgeBrief}`.trim(),
        identity.nomsFilm,
      );
      try {
        const panelRes = await generateOnePanelImpl(prompt, i, 300_000, identity, { onProgress });
        // Rétrocompat : ancien format = URL string, nouveau = { url, promptId }.
        let panelUrl = typeof panelRes === 'string' ? panelRes : panelRes.url;
        let panelPromptId = typeof panelRes === 'string' ? null : panelRes.promptId;
        const dest = path.join(clipDir, `panel_${String(i).padStart(2, '0')}.png`);
        emitProgress(onProgress, { stage: 'panel:downloading', status: 'generating', segmentIndex: i });
        await materializeMedia(panelUrl, dest, { kind: 'image' });

        // Un seul nouvel essai si "rejete" (identite ou derive non voulue) --
        // jamais une boucle, jamais un blocage de la planche sur son seul avis.
        // Tout echec ici se journalise et n'interrompt jamais la generation.
        if (malcolmOn) {
          try {
            const previousSection = i > 0 ? sections[(i - 1) % sections.length] : null;
            const judgeThisPanel = () => judgeContinuityImpl({
              imageUrl: dest,
              planIndex: i,
              planName: section.name,
              planVisual: section.visual,
              previousPlanVisual: previousSection ? previousSection.visual : '',
              lieu,
              mood: (directed && directed.mood) || '',
              title,
              castLabels: identity.castLabels || [],
              vehicleHints: Array.isArray(config.vehicleHints) ? config.vehicleHints : [],
            });
            let jugement = await judgeThisPanel();

            if (jugement.ok && jugement.verdict.verdict === 'rejete') {
              const motif = [jugement.verdict.raison_changement, jugement.verdict.suite_possible].filter(Boolean).join(' ');
              console.warn(`[manga] Malcolm: planche ${i} rejetée (${sanitizeDiagnostic(motif, 160)}), un seul nouvel essai.`);
              try {
                const correctedRes = await generateOnePanelImpl(`${prompt} ${motif}`.trim(), i, 300_000, identity, { onProgress });
                const correctedUrl = typeof correctedRes === 'string' ? correctedRes : correctedRes.url;
                await materializeMedia(correctedUrl, dest, { kind: 'image' });
                panelUrl = correctedUrl;
                panelPromptId = typeof correctedRes === 'string' ? null : correctedRes.promptId;
                jugement = await judgeThisPanel();
              } catch (retryError) {
                console.warn(`[manga] Malcolm: nouvel essai de la planche ${i} échoué (${sanitizeDiagnostic(retryError.message, 120)}), premier rendu conservé.`);
              }
            }

            malcolmLog.push({
              planIndex: i,
              planName: section.name,
              skipped: !jugement.ok,
              reason: jugement.ok ? undefined : jugement.reason,
              verdict: jugement.ok ? jugement.verdict : null,
            });
          } catch (error) {
            console.warn(`[manga] Malcolm indisponible pour la planche ${i}: ${sanitizeDiagnostic(error.message, 120)}`);
            malcolmLog.push({ planIndex: i, planName: section.name, skipped: true, reason: 'malcolm_error' });
          }
        }
        // La bulle est ECRITE par nous, pas dessinee par le modele : son texte
        // est celui de K44, donc juste, en francais et sans faute (20/09/2026).
        // Les bulles alternent de cote pour ne pas masquer toujours le meme coin.
        let bulle = false;
        if (section.dialogue) {
          try {
            bulle = await require('./manga-bulles.cjs').poserBulle(dest, {
              texte: section.dialogue,
              locuteur: section.locuteur || '',
              position: i % 2 === 0 ? 'haut' : 'droite',
            });
          } catch (error) {
            console.warn(`[manga] Bulle non posee sur la planche ${i}: ${sanitizeDiagnostic(error.message, 120)}`);
          }
        }
        panelPaths.push(dest);
        panelsMeta.push({
          index: i,
          promptId: panelPromptId,
          file: path.basename(dest),
          name: section.name || `Plan ${i + 1}`,
          visual: section.visual || '',
          acte: section.acte || '',
          dialogue: section.dialogue || '',
          locuteur: section.locuteur || '',
          bulle,
        });
        console.log(`[manga] Planche ${i} prête (${panelPaths.length}/${numSegments})`);
        emitProgress(onProgress, {
          stage: 'panel:ready', status: 'generating',
          progress: 20 + Math.round((panelPaths.length / numSegments) * 70),
          segments: panelPaths.length, totalSegments: numSegments,
        });
      } catch (error) {
        dernierEchecPanel = sanitizeDiagnostic(error.message, 200);
        console.warn(`[manga] Planche ${i} échouée: ${dernierEchecPanel}`);
      }
      if (i < numSegments - 1) await sleepImpl(1500);
    }
    if (!panelPaths.length) {
      fs.rmSync(clipDir, { recursive: true, force: true });
      throw new Error(`manga_no_panels: aucune planche générée — ${dernierEchecPanel || 'cause inconnue'}`);
    }
    // Manifeste des planches : réutilisé pour animer le manga (manga → animé).
    try {
      fs.writeFileSync(path.join(clipDir, 'manga-panels.json'), JSON.stringify({
        title, lieu, render: 'manga',
        identityIds: fichesChapitre ? [] : (identity.identityIds || []),
        identityPrompt: identiteRetenue || '',
        ficheDeChapitre: Boolean(fichesChapitre),
        panels: panelsMeta,
      }, null, 2));
    } catch (e) { console.warn('[manga] manifeste planches non écrit:', e.message); }
    const partial = panelPaths.length < numSegments;
    const warning = partial ? `manga_partial: ${panelPaths.length}/${numSegments} planches` : null;
    emitProgress(onProgress, { stage: 'assembling', status: 'assembling', progress: 92, segments: panelPaths.length, totalSegments: numSegments, ...(warning ? { message: warning } : {}) });

    // La toile de Malcolm, meme principe que le mode video (voir plus bas).
    let malcolmSummary = null;
    if (malcolmOn && malcolmLog.length) {
      try {
        malcolmSummary = malcolmLog.reduce((acc, entry) => {
          const key = entry.skipped ? 'skipped' : ((entry.verdict && entry.verdict.verdict) || 'skipped');
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, { coherent: 0, rupture_acceptee: 0, rejete: 0, skipped: 0 });
        const toileSvg = buildToileSvgImpl(malcolmLog, { title });
        fs.writeFileSync(path.join(clipDir, 'malcolm-toile.svg'), toileSvg);
        console.log(`[manga] Malcolm: ${JSON.stringify(malcolmSummary)}`);
      } catch (error) {
        console.warn(`[manga] Malcolm: toile non générée (${sanitizeDiagnostic(error.message, 120)})`);
      }
      // Conseils de terrain (23/09/2026) : les verdicts problematiques
      // (rejete, rupture_acceptee) partent en checkpoint Neo4j -- best-effort
      // par construction (voir malcolm-checkpoints.cjs), et enveloppe ici en
      // plus, comme le jugement Malcolm lui-meme : ne casse jamais la
      // planche-contact, quoi que fasse l'implementation injectee.
      try {
        await writeMalcolmCheckpointImpl({ clipId, title, render: 'manga', malcolmLog, malcolmSummary });
      } catch (error) {
        console.warn(`[manga] Malcolm: checkpoint non écrit (${sanitizeDiagnostic(error.message, 120)})`);
      }
    }

    // Assemblage : une planche verticale (style webtoon) qui empile les cases.
    // FFmpeg vstack met les images bout à bout ; largeur uniforme d'abord.
    const safeName = (title || 'manga').replace(/[^a-zA-Z0-9àâéèêëïîôùûüç -]/gi, '').replace(/\s+/g, '-').slice(0, 40) || 'manga';
    const boardPath = path.join(clipDir, safeName + '.png');
    try {
      const inputs = [];
      panelPaths.forEach((p) => { inputs.push('-i', p); });
      const n = panelPaths.length;
      // Normalise chaque case à 1024px de large puis empile verticalement.
      const scaleChain = panelPaths.map((_, i) => `[${i}:v]scale=1024:-1[p${i}]`).join(';');
      const stackChain = panelPaths.map((_, i) => `[p${i}]`).join('') + `vstack=inputs=${n}[out]`;
      execFileSyncImpl('ffmpeg', [
        '-y', ...inputs,
        '-filter_complex', `${scaleChain};${stackChain}`,
        '-map', '[out]',
        boardPath,
      ], { timeout: 180_000, windowsHide: true });
    } catch (error) {
      // Si l'empilage échoue (une seule case, ou tailles incompatibles), on garde
      // au moins la première planche comme sortie.
      console.warn(`[manga] Assemblage planche échoué (${sanitizeDiagnostic(error.message, 120)}), première case servie seule.`);
      fs.copyFileSync(panelPaths[0], boardPath);
    }
    const boardStats = fs.statSync(boardPath, { throwIfNoEntry: false });
    if (!boardStats?.isFile() || boardStats.size <= 0) throw new Error('manga_board_missing_or_empty');

    const publicFilename = `${safeName}-${clipId.slice('clip-'.length)}.png`;
    const publicPath = path.join(CLIPS_DIR, publicFilename);
    fs.copyFileSync(boardPath, publicPath);
    // Manifeste public : <planche>.panels.json à côté du .png, pour animer plus tard.
    const publicPanelsManifest = publicPath.replace(/\.png$/i, '.panels.json');
    try {
      fs.copyFileSync(path.join(clipDir, 'manga-panels.json'), publicPanelsManifest);
    } catch (e) { console.warn('[manga] manifeste public non copié:', e.message); }
    console.log(`[manga] Terminé: ${publicFilename} (${panelPaths.length} planches)`);
    emitProgress(onProgress, { stage: 'complete', status: 'done', progress: 100 });
    return {
      ok: true,
      filename: publicFilename,
      url: 'https://a11.funesterie.me/clips/' + encodeURIComponent(publicFilename),
      path: publicPath,
      kind: 'manga',
      clipId,
      panels: panelPaths.length,
      requestedPanels: numSegments,
      panelPromptIds: panelsMeta.map((p) => p.promptId).filter(Boolean),
      partial,
      warning,
      malcolm: malcolmSummary,
    };
  }

  // (La durée et le nombre de plans sont mesurés avant le Director, plus haut.)

  // Une seule lecture du catalogue pour tout le clip: les 26 segments d'un full
  // partagent le meme choix de modele, et une panne de decouverte n'empeche pas
  // la generation.
  const videoModels = await resolveVideoModelsImpl({ env: process.env });
  console.log(`[clip] Modèles vidéo: t2v=${videoModels.t2v} i2v=${videoModels.i2v || '(aucun au catalogue)'}${videoModels.decouvert ? '' : ' — catalogue illisible, repli sur le défaut'}`);
  emitProgress(onProgress, {
    stage: 'video:planned',
    status: 'generating',
    progress: 20,
    segments: 0,
    totalSegments: numSegments,
  });

  // 5. Générer les vidéos UNE PAR UNE (séquentiel)
  // L'identité des personnages est répétée sur CHAQUE segment : c'est ce qui
  // empêche Vivy de changer de tête entre la 3e et la 12e vidéo.
  const identityBrief = identity.prompt
    ? ` Character identity to preserve exactly across every shot: ${identity.prompt}`
    : '';
  // Le lieu est rappele sur chaque segment, comme l'identite : c'est ce qui
  // empeche le clip de partir dans six endroits differents.
  const lieuBrief = lieu ? ` The entire clip is shot in one single location: ${lieu}. Every shot stays in this same location.` : '';
  // Refus de paiement : bascule entre credits mensuels et bonus (voir estRefusPaiement).
  const lireSoldeReprise = typeof lireSoldeImpl === 'function'
    ? lireSoldeImpl
    : require('./comfy-solde.cjs').creerLecteurSolde({ cacheMs: 0 });
  const reessayerApresRefusPaiement = async (i, prompt, premiereErreur) => {
    const parPlan = require('./comfy-solde.cjs').creditsComfyParPlan(process.env);
    let derniere = premiereErreur;
    for (let essai = 1; essai <= PAUSES_REPRISE_PAIEMENT_MS.length; essai++) {
      let solde = null;
      try { solde = await lireSoldeReprise(); } catch (_) { solde = null; }
      const detail = solde ? `${solde.credits} crédits (mensuel ${solde.mensuel ?? '?'}, bonus ${solde.bonus ?? '?'})` : 'solde illisible';
      if (solde && Number.isFinite(Number(solde.credits)) && Number(solde.credits) < parPlan) {
        throw new Error(`comfy_credits_epuises: ${detail}, il en faut ${parPlan} par plan — ${derniere && derniere.message}`);
      }
      const pause = PAUSES_REPRISE_PAIEMENT_MS[essai - 1];
      console.warn(`[clip] Vidéo ${i}: Comfy refuse le paiement, il reste ${detail} ; bascule de réserve, nouvel essai ${essai}/${PAUSES_REPRISE_PAIEMENT_MS.length} dans ${Math.round(pause / 1000)} s.`);
      emitProgress(onProgress, { stage: 'video:credits-switch', status: 'generating', segmentIndex: i });
      await sleepImpl(pause);
      try {
        return await generateVideoImpl(prompt, i, 600000, identity, { onProgress, models: videoModels });
      } catch (error) {
        if (!estRefusPaiement(error && error.message)) throw error;
        derniere = error;
      }
    }
    throw derniere;
  };

  const videoPaths = [];
  // Le motif du dernier segment rate : c'est lui qui explique un clip vide.
  let dernierEchec = '';
  let refusPolitique = 0;
  let arretPlafond = false;
  let arretPaiement = false;
  // Malcolm : un verdict par segment reellement rendu, pour le journal et la toile.
  const malcolmLog = [];
  const malcolmOn = isMalcolmEnabled(process.env);
  for (let i = 0; i < numSegments; i++) {
    const section = sections[i % sections.length];
    const prompt = effacerNomsFilm(
      `${section.visual}.${lieuBrief}${elementRecurrentBrief(config)} ${renduVisuel(process.env, render)} ${styleVideo(style, title)}${identityBrief}`.trim(),
      identity.nomsFilm,
    );

    try {
      let videoUrl;
      try {
        videoUrl = await generateVideoImpl(prompt, i, 600000, identity, { onProgress, models: videoModels });
      } catch (premiereErreur) {
        const motif = premiereErreur && premiereErreur.message;
        if (estRefusAudio(motif) && refusPolitique + 1 < PLAFOND_REFUS_POLITIQUE) {
          // Le premier refus compte dans le plafond : le second essai est payant lui aussi.
          refusPolitique += 1;
          console.warn(`[clip] Vidéo ${i}: son de la scène refusé par le filtre (${refusPolitique}/${PLAFOND_REFUS_POLITIQUE}), nouvel essai avec une ambiance neutre.`);
          videoUrl = await generateVideoImpl(`${prompt}${CONSIGNE_AUDIO_NEUTRE}`, i, 600000, identity, { onProgress, models: videoModels, sansAudio: true });
        } else if (estRefusAutorisation(motif)) {
          console.warn(`[clip] Vidéo ${i}: autorisation Comfy refusée, nouvel essai dans ${Math.round(PAUSE_REPRISE_AUTORISATION_MS / 1000)} s.`);
          await sleepImpl(PAUSE_REPRISE_AUTORISATION_MS);
          videoUrl = await generateVideoImpl(prompt, i, 600000, identity, { onProgress, models: videoModels });
        } else if (estRefusPaiement(motif)) {
          videoUrl = await reessayerApresRefusPaiement(i, prompt, premiereErreur);
        } else {
          throw premiereErreur;
        }
      }
      const dest = path.join(clipDir, `scene_${String(i).padStart(2, '0')}.mp4`);
      emitProgress(onProgress, { stage: 'video:downloading', status: 'generating', segmentIndex: i });
      await materializeMedia(videoUrl, dest, { kind: 'video' });
      videoPaths.push(dest);
      console.log(`[clip] Vidéo ${i} prête (${videoPaths.length}/${numSegments})`);
      emitProgress(onProgress, {
        stage: 'video:ready',
        status: 'generating',
        progress: 20 + Math.round((videoPaths.length / numSegments) * 70),
        segments: videoPaths.length,
        totalSegments: numSegments,
        segmentIndex: i,
      });

      // Malcolm : regarde CE QUI A ETE RENDU, pas le texte du plan. Un seul
      // nouvel essai si "rejete" (identite ou derive non voulue) -- jamais une
      // boucle, jamais un blocage du clip sur son seul avis : il informe et
      // corrige une fois, il ne fait pas foi. Tout echec ici (extraction,
      // vision indisponible, nouvel essai rate) se journalise et n'interrompt
      // jamais la generation.
      if (malcolmOn) {
        try {
          const framePath = path.join(clipDir, `scene_${String(i).padStart(2, '0')}_malcolm.jpg`);
          const previousSection = i > 0 ? sections[(i - 1) % sections.length] : null;
          const judgeThisFrame = (imageUrl) => judgeContinuityImpl({
            imageUrl,
            planIndex: i,
            planName: section.name,
            planVisual: section.visual,
            previousPlanVisual: previousSection ? previousSection.visual : '',
            lieu,
            mood: (directed && directed.mood) || '',
            title,
            castLabels: identity.castLabels || [],
            vehicleHints: Array.isArray(config.vehicleHints) ? config.vehicleHints : [],
          });

          const frame = extractFrameForMalcolm(execFileSyncImpl, dest, framePath);
          let jugement = frame ? await judgeThisFrame(frame) : { ok: false, skipped: true, reason: 'malcolm_frame_missing' };

          if (jugement.ok && jugement.verdict.verdict === 'rejete') {
            const motif = [jugement.verdict.raison_changement, jugement.verdict.suite_possible].filter(Boolean).join(' ');
            console.warn(`[clip] Malcolm: plan ${i} rejeté (${sanitizeDiagnostic(motif, 160)}), un seul nouvel essai.`);
            try {
              const correctedUrl = await generateVideoImpl(`${prompt} ${motif}`.trim(), i, 600000, identity, { onProgress, models: videoModels });
              await materializeMedia(correctedUrl, dest, { kind: 'video' });
              const frame2 = extractFrameForMalcolm(execFileSyncImpl, dest, framePath);
              if (frame2) jugement = await judgeThisFrame(frame2);
            } catch (retryError) {
              console.warn(`[clip] Malcolm: nouvel essai du plan ${i} échoué (${sanitizeDiagnostic(retryError.message, 120)}), premier rendu conservé.`);
            }
          }

          malcolmLog.push({
            planIndex: i,
            planName: section.name,
            skipped: !jugement.ok,
            reason: jugement.ok ? undefined : jugement.reason,
            verdict: jugement.ok ? jugement.verdict : null,
          });
        } catch (error) {
          console.warn(`[clip] Malcolm indisponible pour le plan ${i}: ${sanitizeDiagnostic(error.message, 120)}`);
          malcolmLog.push({ planIndex: i, planName: section.name, skipped: true, reason: 'malcolm_error' });
        }
      }
    } catch (error) {
      dernierEchec = error.message;
      if (estRefusDePolitique(error.message)) {
        refusPolitique += 1;
        console.warn(`[clip] Vidéo ${i} refusée par le filtre de contenu (${refusPolitique}/${PLAFOND_REFUS_POLITIQUE}), on passe au plan suivant.`);
        if (refusPolitique >= PLAFOND_REFUS_POLITIQUE) {
          console.warn('[clip] Trop de refus du filtre, on arrête pour ne pas payer davantage.');
          arretPlafond = true;
          break;
        }
      } else {
        const cause = estRefusAutorisation(error.message)
          ? 'compte Comfy toujours non autorisé après un nouvel essai (crédits ou accès partenaire)'
          : estRefusPaiement(error.message)
            ? 'réserve Comfy épuisée (crédits mensuels et bonus)'
            : 'échouée sans resoumission';
        arretPaiement = estRefusPaiement(error.message);
        console.warn(`[clip] Vidéo ${i} ${cause}: ${error.message}`);
        break;
      }
    }

    // Petit délai entre les soumissions
    if (i < numSegments - 1) await sleepImpl(2000);
  }

  // « Aucune vidéo générée » seul est vrai mais muet : il a fallu une journee pour
  // retrouver que la cause etait une cle API expiree. Le motif voyage avec l'erreur.
  if (videoPaths.length === 0) {
    throw new Error(dernierEchec
      ? `Aucune vidéo générée — dernier échec : ${dernierEchec}`
      : `Aucune vidéo générée — aucun segment demandé (durée ${audioDuration}s, ${numSegments} segments)`);
  }
  const partial = videoPaths.length < numSegments;
  const warning = partial
    // Le plafond de refus et une panne ne se lisent pas pareil : « arret sans
    // resoumission » s'affichait aussi quand c'etait le plafond qui avait arrete.
    ? `clip_partial: ${videoPaths.length}/${numSegments} segments; ${arretPlafond
      ? `arrêté après ${refusPolitique} refus du filtre de contenu`
      : arretPaiement
        ? 'réserve Comfy épuisée (crédits mensuels et bonus)'
        : 'arrêt sans resoumission'} — ${dernierEchec}`
    : null;
  console.log(`[clip] ${videoPaths.length}/${numSegments} vidéos prêtes, assemblage FFmpeg...`);
  emitProgress(onProgress, {
    stage: 'assembling',
    status: 'assembling',
    progress: 92,
    segments: videoPaths.length,
    totalSegments: numSegments,
    ...(warning ? { message: warning } : {}),
  });

  // 6. Assembler avec FFmpeg
  const safeName = (title || 'clip').replace(/[^a-zA-Z0-9àâéèêëïîôùûüç -]/gi, '').replace(/\s+/g, '-').slice(0, 40) || 'clip';
  const outputPath = path.join(clipDir, safeName + '.mp4');

  // La toile de Malcolm : un graphe par clip, garde a cote du rendu (pas encore
  // publie sur /clips -- cette route sert tout avec Content-Type: video/mp4,
  // il faudrait la corriger avant d'y exposer un SVG public).
  let malcolmSummary = null;
  if (malcolmOn && malcolmLog.length) {
    try {
      malcolmSummary = malcolmLog.reduce((acc, entry) => {
        const key = entry.skipped ? 'skipped' : ((entry.verdict && entry.verdict.verdict) || 'skipped');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, { coherent: 0, rupture_acceptee: 0, rejete: 0, skipped: 0 });
      const toileSvg = buildToileSvgImpl(malcolmLog, { title });
      fs.writeFileSync(path.join(clipDir, 'malcolm-toile.svg'), toileSvg);
      console.log(`[clip] Malcolm: ${JSON.stringify(malcolmSummary)}`);
    } catch (error) {
      console.warn(`[clip] Malcolm: toile non générée (${sanitizeDiagnostic(error.message, 120)})`);
    }
    // Conseils de terrain (23/09/2026) : les verdicts problematiques (rejete,
    // rupture_acceptee) partent en checkpoint Neo4j -- best-effort par
    // construction (voir malcolm-checkpoints.cjs), et enveloppe ici en plus,
    // comme le jugement Malcolm lui-meme : ne casse jamais le clip, quoi que
    // fasse l'implementation injectee.
    try {
      await writeMalcolmCheckpointImpl({ clipId, title, render: render || 'video', malcolmLog, malcolmSummary });
    } catch (error) {
      console.warn(`[clip] Malcolm: checkpoint non écrit (${sanitizeDiagnostic(error.message, 120)})`);
    }
  }

  // Créer le fichier concat
  const concatFile = path.join(clipDir, 'concat.txt');
  fs.writeFileSync(concatFile, videoPaths.map(p => `file '${p}'`).join('\n'));

  // Concat vidéos (+ audio si clip musical). En mode script il n'y a pas de
  // piste audio : on assemble la vidéo seule, en gardant le son des scènes.
  const ffmpegArgs = isScriptMode
    ? [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFile,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        outputPath,
      ]
    : [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFile,
        '-i', audioPath,
        // Le son des scenes ne doit jamais remplacer la chanson par selection automatique.
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-movflags', '+faststart',
        outputPath,
      ];
  execFileSyncImpl('ffmpeg', ffmpegArgs, { timeout: 300_000, windowsHide: true });

  const outputStats = fs.statSync(outputPath, { throwIfNoEntry: false });
  if (!outputStats?.isFile() || outputStats.size <= 0) throw new Error('clip_output_missing_or_empty');
  try {
    const outputProbe = execFileSyncImpl('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      outputPath,
    ], { timeout: 10_000, windowsHide: true }).toString().trim().toLowerCase();
    if (!outputProbe.split(/\s+/).includes('video')) throw new Error('flux vidéo absent');
  } catch (error) {
    throw new Error(`clip_output_probe_failed: ${sanitizeDiagnostic(error.message, 160)}`);
  }

  // Copier à la racine pour le listing
  const publicFilename = `${safeName}-${clipId.slice('clip-'.length)}.mp4`;
  const publicPath = path.join(CLIPS_DIR, publicFilename);
  fs.copyFileSync(outputPath, publicPath);

  console.log(`[clip] Terminé: ${safeName}.mp4`);
  emitProgress(onProgress, { stage: 'complete', status: 'done', progress: 100 });
  return {
    ok: true,
    filename: publicFilename,
    url: 'https://a11.funesterie.me/clips/' + encodeURIComponent(publicFilename),
    path: publicPath,
    segments: videoPaths.length,
    requestedSegments: numSegments,
    duration: audioDuration,
    partial,
    warning,
    malcolm: malcolmSummary,
  };
}

function mountClipRoutes(app) {
  const express = require('express');
  app.get('/clips', (req, res) => res.redirect('/api/mcp-bridge/clip/list'));
  app.post('/api/mcp-bridge/clip/generate', express.json({ limit: '1mb' }), async (req, res) => {
    try { res.json(await generateClip(req.body)); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/mcp-bridge/clip/list', (req, res) => {
    try {
      const files = fs.readdirSync(CLIPS_DIR).filter(f => f.endsWith('.mp4') && !f.startsWith('clip-'));
      const clips = files.map(f => {
        const stat = fs.statSync(path.join(CLIPS_DIR, f));
        return { name: f, url: 'https://a11.funesterie.me/clips/' + f, size: stat.size, created: stat.mtime.toISOString() };
      }).sort((a, b) => new Date(b.created) - new Date(a.created));
      res.json({ clips });
    } catch (e) { res.json({ clips: [] }); }
  });
  app.get('/clips/:filename', (req, res) => {
    const f = path.join(CLIPS_DIR, req.params.filename.replace(/[^a-zA-Z0-9._-]/g, ''));
    if (fs.existsSync(f)) { res.set('Content-Type', 'video/mp4'); fs.createReadStream(f).pipe(res); }
    else res.status(404).json({ error: 'Not found' });
  });
  console.log('[clip-gen] V2 routes: /clips, /api/mcp-bridge/clip/{generate,list}');
}

module.exports = {
  elementRecurrentBrief,
  directionAvecElementRecurrent,
  T2V_DEFAUT,
  choisirReference,
  PLAFOND_REFUS_POLITIQUE,
  PAUSE_REPRISE_AUTORISATION_MS,
  estRefusAudio,
  renduVisuel,
  briefIdentiteManga,
  effacerNomsFilm,
  styleVideo,
  estRefusAutorisation,
  estRefusDePolitique,
  estRefusPaiement,
  PAUSES_REPRISE_PAIEMENT_MS,
  extractComfyErrorDetail,
  describeBridgeFailure,
  estImageVersVideo,
  pickVideoModels,
  resolveVideoModels,
  extractComfyJobStatus,
  extractComfyOutputUrl,
  extractComfyPromptId,
  generateClip,
  generateOneVideo,
  generateOnePanel,
  animateOnePanel,
  animateMangaClip,
  mountClipRoutes,
  postJson,
  requireDirectedScenes,
  sanitizeDiagnostic,
  isMalcolmEnabled,
  extractFrameForMalcolm,
};
