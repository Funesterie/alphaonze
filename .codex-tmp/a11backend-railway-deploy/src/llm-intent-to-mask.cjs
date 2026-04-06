// apps/server/src/llm-intent-to-mask.cjs
// LLM intent resolver + MASK builder
// Utilise le LLM pour transformer un texte utilisateur en MASK canonique

const { callOpenAI } = require('./routes/llm-openai.js'); // à adapter si besoin

const SYSTEM_PROMPT = `
Tu es un moteur d’intention pour une IA multimodale.
À partir d’un texte utilisateur, tu dois :
- Déterminer l’intention réelle (même si le verbe est ambigu)
- Choisir UNE intent canonique parmi :
    - image.generate
    - code.generate
    - text.answer
    - action.run
- Générer un objet MASK strictement conforme au schéma suivant :
{
  "intent": "image.generate",
  "inputs": {
    "prompt": "un carambar"
  }
}
- Ne jamais répondre en texte libre, toujours en JSON strict.
- Si tu ne comprends pas, produis une erreur explicite dans le champ error.

Exemples :
"affiche moi un carambar" => { "intent": "image.generate", "inputs": { "prompt": "un carambar" } }
"écris une fonction qui trie un tableau" => { "intent": "code.generate", "inputs": { "prompt": "fonction qui trie un tableau" } }
"quelle est la capitale du Pérou ?" => { "intent": "text.answer", "inputs": { "prompt": "quelle est la capitale du Pérou ?" } }
`;

async function llmIntentToMask(userText) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userText }
  ];
  const response = await callOpenAI({ messages, temperature: 0 });
  let mask;
  try {
    mask = JSON.parse(response.content || response);
  } catch (e) {
    return { error: 'Invalid JSON from LLM', raw: response };
  }
  return mask;
}

module.exports = llmIntentToMask;
