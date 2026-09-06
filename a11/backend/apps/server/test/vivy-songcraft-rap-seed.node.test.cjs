const test = require('node:test');
const assert = require('node:assert/strict');

const { extractDjeffRapSeedLines } = require('../src/music/vivy-songcraft.cjs');

// Regression : un plancher de 8 signes jetait toute ligne plus courte. Applique a
// une demande d'une seule ligne, il vidait la graine — et la generation echouait
// sans dire pourquoi. Or tous les noms propres du lore font moins de 8 signes.

test('un theme court survit — les noms du lore font tous moins de 8 signes', () => {
  for (const nom of ['NOSSEN', 'Vivy', 'Rei', 'Tera', 'M66', 'moto']) {
    const graine = extractDjeffRapSeedLines(`fais un rap sur ${nom}`);
    assert.ok(graine.length > 0, `graine vide pour « ${nom} »`);
    assert.match(graine.join(' '), new RegExp(nom, 'i'));
  }
});

test('« rap » tout seul ne rend plus une graine vide', () => {
  assert.deepEqual(extractDjeffRapSeedLines('rap'), ['rap']);
});

test('une demande normale reste intacte', () => {
  assert.deepEqual(extractDjeffRapSeedLines('Djeff rap sur la moto'), ['Djeff rap sur la moto']);
  assert.deepEqual(extractDjeffRapSeedLines('fais moi du rap'), ['fais moi du rap']);
});

test('le plancher anti-fragments tient toujours quand il y a plusieurs lignes', () => {
  // Ici les miettes doivent bien disparaitre : c'est le role d'origine du filtre.
  const graine = extractDjeffRapSeedLines([
    'un casque bleu dans la nuit et le moteur qui monte',
    'ok',
    'la',
    'la route mouillee renvoie les phares en morceaux',
  ].join('\n'));

  assert.equal(graine.length, 2, `attendu 2 lignes utiles, recu ${JSON.stringify(graine)}`);
  assert.ok(graine.every((l) => l.length >= 8));
});

test('une entree vide rend bien une graine vide', () => {
  assert.deepEqual(extractDjeffRapSeedLines(''), []);
  assert.deepEqual(extractDjeffRapSeedLines('   \n  '), []);
});

test('les etiquettes et meta-instructions restent filtrees', () => {
  // Le repli ne doit pas reintroduire ce que les filtres semantiques rejettent
  // deliberement — sinon on remplacerait un bug par un autre.
  const graine = extractDjeffRapSeedLines('[couplet]\nvivy: transforme cette idee\nla moto rouge devale la nationale');
  assert.ok(graine.some((l) => /moto rouge/i.test(l)));
  assert.ok(!graine.some((l) => /^\[/.test(l)), 'une etiquette a survecu');
});
