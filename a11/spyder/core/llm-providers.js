export class LlamaProClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.model = config.model || "llama-3.2-vision:11b";
    this.systemPrompt = config.systemPrompt;
  }

  async vision({ image, prompt }) {
    console.log(`[Janus Vision] Analyse en cours avec ${this.model}...`);

    // Simulation pour le moment (on branchera la vraie API après)
    return {
      situation: "advantage",
      bestMove: {
        name: "Plasma Laser",
        command: "↓↘→ B",
        confidence: 78
      },
      reason: "Adversaire en recovery, opportunité laser parfaite."
    };
  }
}

export const janus = new LlamaProClient({
  apiKey: process.env.LLAMA_API_KEY_JANUS,
  model: "llama-3.2-vision:11b"
});
