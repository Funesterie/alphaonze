'use strict';
/**
 * Sharingan Clips Guard — Anti-piracy + Paywall for Full Clips
 * 
 * 1. Detects bots/rippers via User-Agent + suspicious headers → serves troll video
 * 2. If user not authenticated and not internal → redirect to Stripe 29.99€ checkout
 * 3. Authenticated users / internal services pass through normally
 */

const path = require('path');
const {
  CLIPS_DIR,
  TROLL_VIDEO,
  CHECKOUT_URL,
  isInternalRequest,
  isAuthenticated,
} = require('./clips-config.cjs');

// Bot/ripper patterns (youtube-dl, yt-dlp, wget recursive, curl bots, etc.)
const RIPPER_PATTERNS = [
  /yt-dlp/i, /youtube-dl/i, /wget/i, /aria2/i, /python-urllib/i,
  /scrapy/i, /httpclient/i, /libcurl.*bot/i, /go-http-client/i,
  /java\/\d/i, /okhttp/i, /axios\/0\./i, /node-fetch/i,
  /ffmpeg/i, /streamripper/i, /grab/i, /telegrambot/i,
  /discordbot/i, /facebookexternalhit/i, /twitterbot/i,
  /whatsapp/i, /applebot/i, /bingbot/i, /googlebot/i,
  /baiduspider/i, /yandexbot/i, /duckduckbot/i,
  /headlesschrome/i, /phantomjs/i, /selenium/i
];

function isRipper(req) {
  const ua = req.headers['user-agent'] || '';
  // No user-agent at all = suspicious
  if (!ua || ua.length < 5) return true;
  // Known ripper patterns
  if (RIPPER_PATTERNS.some(p => p.test(ua))) return true;
  // Range abuse (downloading full file in chunks without referer)
  const range = req.headers['range'];
  const referer = req.headers['referer'] || req.headers['origin'] || '';
  if (range && !referer && !req.headers['cookie']) return true;
  return false;
}

/**
 * Mount the Sharingan guard on the clips route
 * @param {object} opts
 * @param {string} opts.clipsDir - Path to clips directory
 * @param {string} opts.stripeCheckoutUrl - Stripe payment link for clips (29.99€)
 * @param {string} opts.trollVideoPath - Full path to troll video (or null to use default in clipsDir)
 */
function createSharinganClipsGuard(opts = {}) {
  const {
    clipsDir = CLIPS_DIR,
    stripeCheckoutUrl = CHECKOUT_URL,
    trollVideoPath = null
  } = opts;

  const trollPath = trollVideoPath || path.join(clipsDir, TROLL_VIDEO);

  return function sharinganGuard(req, res, next) {
    // Internal services and authenticated users always pass, and they pass
    // BEFORE ripper detection: la chaine interne telecharge avec ffmpeg et
    // node-fetch, qui sont tous deux dans la liste des pirates. Detecter
    // d'abord revenait a servir la video troll a notre propre production.
    if (isInternalRequest(req)) return next();
    if (isAuthenticated(req)) return next();

    // Check for rippers → serve troll video
    if (isRipper(req)) {
      console.log(`[Sharingan] 🔴 Ripper detected: ${req.headers['user-agent']?.slice(0, 50)} → troll video`);
      return res.sendFile(trollPath, (err) => {
        if (err && !res.headersSent) {
          // If troll video doesn't exist, send a rickroll redirect
          res.redirect(302, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        }
      });
    }

    // Not authenticated, not internal, not a ripper → paywall
    // But allow preview (first 5 seconds) if they have a referer from funesterie
    const referer = req.headers['referer'] || '';
    if (referer.includes('funesterie.me') || referer.includes('funesterie.')) {
      // Allow streaming from our own site (the player is on our page)
      return next();
    }

    // External hotlink without auth → redirect to Stripe
    console.log(`[Sharingan] 💰 Paywall redirect: ${req.ip} → Stripe checkout`);
    return res.redirect(302, stripeCheckoutUrl);
  };
}

module.exports = { createSharinganClipsGuard, isRipper };
