'use strict';
// Patch server.cjs to inject the clips route with the Sharingan guard.
//
// Ce fichier contenait auparavant une copie complete de la route, en chaine de
// caracteres. Elle avait diverge de clips-addon.cjs sur trois points: le dossier
// des clips (l'ancien chemin d'avant le volume partage), l'URL de paiement
// Stripe, et l'ordre des controles (la detection de rippers passait avant la
// reconnaissance des appels internes, donc notre propre chaine recevait la video
// troll). On injecte desormais un appel au module unique plutot qu'une copie.
const fs = require('fs');
const file = '/app/server.cjs';
let code = fs.readFileSync(file, 'utf8');

if (code.includes('clips-addon.cjs') || code.includes('/clips/:filename')) {
  console.log('Clips route already present, skipping');
  process.exit(0);
}

const CLIPS_ROUTE = `
// --- NOSSEN: Route /clips/:filename avec Sharingan Guard ---
try { require('./clips-addon.cjs')(app); } catch (e) { console.warn('[clips-addon]', e.message); }
`;

// Insert before the try { const HOST line
const insertBefore = '  try {\n    const HOST = resolveBindHost';
const idx = code.indexOf(insertBefore);
if (idx === -1) {
  console.error('Could not find insertion point');
  process.exit(1);
}
code = code.slice(0, idx) + CLIPS_ROUTE + '\n' + code.slice(idx);
fs.writeFileSync(file, code);
console.log('Clips route injected successfully');
