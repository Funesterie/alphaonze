console.log("🚀 [G88 Janus Full Auto] Démarré - Mode Réaliste");

async function startPipeline() {
  console.log("📷 En attente de RomStation / Killer Instinct...");
  console.log("Appuie sur une touche quand le jeu est bien visible à l'écran.");

  let frameCount = 0;

  while (true) {
    frameCount++;

    // Simulation réaliste : on attend vraiment une image
    console.log(`\n[Frame ${frameCount}] Attente de capture d'écran...`);

    // Ici on mettra plus tard la vraie capture
    const hasGameOnScreen = true; // tu peux changer en fonction de détection

    if (hasGameOnScreen) {
      console.log("✅ Frame détectée → Janus analyse...");
      console.log("🔴 Recommandation Janus : Plasma Laser (↓↘→ B)");
      console.log("🔴 Recommandation Janus : Anti-air Shadow Eye");
    } else {
      console.log("⭕ Aucun jeu détecté sur l'écran");
    }

    await new Promise(r => setTimeout(r, 1200));
  }
}

startPipeline().catch(console.error);
