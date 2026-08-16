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

function handleInteraction(body) {
  if (body.type === 1) return { type: 1 };
  if (body.type === 2) {
    const cmd = body.data?.name;
    const opts = {};
    for (const o of (body.data?.options || [])) opts[o.name] = o.value;
    if (cmd === 'clip') {
      const url = opts.url;
      if (!url) return { type: 4, data: { content: '❌ `/clip url:https://...mp3`' } };
      const http = require('http');
      const pd = JSON.stringify({ songUrl: url, title: opts.title || 'discord-' + Date.now(), style: opts.style || 'anime cyberpunk neon', sections: [{ name: 'Intro', visual: 'neon city code rain', duration: 15 }, { name: 'Verse', visual: 'programmer holographic', duration: 20 }, { name: 'Chorus', visual: 'cosmic energy epic', duration: 25 }, { name: 'Bridge', visual: 'AI girl purple hair light orbs', duration: 20 }, { name: 'Finale', visual: 'duo rooftop stars neon', duration: 25 }] });
      try { const r = http.request('http://localhost:3000/api/mcp-bridge/clip/start', { method: 'POST', headers: { 'content-type': 'application/json' } }); r.write(pd); r.end(); } catch (e) {}
      return { type: 4, data: { content: '🎬 **Clip lancé!** ⏳ 3-5 min\n🎵 ' + url.slice(0, 60) } };
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
