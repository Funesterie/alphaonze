'use strict';

// Regression : Suno rejette (403, « Our models do not recognize artists' names »)
// tout champ `style` qui ressemble a un nom d'artiste. stripCastTimbreForCatalogVoice
// retirait les noms des fragments... puis reinjectait le nom de la persona dans sa
// balise « authorized custom voice direction <label> ». Le style final doit ne
// contenir AUCUN nom d'interprete -- la voix passe par personaId, pas par le texte.

const test = require('node:test');
const assert = require('node:assert');

const { stripCastTimbreForCatalogVoice } = require('../src/routes/vivy-studio.cjs');

const NOMS = /\b(vivy|vivi|djeff|k44|kaen44|kaen|a11|alphaonze|marvin)\b/i;

test('le nom de la persona ne survit jamais dans le style (Djeff)', () => {
  const style = 'rap francais stable et profond, basses legeres, refrain simple';
  const out = stripCastTimbreForCatalogVoice(style, 'Djeff', 'homme');
  assert.ok(!NOMS.test(out), `un nom d'interprete a survecu: ${out}`);
});

test('un nom present dans le style d entree est retire aussi', () => {
  const style = 'rap francais, clear Djeff vocal, punchlines';
  const out = stripCastTimbreForCatalogVoice(style, 'Djeff', 'homme');
  assert.ok(!NOMS.test(out), `Djeff aurait du disparaitre: ${out}`);
});

test('marche pour chaque persona du casting', () => {
  for (const nom of ['Vivy', 'Marvin', 'Kaen44', 'A11']) {
    const out = stripCastTimbreForCatalogVoice('rap francais, refrain', nom, '');
    assert.ok(!NOMS.test(out), `${nom} a survecu: ${out}`);
  }
});

test('l intention d autorisation reste presente (sans nom)', () => {
  const out = stripCastTimbreForCatalogVoice('rap francais', 'Djeff', 'homme');
  assert.match(out, /authorized/i, 'la balise d autorisation a disparu');
});

test('le genre musical utile est conserve', () => {
  const out = stripCastTimbreForCatalogVoice('deep french rap, heavy bass', 'Djeff', 'homme');
  assert.match(out, /rap/i);
  assert.match(out, /bass/i);
});

test('la direction de genre vocal (homme/femme) est conservee', () => {
  assert.match(stripCastTimbreForCatalogVoice('rap', 'Djeff', 'homme'), /male lead vocal/i);
  assert.match(stripCastTimbreForCatalogVoice('pop', 'Vivy', 'femme'), /female lead vocal/i);
});
