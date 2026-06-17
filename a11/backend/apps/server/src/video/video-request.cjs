function normalizeVideoText(value = '') {
  return String(value || '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVideoFormat(value = '', fallback = 'mp4') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'gif') return 'gif';
  if (normalized === 'mp4' || normalized === 'video/mp4') return 'mp4';
  return fallback;
}

function normalizeVideoBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toVideoStringList(values = [], limit = 12) {
  const source = Array.isArray(values) ? values : [values];
  const output = [];
  const seen = new Set();
  for (const value of source) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      const text = String(entry || '').trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(text);
      if (output.length >= limit) return output;
    }
  }
  return output;
}

function normalizeSequencePlannerMode(value = '', fallback = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['llm', 'ollama', 'llm-prompter', 'llm_prompter'].includes(normalized)) return 'llm_prompter';
  if (['auto', 'heuristic', 'janus'].includes(normalized)) return normalized;
  return fallback;
}

function parsePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(numeric);
}

function extractDurationSeconds(text = '') {
  const match = String(text || '').match(/\b(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|second|seconds|seconde|secondes)\b/i);
  if (!match) return null;
  return Number(String(match[1] || '').replace(',', '.'));
}

function extractFps(text = '') {
  const match = String(text || '').match(/\b(\d{1,3})\s*fps\b/i);
  if (!match) return null;
  return Number(match[1]);
}

function extractFrameCount(text = '') {
  const match = String(text || '').match(/\b(\d{1,3})\s*(?:frames?|images?)\b/i);
  if (!match) return null;
  return Number(match[1]);
}

function extractFormat(text = '') {
  const match = String(text || '').match(/\b(mp4|gif)\b/i);
  return match ? normalizeVideoFormat(match[1]) : '';
}

function stripVideoIntentPrefix(text = '') {
  return String(text || '')
    .replace(/^(?:peux[-\s]*tu|tu peux|merci de|stp|svp)?\s*/i, '')
    .replace(/^(?:genere|generer|cree|creer|fais|faire|fabrique|produis|prepare|generate|create|make|render)\s+(?:moi\s+)?/i, '')
    .replace(/^(?:une?\s+)?(?:video|animation|gif|clip|mp4)\s+/i, '')
    .replace(/^(?:de|du|des|d)\s+/i, '')
    .trim();
}

function stripVideoControlSuffixes(text = '') {
  return String(text || '')
    .replace(/\b(?:pendant|pour|duree|durée)\s+\d+(?:[.,]\d+)?\s*(?:s|sec|secs|second|seconds|seconde|secondes)\b/gi, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:s|sec|secs|second|seconds|seconde|secondes)\b/gi, '')
    .replace(/\b(?:a|à|en)\s+\d{1,3}\s*fps\b/gi, '')
    .replace(/\b\d{1,3}\s*fps\b/gi, '')
    .replace(/\b(?:format|au format|en format)\s+(?:mp4|gif)\b/gi, '')
    .replace(/\b(?:mp4|gif)\b/gi, '')
    .replace(/[,:;.\-]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPromptFromVideoText(text = '') {
  const normalized = normalizeVideoText(text);
  if (!normalized) return '';
  const withoutPrefix = stripVideoIntentPrefix(normalized);
  const withoutControls = stripVideoControlSuffixes(withoutPrefix);
  return withoutControls || normalized;
}

function parseVideoGenerateRequest(text = '', body = {}) {
  const rawText = normalizeVideoText(text || body?.message || body?.prompt || '');
  const explicitPrompt = normalizeVideoText(
    body?.videoPrompt
    || body?.video_prompt
    || body?.subject
    || body?.topic
    || ''
  );
  const prompt = explicitPrompt || extractPromptFromVideoText(rawText);
  const sourceImageUrl = String(body?.sourceImageUrl || body?.source_image_url || body?.imageUrl || body?.image_url || '').trim();
  const referenceImageUrls = toVideoStringList([
    sourceImageUrl,
    body?.referenceImageUrl,
    body?.reference_image_url,
    body?.initImageUrl,
    body?.init_image_url,
    body?.referenceImageUrls,
    body?.reference_image_urls,
  ], 12);

  return {
    rawText,
    prompt,
    textDurationSeconds: extractDurationSeconds(rawText) || 0,
    textFps: extractFps(rawText) || 0,
    textFrameCount: extractFrameCount(rawText) || 0,
    durationSeconds: Number(
      body?.durationSeconds
      || body?.duration_seconds
      || body?.duration
      || extractDurationSeconds(rawText)
      || 0
    ) || 0,
    fps: Number(body?.fps || extractFps(rawText) || 0) || 0,
    frameCount: Number(body?.frameCount || body?.frame_count || body?.frames || extractFrameCount(rawText) || 0) || 0,
    format: normalizeVideoFormat(body?.format || body?.outputFormat || extractFormat(rawText) || ''),
    width: Number(body?.width || 0) || 0,
    height: Number(body?.height || 0) || 0,
    sourceType: String(body?.sourceType || body?.source_type || '').trim().toLowerCase(),
    sourceUrl: String(body?.sourceUrl || body?.source_url || '').trim(),
    sourcePath: String(body?.sourcePath || body?.source_path || '').trim(),
    sourceImageUrl,
    referenceImageUrls,
    sourceImagePath: String(body?.sourceImagePath || body?.source_image_path || body?.imagePath || body?.image_path || '').trim(),
    sourceVideoUrl: String(body?.sourceVideoUrl || body?.source_video_url || body?.videoUrl || body?.video_url || '').trim(),
    sourceVideoPath: String(body?.sourceVideoPath || body?.source_video_path || body?.videoPath || body?.video_path || '').trim(),
    audioUrl: String(body?.audioUrl || body?.audio_url || '').trim(),
    sequencePlanner: normalizeSequencePlannerMode(
      body?.sequencePlanner
      || body?.sequence_planner
      || body?.sequencePlannerMode
      || body?.sequence_planner_mode
      || body?.planner
      || body?.planner_mode
      || '',
      ''
    ),
    sequencePlannerImageAware: normalizeVideoBoolean(
      body?.sequencePlannerImageAware
      || body?.sequence_planner_image_aware
      || body?.plannerImageAware
      || body?.planner_image_aware,
      null
    ),
    sequencePlannerTimeoutMs: parsePositiveInteger(
      body?.sequencePlannerTimeoutMs
      || body?.sequence_planner_timeout_ms
      || body?.plannerTimeoutMs
      || body?.planner_timeout_ms,
      0
    ),
  };
}

module.exports = {
  extractDurationSeconds,
  extractFrameCount,
  extractFps,
  extractFormat,
  extractPromptFromVideoText,
  normalizeVideoFormat,
  normalizeVideoText,
  parseVideoGenerateRequest,
};
