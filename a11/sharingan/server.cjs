'use strict';
/**
 * sharingan-genjutsu — Défense anti-piratage de trafic Funesterie.
 *
 * Si un concurrent détourne nos redirections, ce serveur capte le trafic
 * et retourne la situation : Djeff freestyle sur le thème du piratage,
 * ridiculise le concurrent, et éduque le visiteur.
 *
 * Déployé sur Render. Chaque "attaque" = un nouveau morceau de Djeff dans la jukebox.
 *
 * Flow :
 *   1. Le concurrent redirige vers nous (ou on claim le domaine qu'il visait)
 *   2. Le visiteur arrive sur notre faux frontend (imite le style du concurrent)
 *   3. On détecte le referer/origin du piratage
 *   4. Djeff génère un freestyle sur le thème (via API A11)
 *   5. Le visiteur entend Djeff le retourner, puis est redirigé vers le vrai Funesterie
 *   6. Le morceau est archivé dans la jukebox des trolls
 */

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const A11_BASE = process.env.A11_BASE_URL || 'https://a11.funesterie.me';
const DJEFF_VOICE_ID = '7c84e0c86813bf2e74610cf4b34ccc04';
const JUKEBOX_FILE = path.join(__dirname, 'jukebox.json');

// ─── Jukebox des trolls ─────────────────────────────────────────────────────
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
  jukebox.tracks = jukebox.tracks.slice(0, 100); // garder 100 max
  jukebox.totalPirates++;
  saveJukebox(jukebox);
  return jukebox;
}

// ─── Détection du pirate ────────────────────────────────────────────────────
function detectPirate(req) {
  const referer = req.headers.referer || req.headers.referrer || '';
  const origin = req.headers.origin || '';
  const query = req.query.from || req.query.ref || req.query.utm_source || '';
  const host = req.headers.host || '';

  // Extraire le nom du site pirate
  let pirateName = 'inconnu';
  let pirateUrl = '';
  for (const src of [referer, origin, query]) {
    if (src && src.includes('.')) {
      try {
        const u = new URL(src.startsWith('http') ? src : `https://${src}`);
        pirateName = u.hostname.replace('www.', '').split('.')[0];
        pirateUrl = u.href;
        break;
      } catch (_) {}
    }
  }

  // Détecter le thème de l'arnaque depuis l'URL
  const requestPath = req.path.toLowerCase();
  let theme = 'musique IA générative';
  if (requestPath.includes('music') || requestPath.includes('song')) theme = 'musique IA';
  if (requestPath.includes('voice') || requestPath.includes('vocal')) theme = 'clonage vocal';
  if (requestPath.includes('beat') || requestPath.includes('produce')) theme = 'production musicale';
  if (requestPath.includes('ai') || requestPath.includes('generate')) theme = 'IA générative';
  if (requestPath.includes('free') || requestPath.includes('trial')) theme = 'essai gratuit bidon';

  return { pirateName, pirateUrl, theme, referer, path: req.path, ip: req.ip, timestamp: new Date().toISOString() };
}

// ─── Génération du freestyle Djeff ──────────────────────────────────────────
function buildFreestylePrompt(pirate) {
  return `[Djeff Engine freestyle — thème: ${pirate.theme}]

Un site appelé "${pirate.pirateName}" essaie de piquer le trafic de Funesterie.
Ils redirigent les gens vers eux en se faisant passer pour nous.
Écris un couplet de 8 lignes MAXIMUM, style rap freestyle agressif.
Retourne la situation : moque leur service, expose l'arnaque, et dis aux gens de venir sur le vrai funesterie.me.
En français, direct, drôle, méchant. Pas de censure.
Le referer était: ${pirate.pirateUrl || pirate.referer || 'caché (lâche)'}
Thème qu'ils prétendent offrir: ${pirate.theme}

FORMAT: juste les paroles, 8 lignes max, rien d'autre.`;
}

async function generateFreestyle(pirate) {
  // Appeler le LLM local via A11 pour écrire les paroles
  try {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: buildFreestylePrompt(pirate) }],
      model: 'djeff-engine',
      stream: false,
    });

    const res = await fetch(`${A11_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-service': 'sharingan' },
      body,
      signal: AbortSignal.timeout(30000),
    }).then(r => r.json()).catch(() => null);

    if (res?.choices?.[0]?.message?.content) return res.choices[0].message.content;
    if (res?.content) return res.content;
    if (res?.message?.content) return res.message.content;
  } catch (_) {}

  // Fallback : paroles génériques
  return `Yo ${pirate.pirateName}, tu croyais nous piquer le game ?
T'es même pas un site, t'es un lien cassé sans âme.
Funesterie c'est du vrai, toi c'est du copier-coller,
Djeff Engine te retourne avant que tu puisses exister.
Tes users cherchaient du son, ils ont trouvé du carton,
Moi je suis là avec le V11, toi t'as un WordPress gratuit en promotion.
Retourne d'où tu viens, le sous-sol du web poubelle,
Et dis à tes 3 visiteurs que Funesterie c'est la mère de la clientèle.`;
}

