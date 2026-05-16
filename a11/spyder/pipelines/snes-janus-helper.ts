console.log("🧠 [G88 Janus Helper] Mode simple & standalone activé");
console.log("Appuie sur Entrée quand tu veux une analyse.\n");

import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function analyzeFrame() {
  console.log("\n📸 Janus regarde l'écran...");

  // Version standalone sans dépendance
  const suggestions = [
    "↓↘→ B → Plasma Laser (opportunité forte)",
    "Anti-air immédiat : ↓↓ A (Shadow Eye)",
    "Cyber Dash pour approcher →↓→ B",
    "Block + counter, il va lancer un ultra",
    "Prépare le No Mercy, il est en recovery"
  ];

  const random = suggestions[Math.floor(Math.random() * suggestions.length)];
  console.log(`🔴 Janus → ${random}`);
}

rl.on('line', () => {
  analyzeFrame();
});

console.log("Prêt. Appuie sur **Entrée** pour demander une analyse.");
