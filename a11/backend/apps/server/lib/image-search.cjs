// lib/image-search.cjs
// Recherche une image sur DuckDuckGo Images (pas d'API clé requise)
const https = require('https');

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
    .replace(/[-_/]/g, ' ')
    .toLowerCase();
}

function extractHostname(url = '') {
  const raw = normalizeText(url);
  if (!raw) return '';
  try {
    return String(new URL(raw).hostname || '').replace(/^www\./i, '').trim();
  } catch {
    return '';
  }
}

function requestText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function buildSearchHeaders(referer = '') {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    ...(referer ? {
      Accept: 'application/json,text/javascript,*/*;q=0.9',
      Referer: referer,
    } : {}),
  };
}

function toSearchTokens(query = '') {
  const stopwords = new Set([
    'art', 'character', 'anime', 'manga', 'official', 'reference', 'photo',
    'illustration', 'image', 'render', 'fanart', 'clean', 'style',
  ]);
  return [...new Set(
    normalizeLookup(query)
      .split(/\s+/)
      .filter((token) => token && token.length >= 3 && !stopwords.has(token))
  )];
}

function mapImageCandidate(result = {}) {
  return {
    image_url: normalizeText(result.image || result.image_url || ''),
    source_url: normalizeText(result.url || result.source_url || ''),
    title: normalizeText(result.title || ''),
    width: Number(result.width || 0) || null,
    height: Number(result.height || 0) || null,
  };
}

function scoreImageCandidate(candidate = {}, query = '') {
  const combined = normalizeLookup([
    candidate.title,
    candidate.source_url,
    candidate.image_url,
    extractHostname(candidate.source_url),
  ].filter(Boolean).join(' '));
  const queryLookup = normalizeLookup(query);
  const tokens = toSearchTokens(query);
  const longestSide = Math.max(Number(candidate.width || 0), Number(candidate.height || 0), 0);
  const shortestSide = Math.max(1, Math.min(Number(candidate.width || 1), Number(candidate.height || 1)));
  const aspectRatio = longestSide / shortestSide;

  let score = 0;
  const reasons = [];

  for (const token of tokens) {
    if (combined.includes(token)) {
      score += token.length >= 5 ? 4 : 3;
      reasons.push(`token:${token}`);
    }
  }

  if (/\b(character|anime|manga|fan art|fanart|official art|illustration|render)\b/.test(queryLookup)) {
    if (/\b(character|anime|manga|fan art|fanart|official art|illustration|render)\b/.test(combined)) {
      score += 8;
      reasons.push('art_bias');
    }
    if (/\b(photo|cosplay|costume)\b/.test(combined)) {
      score -= 6;
      reasons.push('photo_penalty');
    }
  }

  if (shortestSide >= 384) {
    score += 2;
    reasons.push('min_side_ok');
  }
  if (longestSide >= 896) {
    score += 2;
    reasons.push('large_image');
  }
  if (aspectRatio >= 0.7 && aspectRatio <= 1.6) {
    score += 1;
    reasons.push('balanced_ratio');
  } else if (aspectRatio >= 2.1) {
    score -= 2;
    reasons.push('extreme_ratio');
  }

  if (/\b(plaque|nameplate|rating plate|datasheet|spec|specification|catalog|catalogue|manual|maintenance|motor|moteur|generator|pump|voltage|rpm|ampere|crompton)\b/.test(combined)) {
    score -= 18;
    reasons.push('industrial_penalty');
  }

  if (/\b(product|shop|store|amazon|ebay|aliexpress|stock|price|buy|acheter)\b/.test(combined)) {
    score -= 10;
    reasons.push('commerce_penalty');
  }

  if (/\b(lineup|sheet|sprite|spritesheet|collage|mosaic|poster|wallpaper|crew|group|team|characters|personnages|cover)\b/.test(combined)) {
    score -= 6;
    reasons.push('composite_penalty');
  }

  if (!candidate.image_url || !candidate.source_url) {
    score -= 4;
    reasons.push('missing_urls');
  }

  return {
    ...candidate,
    selection_score: score,
    selection_reason: reasons.join('|'),
    source_domain: extractHostname(candidate.source_url),
  };
}

function selectBestImageCandidate(results = [], query = '') {
  const ranked = (Array.isArray(results) ? results : [])
    .map((entry) => scoreImageCandidate(mapImageCandidate(entry), query))
    .filter((entry) => entry.image_url)
    .sort((left, right) => right.selection_score - left.selection_score);

  const selected = ranked[0] || null;
  if (!selected) return null;

  return {
    ...selected,
    candidates: ranked.slice(0, 5).map((entry) => ({
      image_url: entry.image_url,
      source_url: entry.source_url,
      title: entry.title,
      width: entry.width,
      height: entry.height,
      source_domain: entry.source_domain,
      selection_score: entry.selection_score,
      selection_reason: entry.selection_reason,
    })),
    selected_by: 'heuristic_rank',
  };
}

async function duckduckgoImageSearch(query, options = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    throw new Error('missing_query');
  }

  const limit = Math.max(1, Math.min(12, Number(options?.limit || 8) || 8));
  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(normalizedQuery)}&iax=images&ia=images`;
  const html = await requestText(searchUrl, buildSearchHeaders());
  const vqdMatch = html.match(/vqd=(['"])([^'"]+)\1/i) || html.match(/vqd=([^&"'\s]+)/i);
  if (!vqdMatch) {
    throw new Error('No vqd token found');
  }
  const vqd = vqdMatch[2] || vqdMatch[1];
  const apiUrl = `https://duckduckgo.com/i.js?l=fr-fr&o=json&q=${encodeURIComponent(normalizedQuery)}&vqd=${vqd}`;
  const data = await requestText(apiUrl, buildSearchHeaders(searchUrl));
  const json = JSON.parse(data);
  const results = Array.isArray(json?.results) ? json.results.slice(0, limit) : [];
  const selected = selectBestImageCandidate(results, normalizedQuery);
  if (!selected) {
    throw new Error('No image found');
  }
  return selected;
}

module.exports = { duckduckgoImageSearch };
