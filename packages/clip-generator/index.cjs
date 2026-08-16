'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const CLIPS_DIR = '/agent-bus/clips';
const BRIDGE_URL = 'http://localhost:3000/api/mcp-bridge/call';
const PUBLIC_URL = 'https://a11.funesterie.me/clips';

if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
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
    if (url.startsWith('file://')) { try { fs.copyFileSync(url.replace('file://', ''), dest); return resolve(dest); } catch (e) { return reject(e); } }
    if (url.startsWith('/')) { try { fs.copyFileSync(url, dest); return resolve(dest); } catch (e) { return reject(e); } }
    const get = (u) => {
      const parsed = new URL(u);
      const mod = parsed.protocol === 'https:' ? https : http;
      mod.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(res.headers.location);
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        const ws = fs.createWriteStream(dest);
        res.pipe(ws);
        ws.on('finish', () => { ws.close(); resolve(dest); });
        ws.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Submit VIDEO (Seedance 2.0) — no text in prompts!
async function submitVideo(prompt, index) {
  console.log(`[clip] Submitting video ${index}: ${prompt.slice(0, 50)}...`);
  const result = await postJson(BRIDGE_URL, {
    tool: 'comfy__partner_generate',
    args: {
      type: 'video',
      model: 'byteplus/seedance-2.0-t2v',
      prompt,
      client_os: 'linux',
      confirm: true,
      params: { model: 'Seedance 2.0 Fast' } // 720p, faster
    }
  });
  if (!result.ok) throw new Error('Submit failed: ' + JSON.stringify(result.error || result));
  const text = result.result?.content?.[0]?.text || '';
  const match = text.match(/prompt_id:\s*([a-f0-9-]+)/);
  if (!match) throw new Error('No prompt_id: ' + text.slice(0, 150));
  return match[1];
}

// Submit IMAGE (Flux Pro) as fallback
async function submitImage(prompt, index) {
  console.log(`[clip] Submitting image ${index}: ${prompt.slice(0, 50)}...`);
  const result = await postJson(BRIDGE_URL, {
    tool: 'comfy__partner_generate',
    args: { type: 'image', model: 'bfl/flux-pro-1.1-ultra', prompt, aspect_ratio: '16:9', client_os: 'linux', confirm: true }
  });
  if (!result.ok) throw new Error('Submit failed: ' + JSON.stringify(result.error || result));
  const text = result.result?.content?.[0]?.text || '';
  const match = text.match(/prompt_id:\s*([a-f0-9-]+)/);
  if (!match) throw new Error('No prompt_id: ' + text.slice(0, 150));
  return match[1];
}

// Async retry poll loop until done
async function pollAndDownload(promptId, dest, maxWaitMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(10000);
    try {
      const status = await postJson(BRIDGE_URL, { tool: 'comfy__get_job_status', args: { prompt_id: promptId } });
      const text = status.result?.content?.[0]?.text || '';
      if (text.includes('completed')) {
        const output = await postJson(BRIDGE_URL, { tool: 'comfy__get_output', args: { prompt_id: promptId, client_os: 'linux' } });
        const outText = output.result?.content?.[0]?.text || '';
        // Extract URL (video or image)
        const urlMatch = outText.match(/(https:\/\/[^\s"']+)/);
        if (urlMatch) { await downloadFile(urlMatch[0], dest); console.log(`[clip] Downloaded: ${dest}`); return dest; }
        const curlMatch = outText.match(/curl[^"]*"(https:\/\/[^"]+)"/);
        if (curlMatch) { await downloadFile(curlMatch[1], dest); console.log(`[clip] Downloaded: ${dest}`); return dest; }
        throw new Error('No URL in output');
      }
      if (text.includes('error') || text.includes('failed')) throw new Error('Job failed: ' + text.slice(0, 100));
      console.log(`[clip] Polling ${promptId.slice(0, 8)}... (${Math.round((Date.now() - start) / 1000)}s)`);
    } catch (e) {
      if (e.message.includes('failed') || e.message.includes('No URL')) throw e;
    }
  }
  throw new Error('Timeout: ' + promptId);
}

// FFmpeg V2: video clips concatenated with audio

// FFmpeg V1 fallback: images as slideshow
function assembleClipV1(images, audioPath, outputPath, durations) {
  let inputArgs = [];
  let filterParts = [];
  images.forEach((img, i) => {
    inputArgs.push(`-loop 1 -t ${durations[i]} -i "${img}"`);
    filterParts.push(`[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fade=t=in:st=0:d=1,fade=t=out:st=${durations[i] - 1}:d=1[v${i}]`);
  });
  const concat = images.map((_, i) => `[v${i}]`).join('');
  const filter = filterParts.join('; ') + `; ${concat}concat=n=${images.length}:v=1:a=0[outv]`;
  const cmd = `ffmpeg -y ${inputArgs.join(' ')} -i "${audioPath}" -filter_complex "${filter}" -map "[outv]" -map ${images.length}:a -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -shortest -movflags +faststart "${outputPath}"`;
  console.log('[clip] FFmpeg V1 slideshow...');
  execSync(cmd, { timeout: 300000 });
  return outputPath;
}

async function generateClip(config) {
  const { songUrl, title, sections, style = 'anime cyberpunk', mode = 'video' } = config;
  const clipId = 'clip-' + Date.now();
  const clipDir = path.join(CLIPS_DIR, clipId);
  fs.mkdirSync(clipDir, { recursive: true });
  console.log(`[clip] Starting: ${title} (${sections.length} sections, mode=${mode})`);

  // 1. Download audio
  const audioPath = path.join(clipDir, 'audio.mp3');
  await downloadFile(songUrl, audioPath);
  console.log('[clip] Audio ready');

  // 2. Submit all scenes
  const jobs = [];
  for (let i = 0; i < sections.length; i++) {
    // NEVER put text/letters in visual prompts — causes hallucinated text
    const prompt = `${style}, ${sections[i].visual}. The scene is rendered in a cinematic cyberpunk anime aesthetic with rich detail and dramatic lighting. The color palette combines deep teals, electric purples, and warm neon accents against dark backgrounds. All surfaces have subtle reflective qualities. The male character Djeff is a confident young programmer with short dark hair, wearing a fitted black hoodie featuring delicate circuit-board patterns embroidered in silver thread, the word FUNESTERIE stitched cleanly on his chest. The female character Vivy is an ethereal presence with impossibly long gradient hair flowing from deep purple at the roots through electric blue to luminous cyan at the tips, her eyes glowing softly with inner light, wearing a sleek white bodysuit with violet geometric accents that catch the light. Every frame feels like a frame from a high-budget anime film with volumetric lighting and subtle particle effects. `;
    let pid;
    if (mode === 'video') {
      pid = await submitVideo(prompt, i);
    } else {
      pid = await submitImage(prompt, i);
    }
    jobs.push({ pid, index: i, ext: mode === 'video' ? '.mp4' : '.png' });
    await sleep(10000); // 10s delay between video submissions
  }
  console.log(`[clip] ${jobs.length} scenes submitted, polling...`);

  // 3. Async retry download all (with fallback)
  const files = [];
  for (const { pid, index, ext } of jobs) {
    const filePath = path.join(clipDir, `scene_${String(index).padStart(2, "0")}${ext}`);
    try {
      await pollAndDownload(pid, filePath);
      files.push(filePath);
    } catch (e) {
      console.log(`[clip] Scene ${index} failed: ${e.message.slice(0, 80)}, retrying...`);
      await sleep(15000);
      try {
        const retryPid = mode === "video" ? await submitVideo(sections[index].visual, index) : await submitImage(sections[index].visual, index);
        await pollAndDownload(retryPid, filePath);
        files.push(filePath);
      } catch (e2) {
        if (mode === "video") {
          console.log(`[clip] Scene ${index} video retry failed, trying image fallback`);
          const imgPath = path.join(clipDir, `scene_${String(index).padStart(2, "0")}.png`);
          try {
            const imgPid = await submitImage(sections[index].visual, index);
            await pollAndDownload(imgPid, imgPath);
            files.push(imgPath);
          } catch (e3) { console.log(`[clip] Scene ${index} skipped`); }
        } else { console.log(`[clip] Scene ${index} skipped`); }
      }
    }
  }
  if (files.length === 0) throw new Error("All scenes failed");
  console.log(`[clip] ${files.length}/${jobs.length} scenes ready`);

  // 4. Assemble
  const cleanTitle = title.split('-').slice(0,3).join('-').replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0,40);
  const outputPath = path.join(clipDir, `${cleanTitle}.mp4`);
  if (mode === 'video') {
    const songDuration = parseInt(execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`).toString().trim()) || 180;
  const perScene = Math.ceil(songDuration / files.length);
  const durations = files.map(() => perScene);
  assembleClipV3(files, audioPath, outputPath, durations);
  } else {
    const durations = sections.map(s => s.duration || 15);
    assembleClipV1(files, audioPath, outputPath, durations);
  }

  // 5. Publish
  const publicPath = path.join(CLIPS_DIR, path.basename(outputPath));
  fs.copyFileSync(outputPath, publicPath);
  return { ok: true, clipId, videoUrl: `${PUBLIC_URL}/${path.basename(outputPath)}`, scenes: files.length, mode };
}

function mountClipRoutes(app) {
  const express = require('express');
  app.use('/clips', express.static(CLIPS_DIR));
  app.get('/api/mcp-bridge/clip/list', (req, res) => {
    try {
      const clips = fs.readdirSync(CLIPS_DIR).filter(f => f.endsWith('.mp4')).map(f => ({
        name: f, url: `${PUBLIC_URL}/${f}`, size: fs.statSync(path.join(CLIPS_DIR, f)).size, created: fs.statSync(path.join(CLIPS_DIR, f)).mtime
      }));
      res.json({ clips });
    } catch (e) { res.json({ clips: [] }); }
  });
  app.post('/api/mcp-bridge/clip/generate', express.json({ limit: '1mb' }), async (req, res) => {
    try { res.json(await generateClip(req.body)); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  console.log('[clip-gen] V2 routes: /clips, /api/mcp-bridge/clip/{generate,list}');
}

module.exports = { generateClip, mountClipRoutes };

// --- V11Pan audio processing ---
async function applyV11Pan(inputPath, outputPath) {
  // Call the internal double-harmonic process endpoint
  const FormData = require('form-data') || null;
  // Fallback: use curl to call the internal API with a service JWT
  try {
    const cmd = `curl -s -X POST http://localhost:3000/api/double-harmonic/v10boom/process -F "audio=@${inputPath}" -H "Authorization: Bearer internal-clip-service" -o "${outputPath}" -w "%{http_code}"`;
    const result = execSync(cmd, { timeout: 60000 }).toString().trim();
    if (result === '200' && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      console.log('[clip] V11Pan applied:', outputPath);
      return outputPath;
    }
  } catch (e) {}
  // If v11pan fails, use original audio (better than no clip)
  console.log('[clip] V11Pan skipped, using original audio');
  fs.copyFileSync(inputPath, outputPath);
  return outputPath;
}
// FFmpeg V3: loop each video to fill section duration, then concat with audio
function assembleClipV3(videos, audioPath, outputPath, sectionDurations) {
  const fs = require('fs');
  const dir = path.dirname(outputPath);
  
  // Step 1: extend each video to fill its section duration
  const extendedVideos = [];
  videos.forEach((vid, i) => {
    const duration = sectionDurations[i] || 15;
    const extPath = path.join(dir, `ext_${i}.mp4`);
    
    if (vid.endsWith('.png') || vid.endsWith('.jpg')) {
      // Image: create video from still with zoom effect
      execSync(`ffmpeg -y -loop 1 -t ${duration} -i "${vid}" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.001,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration*25}:s=1920x1080:fps=25" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${extPath}"`, { timeout: 120000 });
    } else {
      // Video: loop/slow-mo to fill duration
      execSync(`ffmpeg -y -stream_loop -1 -i "${vid}" -t ${duration} -vf "setpts=1.2*PTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset fast -crf 23 -an -pix_fmt yuv420p "${extPath}"`, { timeout: 120000 });
    }
    extendedVideos.push(extPath);
  });
  
  // Step 2: concat all extended videos
  const concatFile = path.join(dir, 'concat.txt');
  fs.writeFileSync(concatFile, extendedVideos.map(v => `file '${v}'`).join('\n'));
  
  // Step 3: merge with audio
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -i "${audioPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -map 0:v -map 1:a -shortest -movflags +faststart "${outputPath}"`, { timeout: 600000 });
  
  // Cleanup temp files
  extendedVideos.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
  try { fs.unlinkSync(concatFile); } catch(e) {}
  
  console.log('[clip] V3 assembled:', outputPath);
  return outputPath;
}
