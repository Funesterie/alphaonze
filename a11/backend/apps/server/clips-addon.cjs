'use strict';
// clips-addon.cjs — Mounted as a standalone route file
// Load after server startup via: require('./clips-addon.cjs')(app)
const path = require('path');

const CLIPS_DIR = process.env.NOSSEN_CLIPS_DIR || '/agent-bus/clips';
const RIPPER_RE = [/yt-dlp/i, /youtube-dl/i, /wget/i, /aria2/i, /ffmpeg/i, /streamripper/i, /headlesschrome/i, /phantomjs/i, /selenium/i];

module.exports = function mountClipsRoute(app) {
  app.get('/clips/:filename', (req, res) => {
    const ua = req.headers['user-agent'] || '';
    // Sharingan: detect rippers -> troll video or rickroll
    if (!ua || ua.length < 5 || RIPPER_RE.some(r => r.test(ua))) {
      const tp = path.join(CLIPS_DIR, 'sharingan_troll.mp4');
      return res.sendFile(tp, { root: '/' }, (e) => {
        if (e) res.redirect(302, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      });
    }
    // Paywall: external hotlink without auth -> Stripe
    const ref = req.headers['referer'] || req.headers['origin'] || '';
    if (!req.internalService && !req.user && !(req.cookies || {}).session && !ref.includes('funesterie')) {
      return res.redirect(302, process.env.NOSSEN_CLIP_CHECKOUT_URL || 'https://buy.stripe.com/aEU17k4OG9Kh4xi5kk');
    }
    // Serve clip
    const decoded = decodeURIComponent(req.params.filename || '');
    if (!decoded || /[\/\\]/.test(decoded)) return res.status(400).json({ error: 'Invalid' });
    const ext = path.extname(decoded).toLowerCase();
    if (!['.mp4', '.webm', '.mkv'].includes(ext)) return res.status(403).json({ error: 'Unsupported' });
    res.sendFile(path.join(CLIPS_DIR, decoded), { root: '/' }, (e) => {
      if (e && !res.headersSent) res.status(404).json({ error: 'Not found' });
    });
  });
  console.log('[Server] NOSSEN clips route + Sharingan Guard active');
};
