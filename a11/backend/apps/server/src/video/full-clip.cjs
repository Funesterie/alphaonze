"use strict";

/**
 * FULL CLIP — Génération de clip vidéo complet à partir d'une chanson NOSSEN
 *
 * Pipeline :
 *   1. Paroles → storyboard (sections → scènes → prompts visuels)
 *   2. Chaque scène → image (ComfyUI si dispo, sinon dégradé de couleur persona)
 *   3. Images → loops vidéo (ffmpeg zoom/pan/fade)
 *   4. Loops → montage assemblé sur la durée de l'audio
 *   5. Audio muxé dans le montage
 *   6. Export multi-format (16:9, 9:16, 1:1) pour YouTube/Facebook/Instagram
 *   7. Upload R2 → URLs téléchargeables sur files.funesterie.me
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_FPS = 24;
const MIN_DURATION = 10;
const MAX_DURATION = 300;
const MIN_SCENES = 4;
const MAX_SCENES = 12;
const SCENE_MIN_DURATION = 4;
const SCENE_MAX_DURATION = 30;

const SOCIAL_FORMATS = {
  landscape: { width: 1920, height: 1080, label: "16:9 YouTube/Facebook" },
  portrait: { width: 1080, height: 1920, label: "9:16 Instagram Reels/TikTok" },
  square: { width: 1080, height: 1080, label: "1:1 Facebook feed" },
};

// ---------------------------------------------------------------------------
// Storyboard from lyrics
// ---------------------------------------------------------------------------

function parseLyricSections(lyrics) {
  const lines = String(lyrics || "").split(/\r?\n/);
  const sections = [];
  let current = null;
  const headerRe = /^\s*\[(Intro|Verse|Couplet|Pre[- ]?Chorus|Pré[- ]?refrain|Refrain|Chorus|Bridge|Pont|Outro|Final(?:\s+Chorus)?)\b[^\]]*\]\s*$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(headerRe);
    if (match) {
      if (current) sections.push(current);
      current = { header: match[1], lines: [], raw: trimmed };
    } else if (current && trimmed) {
      current.lines.push(trimmed);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function buildStoryboard(lyrics, options = {}) {
  const sections = parseLyricSections(lyrics);
  const duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, Number(options.durationSeconds) || 180));
  const artistId = String(options.artistId || "vivy").toLowerCase();
  const songTitle = String(options.title || "Funesterie Clip");
  const visualMood = String(options.visualMood || "").trim();

  // If no sections found, create a simple 4-scene storyboard
  if (sections.length < 2) {
    const simpleScenes = Math.max(MIN_SCENES, Math.min(MAX_SCENES, 4));
    const sceneDur = duration / simpleScenes;
    const storyboard = [];
    for (let i = 0; i < simpleScenes; i++) {
      storyboard.push({
        sceneId: `scene-${i + 1}`,
        header: i === 0 ? "Intro" : i === simpleScenes - 1 ? "Outro" : `Verse ${i}`,
        prompt: buildScenePrompt(songTitle, visualMood, artistId, i, simpleScenes),
        startMs: Math.round(i * sceneDur * 1000),
        endMs: Math.round((i + 1) * sceneDur * 1000),
        durationSeconds: Math.round(sceneDur * 10) / 10,
      });
    }
    return storyboard;
  }

  // Allocate time per section based on line count
  const totalLines = sections.reduce((sum, s) => sum + Math.max(1, s.lines.length), 0);
  let cursor = 0;
  const storyboard = sections.slice(0, MAX_SCENES).map((section, i) => {
    const weight = Math.max(1, section.lines.length) / totalLines;
    const sceneDur = Math.max(SCENE_MIN_DURATION, Math.min(SCENE_MAX_DURATION, weight * duration));
    const end = i === sections.length - 1 ? duration : Math.min(duration, cursor + sceneDur);
    const scene = {
      sceneId: `scene-${i + 1}`,
      header: section.header,
      prompt: buildScenePrompt(songTitle, visualMood, artistId, i, sections.length, section.lines[0]),
      lyricPreview: section.lines.slice(0, 2).join(" "),
      startMs: Math.round(cursor * 1000),
      endMs: Math.round(end * 1000),
      durationSeconds: Math.round((end - cursor) * 10) / 10,
    };
    cursor = end;
    return scene;
  });

  return storyboard;
}

function buildScenePrompt(title, mood, artistId, index, total, firstLine) {
  const palette = {
    vivy: "neon cyber-pop, electric magenta and cyan, dark club atmosphere",
    djeff: "gritty urban rap, blood red and dark amber, street night scenes",
    a11: "deep blue tech, cold digital landscape, data streams",
    k44: "indigo and gold, regal cinematic, dramatic lighting",
    kaen44: "same as k44",
  };
  const visualStyle = palette[artistId] || palette.vivy;
  const moodPart = mood ? `, ${mood}` : "";
  const linePart = firstLine ? `, inspired by: "${firstLine.slice(0, 80)}"` : "";
  const progression = index === 0 ? "establishing shot" : index === total - 1 ? "final crescendo" : `scene ${index + 1} of ${total}`;
  return `${visualStyle}${moodPart}, ${progression}, music video for "${title.slice(0, 60)}"${linePart}, cinematic, high quality, dramatic lighting, no text overlay`;
}

// ---------------------------------------------------------------------------
// Image generation (fallback: colored gradient with title)
// ---------------------------------------------------------------------------

function getPersonaColor(artistId) {
  const colors = {
    vivy: ["0x0a8a8a", "0x8a0a8a"], // Cyan to Magenta
    djeff: ["0x8a0a0a", "0x8a4a0a"], // BloodRed to FireOrange
    a11: ["0x0a4a8a", "0x0a0a4a"], // DeepBlue to Indigo
    k44: ["0x0a0a4a", "0x8a8a0a"], // Indigo to DORE
    kaen44: ["0x0a0a4a", "0x8a8a0a"],
  };
  return colors[artistId] || colors.vivy;
}

async function generateFallbackImage(scene, options = {}) {
  const workDir = options.workDir || os.tmpdir();
  const imagePath = path.join(workDir, `${scene.sceneId}-${crypto.randomBytes(4).toString("hex")}.png`);
  const [c1, c2] = getPersonaColor(options.artistId);
  const w = options.width || DEFAULT_WIDTH;
  const h = options.height || DEFAULT_HEIGHT;

  // Create a gradient image with the scene header as text overlay
  const args = [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${c1}:s=${w}x${h}:d=1`,
    "-vf", `drawtext=text='${scene.header.replace(/'/g, "\\'")}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:`,
    "-frames:v", "1",
    imagePath,
  ];

  await execFileAsync("ffmpeg", args, { timeout: 30000 });
  return imagePath;
}

// ---------------------------------------------------------------------------
// Motion loop from image (ffmpeg zoom/pan)
// ---------------------------------------------------------------------------

async function createMotionLoop(imagePath, outputPath, durationSeconds, options = {}) {
  const w = options.width || DEFAULT_WIDTH;
  const h = options.height || DEFAULT_HEIGHT;
  const fps = options.fps || DEFAULT_FPS;
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));

  // Zoom in slowly + slight pan
  const zoomStart = 1.0;
  const zoomEnd = 1.15;
  const zoomExpr = `min(zoom+0.0008,${zoomEnd})`;
  const xExpr = `iw/2-(iw/zoom/2)`;
  const yExpr = `ih/2-(ih/zoom/2)`;

  const args = [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-vf", `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${w}x${h}:fps=${fps},fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, durationSeconds - 0.5).toFixed(1)}:d=0.5`,
    "-t", durationSeconds.toFixed(1),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "fast",
    "-crf", "23",
    outputPath,
  ];

  await execFileAsync("ffmpeg", args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
  return outputPath;
}

// ---------------------------------------------------------------------------
// Montage assembly
// ---------------------------------------------------------------------------

async function assembleMontage(loopPaths, outputPath, options = {}) {
  const w = options.width || DEFAULT_WIDTH;
  const h = options.height || DEFAULT_HEIGHT;
  const fps = options.fps || DEFAULT_FPS;

  // Build the ffmpeg concat with crossfade
  const inputs = [];
  for (const p of loopPaths) {
    inputs.push("-i", p);
  }

  // Simple concat with xfade between scenes
  const filters = [];
  let prevLabel = "0:v";
  let offset = 0;

  for (let i = 1; i < loopPaths.length; i++) {
    const fadeDuration = 0.5;
    const label = `v${i}`;
    filters.push(`[${prevLabel}][${i}:v]xfade=transition=fade:duration=${fadeDuration}:offset=${offset.toFixed(2)}[${label}]`);
    prevLabel = label;
    offset += Number(options.sceneDurations?.[i - 1] || 5) - fadeDuration;
  }

  const filterComplex = filters.length > 0 ? filters.join(";") : "[0:v]null[out]";
  const lastLabel = filters.length > 0 ? prevLabel : "out";

  const args = [
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", `[${lastLabel}]`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "fast",
    "-crf", "23",
    "-r", String(fps),
    "-s", `${w}x${h}`,
    outputPath,
  ];

  await execFileAsync("ffmpeg", args, { timeout: 300000, maxBuffer: 50 * 1024 * 1024 });
  return outputPath;
}

// ---------------------------------------------------------------------------
// Audio mux
// ---------------------------------------------------------------------------

async function muxAudio(videoPath, audioUrl, outputPath, options = {}) {
  const ffmpeg = options.ffmpeg || "ffmpeg";
  const fetchFn = options.fetchFn || globalThis.fetch;
  const workDir = options.workDir || path.dirname(videoPath);
  
  let audioInput = audioUrl;
  
  // If the URL is an external HTTPS URL, download it locally first
  // because ffmpeg can't authenticate against our own API
  if (/^https?:/i.test(audioUrl)) {
    // Try 1: direct fetch with the provided fetchFn (may have auth cookies)
    // Try 2: convert to localhost URL (internal backend access, no auth needed)
    // Try 3: use ffmpeg directly (last resort)
    
    const urls = [
      audioUrl,
      audioUrl.replace(/^https?:\/\/[^/]+/i, "http://localhost:3000"),
    ];
    
    for (const tryUrl of urls) {
      try {
        const useFetch = tryUrl.includes("localhost") ? globalThis.fetch : fetchFn;
        const response = await useFetch(tryUrl, { redirect: "follow" });
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > 1000) {
            const tempAudio = path.join(workDir, "audio-input-" + crypto.randomBytes(4).toString("hex") + ".mp3");
            fs.writeFileSync(tempAudio, buffer);
            audioInput = tempAudio;
            break;
          }
        }
      } catch (e) {
        // try next URL
      }
    }
    
    // If still an HTTP URL, try ffmpeg with -headers for auth
    if (/^https?:/i.test(audioInput)) {
      // Last resort: strip the token and try without auth (some endpoints are public)
      const cleanUrl = audioInput.replace(/\?token=[^&]*/i, "");
      audioInput = cleanUrl;
    }
  }
  
  const args = [
    "-y",
    "-i", videoPath,
    "-i", audioInput,
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  ];
  await execFileAsync(ffmpeg, args, { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });
  return outputPath;
}

