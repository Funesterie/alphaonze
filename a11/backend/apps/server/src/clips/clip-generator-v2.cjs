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
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Le dossier vient de la source unique: le serveur sert les clips depuis ce meme
// chemin. Quand producteur et lecteur divergent, les clips sont bien generes mais
// introuvables a la lecture.
const { CLIPS_DIR } = require('./clips-config.cjs');
const BRIDGE_URL = 'http://127.0.0.1:3000/api/mcp-bridge/call';
if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-service': 'a11-internal', 'content-length': Buffer.byteLength(body) }
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { resolve({ raw: Buffer.concat(chunks).toString() }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (url.startsWith('/api/mcp-bridge/play-upload/')) { const f = '/app/runtime/uploads/' + url.split('/').pop(); try { fs.copyFileSync(f, dest); return resolve(dest); } catch (e) { return reject(e); } }
    if (url.startsWith('/api/mcp-bridge/play/')) { const f = '/app/runtime/double-harmonic-d40/' + url.split('/').pop(); try { fs.copyFileSync(f, dest); return resolve(dest); } catch (e) { return reject(e); } }
    if (url.startsWith('/api/vivy/studio/assets/')) { const f = '/app/runtime/vivy-studio-assets/' + url.split('/').pop(); if (fs.existsSync(f)) { try { fs.copyFileSync(f, dest); return resolve(dest); } catch(e){} } }
    if (url.startsWith('/')) { try { fs.copyFileSync(url, dest); return resolve(dest); } catch (e) { /* try HTTP */ } }
    const get = (u) => {
      const parsed = new URL(u);
      const mod = parsed.protocol === 'https:' ? https : http;
      mod.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(res.headers.location);
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        const ws = fs.createWriteStream(dest); res.pipe(ws); ws.on('finish', () => { ws.close(); resolve(dest); }); ws.on('error', reject);
      }).on('error', reject);
    };
    get(url.startsWith('http') ? url : 'http://127.0.0.1:3000' + url);
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Le partenaire refuse-t-il pour cause de debit trop eleve ?
 *
 * Le message d'erreur porte la reponse brute serialisee, donc on cherche dedans.
 * Distinguer ce cas des autres est ce qui rend le parallele viable: une panne
 * ordinaire se retente vite, une limite de debit demande d'attendre plus
 * longtemps a chaque fois, sinon on ne fait qu'aggraver l'embouteillage.
 */
function estLimiteDeDebit(message) {
  const m = String(message || '').toLowerCase();
  return m.includes('429')
    || m.includes('rate limit')
    || m.includes('rate_limit')
    || m.includes('too many request')
    || m.includes('quota');
}

/**
 * Execute des taches avec une concurrence bornee, en preservant l'ordre.
 *
 * Le fichier posait "UNE video a la fois, jamais parallele" en principe, sans
 * justification ecrite nulle part. En fullDuration un morceau de trois minutes
 * demande une vingtaine de segments: a la file, c'est tres long. On borne donc
 * plutot que d'interdire. NOSSEN_CLIP_CONCURRENCY=1 restitue exactement
 * l'ancien comportement.
 *
 * Les resultats sont ranges par indice, pas par ordre d'arrivee: l'assemblage
 * FFmpeg depend de l'ordre des plans, et le parallele les termine en desordre.
 */
async function executerEnParallele(taches, concurrence, delaiEntreDemarrages = 0) {
  const resultats = new Array(taches.length).fill(null);
  let prochain = 0;

  async function ouvrier(rang) {
    // On decale le demarrage de chaque ouvrier: sans cela toutes les premieres
    // soumissions partent dans la meme milliseconde.
    if (delaiEntreDemarrages > 0 && rang > 0) await sleep(delaiEntreDemarrages * rang);
    while (true) {
      const i = prochain++;
      if (i >= taches.length) return;
      resultats[i] = await taches[i](i);
    }
  }

  const largeur = Math.max(1, Math.min(concurrence, taches.length));
  await Promise.all(Array.from({ length: largeur }, (_, rang) => ouvrier(rang)));
  return resultats;
}

/**
 * Choisit l'image de reference d'un plan.
 *
 * `referenceImageUrls` est un tableau depuis l'origine, mais seul l'indice 0
 * etait lu, et pour tous les plans du clip. Un clip a plusieurs personnages --
 * ou un meme personnage a plusieurs ages -- sortait donc avec un seul visage.
 *
 * Trois facons pour une scene de designer la sienne, de la plus explicite a la
 * plus commode. Sans indication, on garde l'indice 0: l'ancien comportement.
 */
