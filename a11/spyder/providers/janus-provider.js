import { LlamaProClient } from "../core/llm-providers.js";

export const janus = new LlamaProClient({
  apiKey: process.env.LLAMA_API_KEY_JANUS,
  model: "llama-3.2-vision:11b",
  temperature: 0.3,
  systemPrompt: "Tu es Janus, un expert en analyse de frames Killer Instinct SNES. Tu es ultra-précis, rapide et agressif."
});

export async function analyzeFrame(base64Image, context = {}) {
  return janus.vision({
    image: base64Image,
    prompt: `Analyse cette frame de Killer Instinct.
Personnage principal : Fulgore
Contexte : ${context.mode || 'aggressive'}
Retourne uniquement du JSON valide :
{
  "situation": "advantage | neutral | danger",
  "bestMove": { "name": "Plasma Laser", "command": "↓↘→ B", "confidence": 85 },
  "reason": "explication courte"
}`
  });
}
