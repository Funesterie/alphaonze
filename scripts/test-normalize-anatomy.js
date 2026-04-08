// scripts/test-normalize-anatomy.js
// Usage: node scripts/test-normalize-anatomy.js

const path = require('path');

function requirePromptBuilder() {
  // path relatif depuis la racine du repo
  const modPath = path.resolve(__dirname, '..', 'a11', 'backend', 'apps', 'server', 'src', 'image', 'prompt-builder.cjs');
  try {
    return require(modPath);
  } catch (err) {
    console.error('Impossible de charger prompt-builder.cjs depuis', modPath);
    console.error(err && err.stack ? err.stack : err);
    process.exit(2);
  }
}

const { buildPromptSeed } = requirePromptBuilder();

function runCase(caseDef) {
  const { name, prompt, shouldNormalize = true, expectCompositionHints = ['single subject', 'full body', 'natural anatomy', 'coherent silhouette'] } = caseDef;
  const seed = buildPromptSeed(prompt);
  const normalized = String(seed?.normalizedText || '').toLowerCase();
  const compHints = Array.isArray(seed?.compositionHints) ? seed.compositionHints.map(s => String(s || '').toLowerCase()) : [];

  let ok = true;
  const reasons = [];

  if (shouldNormalize) {
    const foundHint = expectCompositionHints.some(h => compHints.includes(h.toLowerCase()));
    const containsPhrase = normalized.includes('single subject') || normalized.includes('full body') || normalized.includes('natural anatomy') || normalized.includes('coherent silhouette');

    if (!foundHint && !containsPhrase) {
      ok = false;
      reasons.push('La normalisation n\'a pas ajouté de phrase d\'unité ni d\'hints de composition.');
    }
  } else {
    // on attend a minima que l'on n'ait pas transformé un prompt déjà correct en style "inventaire"
    // si normalizedText contient les motifs inventaires -> échec
    const badInventory = (/\b(?:one|two|three|four|\d+)\b\s+(?:head|body|leg|arm|wing|tail|eye|ear|wheel|door|handle)s?\b/i.test(normalized))
      || (new RegExp(`\\b(?:head|body|leg|arm|wing|tail|eye|ear|wheel|door|handle)s?\\b(?:\\s*,\\s*(?:head|body|leg|arm|wing|tail|eye|ear|wheel|door|handle)s?)+`, 'i').test(normalized));
    if (badInventory) {
      ok = false;
      reasons.push('Prompt non-inventaire attendu mais on détecte encore un pattern "inventory".');
    }
  }

  return {
    name,
    prompt,
    normalized,
    compHints,
    ok,
    reasons,
  };
}

const TEST_CASES = [
  {
    name: 'Dragon rouge (inventaire) - FR',
    prompt: 'dragon rouge, one head, one body, four legs, two wings',
    shouldNormalize: true,
  },
  {
    name: 'Chien (inventaire) - FR',
    prompt: 'chien, one head, one body, four legs, furry paws',
    shouldNormalize: true,
  },
  {
    name: 'Voiture (inventaire) - FR',
    prompt: 'voiture, four wheels, two doors, one trunk',
    shouldNormalize: true,
  },
  {
    name: 'Visage / personnage (inventaire) - FR',
    prompt: 'personnage, one head, eyes, nose, mouth, ears',
    shouldNormalize: true,
  },
  {
    name: 'Objet simple (inventaire) - FR',
    prompt: 'objet simple, one handle, one body, rectangular base',
    shouldNormalize: true,
  },
  {
    name: 'Prompt déjà correct (ne pas normaliser)',
    prompt: 'single red rabbit, full body, natural anatomy, coherent silhouette, side profile, solo, centered',
    shouldNormalize: false,
  },
  {
    name: 'Explicit multi-intent (ne pas normaliser)',
    prompt: 'two-headed dragon, fierce, red scales',
    shouldNormalize: false,
  },
];

async function main() {
  console.log('=== TEST: normalizeAnatomyPrompt via buildPromptSeed ===\n');
  const results = TEST_CASES.map(runCase);
  let failures = 0;

  for (const r of results) {
    console.log(`-- ${r.name} --`);
    console.log('prompt :', r.prompt);
    console.log('normalizedText :', r.normalized);
    console.log('compositionHints :', JSON.stringify(r.compHints));
    if (r.ok) {
      console.log('✅ OK\n');
    } else {
      failures += 1;
      console.log('❌ ÉCHEC', r.reasons.join('; '), '\n');
    }
  }

  if (failures) {
    console.error(`\n${failures} test(s) en échec.`);
    process.exit(1);
  } else {
    console.log('\nTous les tests passent ✅');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Erreur pendant l\'exécution des tests :', err && err.stack ? err.stack : err);
  process.exit(3);
});
