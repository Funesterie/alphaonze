const fs = require('node:fs/promises');
const path = require('node:path');

const {
  callJanusVisionText,
  resolveJanusVisionConfig,
  resolveVisionProvider,
} = require('../../lib/janus-vision-runtime.cjs');

const IMAGE_REFERENCE_ROLES = [
  'identity',
  'pose',
  'accessory',
  'background',
  'style_reference',
];

const IMAGE_QUALITY_FLAGS = [
  'screenshot_ui',
  'blurry',
  'composite',
  'crop_needed',
];

const ROLE_PRIORITY = {
  identity: 5,
  pose: 4,
  accessory: 3,
  background: 2,
  style_reference: 1,
};

const IMAGE_REFERENCE_CLARIFICATION_POLICY = Object.freeze({
  roles: ['identity', 'pose'],
  minConfidence: 0.52,
  maxConfidenceGap: 0.12,
  maxScoreGap: 16,
});

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookup(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .toLowerCase();
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function isRemoteUrl(value = '') {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isDataUrl(value = '') {
  return /^data:/i.test(String(value || '').trim());
}

function guessImageContentType(locator = '') {
  const lowered = String(locator || '').trim().toLowerCase();
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg';
  if (lowered.endsWith('.webp')) return 'image/webp';
  if (lowered.endsWith('.gif')) return 'image/gif';
  if (lowered.endsWith('.bmp')) return 'image/bmp';
  if (lowered.endsWith('.svg')) return 'image/svg+xml';
  return 'image/png';
}

function parseJsonObjectFromModelText(value = '') {
  const cleaned = normalizeText(String(value || ''))
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return null;
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeRole(value = '') {
  const normalized = normalizeLookup(value);
  if (normalized === 'style reference' || normalized === 'style') return 'style_reference';
  return IMAGE_REFERENCE_ROLES.includes(normalized) ? normalized : 'style_reference';
}

function normalizeOptionalRole(value = '') {
  const cleaned = normalizeText(value);
  return cleaned ? normalizeRole(cleaned) : '';
}

function normalizeQualityFlags(values = []) {
  return toUniqueStrings(values)
    .map((entry) => normalizeLookup(entry))
    .filter((entry) => IMAGE_QUALITY_FLAGS.includes(entry));
}

function normalizeDetectedContent(value = '') {
  if (Array.isArray(value)) {
    return toUniqueStrings(value).slice(0, 4).join(', ');
  }
  return normalizeText(value);
}

function roundCoordinate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (Math.abs(numeric) <= 1) {
    return Number(numeric.toFixed(4));
  }
  return Number(numeric.toFixed(2));
}

function normalizeCoordinateBox(value = null) {
  let raw = value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    raw = raw.bbox
      || raw.box
      || raw.bounding_box
      || raw.boundingBox
      || raw.coordinates
      || raw.position
      || raw.rect
      || raw;
  }

  let coordinates = [];
  if (Array.isArray(raw)) {
    coordinates = raw.slice(0, 4);
  } else if (raw && typeof raw === 'object') {
    const x = raw.x ?? raw.left ?? raw.x1 ?? raw.min_x ?? raw.minX;
    const y = raw.y ?? raw.top ?? raw.y1 ?? raw.min_y ?? raw.minY;
    const width = raw.width ?? raw.w;
    const height = raw.height ?? raw.h;
    const right = raw.right ?? raw.x2 ?? raw.max_x ?? raw.maxX;
    const bottom = raw.bottom ?? raw.y2 ?? raw.max_y ?? raw.maxY;
    if (width !== undefined && height !== undefined) {
      coordinates = [x, y, width, height];
    } else if (right !== undefined && bottom !== undefined) {
      const numericX = Number(x);
      const numericY = Number(y);
      const numericRight = Number(right);
      const numericBottom = Number(bottom);
      coordinates = [
        numericX,
        numericY,
        numericRight - numericX,
        numericBottom - numericY,
      ];
    }
  } else if (typeof raw === 'string') {
    coordinates = raw.match(/-?\d+(?:\.\d+)?/g)?.slice(0, 4) || [];
  }

  const normalized = coordinates.map(roundCoordinate);
  if (normalized.length !== 4 || normalized.some((entry) => entry === null)) return null;
  return normalized;
}

function normalizeConfidence(value, fallback = 0) {
  return Number(clamp01(value ?? fallback ?? 0).toFixed(4));
}

function normalizeEntityAttributes(value = []) {
  if (!value || typeof value !== 'object') return toUniqueStrings(value).slice(0, 6);
  if (Array.isArray(value)) return toUniqueStrings(value).slice(0, 6);
  return toUniqueStrings(
    Object.entries(value)
      .map(([key, entry]) => {
        const keyText = normalizeText(key);
        const entryText = normalizeText(Array.isArray(entry) ? entry.join(', ') : entry);
        return keyText && entryText ? `${keyText}: ${entryText}` : entryText || keyText;
      })
  ).slice(0, 6);
}

function normalizeManifestObject(entry = null) {
  if (typeof entry === 'string') {
    const label = normalizeText(entry);
    return label ? { label, role: '', bbox: null, confidence: 0, attributes: [] } : null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const label = normalizeText(
    entry.label
    || entry.name
    || entry.object
    || entry.category
    || entry.description
    || ''
  );
  const role = normalizeText(entry.role || entry.type || entry.kind || '');
  const bbox = normalizeCoordinateBox(entry);
  const attributes = normalizeEntityAttributes(
    entry.attributes
    || entry.traits
    || entry.visible_attributes
    || entry.visibleAttributes
    || []
  );
  if (!label && !role && !bbox && attributes.length <= 0) return null;
  return {
    label: label || role || 'visible object',
    role,
    bbox,
    confidence: normalizeConfidence(entry.confidence),
    attributes,
  };
}

function normalizeManifestAnatomy(entry = null) {
  if (typeof entry === 'string') {
    const part = normalizeText(entry);
    return part ? { part, side: '', state: '', bbox: null, confidence: 0 } : null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const part = normalizeText(
    entry.part
    || entry.label
    || entry.name
    || entry.body_part
    || entry.bodyPart
    || ''
  );
  const side = normalizeText(entry.side || entry.laterality || '');
  const state = normalizeText(
    entry.state
    || entry.pose
    || entry.gesture
    || entry.condition
    || entry.description
    || ''
  );
  const bbox = normalizeCoordinateBox(entry);
  if (!part && !side && !state && !bbox) return null;
  return {
    part: part || 'visible anatomy',
    side,
    state,
    bbox,
    confidence: normalizeConfidence(entry.confidence),
  };
}

function normalizeManifestCharacter(entry = null) {
  if (typeof entry === 'string') {
    const label = normalizeText(entry);
    return label ? { label, bbox: null, pose: '', anatomy: [], clothing: [], confidence: 0 } : null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const label = normalizeText(
    entry.label
    || entry.name
    || entry.identity
    || entry.character
    || entry.description
    || ''
  );
  const bbox = normalizeCoordinateBox(entry);
  const pose = normalizeText(entry.pose || entry.body_pose || entry.bodyPose || entry.stance || '');
  const anatomy = normalizeManifestList(
    entry.anatomy
    || entry.visible_anatomy
    || entry.visibleAnatomy
    || [],
    normalizeManifestAnatomy,
    8
  );
  const clothing = normalizeEntityAttributes(entry.clothing || entry.outfit || entry.costume || []);
  if (!label && !pose && !bbox && anatomy.length <= 0 && clothing.length <= 0) return null;
  return {
    label: label || 'visible character',
    bbox,
    pose,
    anatomy,
    clothing,
    confidence: normalizeConfidence(entry.confidence),
  };
}

function normalizeManifestList(values = [], mapper = (entry) => entry, limit = 10) {
  return (Array.isArray(values) ? values : [values])
    .map((entry) => mapper(entry))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeManifestRelationships(values = []) {
  return normalizeManifestList(values, (entry) => {
    if (typeof entry === 'string') return normalizeText(entry);
    if (!entry || typeof entry !== 'object') return '';
    const subject = normalizeText(entry.subject || entry.from || entry.actor || '');
    const relation = normalizeText(entry.relation || entry.action || entry.verb || entry.type || '');
    const object = normalizeText(entry.object || entry.to || entry.target || '');
    const description = normalizeText(entry.description || entry.summary || '');
    if (description) return description;
    return normalizeText([subject, relation, object].filter(Boolean).join(' '));
  }, 8);
}

function sanitizeDetectedContentForPrompt(value = '') {
  return normalizeText(value)
    .replace(/\bprimary reference image\b/gi, 'reference image')
    .replace(
      /\b(bandaged|wrapped|cast|splinted)\s+(left|right)\s+hand\b/gi,
      '$1 hand on the same side as in the reference image'
    )
    .replace(/\bhandedness\b/gi, 'same-side hand laterality');
}

function hasRichManifestObservation(manifest = {}) {
  return (
    (Array.isArray(manifest?.objects) && manifest.objects.length > 0)
    || (Array.isArray(manifest?.characters) && manifest.characters.length > 0)
    || (Array.isArray(manifest?.anatomy) && manifest.anatomy.length > 0)
    || (Array.isArray(manifest?.relationships) && manifest.relationships.length > 0)
  );
}

function formatCoordinateBox(box = null) {
  return Array.isArray(box) && box.length === 4
    ? `bbox ${box.join(',')}`
    : '';
}

function trimPromptObservation(value = '', limit = 520) {
  const text = normalizeText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trim()}...`;
}

function formatManifestAnatomy(entry = {}) {
  const part = normalizeText(entry?.part || '');
  const side = normalizeText(entry?.side || '');
  const state = normalizeText(entry?.state || '');
  const bbox = formatCoordinateBox(entry?.bbox || null);
  const core = normalizeText([
    side,
    part,
    state ? `(${state})` : '',
  ].filter(Boolean).join(' '));
  return normalizeText([core || part || 'visible anatomy', bbox].filter(Boolean).join(' '));
}

function formatManifestObject(entry = {}) {
  const label = normalizeText(entry?.label || '');
  const role = normalizeText(entry?.role || '');
  const bbox = formatCoordinateBox(entry?.bbox || null);
  const attributes = Array.isArray(entry?.attributes) && entry.attributes.length
    ? `attributes: ${entry.attributes.slice(0, 3).join(', ')}`
    : '';
  return normalizeText([label || role || 'visible object', role && label ? `(${role})` : '', bbox, attributes].filter(Boolean).join(' '));
}

function formatManifestCharacter(entry = {}) {
  const label = normalizeText(entry?.label || '');
  const bbox = formatCoordinateBox(entry?.bbox || null);
  const pose = normalizeText(entry?.pose || '');
  const clothing = Array.isArray(entry?.clothing) && entry.clothing.length
    ? `clothing: ${entry.clothing.slice(0, 3).join(', ')}`
    : '';
  const anatomy = Array.isArray(entry?.anatomy) && entry.anatomy.length
    ? `anatomy: ${entry.anatomy.slice(0, 4).map(formatManifestAnatomy).filter(Boolean).join(', ')}`
    : '';
  return normalizeText([
    label || 'visible character',
    bbox,
    pose ? `pose: ${pose}` : '',
    clothing,
    anatomy,
  ].filter(Boolean).join(' '));
}

function buildManifestPromptObservation(manifest = {}) {
  if (!manifest || typeof manifest !== 'object') return '';
  const sections = [];
  const detected = sanitizeDetectedContentForPrompt(manifest.detected_content || '');
  if (detected) sections.push(detected);
  if (Array.isArray(manifest.characters) && manifest.characters.length > 0) {
    sections.push(`characters: ${manifest.characters.slice(0, 3).map(formatManifestCharacter).filter(Boolean).join('; ')}`);
  }
  if (Array.isArray(manifest.objects) && manifest.objects.length > 0) {
    sections.push(`objects: ${manifest.objects.slice(0, 6).map(formatManifestObject).filter(Boolean).join('; ')}`);
  }
  if (Array.isArray(manifest.anatomy) && manifest.anatomy.length > 0) {
    sections.push(`anatomy: ${manifest.anatomy.slice(0, 6).map(formatManifestAnatomy).filter(Boolean).join('; ')}`);
  }
  if (Array.isArray(manifest.relationships) && manifest.relationships.length > 0) {
    sections.push(`spatial relations: ${manifest.relationships.slice(0, 4).join('; ')}`);
  }
  return trimPromptObservation(sections.filter(Boolean).join('; '));
}

function normalizeImageReferenceManifest(result = {}, fallback = {}) {
  return {
    image_id: normalizeText(result?.image_id || result?.imageId || fallback.image_id || ''),
    detected_content: normalizeDetectedContent(
      result?.detected_content
      || result?.detectedContent
      || fallback.detected_content
      || ''
    ),
    probable_role: normalizeRole(
      result?.probable_role
      || result?.probableRole
      || fallback.probable_role
      || ''
    ),
    confidence: normalizeConfidence(result?.confidence, fallback.confidence),
    quality_flags: normalizeQualityFlags(
      result?.quality_flags
      || result?.qualityFlags
      || fallback.quality_flags
      || []
    ),
    objects: normalizeManifestList(
      result?.objects
      || result?.detected_objects
      || result?.detectedObjects
      || fallback.objects
      || [],
      normalizeManifestObject,
      12
    ),
    characters: normalizeManifestList(
      result?.characters
      || result?.people
      || result?.persons
      || fallback.characters
      || [],
      normalizeManifestCharacter,
      6
    ),
    anatomy: normalizeManifestList(
      result?.anatomy
      || result?.visible_anatomy
      || result?.visibleAnatomy
      || fallback.anatomy
      || [],
      normalizeManifestAnatomy,
      12
    ),
    relationships: normalizeManifestRelationships(
      result?.relationships
      || result?.spatial_relationships
      || result?.spatialRelationships
      || fallback.relationships
      || []
    ),
  };
}

function buildJanusImageManifestPrompt(imageId = '') {
  return [
    'You are Janus, an image reference classifier for A11.',
    'Analyze exactly one image.',
    'Do not rewrite or reinterpret the user prompt.',
    'Return strict JSON only with this exact shape:',
    JSON.stringify({
      image_id: String(imageId || 'image-1'),
      detected_content: 'short English summary',
      probable_role: 'identity',
      confidence: 0.0,
      quality_flags: [],
      objects: [
        {
          label: 'visible object or prop',
          role: 'prop/accessory/background/detail',
          bbox: [0.0, 0.0, 0.0, 0.0],
          confidence: 0.0,
          attributes: ['short visible cue'],
        },
      ],
      characters: [
        {
          label: 'main character/person',
          bbox: [0.0, 0.0, 0.0, 0.0],
          pose: 'short pose description',
          anatomy: [
            {
              part: 'hand/arm/face/etc',
              side: 'left/right/center/unknown',
              state: 'short visible state',
              bbox: [0.0, 0.0, 0.0, 0.0],
              confidence: 0.0,
            },
          ],
          clothing: ['short visible cue'],
          confidence: 0.0,
        },
      ],
      anatomy: [
        {
          part: 'visible body part',
          side: 'left/right/center/unknown',
          state: 'short visible state',
          bbox: [0.0, 0.0, 0.0, 0.0],
          confidence: 0.0,
        },
      ],
      relationships: ['short spatial relation'],
    }),
    'Rules:',
    `- probable_role must be one of: ${IMAGE_REFERENCE_ROLES.join(', ')}`,
    `- quality_flags may contain only: ${IMAGE_QUALITY_FLAGS.join(', ')}`,
    '- detected_content must stay short, concrete, and in English',
    '- detected_content should mention the main subject, their position in frame, dominant colors, and any distinctive prop, held item, visible wrap/cast, or facial cue when clearly visible',
    '- objects must list visible objects/props/background details with normalized bbox [x, y, width, height] from 0 to 1 when possible',
    '- for each object: attributes must include color (precise hex or descriptive like "deep burgundy"), material/texture ("polished gold metal", "rough linen"), size relative to frame ("~15% frame width"), and finish ("matte", "glossy", "brushed")',
    '- characters must list visible people/characters, their bbox, body pose, clothing, and nested anatomy when visible',
    '- for each character: clothing must list each garment with color + material + style ("matte black leather jacket, silver zipper pulls", "faded indigo denim jeans, straight cut")',
    '- anatomy must list visible body parts, laterality, state/gesture, and bbox when visible',
    '- for anatomy state: include color/skin tone when relevant and any visible markings, wraps, or accessories on that body part',
    '- relationships must list concise spatial relations such as "left hand grips bat above shoulder", "badge pinned to upper-left chest", "watch on right wrist"',
    '- Use empty arrays when a section is not visible; never invent hidden details',
    '- identity: the image mainly defines who the main person or character is',
    '- pose: the image mainly defines body pose, framing, or camera angle',
    '- accessory: the image mainly defines a prop, wearable, or local detail',
    '- background: the image mainly defines the setting or backdrop',
    '- style_reference: the image mainly defines rendering style, color mood, or aesthetic direction',
    '- screenshot_ui if phone UI, app chrome, story captions, subtitles, status bar, or overlay text are visible',
    '- blurry if the useful content is visibly soft or low-detail',
    '- composite if the image is a collage, sheet, poster, panel, or multiple references combined',
    '- crop_needed if the useful subject is cut off or surrounded by large irrelevant borders or UI',
    '- If uncertain, choose the most likely role and lower confidence',
    '- JSON only',
  ].join('\n');
}

function normalizeImageReferenceEntry(entry = {}, index = 0) {
  const locator = normalizeText(
    entry?.locator
    || entry?.url
    || entry?.path
    || entry?.imageUrl
    || entry?.image_url
    || ''
  );
  const imageId = normalizeText(entry?.image_id || entry?.imageId || `image-${index + 1}`);
  return {
    image_id: imageId,
    locator,
    source_hint: normalizeText(entry?.source_hint || entry?.sourceHint || ''),
    declared_role: normalizeOptionalRole(entry?.declared_role || entry?.declaredRole || entry?.role || ''),
    content_type: normalizeText(entry?.content_type || entry?.contentType || guessImageContentType(locator)),
  };
}

function extractObjectImageReferenceEntries(items = [], sourceHint = '') {
  return (Array.isArray(items) ? items : [])
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return normalizeImageReferenceEntry({
          locator: entry,
          source_hint: sourceHint,
        }, index);
      }
      if (!entry || typeof entry !== 'object') return null;
      const locator = normalizeText(
        entry.url
        || entry.path
        || entry.imageUrl
        || entry.image_url
        || entry.src
        || ''
      );
      if (!locator) return null;
      return normalizeImageReferenceEntry({
        image_id: entry.image_id || entry.imageId,
        locator,
        source_hint: sourceHint,
        declared_role: entry.role || entry.roleHint || entry.role_hint,
        content_type: entry.contentType || entry.content_type,
      }, index);
    })
    .filter((entry) => entry && entry.locator);
}

function extractMessageImageReferenceEntries(messages = []) {
  const refs = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const directCandidates = [
      message?.imageUrl,
      message?.image_url,
      message?.imagePath,
      message?.image_path,
      ...(Array.isArray(message?.imageUrls) ? message.imageUrls : []),
      ...(Array.isArray(message?.image_urls) ? message.image_urls : []),
    ];
    for (const locator of directCandidates) {
      if (!normalizeText(locator)) continue;
      refs.push(normalizeImageReferenceEntry({
        locator,
        source_hint: 'message_image_field',
      }, refs.length));
    }

    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const type = normalizeLookup(part.type || '');
      if (!['image_url', 'input_image', 'image'].includes(type)) continue;
      const locator = normalizeText(
        part?.image_url?.url
        || part?.image_url
        || part?.url
        || part?.imageUrl
        || ''
      );
      if (!locator) continue;
      refs.push(normalizeImageReferenceEntry({
        image_id: part.image_id || part.imageId,
        locator,
        source_hint: 'message_image',
        declared_role: part.role || part.roleHint || part.role_hint,
      }, refs.length));
    }
  }
  return refs;
}

function extractRequestImageReferences({ body = {}, messages = [] } = {}) {
  const refs = [];
  const register = (entry) => {
    const normalized = normalizeImageReferenceEntry(entry, refs.length);
    if (!normalized.locator) return;
    const dedupeKey = normalizeLookup(`${normalized.locator}::${normalized.declared_role}`);
    if (refs.some((item) => normalizeLookup(`${item.locator}::${item.declared_role}`) === dedupeKey)) return;
    refs.push(normalized);
  };

  const scalarCandidates = [
    ['sourceImageUrl', body?.sourceImageUrl],
    ['source_image_url', body?.source_image_url],
    ['referenceImageUrl', body?.referenceImageUrl],
    ['reference_image_url', body?.reference_image_url],
    ['initImageUrl', body?.initImageUrl],
    ['init_image_url', body?.init_image_url],
    ['imageUrl', body?.imageUrl],
    ['image_url', body?.image_url],
  ];
  for (const [sourceHint, locator] of scalarCandidates) {
    if (!normalizeText(locator)) continue;
    register({ locator, source_hint: sourceHint });
  }

  const listCandidates = [
    ['sourceImages', body?.sourceImages],
    ['sourceImageUrls', body?.sourceImageUrls],
    ['source_image_urls', body?.source_image_urls],
    ['referenceImages', body?.referenceImages],
    ['referenceImageUrls', body?.referenceImageUrls],
    ['reference_image_urls', body?.reference_image_urls],
    ['initImages', body?.initImages],
    ['initImageUrls', body?.initImageUrls],
    ['init_image_urls', body?.init_image_urls],
    ['images', body?.images],
    ['imageUrls', body?.imageUrls],
    ['image_urls', body?.image_urls],
  ];
  for (const [sourceHint, entries] of listCandidates) {
    for (const entry of extractObjectImageReferenceEntries(entries, sourceHint)) {
      register(entry);
    }
  }

  for (const entry of extractMessageImageReferenceEntries(messages)) {
    register(entry);
  }

  return refs.map((entry, index) => normalizeImageReferenceEntry(entry, index));
}

async function readImageReferenceBuffer(reference = {}) {
  const locator = normalizeText(reference?.locator || '');
  if (!locator) {
    const error = new Error('missing_image_locator');
    error.code = 'missing_image_locator';
    throw error;
  }

  if (isDataUrl(locator)) {
    const match = locator.match(/^data:([^;,]+)?;base64,(.+)$/i);
    if (!match) {
      const error = new Error('invalid_data_url');
      error.code = 'invalid_data_url';
      throw error;
    }
    return {
      buffer: Buffer.from(match[2], 'base64'),
      contentType: normalizeText(match[1] || reference?.content_type || 'image/png') || 'image/png',
    };
  }

  if (isRemoteUrl(locator)) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = Math.max(1000, Number(process.env.A11_IMAGE_REFERENCE_FETCH_TIMEOUT_MS || 3500) || 3500);
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const response = await fetch(locator, {
        signal: controller?.signal,
        headers: {
          Accept: 'image/*,*/*;q=0.8',
        },
      });
      if (!response.ok) {
        const error = new Error(`reference_image_fetch_failed:${response.status}`);
        error.code = 'reference_image_fetch_failed';
        throw error;
      }
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: normalizeText(response.headers.get('content-type') || reference?.content_type || guessImageContentType(locator))
          || guessImageContentType(locator),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const absolutePath = path.resolve(locator);
  return {
    buffer: await fs.readFile(absolutePath),
    contentType: normalizeText(reference?.content_type || guessImageContentType(locator)) || guessImageContentType(locator),
  };
}

function computeReferencePriorityScore(reference = {}, manifest = {}) {
  const role = normalizeRole(manifest?.probable_role || '');
  const confidence = Number(manifest?.confidence || 0) || 0;
  const sourceHint = normalizeLookup(reference?.source_hint || '');
  let score = (ROLE_PRIORITY[role] || 0) * 100 + Math.round(confidence * 100);

  if (role === 'identity' && /\b(sourceimageurl|source image url|initimageurl|referenceimageurl)\b/.test(sourceHint)) {
    score += 22;
  }
  if (role === 'pose' && /\b(initimageurl|referenceimageurl)\b/.test(sourceHint)) {
    score += 16;
  }
  if (role === 'style_reference' && /\b(style|mood|look)\b/.test(sourceHint)) {
    score += 14;
  }
  if (reference?.declared_role && normalizeRole(reference.declared_role) === role) {
    score += 18;
  }
  return score;
}

function buildRoleAmbiguityQuestion(role = 'identity') {
  if (role === 'pose') {
    return 'J’ai trouvé plusieurs images qui ressemblent à des références de pose ou de cadrage. Laquelle doit servir de base principale ?';
  }
  return 'J’ai trouvé plusieurs images qui ressemblent à des références d’identité. Laquelle doit rester l’image principale ?';
}

function shouldClarifyRankedConflict(primary = null, challenger = null) {
  if (!primary || !challenger) return false;
  const primaryRole = normalizeRole(primary?.manifest?.probable_role || '');
  const challengerRole = normalizeRole(challenger?.manifest?.probable_role || '');
  if (primaryRole !== challengerRole) return false;
  if (!IMAGE_REFERENCE_CLARIFICATION_POLICY.roles.includes(primaryRole)) return false;

  const primaryConfidence = Number(primary?.manifest?.confidence || 0) || 0;
  const challengerConfidence = Number(challenger?.manifest?.confidence || 0) || 0;
  if (
    primaryConfidence < IMAGE_REFERENCE_CLARIFICATION_POLICY.minConfidence
    || challengerConfidence < IMAGE_REFERENCE_CLARIFICATION_POLICY.minConfidence
  ) {
    return false;
  }

  const confidenceGap = Math.abs(primaryConfidence - challengerConfidence);
  if (confidenceGap > IMAGE_REFERENCE_CLARIFICATION_POLICY.maxConfidenceGap) return false;

  const scoreGap = Math.abs((Number(primary?.score || 0) || 0) - (Number(challenger?.score || 0) || 0));
  return scoreGap <= IMAGE_REFERENCE_CLARIFICATION_POLICY.maxScoreGap;
}

function resolveImageReferenceDecision({
  references = [],
  manifests = [],
} = {}) {
  const manifestById = new Map(
    (Array.isArray(manifests) ? manifests : [])
      .map((entry) => normalizeImageReferenceManifest(entry))
      .filter((entry) => entry.image_id)
      .map((entry) => [entry.image_id, entry])
  );

  const ranked = (Array.isArray(references) ? references : [])
    .map((reference) => {
      const normalizedReference = normalizeImageReferenceEntry(reference);
      const manifest = manifestById.get(normalizedReference.image_id) || null;
      if (!manifest) return null;
      return {
        reference: normalizedReference,
        manifest,
        score: computeReferencePriorityScore(normalizedReference, manifest),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) {
    return {
      manifests: Array.from(manifestById.values()),
      primary_image_id: '',
      primary_role: '',
      clarification_required: false,
      clarification_question: '',
      conflicts: [],
      ranked: [],
    };
  }

  const primary = ranked[0];
  const primaryRole = normalizeRole(primary.manifest.probable_role);
  const conflicts = ranked
    .slice(1)
    .filter((entry) => shouldClarifyRankedConflict(primary, entry))
    .map((entry) => ({
      image_id: entry.reference.image_id,
      probable_role: entry.manifest.probable_role,
      confidence: entry.manifest.confidence,
      detected_content: entry.manifest.detected_content,
    }));

  const clarificationRequired = (
    ['identity', 'pose'].includes(primaryRole)
    && conflicts.length > 0
  );

  return {
    manifests: Array.from(manifestById.values()),
    primary_image_id: primary.reference.image_id,
    primary_role: primaryRole,
    primary_confidence: primary.manifest.confidence,
    clarification_required: clarificationRequired,
    clarification_question: clarificationRequired ? buildRoleAmbiguityQuestion(primaryRole) : '',
    conflicts,
    decision_source: 'janus_manifest',
    selection_mode: clarificationRequired ? 'needs_user_clarification' : 'auto_primary',
    fallback_reason: '',
    ranked: ranked.map((entry) => ({
      image_id: entry.reference.image_id,
      locator: entry.reference.locator,
      probable_role: entry.manifest.probable_role,
      confidence: entry.manifest.confidence,
      score: entry.score,
      detected_content: entry.manifest.detected_content,
      quality_flags: entry.manifest.quality_flags,
    })),
  };
}

function buildAutomaticImageReferenceFallbackDecision({
  references = [],
  reason = 'first_reference_fallback',
} = {}) {
  const normalizedReferences = (Array.isArray(references) ? references : [])
    .map((entry, index) => normalizeImageReferenceEntry(entry, index))
    .filter((entry) => entry.locator);
  const primaryReference = normalizedReferences[0] || null;
  const primaryRole = normalizeOptionalRole(primaryReference?.declared_role || '');

  return {
    manifests: [],
    primary_image_id: normalizeText(primaryReference?.image_id || ''),
    primary_role: primaryRole,
    primary_confidence: 0,
    clarification_required: false,
    clarification_question: '',
    conflicts: [],
    decision_source: 'a11_fallback',
    selection_mode: 'fallback_first_reference',
    fallback_reason: normalizeText(reason || 'first_reference_fallback') || 'first_reference_fallback',
    ranked: normalizedReferences.map((entry, index) => ({
      image_id: entry.image_id,
      locator: entry.locator,
      probable_role: normalizeOptionalRole(entry.declared_role || ''),
      confidence: 0,
      score: Math.max(0, normalizedReferences.length - index),
      detected_content: '',
      quality_flags: [],
    })),
  };
}

function applyImageReferenceDecisionToMask(mask = {}, decision = {}, references = []) {
  const nextMask = JSON.parse(JSON.stringify(mask || {}));
  nextMask.meta = nextMask.meta && typeof nextMask.meta === 'object' ? nextMask.meta : {};
  nextMask.inputs = nextMask.inputs && typeof nextMask.inputs === 'object' ? nextMask.inputs : {};

  const normalizedReferences = (Array.isArray(references) ? references : [])
    .map((entry, index) => normalizeImageReferenceEntry(entry, index))
    .filter((entry) => entry.locator);
  const manifests = (Array.isArray(decision?.manifests) ? decision.manifests : [])
    .map((entry) => normalizeImageReferenceManifest(entry))
    .filter((entry) => entry.image_id);
  const primaryImageId = normalizeText(decision?.primary_image_id || decision?.primaryImageId || '');
  const primaryManifest = manifests.find((entry) => entry.image_id === primaryImageId) || null;
  const primaryReference = normalizedReferences.find((entry) => entry.image_id === primaryImageId) || null;

  nextMask.meta.imageReferences = normalizedReferences;
  nextMask.meta.imageReferenceManifests = manifests;
  nextMask.meta.imageReferenceDecision = {
    primaryImageId,
    primaryRole: normalizeOptionalRole(
      decision?.primary_role || decision?.primaryRole || primaryManifest?.probable_role || ''
    ),
    primaryConfidence: Number(decision?.primary_confidence || decision?.primaryConfidence || primaryManifest?.confidence || 0) || 0,
    clarificationRequired: decision?.clarification_required === true,
    clarificationQuestion: normalizeText(decision?.clarification_question || decision?.clarificationQuestion || ''),
    conflicts: Array.isArray(decision?.conflicts) ? decision.conflicts : [],
    decisionSource: normalizeText(decision?.decision_source || decision?.decisionSource || ''),
    selectionMode: normalizeText(decision?.selection_mode || decision?.selectionMode || ''),
    fallbackReason: normalizeText(decision?.fallback_reason || decision?.fallbackReason || ''),
  };

  if (!primaryReference || !primaryReference.locator) {
    return nextMask;
  }

  const primaryLocator = primaryReference.locator;
  const isRemotePrimary = isRemoteUrl(primaryLocator) || isDataUrl(primaryLocator);
  nextMask.meta.init_image_url = primaryLocator;
  nextMask.meta.reference_image_url = primaryLocator;
  nextMask.meta.webImageDraft = {
    ...((nextMask.meta.webImageDraft && typeof nextMask.meta.webImageDraft === 'object') ? nextMask.meta.webImageDraft : {}),
    ...(isRemotePrimary ? { initImageUrl: primaryLocator } : { initImagePath: primaryLocator }),
    sourceUsed: primaryLocator,
    mode: isRemotePrimary ? 'image_url' : 'local_path',
    reason: 'image_reference_manifest_primary',
    explicitReferenceAnchor: true,
    fromChatSourceImage: true,
    imageReferenceRole: normalizeOptionalRole(primaryManifest?.probable_role || decision?.primary_role || ''),
    imageReferenceId: primaryImageId,
    imageReferenceQualityFlags: Array.isArray(primaryManifest?.quality_flags) ? primaryManifest.quality_flags : [],
    compositeRisk: Array.isArray(primaryManifest?.quality_flags) && primaryManifest.quality_flags.includes('composite'),
  };

  const promptInstructions = Array.isArray(nextMask.meta.promptInstructions)
    ? [...nextMask.meta.promptInstructions]
    : [];
  const environment = Array.isArray(nextMask.inputs.environment)
    ? [...nextMask.inputs.environment]
    : [];
  const style = Array.isArray(nextMask.inputs.style)
    ? [...nextMask.inputs.style]
    : [];

  if (Array.isArray(primaryManifest?.quality_flags) && primaryManifest.quality_flags.includes('screenshot_ui')) {
    promptInstructions.push('ignore any screenshot interface or overlay text from the primary reference image');
  }
  if (Array.isArray(primaryManifest?.quality_flags) && primaryManifest.quality_flags.includes('crop_needed')) {
    promptInstructions.push('focus on the main subject from the primary reference image and ignore irrelevant margins');
  }
  const primaryObservation = buildManifestPromptObservation(primaryManifest);
  if (primaryObservation && hasRichManifestObservation(primaryManifest)) {
    promptInstructions.push(`use Janus source analysis as spatial guide: ${primaryObservation}`);
  }
  if (
    ['identity', 'pose'].includes(normalizeOptionalRole(primaryManifest?.probable_role || ''))
    && primaryObservation
  ) {
    promptInstructions.push(`preserve these distinctive visible cues from the reference image: ${primaryObservation}`);
    promptInstructions.push('preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image');
  }

  for (const manifest of manifests) {
    if (!manifest || manifest.image_id === primaryImageId) continue;
    const manifestObservation = buildManifestPromptObservation(manifest);
    if (!manifestObservation) continue;
    if (manifest.probable_role === 'background') {
      environment.push(`background reference: ${manifestObservation}`);
      continue;
    }
    if (manifest.probable_role === 'style_reference') {
      style.push(`style reference: ${manifestObservation}`);
      continue;
    }
    if (manifest.probable_role === 'accessory') {
      promptInstructions.push(`include uploaded accessory reference details: ${manifestObservation}`);
      continue;
    }
    if (manifest.probable_role === 'pose') {
      promptInstructions.push(`reuse pose cues from the uploaded pose reference: ${manifestObservation}`);
    }
  }

  nextMask.meta.promptInstructions = toUniqueStrings(promptInstructions).slice(0, 10);
  nextMask.inputs.environment = toUniqueStrings(environment).slice(0, 6);
  nextMask.inputs.style = toUniqueStrings(style).slice(0, 6);
  return nextMask;
}

async function classifyReferenceImages({
  references = [],
  requestId = '',
  callVisionText = callJanusVisionText,
} = {}) {
  const normalizedReferences = (Array.isArray(references) ? references : [])
    .map((entry, index) => normalizeImageReferenceEntry(entry, index))
    .filter((entry) => entry.locator)
    .slice(0, Math.max(1, Number(process.env.A11_IMAGE_REFERENCE_MAX_IMAGES || 4) || 4));

  if (!normalizedReferences.length) {
    return {
      skipped: true,
      reason: 'no_references',
      manifests: [],
    };
  }

  if (resolveVisionProvider({}) !== 'janus' || typeof callVisionText !== 'function') {
    return {
      skipped: true,
      reason: 'janus_unavailable',
      manifests: [],
    };
  }

  const config = resolveJanusVisionConfig({
    maxNewTokens: Number(process.env.A11_IMAGE_REFERENCE_JANUS_MAX_TOKENS || 700),
    timeoutMs: Number(process.env.A11_IMAGE_REFERENCE_JANUS_TIMEOUT_MS || 12000),
  });
  const manifests = [];
  const errors = [];

  for (const reference of normalizedReferences) {
    try {
      const loaded = await readImageReferenceBuffer(reference);
      const rawResponse = await callVisionText({
        imageBuffer: loaded.buffer,
        contentType: loaded.contentType || reference.content_type || 'image/png',
        prompt: buildJanusImageManifestPrompt(reference.image_id),
        requestId: `${String(requestId || 'janus-image-ref').trim() || 'janus-image-ref'}:${reference.image_id}`,
        maxNewTokens: config.maxNewTokens,
        timeoutMs: config.timeoutMs,
        modelRef: config.modelRef,
        device: config.device,
        torchDtype: config.torchDtype,
        temperature: 0,
      });
      const parsed = parseJsonObjectFromModelText(rawResponse?.text || rawResponse?.response || rawResponse || '');
      const manifest = normalizeImageReferenceManifest(parsed || {}, {
        image_id: reference.image_id,
      });
      if (manifest.image_id) manifests.push(manifest);
    } catch (error_) {
      errors.push({
        image_id: reference.image_id,
        error: normalizeText(error_?.message || error_),
      });
    }
  }

  const decision = resolveImageReferenceDecision({
    references: normalizedReferences,
    manifests,
  });

  return {
    ...decision,
    skipped: manifests.length <= 0,
    reason: manifests.length > 0 ? '' : 'classification_failed',
    errors,
  };
}

module.exports = {
  IMAGE_QUALITY_FLAGS,
  IMAGE_REFERENCE_ROLES,
  applyImageReferenceDecisionToMask,
  buildAutomaticImageReferenceFallbackDecision,
  classifyReferenceImages,
  extractRequestImageReferences,
  normalizeImageReferenceManifest,
  resolveImageReferenceDecision,
};
