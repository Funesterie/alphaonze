// src/cortex/resonnance.ts
import { startCortexListener } from './listener.js';

export async function resonnance() {
  // Tu peux logger un petit rituel SPYDER ici 😈
  console.log('[CORTEX] Résonnance SPYDER activée…');
  console.log('[CORTEX] En attente de paquets (enable-spyder, cortex-packet, etc.)');

  await startCortexListener();
}
