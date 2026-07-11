/**
 * Pulsar Mine — document_start content script
 * 
 * Le champ de mines. Intercepte et neutralise les scripts avant qu'ils
 * puissent ouvrir des popups, tracker, ou injecter du contenu intrusif.
 * Utilise des patterns sémantiques pour détecter et désactiver.
 */

'use strict';

(function() {
  const PULSAR_VERSION = '5.0.0';
  let blockedCount = 0;
  const blockedLog = [];

  // ─── Patterns sémantiques : les "signaux neuronaux" à neutraliser ──────
  const SEMANTIC_PATTERNS = {
    // Popups forcés via window.open
    forcedPopups: [
      /window\.open\s*\(/gi,
      /document\.write\s*\(.*window\.open/gi,
      /location\.href\s*=\s*["']https?:\/\//gi,
      /location\.replace\s*\(/gi,
      /top\.location\s*=/gi,
    ],
    // Réseaux publicitaires
    adNetworks: [
      /googletag|googlesyndication|doubleclick/i,
      /adservice|adnxs|adsrvr|adroll|taboola|outbrain/i,
      /amazon-adsystem|adsystem|adsafeprotected/i,
      /criteo|scorecardresearch|quantserve|chartbeat/i,
      /popads|popcash|propellerads|popmyads/i,
      /ad-maven|adcash|adsterra|hilltopads/i,
    ],
    // Trackers
    trackers: [
      /google-analytics|hotjar|mixpanel|segment\.io/i,
      /facebook\.net\/.*tr|connect\.facebook\.net/i,
      /clarity\.ms|sentry\.io|amplitude\.com/i,
      /fullstory|mouseflow|luckycmp/i,
    ],
    // Scripts de redirection forcée
    forcedRedirects: [
      /window\.location\s*=\s*["']https?:\/\//gi,
      /document\.location\.href\s*=/gi,
      /meta.*http-equiv.*refresh.*url=/gi,
    ],
    // Overlays modaux forcés
    forcedOverlays: [
      /document\.createElement\s*\(\s*['"]iframe['"]\s*\)/gi,
      /\.style\.display\s*=\s*['"]block['"]/gi,
      /\.classList\.add\s*\(\s*['"]modal['"]\s*\)/gi,
    ],
  };

  // ─── Mines : interceptions au niveau du DOM ─────────────────────────────

  // Mine 1 : Neutraliser window.open
  const originalOpen = window.open;
  window.open = function(url, target, features) {
    // Permettre les opens déclenchés par clic utilisateur
    if (window.event && window.event.isTrusted) {
      return originalOpen.call(this, url, target, features);
    }
    blockedCount++;
    blockedLog.push({ type: 'window.open', url: String(url || '').slice(0, 100), time: Date.now() });
    console.log('[Pulsar] window.open neutralisé:', String(url || '').slice(0, 60));
    return null;
  };

  // Mine 2 : Neutraliser les redirections forcées
  const originalLocation = window.location;
  let redirectGuard = false;
  const guardLocation = (original, prop) => {
    return function(...args) {
      const value = args[0];
      if (typeof value === 'string' && value.startsWith('http') && !redirectGuard) {
        // Permettre si c'est une navigation utilisateur
        if (window.event && window.event.isTrusted) {
          return original.apply(this, args);
        }
        blockedCount++;
        blockedLog.push({ type: 'redirect', url: value.slice(0, 100), time: Date.now() });
        console.log('[Pulsar] Redirection neutralisée:', value.slice(0, 60));
        return;
      }
      return original.apply(this, args);
    };
  };

  // Mine 3 : Intercepter document.write (souvent utilisé pour injecter des pubs)
  const originalWrite = document.write;
  document.write = function(content) {
    const str = String(content || '');
    const hasAd = SEMANTIC_PATTERNS.adNetworks.some(p => p.test(str));
    const hasPopup = SEMANTIC_PATTERNS.forcedPopups.some(p => p.test(str));
    if (hasAd || hasPopup) {
      blockedCount++;
      blockedLog.push({ type: 'document.write', snippet: str.slice(0, 80), time: Date.now() });
      console.log('[Pulsar] document.write neutralisé (ad/popup détecté)');
      return;
    }
    return originalWrite.call(this, content);
  };

  // Mine 4 : Intercepter createElement('iframe') et createElement('script')
  const originalCreate = document.createElement;
  document.createElement = function(tag) {
    const el = originalCreate.call(this, tag);
    if (typeof tag === 'string') {
      const lower = tag.toLowerCase();
      if (lower === 'iframe') {
        // Surveiller le src de l'iframe
        const originalSetAttribute = el.setAttribute.bind(el);
        el.setAttribute = function(name, value) {
          if (name === 'src' && typeof value === 'string') {
            const isAd = SEMANTIC_PATTERNS.adNetworks.some(p => p.test(value));
            const isTracker = SEMANTIC_PATTERNS.trackers.some(p => p.test(value));
            if (isAd || isTracker) {
              blockedCount++;
              blockedLog.push({ type: 'iframe-ad', url: value.slice(0, 80), time: Date.now() });
              console.log('[Pulsar] iframe publicitaire neutralisée:', value.slice(0, 60));
              return;
            }
          }
          return originalSetAttribute(name, value);
        };
      }
      if (lower === 'script') {
        const originalSetAttribute = el.setAttribute.bind(el);
        el.setAttribute = function(name, value) {
          if (name === 'src' && typeof value === 'string') {
            const isAd = SEMANTIC_PATTERNS.adNetworks.some(p => p.test(value));
            const isTracker = SEMANTIC_PATTERNS.trackers.some(p => p.test(value));
            const isPopup = SEMANTIC_PATTERNS.forcedPopups.some(p => p.test(value));
            if (isAd || isTracker || isPopup) {
              blockedCount++;
              blockedLog.push({ type: 'script-block', url: value.slice(0, 80), time: Date.now() });
              console.log('[Pulsar] script neutralisé:', value.slice(0, 60));
              return;
            }
          }
          return originalSetAttribute(name, value);
        };
      }
    }
    return el;
  };

  // Mine 5 : Intercepter fetch/XMLHttpRequest vers des domaines publicitaires
  const originalFetch = window.fetch;
  window.fetch = function(url, opts) {
    const urlStr = String(url || '');
    const isAd = SEMANTIC_PATTERNS.adNetworks.some(p => p.test(urlStr));
    const isTracker = SEMANTIC_PATTERNS.trackers.some(p => p.test(urlStr));
    if (isAd || isTracker) {
      blockedCount++;
      blockedLog.push({ type: 'fetch-block', url: urlStr.slice(0, 80), time: Date.now() });
      console.log('[Pulsar] fetch neutralisé:', urlStr.slice(0, 60));
      return Promise.reject(new Error('Pulsar: blocked'));
    }
    return originalFetch.apply(this, arguments);
  };

  // ─── Exposer le compteur pour le popup et le sweeper ───────────────────
  window.__pulsarMinefield = {
    version: PULSAR_VERSION,
    getBlocked: () => blockedCount,
    getLog: () => blockedLog,
    reset: () => { blockedCount = 0; blockedLog.length = 0; },
  };

  console.log(`[Pulsar] Champ de mines déployé v${PULSAR_VERSION} — ${SEMANTIC_PATTERNS.adNetworks.length} réseaux pub, ${SEMANTIC_PATTERNS.trackers.length} trackers, ${SEMANTIC_PATTERNS.forcedPopups.length} patterns popup`);
})();
