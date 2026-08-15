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

const CLIPS_DIR = '/agent-bus/clips';
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

// Soumettre UNE vidéo et ATTENDRE qu'elle soit prête
async function generateOneVideo(prompt, index, maxWaitMs = 600000, identity = null) {
  console.log(`[clip] Vidéo ${index}: ${prompt.slice(0, 60)}...`);

  // Image de référence : si un personnage canonique est en jeu, on bascule sur
  // l'image-to-video pour verrouiller son visage au lieu de le redécrire.
  const referenceImage = identity && Array.isArray(identity.referenceImageUrls)
    ? identity.referenceImageUrls[0]
    : null;
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
  const loadDirector = () => {
    try { return require('./clip-vivy-director.cjs'); }
    catch (e) { return require('/app/clip-vivy-director.cjs'); }
  };
  try {
    const director = loadDirector();
    const directed = await director.directClip({ title, songUrl, style, sections });
    if (directed?.scenes?.length > 0) {
      sections = directed.scenes;
      console.log(`[clip] Director: ${sections.length} scènes`);
    }
    if (directed?.identity) identity = directed.identity;
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
  const videoPaths = [];
  for (let i = 0; i < numSegments; i++) {
    const section = sections[i % sections.length];
    const prompt = `${section.visual}. Cinematic anime quality, volumetric lighting, smooth camera movement. ${style}${identityBrief}`.trim();

    let videoUrl;
    let retries = 2;
    while (retries > 0) {
      try {
        videoUrl = await generateOneVideo(prompt, i, 600000, identity);
        break;
      } catch (e) {
        retries--;
        console.warn(`[clip] Vidéo ${i} échouée: ${e.message}${retries > 0 ? ', retry...' : ''}`);
        if (retries > 0) await sleep(5000);
      }
    }

    if (videoUrl) {
      const dest = path.join(clipDir, `scene_${String(i).padStart(2, '0')}.mp4`);
      await downloadFile(videoUrl, dest);
      videoPaths.push(dest);
      console.log(`[clip] Vidéo ${i} prête (${videoPaths.length}/${numSegments})`);
    } else {
      console.warn(`[clip] Vidéo ${i} abandonnée après 2 essais`);
    }

    // Petit délai entre les soumissions
    if (i < numSegments - 1) await sleep(2000);
  }

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

module.exports = { generateClip, mountClipRoutes };
