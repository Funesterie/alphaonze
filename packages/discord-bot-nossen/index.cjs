'use strict';
const crypto = require('crypto');
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || 'c3504be88063d2a89504a797210bbbe15632c55159c7c2dbf49a0990e38ec515';

function verifyDiscordSignature(rawBody, signature, timestamp) {
  try {
    const msg = Buffer.from(timestamp + rawBody);
    const sig = Buffer.from(signature, 'hex');
    const key = Buffer.from(DISCORD_PUBLIC_KEY, 'hex');
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]);
    const pubKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return crypto.verify(null, msg, pubKey, sig);
  } catch (e) { return false; }
}

/**
 * Envoie la demande de clip au backend, sans jamais faire tomber le serveur.
 *
 * L'ancienne version tenait sur une ligne :
 *   try { const r = http.request(...); r.write(pd); r.end(); } catch (e) {}
 *
 * Trois defauts empiles.
 *
 *   Aucun ecouteur 'error'. En Node, une requete HTTP qui echoue emet un
 *   evenement 'error'; sans ecouteur, c'est une exception non gerée qui TUE LE
 *   PROCESSUS. Le try/catch ne l'attrapait pas -- l'erreur est asynchrone, elle
 *   arrive apres la sortie du bloc. Backend arrete, un /clip sur Discord
 *   suffisait donc a abattre le serveur.
 *
 *   Aucune lecture de la reponse. Personne ne voyait le code HTTP, et le
 *   socket restait ouvert.
 *
 *   Aucune trace. Un echec ne laissait rien derriere lui.
 */
function lancerClip(charge) {
  const http = require('http');
  const url = process.env.NOSSEN_CLIP_START_URL || 'http://localhost:3000/api/mcp-bridge/clip/start';
  let req;
  try {
    req = http.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(charge) },
      timeout: 15000,
    }, (res) => {
      // On consomme le corps meme sans l'utiliser : sans ca le socket reste
      // ouvert et les demandes suivantes s'empilent.
      res.resume();
      if (res.statusCode >= 400) {
        console.warn(`[discord-bot] clip/start a repondu ${res.statusCode}`);
      }
    });
  } catch (e) {
    console.warn(`[discord-bot] clip/start injoignable : ${e.message}`);
    return;
  }
  req.on('error', (e) => console.warn(`[discord-bot] clip/start echec : ${e.code || e.message}`));
  req.on('timeout', () => { req.destroy(); console.warn('[discord-bot] clip/start delai depasse'); });
  req.write(charge);
  req.end();
}

function handleInteraction(body) {
  if (body.type === 1) return { type: 1 };
  if (body.type === 2) {
    const cmd = body.data?.name;
    const opts = {};
    for (const o of (body.data?.options || [])) opts[o.name] = o.value;
    if (cmd === 'clip') {
      const url = opts.url;
      if (!url) return { type: 4, data: { content: '❌ `/clip url:https://...mp3`' } };
      const pd = JSON.stringify({ songUrl: url, title: opts.title || 'discord-' + Date.now(), style: opts.style || 'anime cyberpunk neon', sections: [{ name: 'Intro', visual: 'neon city code rain', duration: 15 }, { name: 'Verse', visual: 'programmer holographic', duration: 20 }, { name: 'Chorus', visual: 'cosmic energy epic', duration: 25 }, { name: 'Bridge', visual: 'AI girl purple hair light orbs', duration: 20 }, { name: 'Finale', visual: 'duo rooftop stars neon', duration: 25 }] });
      lancerClip(pd);
      // « transmise », pas « lancée ». Discord exige une reponse en moins de
      // trois secondes, on ne peut donc PAS savoir ici si le rendu a demarre.
      // Annoncer un succes qu'on n'a pas verifie, c'est apprendre a l'utilisateur
      // a ne pas croire le bot le jour ou ca casse.
      return { type: 4, data: { content: '🎬 **Demande transmise** ⏳ 3-5 min si elle aboutit\n🎵 ' + url.slice(0, 60) } };
    }
    if (cmd === 'status') return { type: 4, data: { content: '🌀 NOSSEN OK\n🔗 https://a11.funesterie.me/nossen/' } };
    if (cmd === 'clips') return { type: 4, data: { content: '📁 https://a11.funesterie.me/nossen/' } };
    return { type: 4, data: { content: '❓ ' + cmd } };
  }
  return { type: 1 };
}

function mountDiscordRoutes(app) {
  function handler(req, res) {
    const rawBody = req.rawBody || '';
    const sig = req.headers['x-signature-ed25519'] || '';
    const ts = req.headers['x-signature-timestamp'] || '';
    if (!sig || !ts) return res.status(401).json({ error: 'Missing headers' });
    if (!rawBody) return res.status(400).json({ error: 'No body' });
    if (!verifyDiscordSignature(rawBody, sig, ts)) return res.status(401).json({ error: 'Bad signature' });
    try { res.json(handleInteraction(JSON.parse(rawBody))); }
    catch (e) { res.status(400).json({ error: e.message }); }
  }
  app.post('/nossen/', handler);
  app.post('/api/discord/interactions', handler);
  console.log('[discord-bot] NOSSEN mounted: POST /nossen/ + /api/discord/interactions');
}

module.exports = { mountDiscordRoutes, handleInteraction, verifyDiscordSignature };
