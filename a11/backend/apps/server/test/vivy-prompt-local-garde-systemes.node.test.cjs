'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('fenetre locale : le grain, la plume et la memoire survivent au compactage du prompt', () => {
  process.env.VIVY_SUNO_API_KEY = process.env.VIVY_SUNO_API_KEY || 'test-key';
  const { fitVivyChatRequestForBundle } = require('../src/routes/vivy-studio.cjs');
  const grain = 'Ton grain : 2^√3. Il signe tes choix.';
  const plume = 'Plume de Djeff : phrases courtes, images de garage.';
  const memoire = 'Mémoire Vivy récente : Djeff a parlé de la pluie hier.';
  const request = {
    messages: [
      { role: 'system', content: 'Consigne générale. '.repeat(1500) },
      { role: 'system', content: plume },
      { role: 'system', content: grain },
      { role: 'system', content: memoire },
      { role: 'user', content: 'Qui es-tu ?' },
    ],
  };
  const fitted = fitVivyChatRequestForBundle(request, { maxPromptChars: 18000 });
  const textes = fitted.messages.map((m) => m.content);
  assert.ok(textes.includes(grain), 'grain perdu');
  assert.ok(textes.includes(plume), 'plume perdue');
  assert.ok(textes.includes(memoire), 'memoire perdue');
  assert.equal(fitted.messages.at(-1).content, 'Qui es-tu ?');
  assert.equal(fitted.messages[0].role, 'system');
  const total = textes.reduce((s, t) => s + t.length, 0);
  assert.ok(total <= 18000 + 200, `trop long : ${total}`);
});