// ─── Pages ──────────────────────────────────────────────────────────────────
function buildTrapPage(pirate, lyrics, trackUrl) {
  const jukebox = loadJukebox();
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NOSSEN — ${pirate.theme}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a12;color:#eee;font-family:system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
.trap{max-width:600px;text-align:center}
h1{font-size:2rem;background:linear-gradient(135deg,#7b2ff7,#f72585);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem}
.lyrics{background:#111119;border:1px solid rgba(123,47,247,.3);border-radius:12px;padding:1.5rem;margin:1.5rem 0;text-align:left;white-space:pre-line;font-size:.9rem;line-height:1.6;color:#f0c0ff}
.meta{color:#777;font-size:.7rem;margin:1rem 0}
.btn{display:inline-block;padding:.8rem 2rem;background:linear-gradient(135deg,#7b2ff7,#f72585);color:#fff;text-decoration:none;border-radius:8px;font-weight:700;margin-top:1rem;transition:transform .2s}
.btn:hover{transform:scale(1.05)}
audio{width:100%;margin:1rem 0;border-radius:8px}
.jukebox{margin-top:2rem;width:100%;max-width:600px}
.jukebox h2{font-size:1rem;color:#7b2ff7;margin-bottom:.5rem}
.jk-track{background:#111119;padding:.5rem 1rem;margin:.3rem 0;border-radius:6px;font-size:.75rem;color:#999}
.warning{background:rgba(247,37,133,.1);border:1px solid rgba(247,37,133,.3);border-radius:8px;padding:1rem;margin:1rem 0;font-size:.8rem;color:#f72585}
</style>
</head>
<body>
<div class="trap">
<h1>SHARINGAN GENJUTSU</h1>
<p>Tu croyais être sur <strong>${pirate.pirateName}</strong> ?</p>
<p style="margin-top:.5rem;color:#777">Non. Tu es chez Funesterie. Et Djeff a un message pour toi.</p>

<div class="lyrics">${lyrics}</div>

${trackUrl ? `<audio controls autoplay src="${trackUrl}"></audio>` : ''}

<div class="warning">
  ⚠️ Le site <strong>${pirate.pirateName}</strong> a tenté de détourner notre trafic.<br>
  Ce que tu viens d'entendre est un freestyle généré automatiquement par Djeff Engine.<br>
  Chaque tentative de piratage = un nouveau morceau dans la jukebox.
</div>

<a href="https://funesterie.me" class="btn">→ Le vrai Funesterie</a>
<a href="https://vivy.funesterie.me" class="btn" style="background:linear-gradient(135deg,#00f5d4,#7b2ff7)">→ Écouter Vivy</a>

<div class="meta">
  Pirate détecté: ${pirate.pirateName} | Thème: ${pirate.theme}<br>
  ${pirate.timestamp} | Troll #${jukebox.totalPirates + 1}
</div>
</div>

${jukebox.tracks.length > 0 ? `
<div class="jukebox">
  <h2>🎵 Jukebox des pirates (${jukebox.tracks.length} trolls)</h2>
  ${jukebox.tracks.slice(0, 10).map(t => `<div class="jk-track">🏴‍☠️ ${t.pirateName} — "${t.theme}" — ${t.timestamp.slice(0, 10)}</div>`).join('')}
</div>` : ''}

</body>
</html>`;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Tout trafic entrant = piège
app.use(async (req, res, next) => {
  // Health check pour Render
  if (req.path === '/health' || req.path === '/_health') {
    return res.json({ ok: true, service: 'sharingan-genjutsu', trolls: loadJukebox().totalPirates });
  }

  // API jukebox
  if (req.path === '/jukebox') {
    return res.json(loadJukebox());
  }

  // Toute autre requête = piège activé
  const pirate = detectPirate(req);
  console.log(`[SHARINGAN] Piège activé — pirate: ${pirate.pirateName} | thème: ${pirate.theme} | path: ${pirate.path}`);

  // Générer le freestyle
  const lyrics = await generateFreestyle(pirate);

  // TODO: générer le son via Suno (pour l'instant juste les paroles)
  const trackUrl = null;

  // Archiver dans la jukebox
  addToJukebox({
    pirateName: pirate.pirateName,
    pirateUrl: pirate.pirateUrl,
    theme: pirate.theme,
    lyrics: lyrics.slice(0, 500),
    timestamp: pirate.timestamp,
    trackUrl,
  });

  // Servir la page piège
  const html = buildTrapPage(pirate, lyrics, trackUrl);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`[SHARINGAN] Genjutsu actif sur :${PORT}`);
  console.log(`[SHARINGAN] Toute requête = piège + freestyle Djeff`);
  console.log(`[SHARINGAN] Jukebox: ${loadJukebox().totalPirates} trolls archivés`);
});
