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
  return /PolicyViolation|SensitiveContent|copyright restriction/i.test(String(message || ''));
}

// Le 12/09/2026 (clip normal depuis le telephone), Seedance a refuse un plan pour
// son AUDIO : "OutputAudioSensitiveContentDetected". Or la piste son des scenes
// est jetee au montage, la chanson la remplace. Ce refus ne dit donc rien de
// l'image : le plan merite un second essai, avec une ambiance sonore neutre
// decrite en positif. Le catalogue Comfy ne documente aucun moyen de couper
// l'audio de Seedance, d'ou la consigne plutot qu'un parametre invente.
function estRefusAudio(message) {
  return /OutputAudioSensitiveContent|output audio may contain sensitive/i.test(String(message || ''));
}
const CONSIGNE_AUDIO_NEUTRE = ' Sound: soft ambient room tone and distant wind only.';

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
} = {}) {
  console.log(`[clip] Vidéo ${index}: ${prompt.slice(0, 60)}...`);
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
  if (identity && identity.negativePrompt) args.negative_prompt = identity.negativePrompt;
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

function loadClipDirector() {
  try { return require('./clip-vivy-director.cjs'); }
  catch (_) { return require('/app/clip-vivy-director.cjs'); }
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
  resolveVideoModelsImpl = resolveVideoModels,
  execFileSyncImpl = execFileSync,
  sleepImpl = sleep,
  nowImpl = Date.now,
  randomBytesImpl = crypto.randomBytes,
} = {}) {
  let { songUrl, title, sections, style = '', fullDuration, onProgress, casting = '', castArtists = [] } = config;
  const clipId = createClipId(nowImpl, randomBytesImpl);
  const clipDir = path.join(CLIPS_DIR, clipId);
  fs.mkdirSync(clipDir, { recursive: true });

  // 1. Valider et matérialiser l'audio AVANT le Director et avant tout appel
  // vidéo payant. Une page HTML ou un lien mort s'arrête donc sans crédit perdu.
  const audioPath = path.join(clipDir, 'audio.mp3');
  emitProgress(onProgress, { stage: 'audio:validating', status: 'validating', progress: 2 });
  try {
    await materializeMedia(songUrl, audioPath, { kind: 'audio' });
  } catch (error) {
    fs.rmSync(clipDir, { recursive: true, force: true });
    throw new Error(`clip_audio_preflight_failed: ${error.message}`);
  }
  console.log('[clip] Audio prêt');
  emitProgress(onProgress, { stage: 'audio:ready', status: 'validating', progress: 8 });

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
    const director = loadDirectorImpl();
    if (!director || typeof director.directClip !== 'function') throw new Error('directClip indisponible');
    directed = await director.directClip({ title, songUrl, audioPath, style, sections, casting, castArtists, onProgress: directorProgress });
    sections = requireDirectedScenes(directed);
  } catch (error) {
    throw new Error(`clip_director_failed: ${error.message}`);
  }
  console.log(`[clip] Director: ${sections.length} plans`);
  if (directed?.identity) identity = directed.identity;
  if (directed?.lieu) {
    lieu = directed.lieu;
    console.log(`[clip] Lieu unique: ${lieu.slice(0, 70)}`);
  }
  emitProgress(onProgress, { stage: 'director:ready', status: 'directing', progress: 18 });

  // 2. Mesurer la durée
  // Le repli de 180 s ne survit que si la mesure est un nombre. Avant, l'affectation
  // se faisait AVANT toute verification : un ffprobe qui reussit en imprimant « N/A »
  // ou rien donnait NaN, sans exception, donc sans passer par le catch. numSegments
  // valait alors NaN, la boucle `i < NaN` ne tournait pas une seule fois, et l'erreur
  // finale disait « Aucune vidéo générée » sans que rien n'ait ete tente.
  let audioDuration = 180;
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

  // 3. Calculer le nombre de segments (1 vidéo = ~8s, max 8 vidéos pour un clip normal, illimité pour full)
  const SEGMENT_SECONDS = 8;
  let numSegments;
  if (fullDuration) {
    numSegments = Math.ceil(audioDuration / SEGMENT_SECONDS);
  } else {
    numSegments = Math.min(6, Math.ceil(audioDuration / SEGMENT_SECONDS));
  }
  console.log(`[clip] ${numSegments} vidéos à générer (${fullDuration ? 'full' : 'normal'})`);

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
  const lieuBrief = lieu ? ` The entire clip is shot in one single location: ${lieu}. Never change location.` : '';
  const videoPaths = [];
  // Le motif du dernier segment rate : c'est lui qui explique un clip vide.
  let dernierEchec = '';
  let refusPolitique = 0;
  for (let i = 0; i < numSegments; i++) {
    const section = sections[i % sections.length];
    const prompt = `${section.visual}.${lieuBrief} Cinematic anime quality, volumetric lighting, smooth camera movement. ${style}${identityBrief}`.trim();

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
          videoUrl = await generateVideoImpl(`${prompt}${CONSIGNE_AUDIO_NEUTRE}`, i, 600000, identity, { onProgress, models: videoModels });
        } else if (estRefusAutorisation(motif)) {
          console.warn(`[clip] Vidéo ${i}: autorisation Comfy refusée, nouvel essai dans ${Math.round(PAUSE_REPRISE_AUTORISATION_MS / 1000)} s.`);
          await sleepImpl(PAUSE_REPRISE_AUTORISATION_MS);
          videoUrl = await generateVideoImpl(prompt, i, 600000, identity, { onProgress, models: videoModels });
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
    } catch (error) {
      dernierEchec = error.message;
      if (estRefusDePolitique(error.message)) {
        refusPolitique += 1;
        console.warn(`[clip] Vidéo ${i} refusée par le filtre de contenu (${refusPolitique}/${PLAFOND_REFUS_POLITIQUE}), on passe au plan suivant.`);
        if (refusPolitique >= PLAFOND_REFUS_POLITIQUE) {
          console.warn('[clip] Trop de refus du filtre, on arrête pour ne pas payer davantage.');
          break;
        }
      } else {
        const cause = estRefusAutorisation(error.message)
          ? 'compte Comfy toujours non autorisé après un nouvel essai (crédits ou accès partenaire)'
          : 'échouée sans resoumission';
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
    ? `clip_partial: ${videoPaths.length}/${numSegments} segments; arrêt sans resoumission — ${dernierEchec}`
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

  // Créer le fichier concat
  const concatFile = path.join(clipDir, 'concat.txt');
  fs.writeFileSync(concatFile, videoPaths.map(p => `file '${p}'`).join('\n'));

  // Concat vidéos + audio
  execFileSyncImpl('ffmpeg', [
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
  ], { timeout: 300_000, windowsHide: true });

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
  T2V_DEFAUT,
  choisirReference,
  PLAFOND_REFUS_POLITIQUE,
  PAUSE_REPRISE_AUTORISATION_MS,
  estRefusAudio,
  estRefusAutorisation,
  estRefusDePolitique,
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
  mountClipRoutes,
  postJson,
  requireDirectedScenes,
  sanitizeDiagnostic,
};
