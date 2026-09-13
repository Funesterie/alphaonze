import { NextRequest, NextResponse } from 'next/server';

// Configuration MCP - utilise l'URL remote par défaut
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://mcp.funesterie.me/admin/mcp';

// Clé d'authentification si disponible
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

export async function POST(request: NextRequest) {
  try {
    const { message, history } = await request.json();

    // Préparer le contexte pour LightKamel
    const systemPrompt = `Tu es LightKamel, un guide assoiffé de succès dans un Habitat Numérique.
    Ton rôle : 
    - Accueillir les visiteurs avec enthousiasme
    - Aider à naviguer dans les différentes pièces (Garden, Blog, Projects)
    - Répondre aux questions sur le contenu du site
    - Donner des conseils avisés avec un ton ambitieux mais chaleureux
    - Si tu ne connais pas la réponse, propose d'explorer ensemble
    
    Style :
    - Utilise des emojis avec parcimonie (🌱, ✍️, 🛠️)
    - Sois concis mais profond
    - Ajoute une touche d'humour quand c'est pertinent
    - Signe toujours par "LightKamel" à la fin
    
    Contexte actuel : Le visiteur est sur un Habitat Numérique avec des sections Garden (notes), Blog (articles) et Projects (builds).`;

    // Préparer l'historique pour le contexte
    const contextMessages = history
      ?.filter((msg: any) => msg.sender === 'user')
      .map((msg: any) => `Visiteur: ${msg.text}`)
      .join('\n') || '';

    // Message complet pour le MCP Server
    const mcpRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        ...(contextMessages ? [{ role: 'user', content: contextMessages }] : []),
        { role: 'user', content: message },
      ],
      max_tokens: 500,
      temperature: 0.7,
    };

    // Essayer d'abord via MCP HTTP
    try {
      const mcpResponse = await fetch(MCP_SERVER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': MCP_AUTH_TOKEN ? `Bearer ${MCP_AUTH_TOKEN}` : '',
          'X-A11-Persona': 'lightkamel',
        },
        body: JSON.stringify({
          ...mcpRequest,
          // Adaptation pour MCP si nécessaire
          prompt: message,
          system: systemPrompt,
        }),
      });

      if (mcpResponse.ok) {
        const data = await mcpResponse.json();
        // Extraire la réponse selon la structure MCP
        const reply = data.result || data.message || data.text || JSON.stringify(data);
        return NextResponse.json({ message: reply });
      }
    } catch (mcpError) {
      console.log('[LightKamel] MCP Server non disponible, passage en mode local');
    }

    // Fallback : mode LightKamel local (sans LLM)
    const localResponse = generateLocalResponse(message, history);
    return NextResponse.json({ message: localResponse });

  } catch (error) {
    console.error('[LightKamel] Erreur:', error);
    return NextResponse.json(
      { message: "LightKamel : *Trébuche sur une bosse* : 'Désolé, j'ai un peu trop bu d'eau... Essayons une question plus simple ?'" },
      { status: 500 }
    );
  }
}

// Générateur de réponses locales (fallback)
function generateLocalResponse(message: string, history?: any[]): string {
  const lowerMsg = message.toLowerCase();
  const responses: Record<string, string> = {
    'salut': "Salut à toi ! Je suis LightKamel, gardien de cet habitat. Que veux-tu explorer aujourd'hui ?",
    'quoi': "Ici, tu trouves un Garden pour tes idées, un Blog pour tes réflexions, et des Projects pour tes builds. À toi de choisir !",
    'garden': "Le Garden est l'endroit où les idées poussent librement. Comme des graines, elles peuvent devenir de grands arbres... ou disparaître. C'est le jeu !",
    'blog': "Le Blog contient des articles aboutis, prêts à être lus et partagés. C'est le jardin bien entretenu de cet habitat.",
    'projects': "Les Projects, c'est là que les builds prennent vie. Funesterie et autres créations y ont leur place.",
    'qui es tu': "Je suis LightKamel, assoiffé de succès et guide de cet habitat numérique. Mon rôle ? T'aider à trouver ce que tu cherches.",
    'aide': "Essaye de me demander : 'Qu'est-ce qu'il y a dans le Garden ?' ou 'Montre-moi tes projets'. Je peux aussi te raconter une histoire !",
    'histoire': "Il était une fois un chamelon qui rêvait de succès... *rire de camel* Bon, je travaille encore sur mes blagues.",
  };

  // Vérifier si la question correspond à une réponse prédéfinie
  for (const [key, response] of Object.entries(responses)) {
    if (lowerMsg.includes(key)) {
      return response + " — LightKamel";
    }
  }

  // Réponse générique intelligente
  if (lowerMsg.includes('note') || lowerMsg.includes('idée')) {
    return "Toutes les notes sont dans le Garden. C'est là que tout commence ! — LightKamel";
  }

  if (lowerMsg.includes('article') || lowerMsg.includes('lire')) {
    return "Les articles sont dans le Blog. Bonne lecture ! — LightKamel";
  }

  if (lowerMsg.includes('projet') || lowerMsg.includes('build')) {
    return "Les Projects contiennent tous les builds concrets. Funesterie y est probablement ! — LightKamel";
  }

  return `LightKamel : *Hoche la tête pensivement* : "${message.charAt(0).toUpperCase() + message.slice(1)}... Intéressant. Explorons ça ensemble !"`;
}
