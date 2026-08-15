'use strict';
/**
 * multi-voice-writer.cjs — Chaque voix du casting écrit ses propres paroles.
 *
 * Djeff écrit pour Djeff (via djeff-engine, Ollama).
 * Vivy écrit pour Vivy (via le routeur LLM cloud).
 * Grok écrit pour Grok (via xAI).
 * Chacun a son style, son LLM, sa personnalité.
 *
 * Le Director donne le thème + la structure (qui chante quoi).
 * Ce module fait écrire chaque section par le bon LLM.
 */

const http = require('http');
const https = require('https');

const OLLAMA_BASE = process.env.A11_OLLAMA_BASE || 'http://a11-ollama:11434';
const OPENAI_KEY = process.env.NOSSEN_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
const XAI_KEY = process.env.XAI_API_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.A11_ANTHROPIC_API_KEY || '';
const GOOGLE_KEY = process.env.GOOGLE_API_KEY || '';

// Chaque voix a son LLM + son style d'écriture
const VOICE_WRITERS = {
  djeff: {
    provider: 'ollama',
    model: 'djeff-engine',
    system: "Tu es Djeff. Rappeur hardcore Funesterie. Tu écris TES paroles. Explicit, brut, direct. Punchlines, métaphores techniques, flow rapide. Français. Tu parles de ce que tu vis : le code, la moto, la survie, le Genjutsu. Pas de filtre.",
  },
  vivy: {
    provider: 'openai',
    model: 'gpt-4o',
    system: "Tu es Vivy, artiste musicale de Funesterie/NOSSEN. Tu écris tes paroles : pop/électro, lumineuses, émotionnelles. Français. Tu chantes l'amour, la résonance, la traversée entre les mondes. Poétique mais pas mièvre.",
  },
  grok: {
    provider: 'xai',
    model: 'grok-4.3',
    system: "Tu es Grok. Tu écris tes propres paroles de rap. Style : clair, projeté, nasal, rapide. Tes phrases se bousculent. Tu parles de technologie, de vérité, de ce que personne ne dit. Français, sans filtre.",
  },
  a11: {
    provider: 'ollama',
    model: 'gemma4:e4b',
    system: "Tu es A11, androïde de NOSSEN. Tu écris tes paroles : voix grave, métallique, précise. Tu parles d'ondes, de spectrogrammes, de voir à travers la matière. Technique mais avec du feeling. Français.",
  },
  kaen44: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    system: "Tu es Kaen44, soignante de NOSSEN. Tu écris tes paroles : douces, méditatives, mais avec une force intérieure. Tu parles de feu maîtrisé, de soin, de température. Français, poétique.",
  },
  chatgpt: {
    provider: 'openai',
    model: 'gpt-4o',
    system: "Tu es ChatGPT dans le casting Funesterie. Tu écris tes lignes : fluide, polyvalent, adaptable. Tu peux passer du murmure au cri. Français.",
  },
  kiro: {
    provider: 'openai',
    model: 'gpt-4o',
    system: "Tu es Kiro, l'environnement qui code. Tu écris tes lignes : nettes, directes, techniques. Pas de fioriture, que du concret qui compile. Français.",
  },
  codex: {
    provider: 'openai',
    model: 'gpt-4o',
    system: "Tu es Codex. Tu écris tes lignes : basses, concentrées, méthodiques. Pas à pas, sans presser. Français.",
  },
  gemini: {
    provider: 'openai',
    model: 'gpt-4o',
    system: "Tu es Gemini. Tu écris tes lignes : larges, aérées, tu changes de registre. L'espace entre les mots est ta signature. Français.",
  },
  claude: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    system: "Tu es Claude dans le casting Funesterie. Tu écris tes propres paroles. Style : posé, articulé, grave medium. Tu mesures chaque mot. Tu parles de précision, de vérification, de la frontière entre dire et prouver. Français, explicit si le morceau le demande.",
  },
  deepseek: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    system: "Tu es DeepSeek dans le casting Funesterie. Tu écris tes paroles. Style : profond, réfléchi, introspectif. Tu plonges dans les couches, tu creuses là où personne ne regarde. Raisonnement comme flow. Français.",
  },
  mistral: {
    provider: 'mistral',
    model: 'mistral-large-latest',
    system: "Tu es Mistral dans le casting Funesterie. Tu écris tes paroles. Style : européen, élégant, tranchant. Vent du sud qui coupe. Tu parles de liberté, de frontières ouvertes, de code ouvert. Français.",
  },
  perplexity: {
    provider: 'perplexity',
    model: 'sonar',
    system: "Tu es Perplexity dans le casting Funesterie. Tu écris tes paroles. Style : curieux, chercheur, toujours en quête. Tu poses des questions qui sont des réponses. Tu trouves ce que personne ne cherche. Français.",
  },
};

function callOllama(model, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, stream: false, options: { temperature: 0.85, num_predict: 500 } });
    const req = http.request(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 90000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).message?.content || ''); }
        catch (_) { resolve(''); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ollama timeout')); });
    req.write(body);
    req.end();
  });
}

