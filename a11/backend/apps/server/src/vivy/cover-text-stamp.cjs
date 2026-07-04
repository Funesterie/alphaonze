'use strict';

let sharp = null;
try {
  // eslint-disable-next-line global-require
  sharp = require('sharp');
} catch {
  sharp = null;
}

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isCoverTextStampEnabled(env = process.env) {
  const raw = String(env.VIVY_STREAM_COVER_TEXT_STAMP ?? '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function buildCoverTextSvg({ width, height, title = '', signature = '' } = {}) {
  const w = Math.max(64, Number(width) || 1280);
  const h = Math.max(36, Number(height) || 720);
  const pad = Math.round(h * 0.045);
  const titleSize = Math.max(18, Math.round(h * 0.042));
  const signatureSize = Math.max(20, Math.round(h * 0.055));
  const titleStroke = Math.max(2, Math.round(titleSize / 11));
  const safeTitle = escapeXml(String(title || '').slice(0, 90));
  const safeSignature = escapeXml(String(signature || '').slice(0, 40));
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  ${safeTitle ? `<text x="${pad}" y="${h - pad}" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${titleSize}" fill="#fff8ff" stroke="#0a0510" stroke-width="${titleStroke}" paint-order="stroke" stroke-linejoin="round">${safeTitle}</text>` : ''}
  ${safeSignature ? `<text x="${w - pad}" y="${pad + signatureSize}" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-style="italic" font-size="${signatureSize}" fill="#f07ad9" stroke="#12081a" stroke-width="2" paint-order="stroke" stroke-linejoin="round">${safeSignature}</text>` : ''}
</svg>`;
}

async function stampCoverText(imageBuffer, { title = '', signature = 'Vivy ★' } = {}) {
  if (!sharp) throw new Error('cover_text_stamp_sharp_unavailable');
  if (!title && !signature) return imageBuffer;
  const base = sharp(imageBuffer, { failOn: 'none' });
  const meta = await base.metadata();
  const svg = buildCoverTextSvg({
    width: meta.width,
    height: meta.height,
    title,
    signature,
  });
  return base
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

module.exports = {
  buildCoverTextSvg,
  isCoverTextStampEnabled,
  stampCoverText,
};
