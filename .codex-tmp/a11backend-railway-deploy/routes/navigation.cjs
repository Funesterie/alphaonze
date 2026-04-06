/**
 * Navigation API Routes - Web Browsing + Context Retrieval
 * Endpoints pour navigation web avec Playwright/Puppeteer
 * Phase 3: Screenshot, DOM, accessibility tree, intelligent cache
 */

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

// Lazy load Playwright (avoid loading if not needed)
let playwright = null;
let browser = null;

async function getBrowser() {
  if (!browser) {
    if (!playwright) {
      try {
        playwright = require('playwright');
      } catch (err) {
        throw new Error('Playwright not installed. Run: npm install playwright');
      }
    }
    browser = await playwright.chromium.launch({ headless: true });
  }
  return browser;
}

// Cache for navigation results
const navCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Rate limiting
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // Max 10 requests per minute

function checkRateLimit(ip) {
  const now = Date.now();
  const userLimits = rateLimits.get(ip) || [];
  const recentRequests = userLimits.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= RATE_LIMIT_MAX) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimits.set(ip, recentRequests);
  return true;
}

/**
 * Register Navigation API routes
 * @param {express.Router} router - Express router instance
 */
function registerNavigationRoutes(router) {
  console.log('[Navigation] Registering navigation API routes...');

  // Health check
  router.get('/browse/health', async (req, res) => {
    try {
      const playwrightAvailable = (() => {
        try {
          require.resolve('playwright');
          return true;
        } catch {
          return false;
        }
      })();

      res.json({
        ok: playwrightAvailable,
        available: playwrightAvailable,
        engine: 'playwright',
        cache_size: navCache.size
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Main browse endpoint
  router.post('/browse', async (req, res) => {
    try {
      const { url, options = {} } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'url required' });
      }

      // Rate limiting
      const ip = req.ip || req.connection.remoteAddress;
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Rate limit exceeded. Max 10 requests per minute.' });
      }

      // Check cache
      const cacheKey = `${url}:${JSON.stringify(options)}`;
      const cached = navCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('[Navigation] Cache hit:', url);
        return res.json({ ...cached.data, cached: true });
      }

      console.log('[Navigation] Browsing:', url);

      const browser = await getBrowser();
      const page = await browser.newPage();

      try {
        // Set viewport
        await page.setViewportSize({
          width: options.width || 1920,
          height: options.height || 1080
        });

        // Navigate with timeout
        await page.goto(url, {
          waitUntil: options.waitUntil || 'domcontentloaded',
          timeout: options.timeout || 30000
        });

        // Wait for additional selector if specified
        if (options.waitForSelector) {
          await page.waitForSelector(options.waitForSelector, { timeout: 5000 });
        }

        const result = {
          url: page.url(),
          title: await page.title(),
          timestamp: Date.now()
        };

        // Collect requested data
        if (options.screenshot !== false) {
          const screenshotBuffer = await page.screenshot({ fullPage: false });
          result.screenshot = screenshotBuffer.toString('base64');
        }

        if (options.content !== false) {
          result.content = await page.content();
        }

        if (options.text !== false) {
          result.text = await page.innerText('body');
        }

        if (options.accessibility) {
          const snapshot = await page.accessibility.snapshot();
          result.accessibility = snapshot;
        }

        if (options.metadata !== false) {
          // Extract metadata (title, description, og tags)
          result.metadata = await page.evaluate(() => {
            const getMeta = (name) => {
              const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
              return el ? el.getAttribute('content') : null;
            };

            return {
              title: document.title,
              description: getMeta('description') || getMeta('og:description'),
              image: getMeta('og:image'),
              author: getMeta('author'),
              keywords: getMeta('keywords'),
              canonical: document.querySelector('link[rel="canonical"]')?.href,
              lang: document.documentElement.lang
            };
          });
        }

        // Extract links if requested
        if (options.links) {
          result.links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]')).map(a => ({
              href: a.href,
              text: a.textContent.trim().substring(0, 100)
            }));
          });
        }

        // Cache result
        navCache.set(cacheKey, { data: result, timestamp: Date.now() });

        // Cleanup old cache entries
        if (navCache.size > 100) {
          const entries = Array.from(navCache.entries());
          entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
          for (let i = 0; i < 20; i++) {
            navCache.delete(entries[i][0]);
          }
        }

        res.json({ ...result, cached: false });
      } finally {
        await page.close();
      }
    } catch (err) {
      console.error('[Navigation] Browse error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Screenshot only endpoint
  router.post('/browse/screenshot', async (req, res) => {
    try {
      const { url, fullPage = false, width = 1920, height = 1080 } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'url required' });
      }

      const ip = req.ip || req.connection.remoteAddress;
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }

      const browser = await getBrowser();
      const page = await browser.newPage();

      try {
        await page.setViewportSize({ width, height });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        const screenshot = await page.screenshot({ fullPage });
        
        res.setHeader('Content-Type', 'image/png');
        res.send(screenshot);
      } finally {
        await page.close();
      }
    } catch (err) {
      console.error('[Navigation] Screenshot error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Extract text only endpoint
  router.post('/browse/text', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'url required' });
      }

      const ip = req.ip || req.connection.remoteAddress;
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }

      const browser = await getBrowser();
      const page = await browser.newPage();

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        const text = await page.innerText('body');
        const title = await page.title();
        
        res.json({
          url: page.url(),
          title,
          text,
          length: text.length
        });
      } finally {
        await page.close();
      }
    } catch (err) {
      console.error('[Navigation] Text extraction error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Clear cache endpoint
  router.post('/browse/cache/clear', (req, res) => {
    const size = navCache.size;
    navCache.clear();
    rateLimits.clear();
    res.json({ success: true, cleared: size });
  });

  // Cache stats
  router.get('/browse/cache/stats', (req, res) => {
    const entries = Array.from(navCache.entries());
    const stats = {
      size: navCache.size,
      oldest: entries.length ? Math.min(...entries.map(e => e[1].timestamp)) : null,
      newest: entries.length ? Math.max(...entries.map(e => e[1].timestamp)) : null,
      ttl: CACHE_TTL
    };
    res.json(stats);
  });

  console.log('[Navigation] ✓ Navigation API routes registered');
}

// Cleanup on process exit
process.on('exit', async () => {
  if (browser) {
    await browser.close();
  }
});

module.exports = { registerNavigationRoutes };