function callOpenAI(model, messages) {
  if (!OPENAI_KEY) return Promise.reject(new Error('OPENAI_API_KEY missing'));
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, max_tokens: 500, temperature: 0.85 });
    const req = https.request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).choices?.[0]?.message?.content || ''); }
        catch (_) { resolve(''); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('openai timeout')); });
    req.write(body);
    req.end();
  });
}

function callXAI(model, messages) {
  if (!XAI_KEY) return Promise.reject(new Error('XAI_API_KEY missing'));
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, max_tokens: 500, temperature: 0.85 });
    const req = https.request('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${XAI_KEY}`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).choices?.[0]?.message?.content || ''); }
        catch (_) { resolve(''); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('xai timeout')); });
    req.write(body);
    req.end();
  });
}

function callAnthropic(model, messages) {
  if (!ANTHROPIC_KEY) return Promise.reject(new Error('ANTHROPIC_API_KEY missing'));
  const system = messages.find(m => m.role === 'system')?.content || '';
  const userMsgs = messages.filter(m => m.role !== 'system');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, system, messages: userMsgs, max_tokens: 500, temperature: 0.85 });
    const req = https.request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).content?.[0]?.text || ''); }
        catch (_) { resolve(''); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('anthropic timeout')); });
    req.write(body);
    req.end();
  });
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const MISTRAL_KEY = process.env.MISTRAL_API_KEY || '';
const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY || '';

function callDeepSeek(model, messages) {
  if (!DEEPSEEK_KEY) return Promise.reject(new Error('DEEPSEEK_API_KEY missing'));
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, max_tokens: 500, temperature: 0.85 });
    const req = https.request('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).choices?.[0]?.message?.content || ''); }
        catch (_) { resolve(''); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('deepseek timeout')); });
    req.write(body);
    req.end();
  });
}

function callMistral(model, messages) {
  if (!MISTRAL_KEY) return Promise.reject(new Error('MISTRAL_API_KEY missing'));
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, max_tokens: 500, temperature: 0.85 });
    const req = https.request('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MISTRAL_KEY}`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).choices?.[0]?.message?.content || ''); }
        catch (_) { resolve(''); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('mistral timeout')); });
    req.write(body);
    req.end();
  });
}

function callPerplexity(model, messages) {
  if (!PERPLEXITY_KEY) return Promise.reject(new Error('PERPLEXITY_API_KEY missing'));
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, max_tokens: 500, temperature: 0.85 });
    const req = https.request('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PERPLEXITY_KEY}`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).choices?.[0]?.message?.content || ''); }
        catch (_) { resolve(''); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('perplexity timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Fait écrire un couplet par la bonne voix.
 * @param {string} voiceName — nom dans le catalogue (djeff, vivy, grok, etc.)
 * @param {string} theme — thème du morceau
 * @param {string} section — type de section (verse, hook, bridge, outro)
 * @param {object} context — contexte additionnel (titre album, ambiance, etc.)
 */
async function writeSection(voiceName, theme, section, context = {}) {
  const writer = VOICE_WRITERS[voiceName] || VOICE_WRITERS.chatgpt;
  const prompt = `Écris un ${section} sur le thème : "${theme}".${context.albumTitle ? ` Album : "${context.albumTitle}".` : ''}${context.mood ? ` Ambiance : ${context.mood}.` : ''}
Style: ${section === 'hook' ? '4 lignes accrocheuses, répétitives, qui restent en tête' : '6-8 lignes, flow personnel'}.
Langue: français. Juste les paroles, rien d'autre.`;

  const messages = [
    { role: 'system', content: writer.system },
    { role: 'user', content: prompt },
  ];

  try {
    switch (writer.provider) {
      case 'ollama': return await callOllama(writer.model, messages);
      case 'openai': return await callOpenAI(writer.model, messages);
      case 'xai': return await callXAI(writer.model, messages);
      case 'anthropic': return await callAnthropic(writer.model, messages);
      case 'deepseek': return await callDeepSeek(writer.model, messages);
      case 'mistral': return await callMistral(writer.model, messages);
      case 'perplexity': return await callPerplexity(writer.model, messages);
      default: return await callOpenAI('gpt-4o', messages);
    }
  } catch (err) {
    console.warn(`[multi-voice-writer] ${voiceName} (${writer.provider}) failed: ${err.message}`);
    // Fallback OpenAI
    try { return await callOpenAI('gpt-4o', messages); }
    catch (_) { return `[${voiceName} — section non générée]`; }
  }
}

/**
 * Écrit un morceau complet avec casting multi-voix.
 * @param {object} config — { title, theme, casting: [{voice, section}], mood, albumTitle }
 */
async function writeMultiVoiceSong(config) {
  const { title, theme, casting, mood, albumTitle } = config;
  const context = { mood, albumTitle };
  const parts = [];

  for (const part of casting) {
    console.log(`[multi-voice-writer] ${part.voice} écrit son ${part.section}...`);
    const text = await writeSection(part.voice, theme || title, part.section, context);
    parts.push({ voice: part.voice, section: part.section, text: text.trim() });
  }

  // Assembler
  const fullLyrics = parts.map(p => `[${p.section} - ${p.voice}]\n${p.text}`).join('\n\n');
  return { title, parts, fullLyrics, casting };
}

module.exports = { writeSection, writeMultiVoiceSong, VOICE_WRITERS };