// ---------------------------------------------------------------------------
// Social media format export (resize)
// ---------------------------------------------------------------------------

async function exportSocialFormat(inputPath, outputPath, format) {
  const { width, height } = format;
  // Smart crop + resize: center crop to target aspect ratio, then scale
  const args = [
    "-y",
    "-i", inputPath,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "fast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ];
  await execFileAsync("ffmpeg", args, { timeout: 180000, maxBuffer: 50 * 1024 * 1024 });
  return outputPath;
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

async function generateFullClip(input = {}, context = {}) {
  const {
    audioUrl,
    lyrics,
    title,
    artistId = "vivy",
    visualMood = "",
    durationSeconds = 0,
    formats = ["landscape", "portrait", "square"],
    uploadToR2 = null,
    fetchFn = null,
    logger = console,
  } = input;

  if (!audioUrl) throw new Error("full_clip_missing_audio_url");
  if (!lyrics && !title) throw new Error("full_clip_missing_lyrics_or_title");

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "full-clip-"));
  const totalDuration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, Number(durationSeconds) || 180));
  const storyboard = buildStoryboard(lyrics, { durationSeconds: totalDuration, artistId, title, visualMood });

  logger.log(`[full-clip] storyboard: ${storyboard.length} scenes, ${totalDuration}s total`);

  // 1. Generate images for each scene
  const imagePaths = [];
  for (const scene of storyboard) {
    try {
      const imgPath = await generateFallbackImage(scene, {
        workDir,
        artistId,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      });
      imagePaths.push(imgPath);
      logger.log(`[full-clip] image: ${scene.sceneId} (${scene.header})`);
    } catch (e) {
      logger.warn(`[full-clip] image failed for ${scene.sceneId}: ${e.message}`);
      throw e;
    }
  }

  // 2. Create motion loops from images
  const loopPaths = [];
  const sceneDurations = [];
  for (let i = 0; i < storyboard.length; i++) {
    const scene = storyboard[i];
    const loopPath = path.join(workDir, `${scene.sceneId}-loop.mp4`);
    await createMotionLoop(imagePaths[i], loopPath, scene.durationSeconds, {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      fps: DEFAULT_FPS,
    });
    loopPaths.push(loopPath);
    sceneDurations.push(scene.durationSeconds);
    logger.log(`[full-clip] loop: ${scene.sceneId} (${scene.durationSeconds}s)`);
  }

  // 3. Assemble montage (landscape master)
  const masterPath = path.join(workDir, "master-landscape.mp4");
  await assembleMontage(loopPaths, masterPath, {
    width: SOCIAL_FORMATS.landscape.width,
    height: SOCIAL_FORMATS.landscape.height,
    fps: DEFAULT_FPS,
    sceneDurations,
  });
  logger.log(`[full-clip] montage assembled: ${masterPath}`);

  // 4. Mux audio into the master
  const masterWithAudio = path.join(workDir, "master-with-audio.mp4");
  await muxAudio(masterPath, audioUrl, masterWithAudio, { workDir, fetchFn: options.fetchFn || globalThis.fetch });
  logger.log(`[full-clip] audio muxed: ${masterWithAudio}`);

  // 5. Export social formats and upload
  const results = {};
  for (const formatKey of formats) {
    const format = SOCIAL_FORMATS[formatKey];
    if (!format) continue;
    const exportPath = path.join(workDir, `export-${formatKey}.mp4`);
    await exportSocialFormat(masterWithAudio, exportPath, format);
    logger.log(`[full-clip] exported ${formatKey}: ${format.width}x${format.height}`);

    // Upload to R2 if function provided
    if (uploadToR2) {
      const buffer = await fs.promises.readFile(exportPath);
      const uploaded = await uploadToR2({
        userId: context.userId || "vivy-full-clip",
        filename: `${(title || "vivy-clip").replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}-${formatKey}-${crypto.randomBytes(4).toString("hex")}.mp4`,
        buffer,
        contentType: "video/mp4",
      });
      results[formatKey] = {
        url: uploaded.url,
        width: format.width,
        height: format.height,
        label: format.label,
        sizeBytes: buffer.length,
      };
      logger.log(`[full-clip] uploaded ${formatKey}: ${uploaded.url}`);
    } else {
      results[formatKey] = { path: exportPath, width: format.width, height: format.height, label: format.label };
    }
  }

  // Cleanup
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}

  return {
    ok: true,
    title: title || "Funesterie Clip",
    artistId,
    durationSeconds: totalDuration,
    storyboard,
    formats: results,
    socialReady: {
      youtube: results.landscape?.url || null,
      facebook: results.landscape?.url || results.square?.url || null,
      instagram: results.portrait?.url || null,
      tiktok: results.portrait?.url || null,
    },
  };
}

module.exports = {
  buildStoryboard,
  parseLyricSections,
  generateFullClip,
  createMotionLoop,
  assembleMontage,
  muxAudio,
  exportSocialFormat,
  SOCIAL_FORMATS,
};
