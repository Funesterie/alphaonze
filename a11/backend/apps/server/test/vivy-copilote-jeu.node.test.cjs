'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { NATURES, creerCopilote } = require(path.join(__dirname, '../src/music/vivy-copilote-jeu.cjs'));

/** Horloge pilotee : le temps ne doit pas dependre de la vitesse de la machine. */
function horlogeFausse(depart = 1000000) {
  let t = depart;
  return { horloge: () => t, avancer: (ms) => { t += ms; } };
}

test('elle ne repete pas un etat qui n a pas change', () => {
  // Voir « PV bas » vingt fois n'est pas vingt informations : c'est une seule,
  // qui date. C'est le defaut qui rend un commentateur insupportable.
  const { horloge, avancer } = horlogeFausse();
  const c = creerCopilote({ horloge });
  assert.equal(c.observer({ nature: 'danger', cle: 'pv', valeur: 'bas', texte: 'attention' }).parle, true);
  for (let i = 0; i < 20; i += 1) {
    avancer(10000);
    assert.equal(c.observer({ nature: 'danger', cle: 'pv', valeur: 'bas' }).parle, false, 'meme etat = silence');
  }
});

test('mais elle reparle des que l etat change vraiment', () => {
  const { horloge, avancer } = horlogeFausse();
  const c = creerCopilote({ horloge });
  c.observer({ nature: 'danger', cle: 'pv', valeur: 'bas' });
  avancer(10000);
  const r = c.observer({ nature: 'danger', cle: 'pv', valeur: 'critique' });
  assert.equal(r.parle, true);
});

test('le delai de garde depend de la nature — le danger revient vite, la vanne non', () => {
  const { horloge, avancer } = horlogeFausse();
  const c = creerCopilote({ horloge });
  assert.ok(NATURES.danger.gardeMs < NATURES.vanne.gardeMs, 'une vanne doit attendre plus qu un danger');

  c.observer({ nature: 'vanne', cle: 'v1', valeur: 1 });
  avancer(10000);
  assert.equal(c.observer({ nature: 'vanne', cle: 'v2', valeur: 2 }).parle, false, '10 s ne suffisent pas pour une vanne');
  avancer(40000);
  assert.equal(c.observer({ nature: 'vanne', cle: 'v3', valeur: 3 }).parle, true);
});

test('le budget de parole la fait taire quand elle devient du bruit', () => {
  // Le budget ne peut mordre qu'entre natures DIFFERENTES : sur une seule nature,
  // le delai de garde suffit deja. On enchaine donc des natures distinctes, assez
  // vite pour rester dans la meme fenetre d'une minute.
  const { horloge, avancer } = horlogeFausse();
  const c = creerCopilote({ horloge, budgetParMinute: 3 });
  const natures = ['boss', 'objectif', 'reussite', 'butin', 'decouverte', 'vanne'];
  let dits = 0;
  for (const [i, nature] of natures.entries()) {
    avancer(1000);
    if (c.observer({ nature, cle: `${nature}-${i}`, valeur: i }).parle) dits += 1;
  }
  assert.equal(dits, 3, `le budget doit couper apres 3, vu ${dits}`);
  assert.equal(c.etat().budgetRestant, 0);
});

test('sur une seule nature, c est la garde qui protege, pas le budget', () => {
  // Distinction utile : deux mecanismes, deux roles. Confondre les deux m'a fait
  // ecrire un test qui ne testait rien.
  const { horloge, avancer } = horlogeFausse();
  const c = creerCopilote({ horloge, budgetParMinute: 99 });
  let dits = 0;
  for (let i = 0; i < 10; i += 1) {
    avancer(5000);
    if (c.observer({ nature: 'decouverte', cle: `d${i}`, valeur: i }).parle) dits += 1;
  }
  // garde decouverte = 30 s, sur 50 s ecoulees : deux passages au plus.
  assert.ok(dits <= 2, `la garde doit limiter a 2, vu ${dits}`);
});

test('le danger passe outre le budget — se taire pendant qu il meurt serait absurde', () => {
  // Une regle qui se retourne contre son but n est plus une regle, c est un bug.
  const { horloge, avancer } = horlogeFausse();
  const c = creerCopilote({ horloge, budgetParMinute: 1 });
  c.observer({ nature: 'decouverte', cle: 'x', valeur: 1 });
  avancer(5000);
  assert.equal(c.etat().budgetRestant, 0, 'le budget doit bien etre epuise');
  const r = c.observer({ nature: 'danger', cle: 'pv', valeur: 'critique', texte: 'derriere toi' });
  assert.equal(r.parle, true, 'le danger doit passer malgre le budget');
  assert.equal(r.urgent, true);
});

test('sur un seul coup d oeil, elle ne dit QU UNE chose : la plus importante', () => {
  // Enchainer trois phrases sur une image, c est exactement le defaut a eviter.
  const { horloge } = horlogeFausse();
  const c = creerCopilote({ horloge });
  const r = c.observerLot([
    { nature: 'vanne', cle: 'a', valeur: 1, texte: 'tu cours comme un canard' },
    { nature: 'danger', cle: 'b', valeur: 1, texte: 'il charge' },
    { nature: 'butin', cle: 'c', valeur: 1, texte: 'un coffre' },
  ]);
  assert.equal(r.parle, true);
  assert.equal(r.nature, 'danger', 'la priorite doit trancher');
  assert.equal(r.texte, 'il charge');
  assert.equal(r.ecartees, 2);
});

test('on peut la faire taire d un mot, et la rallumer', () => {
  const { horloge } = horlogeFausse();
  const c = creerCopilote({ horloge });
  c.silence(true);
  assert.equal(c.observer({ nature: 'danger', cle: 'pv', valeur: 'bas' }).parle, false);
  assert.equal(c.etat().silencieuse, true);
  c.silence(false);
  assert.equal(c.observer({ nature: 'danger', cle: 'pv', valeur: 'critique' }).parle, true);
});

test('une nature inconnue ne la fait pas parler au hasard', () => {
  const { horloge } = horlogeFausse();
  const c = creerCopilote({ horloge });
  const r = c.observer({ nature: 'meteo', cle: 'x', valeur: 1, texte: 'il pleut' });
  assert.equal(r.parle, false);
  assert.match(r.raison, /nature inconnue/);
});

test('le budget se recharge apres une minute', () => {
  const { horloge, avancer } = horlogeFausse();
  const c = creerCopilote({ horloge, budgetParMinute: 2 });
  c.observer({ nature: 'decouverte', cle: 'a', valeur: 1 });
  avancer(31000);
  c.observer({ nature: 'decouverte', cle: 'b', valeur: 2 });
  assert.equal(c.etat().budgetRestant, 0);
  avancer(61000);
  assert.equal(c.etat().budgetRestant, 2, 'la fenetre glissante doit se vider');
});

test('deux parties sont independantes', () => {
  const { horloge } = horlogeFausse();
  const a = creerCopilote({ horloge });
  const b = creerCopilote({ horloge });
  a.silence(true);
  assert.equal(a.observer({ nature: 'danger', cle: 'x', valeur: 1 }).parle, false);
  assert.equal(b.observer({ nature: 'danger', cle: 'x', valeur: 1 }).parle, true);
});
