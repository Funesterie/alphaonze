'use strict';
// Patch server.cjs to inject clips route with Sharingan guard
const fs = require('fs');
const file = '/app/server.cjs';
let code = fs.readFileSync(file, 'utf8');

if (code.includes('/clips/:filename')) {
  console.log('Clips route already present, skipping');
  process.exit(0);
}

const CLIPS_ROUTE = `
// --- NOSSEN: Route /clips/:filename avec Sharingan Guard ---
const CLIPS_DIR_PATH = process.env.NOSSEN_CLIPS_DIR || '/agent-bus/clips';
const RIPPER_RE = [/yt-dlp/i,/youtube-dl/i,/wget/i,/aria2/i,/python-urllib/i,/scrapy/i,/ffmpeg/i,/streamripper/i,/headlesschrome/i,/phantomjs/i,/selenium/i];
app.get('/clips/:filename', (req, res) => {
  const ua = req.headers['user-agent'] || '';
  // Sharingan: detect rippers
  if (!ua || ua.length < 5 || RIPPER_RE.some(r => r.test(ua))) {
    const trollPath = require('path').join(CLIPS_DIR_PATH, 'sharingan_troll.mp4');
    return res.sendFile(trollPath, { root: '/' }, (err) => {
      if (err) res.redirect(302, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });
  }
  // Paywall: external hotlink without auth → Stripe
  const ref = req.headers['referer'] || req.headers['origin'] || '';
  if (!req.internalService && !req.user && !req.cookies?.session && !ref.includes('funesterie')) {
    return res.redirect(302, process.env.NOSSEN_CLIP_CHECKOUT_URL || 'https://buy.stripe.com/aEU17k4OG9Kh4xi5kk');
  }
  // Serve clip
  const decoded = decodeURIComponent(req.params.filename || '');
  if (!decoded || /[\\/]/.test(decoded)) return res.status(400).json({ error: 'Invalid' });
  const ext = require('path').extname(decoded).toLowerCase();
  if (!['.mp4','.webm','.mkv'].includes(ext)) return res.status(403).json({ error: 'Unsupported' });
  res.sendFile(require('path').join(CLIPS_DIR_PATH, decoded), { root: '/' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Not found' });
  });
});
console.log('[Server] NOSSEN clips route + Sharingan Guard active');
`;

// Insert before the try { const HOST line
const insertBefore = '  try {\n    const HOST = resolveBindHost';
const idx = code.indexOf(insertBefore);
if (idx === -1) {
  console.error('Could not find insertion point');
  process.exit(1);
}
code = code.slice(0, idx) + CLIPS_ROUTE + '\n' + code.slice(idx);
fs.writeFileSync(file, code);
console.log('Clips route injected successfully');
