'use strict';
// clips-addon.cjs — Mounted as a standalone route file
// Load after server startup via: require('./clips-addon.cjs')(app)
const path = require('path');
const {
  CLIPS_DIR,
  TROLL_VIDEO,
  CHECKOUT_URL,
  isInternalRequest,
  isAuthenticated,
  isOwnSiteReferer,
} = require('./src/clips/clips-config.cjs');

const RIPPER_RE = [/yt-dlp/i, /youtube-dl/i, /wget/i, /aria2/i, /ffmpeg/i, /streamripper/i, /headlesschrome/i, /phantomjs/i, /selenium/i];

// Un pirate anonyme s'annonce souvent en ffmpeg ou sans User-Agent du tout.
// Mais la chaine interne aussi: c'est pourquoi l'appartenance est tranchee avant,
// et cette fonction ne voit plus que des inconnus.
function looksLikeRipper(ua) {
  if (!ua || ua.length < 5) return true;
  return RIPPER_RE.some((r) => r.test(ua));
}

module.exports = function mountClipsRoute(app) {
  app.get('/clips/:filename', (req, res) => {
    // Les appels internes et les sessions authentifiees passent avant toute
    // detection: un service maison qui telecharge avec ffmpeg n'est pas un pirate,
    // et le trolier lui-meme etait la cause des clips casses cote production.
    const trusted = isInternalRequest(req) || isAuthenticated(req);

    if (!trusted && looksLikeRipper(req.headers['user-agent'] || '')) {
      const tp = path.join(CLIPS_DIR, TROLL_VIDEO);
      return res.sendFile(tp, { root: '/' }, (e) => {
        if (e) res.redirect(302, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      });
    }

    // Paywall: hotlink externe sans auth -> Stripe
    if (!trusted && !isOwnSiteReferer(req)) {
      return res.redirect(302, CHECKOUT_URL);
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
