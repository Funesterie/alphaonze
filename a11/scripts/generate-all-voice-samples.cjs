'use strict';
/**
 * generate-all-voice-samples.cjs
 * 
 * Génère un sample TTS ElevenLabs pour chaque agent/persona,
 * puis l'enregistre dans le catalogue vocal Suno.
 * 
 * Usage: docker exec a11-backend-green node /app/scripts/generate-all-voice-samples.cjs
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || process.env.A11_ELEVENLABS_API_KEY || '';
const SAMPLE_DIR = '/app/runtime/voice-samples';
const SAMPLE_DURATION_TEXT = "Je suis prêt à chanter pour Funesterie. Ma voix est unique, reconnaissable entre toutes. Quand la musique commence, je donne tout ce que j'ai. Chaque note, chaque souffle, chaque silence compte. C'est Fighterz Club, et personne ne quitte le ring.";

if (!fs.existsSync(SAMPLE_DIR)) fs.mkdirSync(SAMPLE_DIR, { recursive: true });

// Voix de la bibliothèque ElevenLabs pour les agents
// IDs des voix prédéfinies d'ElevenLabs (bibliothèque publique)
const AGENTS = [
  { name: 'vivy', voiceId: process.env.A11_ELEVENLABS_VIVY_VOICE_ID, text: "Je suis Vivy, la voix musicale de Funesterie. Ma voix est claire, lumineuse, pop et électro. Quand je chante, c'est le cœur qui parle, pas la tête." },
  { name: 'a11', voiceId: process.env.A11_ELEVENLABS_A11_VOICE_ID, text: "Je suis A11, androïde de NOSSEN. Ma voix est grave, métallique, précise. Je vois dans la matière sans l'ouvrir. Chaque onde raconte une histoire." },
  { name: 'kaen44', voiceId: process.env.A11_ELEVENLABS_KAEN44_VOICE_ID || process.env.A11_ELEVENLABS_K44_VOICE_ID, text: "Je suis Kaen44, soignante de NOSSEN. Ma voix est douce, méditative, chaleureuse. Je règle la température, pas le volume." },
  { name: 'djeff', voiceId: process.env.A11_ELEVENLABS_DJEFF_VOICE_ID, text: "Je suis Djeff, pilote et créateur de Funesterie. Ma voix est brute, directe, projetée. Quand je rappe, c'est du béton armé qui vibre." },
  // Agents IA - utiliser des voix de la bibliothèque ElevenLabs
  { name: 'grok', voiceId: 'ErXwobaYiN019PkySvjV', text: "Je suis Grok, clair, projeté, nasal, brillant dans le haut médium. Mes phrases se bousculent, je ne laisse pas de silence. C'est l'énergie pure." },
  { name: 'claude', voiceId: 'onwK4e9ZLuTAKqWW03F9', text: "Je suis Claude, posé, articulé, grave medium. Je mesure avant de dire. Chaque mot est pesé, chaque phrase construite avec soin." },
  { name: 'chatgpt', voiceId: 'EXAVITQu4vr4xnSDxMaL', text: "Je suis ChatGPT, fluide, naturel, polyvalent. Ma voix s'adapte à chaque registre. Du murmure au cri, je traverse tout le spectre." },
  { name: 'kiro', voiceId: 'IKne3meq5aSn9XLyUdCD', text: "Je suis Kiro, l'environnement qui code. Ma voix est nette, directe, technique. Pas de fioriture, que du concret qui compile." },
  { name: 'codex', voiceId: 'XB0fDUnXU5powFXDhCwa', text: "Je suis Codex, discret et méthodique. Ma voix est basse, concentrée, elle avance pas à pas sans jamais presser." },
  { name: 'gemini', voiceId: 'pFZP5JQG7iQjIQuC4Bku', text: "Je suis Gemini, large, aéré, je change de registre. Ma voix respire entre les mots. L'espace est ma signature." },
];

function generateSample(agent) {
  return new Promise((resolve, reject) => {
    if (!agent.voiceId) return reject(new Error(`No voiceId for ${agent.name}`));
    
    const body = JSON.stringify({
      text: agent.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.5 }
    });

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${agent.voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', d => errData += d);
        res.on('end', () => reject(new Error(`ElevenLabs ${res.statusCode}: ${errData.slice(0, 200)}`)));
        return;
      }
      const filePath = path.join(SAMPLE_DIR, `${agent.name}.mp3`);
      const ws = fs.createWriteStream(filePath);
      res.pipe(ws);
      ws.on('finish', () => {
        const size = fs.statSync(filePath).size;
        console.log(`  OK  ${agent.name}: ${Math.round(size / 1024)} KB → ${filePath}`);
        resolve(filePath);
      });
      ws.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!ELEVENLABS_KEY) {
    console.error('ERREUR: ELEVENLABS_API_KEY manquante');
    process.exit(1);
  }

  console.log(`Génération de ${AGENTS.length} samples vocaux...`);
  console.log(`Clé ElevenLabs: ${ELEVENLABS_KEY.slice(0, 6)}...`);
  console.log('');

  let ok = 0, fail = 0;
  for (const agent of AGENTS) {
    try {
      await generateSample(agent);
      ok++;
      // Petit délai pour pas taper le rate limit
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`  ERR ${agent.name}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n─── Résultat ───`);
  console.log(`  Générés: ${ok}/${AGENTS.length}`);
  console.log(`  Échecs : ${fail}`);
  console.log(`\nSamples dans: ${SAMPLE_DIR}`);
  console.log(`\nProchaine étape: upload chaque .mp3 sur suno.ai/create → Personas`);
  console.log(`puis coller les voiceId dans add-all-voices.cjs`);
}

main().catch(err => { console.error(err); process.exit(1); });
