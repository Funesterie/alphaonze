'use strict';

// Client HTTP pour un ComfyUI local. Transport seulement : soumettre un graphe,
// attendre, recuperer le fichier. La CONSTRUCTION du graphe vit ailleurs — les noms
// de noeuds de MiniMax H3 ne sont pas devinables, ils se lisent sur l'instance via
// /object_info une fois qu'elle tourne. Separer les deux evite d'ecrire en dur des
// noms qui seraient faux.

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';
const DEFAULT_POLL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // un plan video, pas une requete web

function resolveComfyBaseUrl(env = process.env) {
  const brut = String(env.COMFYUI_BASE_URL || env.COMFY_BASE_URL || '').trim();
  return (brut || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function isComfyEnabled(env = process.env) {
  const v = String(env.COMFYUI_ENABLED || '').trim().toLowerCase();
  if (v) return ['1', 'true', 'yes', 'on'].includes(v);
  // Pas de drapeau explicite : on considere actif des qu'une URL est donnee.
  return Boolean(String(env.COMFYUI_BASE_URL || env.COMFY_BASE_URL || '').trim());
}

function attendre(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function createComfyClient(options = {}) {
  const env = options.env || process.env;
  const baseUrl = String(options.baseUrl || resolveComfyBaseUrl(env)).replace(/\/+$/, '');
  const doFetch = options.fetch || globalThis.fetch;
  const pollMs = Number(options.pollMs) || DEFAULT_POLL_MS;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const clientId = String(options.clientId || 'funesterie-a11');
  const jeton = String(options.token || env.COMFYUI_TUNNEL_TOKEN || '').trim();
  const now = options.now || (() => Date.now());

  if (typeof doFetch !== 'function') {
    throw new Error('comfyui-client: aucune implementation de fetch disponible');
  }

  async function requete(chemin, init = {}) {
    // Jeton du portier. En local il n'y en a pas — on parle a ComfyUI en direct.
    // Des que l'URL passe par le tunnel, le portier l'exige sur CHAQUE requete,
    // et sans lui tout repond 401.
    const entetes = jeton
      ? { ...(init.headers || {}), authorization: `Bearer ${jeton}` }
      : init.headers;
    const reponse = await doFetch(`${baseUrl}${chemin}`, entetes ? { ...init, headers: entetes } : init);
    if (!reponse || reponse.ok !== true) {
      const statut = reponse ? reponse.status : 'sans reponse';
      throw new Error(`comfyui ${chemin} a repondu ${statut}`);
    }
    return reponse;
  }

  // GET /system_stats — sert de sonde de vie et donne la VRAM reellement libre,
  // ce qui compte sur une carte 12 Go ou H3 tient a peine.
  async function health() {
    try {
      const r = await requete('/system_stats');
      const data = await r.json();
      const gpu = (data.devices || [])[0] || {};
      return {
        ok: true,
        baseUrl,
        version: data?.system?.comfyui_version || null,
        gpu: gpu.name || null,
        vramTotal: gpu.vram_total ?? null,
        vramLibre: gpu.vram_free ?? null,
      };
    } catch (erreur) {
      return { ok: false, baseUrl, raison: erreur.message };
    }
  }

  // GET /object_info — la liste des noeuds disponibles. C'est ce qui permet de
  // decouvrir les noeuds H3 au lieu de les supposer.
  async function listNodes({ filtre = '' } = {}) {
    const r = await requete('/object_info');
    const data = await r.json();
    const noms = Object.keys(data || {});
    if (!filtre) return noms;
    const rx = new RegExp(filtre, 'i');
    return noms.filter((nom) => rx.test(nom));
  }

  async function describeNode(nom) {
    const r = await requete(`/object_info/${encodeURIComponent(nom)}`);
    const data = await r.json();
    return data?.[nom] || null;
  }

  // Les images de depart et de fin passent par /upload/image, puis on reference
  // le nom retourne dans le graphe.
  async function uploadImage(buffer, nomFichier, { subfolder = '', overwrite = true } = {}) {
    const form = new FormData();
    const blob = new Blob([buffer]);
    form.append('image', blob, nomFichier);
    if (subfolder) form.append('subfolder', subfolder);
    form.append('overwrite', overwrite ? 'true' : 'false');
    const r = await requete('/upload/image', { method: 'POST', body: form });
    const data = await r.json();
    return { name: data.name, subfolder: data.subfolder || '', type: data.type || 'input' };
  }

  async function submit(graphe) {
    const r = await requete('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graphe, client_id: clientId }),
    });
    const data = await r.json();
    if (!data?.prompt_id) {
      // ComfyUI renvoie 200 avec un objet d'erreur quand le graphe est invalide.
      const detail = data?.error?.message || JSON.stringify(data?.node_errors || data || {}).slice(0, 400);
      throw new Error(`comfyui a refuse le graphe : ${detail}`);
    }
    return data.prompt_id;
  }

  // Une seule lecture de l'etat d'un prompt. Les routes HTTP longues doivent
  // soumettre puis rendre la main; le navigateur rappelle ensuite /jobs/:id.
  // waitFor() reste disponible pour les workers hors requete web.
  async function getStatus(promptId) {
    const safePromptId = String(promptId || '').trim();
    if (!safePromptId) {
      return { ok: false, state: 'error', raison: 'identifiant de prompt absent' };
    }
    const r = await requete(`/history/${encodeURIComponent(safePromptId)}`);
    const data = await r.json();
    const entree = data?.[safePromptId];
    if (!entree) {
      return { ok: true, state: 'processing', promptId: safePromptId, outputs: {} };
    }
    const statut = entree.status || {};
    if (statut.status_str === 'error') {
      const msg = (statut.messages || []).map((m) => JSON.stringify(m)).join(' ').slice(0, 500);
      return { ok: false, state: 'error', promptId: safePromptId, raison: msg || 'erreur d execution' };
    }
    if (statut.completed === true || statut.status_str === 'success') {
      return { ok: true, state: 'done', promptId: safePromptId, outputs: entree.outputs || {} };
    }
    return { ok: true, state: 'processing', promptId: safePromptId, outputs: entree.outputs || {} };
  }

  // Sondage de /history. ComfyUI expose aussi un WebSocket de progression, mais le
  // sondage suffit ici : un plan met des minutes, pas des millisecondes.
  async function waitFor(promptId, { onProgress = null } = {}) {
    const debut = now();
    for (;;) {
      const etat = await getStatus(promptId);
      if (!etat.ok || etat.state === 'done') return etat;
      if (now() - debut > timeoutMs) {
        return { ok: false, promptId, raison: `delai depasse apres ${Math.round(timeoutMs / 1000)} s` };
      }
      if (onProgress) onProgress({ promptId, ecouleMs: now() - debut });
      await attendre(pollMs);
    }
  }

  // Retrouve le premier fichier produit, quel que soit le noeud de sortie.
  function firstOutputFile(outputs = {}) {
    for (const noeud of Object.values(outputs)) {
      for (const cle of ['videos', 'gifs', 'images', 'audio']) {
        const liste = noeud?.[cle];
        if (Array.isArray(liste) && liste.length) return { ...liste[0], kind: cle };
      }
    }
    return null;
  }

  async function fetchOutput(fichier) {
    const params = new URLSearchParams({
      filename: fichier.filename,
      subfolder: fichier.subfolder || '',
      type: fichier.type || 'output',
    });
    const r = await requete(`/view?${params.toString()}`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  }

  return {
    baseUrl,
    health,
    listNodes,
    describeNode,
    uploadImage,
    submit,
    getStatus,
    waitFor,
    firstOutputFile,
    fetchOutput,
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  createComfyClient,
  isComfyEnabled,
  resolveComfyBaseUrl,
};