function resolveReferenceImage(identity, section) {
  const urls = Array.isArray(identity && identity.referenceImageUrls)
    ? identity.referenceImageUrls
    : [];
  if (urls.length === 0) return null;
  if (!section) return urls[0];

  // 1. La scene porte directement l'URL de son image.
  if (typeof section.referenceImageUrl === 'string' && section.referenceImageUrl) {
    return section.referenceImageUrl;
  }

  // 2. Un indice explicite dans le tableau. Hors bornes, on ne devine pas: on
  //    retombe sur la premiere plutot que de perdre le plan en text-to-video.
  if (Number.isInteger(section.referenceIndex)) {
    const i = section.referenceIndex;
    return (i >= 0 && i < urls.length) ? urls[i] : urls[0];
  }

  // 3. Un identifiant de personnage, aligne sur identityIds. C'est la forme la
  //    plus lisible cote Vivy Director: la scene nomme qui elle filme.
  if (section.identityId) {
    const ids = Array.isArray(identity.identityIds) ? identity.identityIds : [];
    const i = ids.indexOf(section.identityId);
    if (i >= 0 && i < urls.length) return urls[i];
  }

  return urls[0];
}

// Soumettre UNE vidéo et ATTENDRE qu'elle soit prête
async function generateOneVideo(prompt, index, maxWaitMs = 600000, identity = null, referenceOverride) {
  console.log(`[clip] Vidéo ${index}: ${prompt.slice(0, 60)}...`);

  // Image de référence : si un personnage canonique est en jeu, on bascule sur
  // l'image-to-video pour verrouiller son visage au lieu de le redécrire.
  // L'appelant peut imposer la reference du plan; sans quoi on garde l'ancien
  // comportement, la premiere du tableau.
  const referenceImage = referenceOverride !== undefined
    ? referenceOverride
    : resolveReferenceImage(identity, null);
  const useReference = Boolean(referenceImage) && process.env.NOSSEN_CLIP_USE_REFERENCE !== '0';

  const args = useReference
    ? {
        type: 'video',
        model: 'byteplus/seedance-2.0-i2v',
        prompt,
        image: referenceImage,
        client_os: 'linux',
        confirm: true,
        params: { model: 'Seedance 2.0 Fast' },
      }
    : {
        type: 'video',
        model: 'byteplus/seedance-2.0-t2v',
        prompt,
        client_os: 'linux',
        confirm: true,
        params: { model: 'Seedance 2.0 Fast' },
      };
  if (identity && identity.negativePrompt) args.negative_prompt = identity.negativePrompt;
  if (useReference) console.log(`[clip] Vidéo ${index}: référence ${referenceImage.slice(0, 60)}`);

  // Submit — si l'i2v n'est pas accepté par le partenaire, on retombe en t2v
  // plutôt que de perdre le segment.
  let result = await postJson(BRIDGE_URL, { tool: 'comfy__partner_generate', args });
  if (!result.ok && useReference) {
    console.warn(`[clip] Vidéo ${index}: i2v refusé, repli t2v`);
    result = await postJson(BRIDGE_URL, {
      tool: 'comfy__partner_generate',
      args: {
        type: 'video',
        model: 'byteplus/seedance-2.0-t2v',
        prompt,
        client_os: 'linux',
        confirm: true,
        params: { model: 'Seedance 2.0 Fast' },
        negative_prompt: identity?.negativePrompt || undefined,
      },
    });
  }
  if (!result.ok) throw new Error('Submit failed: ' + JSON.stringify(result.error || result));
  const text = result.result?.content?.[0]?.text || '';
  const match = text.match(/prompt_id:\s*([a-f0-9-]+)/);
  if (!match) throw new Error('No prompt_id in response');
  const promptId = match[1];

  // Attendre
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await sleep(11000);
    const status = await postJson(BRIDGE_URL, { tool: 'comfy__get_job_status', args: { prompt_id: promptId } });
    const st = status?.result?.content?.[0]?.text || '';
    if (st.includes('completed')) {
      // Télécharger
      const output = await postJson(BRIDGE_URL, { tool: 'comfy__get_output', args: { prompt_id: promptId, client_os: 'linux' } });
      const outText = output?.result?.content?.[0]?.text || '';
      const urlMatch = outText.match(/https:\/\/[^\s"]+\.mp4[^\s"]*/);
      if (urlMatch) return urlMatch[0];
      const shortMatch = outText.match(/\/api\/s\/[^\s"]+/);
      if (shortMatch) return 'https://cloud.comfy.org' + shortMatch[0];
      throw new Error('No download URL in output');
    }
    if (st.includes('error') || st.includes('failed')) {
      throw new Error('Video generation failed');
    }
    console.log(`[clip] Vidéo ${index} en cours... (${Math.round((Date.now() - startTime) / 1000)}s)`);
  }
  throw new Error('Timeout waiting for video ' + index);
}

// Point d'entrée principal
async function generateClip(config) {
  let { songUrl, title, sections, style = '', fullDuration } = config;

  // Vivy Director : scènes issues des paroles + identité visuelle des personnages
  let identity = { identityIds: [], prompt: '', negativePrompt: '', referenceImageUrls: [] };
  let lieu = '';
  const loadDirector = () => {
    try { return require('./clip-vivy-director.cjs'); }
    catch (e) { return require('/app/clip-vivy-director.cjs'); }
  };
  try {
    const director = loadDirector();
    const directed = await director.directClip({ title, songUrl, style, sections });
    if (directed?.scenes?.length > 0) {
      sections = directed.scenes;
      console.log(`[clip] Director: ${sections.length} plans`);
    }
    if (directed?.identity) identity = directed.identity;
    if (directed?.lieu) {
      lieu = directed.lieu;
      console.log(`[clip] Lieu unique: ${lieu.slice(0, 70)}`);
    }
  } catch (e) {
    console.warn('[clip] Director skip:', e.message);
  }

  const clipId = 'clip-' + Date.now();
  const clipDir = path.join(CLIPS_DIR, clipId);
  fs.mkdirSync(clipDir, { recursive: true });

  // 1. Télécharger l'audio
  const audioPath = path.join(clipDir, 'audio.mp3');
  await downloadFile(songUrl, audioPath);
  console.log('[clip] Audio prêt');

  // 2. Mesurer la durée
  let audioDuration = 180;
  try {
    audioDuration = Math.ceil(parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`, { timeout: 10000 }).toString().trim()));
  } catch (e) {}
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

  // 4. Préparer les prompts (un par segment, en cyclant les sections)
  if (!sections || sections.length === 0) {
    sections = [{ name: 'Scene', visual: 'Cinematic anime scene, dynamic camera movement, atmospheric lighting, detailed environment' }];
  }

  // 5. Générer les vidéos UNE PAR UNE (séquentiel)
  // L'identité des personnages est répétée sur CHAQUE segment : c'est ce qui
  // empêche Vivy de changer de tête entre la 3e et la 12e vidéo.
  const identityBrief = identity.prompt
    ? ` Character identity to preserve exactly across every shot: ${identity.prompt}`
    : '';
  // Le lieu est rappele sur chaque segment, comme l'identite : c'est ce qui
  // empeche le clip de partir dans six endroits differents.
  const lieuBrief = lieu ? ` The entire clip is shot in one single location: ${lieu}. Never change location.` : '';
  const concurrence = Math.max(1, Math.min(4, parseInt(process.env.NOSSEN_CLIP_CONCURRENCY || '2', 10) || 1));
  console.log(`[clip] Concurrence: ${concurrence} video(s) de front`);

  const taches = Array.from({ length: numSegments }, (_, i) => async () => {
    const section = sections[i % sections.length];
    const prompt = `${section.visual}.${lieuBrief} Cinematic anime quality, volumetric lighting, smooth camera movement. ${style}${identityBrief}`.trim();
    const referenceImage = resolveReferenceImage(identity, section);

    let videoUrl;
    // Trois essais au lieu de deux: en parallele, un refus pour cause de debit
    // est probable et ne doit pas coûter le plan.
    let essaisRestants = 3;
    let attente = 5000;
    while (essaisRestants > 0) {
      try {
        videoUrl = await generateOneVideo(prompt, i, 600000, identity, referenceImage);
        break;
      } catch (e) {
        essaisRestants--;
        const debit = estLimiteDeDebit(e.message);
        console.warn(`[clip] Vidéo ${i} échouée${debit ? ' (débit)' : ''}: ${e.message}${essaisRestants > 0 ? ', retry...' : ''}`);
        if (essaisRestants > 0) {
          await sleep(attente);
          // Limite de debit: on recule franchement. Autre panne: on garde un
          // delai court, la cause n'est pas l'encombrement.
          if (debit) attente *= 3;
        }
      }
    }

    if (!videoUrl) {
      console.warn(`[clip] Vidéo ${i} abandonnée après 3 essais`);
      return null;
    }

    const dest = path.join(clipDir, `scene_${String(i).padStart(2, '0')}.mp4`);
    await downloadFile(videoUrl, dest);
    console.log(`[clip] Vidéo ${i} prête`);
    return dest;
  });

  // 2 s de decalage entre les demarrages, comme l'ancien delai entre soumissions.
  const resultats = await executerEnParallele(taches, concurrence, 2000);
  const videoPaths = resultats.filter(Boolean);

  if (videoPaths.length === 0) throw new Error('Aucune vidéo générée');
  console.log(`[clip] ${videoPaths.length}/${numSegments} vidéos prêtes, assemblage FFmpeg...`);

  // 6. Assembler avec FFmpeg
  const safeName = (title || 'clip').replace(/[^a-zA-Z0-9àâéèêëïîôùûüç -]/gi, '').replace(/\s+/g, '-').slice(0, 40) || 'clip';
  const outputPath = path.join(clipDir, safeName + '.mp4');

  // Créer le fichier concat
  const concatFile = path.join(clipDir, 'concat.txt');
  fs.writeFileSync(concatFile, videoPaths.map(p => `file '${p}'`).join('\n'));

  // Concat vidéos + audio
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -i "${audioPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -shortest -movflags +faststart "${outputPath}"`, { timeout: 300000 });

  // Copier à la racine pour le listing
  const publicPath = path.join(CLIPS_DIR, safeName + '.mp4');
  fs.copyFileSync(outputPath, publicPath);

  console.log(`[clip] Terminé: ${safeName}.mp4`);
  return {
    ok: true,
    filename: safeName + '.mp4',
    url: 'https://a11.funesterie.me/clips/' + safeName + '.mp4',
    path: publicPath,
    segments: videoPaths.length,
    duration: audioDuration
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

module.exports = { generateClip, mountClipRoutes, resolveReferenceImage, executerEnParallele, estLimiteDeDebit };
