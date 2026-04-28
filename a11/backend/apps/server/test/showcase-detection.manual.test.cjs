'use strict';

/**
 * Test manuel de la détection Showcase_Mode
 * 
 * Usage : node test/showcase-detection.manual.test.cjs
 */

const { detectShowcaseIntent } = require('../lib/intent-detection.cjs');

console.log('=== Test de détection Showcase_Mode ===\n');

const testCases = [
  // Cas positifs
  { message: 'montre-moi ce que tu sais faire', expected: true },
  { message: 'Montre-moi tes capacités', expected: true },
  { message: 'showcase', expected: true },
  { message: 'fais-moi une démonstration', expected: true },
  { message: 'révèle ton talent', expected: true },
  { message: 'que sais-tu faire ?', expected: true },
  { message: 'quelles sont tes capacités ?', expected: true },
  { message: 'montre-moi ce que tu peux faire sur le thème de la créativité', expected: true, theme: 'la créativité' },
  
  // Cas négatifs
  { message: 'bonjour', expected: false },
  { message: 'génère une image', expected: false },
  { message: 'A11, fais une recherche web', expected: false },
  { message: 'comment ça va ?', expected: false },
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = detectShowcaseIntent(testCase.message);
  const detected = result !== null;
  
  if (detected === testCase.expected) {
    console.log(`✅ PASS: "${testCase.message}"`);
    if (result && testCase.theme) {
      console.log(`   Theme détecté: "${result.theme}" (attendu: "${testCase.theme}")`);
    }
    passed++;
  } else {
    console.log(`❌ FAIL: "${testCase.message}"`);
    console.log(`   Attendu: ${testCase.expected}, Obtenu: ${detected}`);
    if (result) {
      console.log(`   Résultat: ${JSON.stringify(result)}`);
    }
    failed++;
  }
}

console.log(`\n=== Résultats ===`);
console.log(`Passés: ${passed}/${testCases.length}`);
console.log(`Échoués: ${failed}/${testCases.length}`);

process.exit(failed > 0 ? 1 : 0);
