'use strict';

/**
 * Ce qui est verrouille ici n'est pas le montant -- il bougera avec la grille
 * Comfy et avec la premiere mesure reelle -- mais les proprietes qui rendent le
 * calcul utilisable: qu'il suive les reglages de production, qu'il reste
 * pessimiste par defaut, et qu'il exprime le plafond mensuel, seule contrainte
 * qui arrete vraiment la production.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PALIERS_COMFY,
  parametresRendu,
  usdParCredit,
  coutClip,
  capaciteMensuelle,
  prixPlancherEur,
} = require('../src/clips/cout-clip.cjs');

test('le calcul suit les reglages de rendu, il ne les fige pas', () => {
  const base = coutClip({ env: {} });
  const double = coutClip({ env: { VIVY_STREAM_FULL_CLIP_SCENES: '16' } });
  assert.equal(base.scenes, 8);
  assert.equal(base.secondesGenerees, 64);
  assert.equal(double.secondesGenerees, 128);
  assert.equal(double.credits, base.credits * 2);
});

test('le multiplicateur est pessimiste par defaut', () => {
  // Sous-estimer vide la reserve au milieu du mois; surestimer ne coute qu'un
  // palier trop genereux. Le defaut doit donc rester au-dessus de 1.
  assert.ok(parametresRendu({}).multiplicateur >= 2);
  const mesure = coutClip({ env: { A11_COMFY_CREDIT_MULTIPLIER: '1' } });
  assert.ok(mesure.credits < coutClip({ env: {} }).credits);
});

test('le cout est marque comme estime, jamais comme releve', () => {
  assert.equal(coutClip({ env: {} }).estime, true);
});

test('les trois paliers individuels facturent le credit au meme prix', () => {
  // Si l'un decrochait, ce serait soit une erreur de saisie de la grille, soit
  // une offre a saisir: dans les deux cas il faut le voir.
  const prix = ['standard', 'creator', 'pro'].map((id) => usdParCredit(id));
  const ecart = Math.max(...prix) - Math.min(...prix);
  assert.ok(ecart < 0.0001, `paliers individuels incoherents, ecart ${ecart}`);
});

test('Team est plus cher au credit que les paliers individuels', () => {
  // Constat de la grille du 18/08/2026, pas une anomalie de saisie: Team coute
  // ~0,00427 USD le credit contre ~0,00379 ailleurs, soit 12 % de plus. On paie
  // des sieges, pas du GPU. Monter en Team pour « avoir plus de credits » est
  // donc le mauvais reflexe: a credit egal, Pro est moins cher.
  assert.ok(usdParCredit('team') > usdParCredit('pro'));
  assert.ok(usdParCredit('team') / usdParCredit('pro') > 1.1);
});

test('un palier inconnu retombe sur standard', () => {
  assert.equal(usdParCredit('nawak'), usdParCredit('standard'));
  assert.equal(capaciteMensuelle({ env: {}, palier: 'nawak' }).palier, 'standard');
});

test('le plafond mensuel est la vraie contrainte, pas la marge', () => {
  const standard = capaciteMensuelle({ env: {}, palier: 'standard' });
  const pro = capaciteMensuelle({ env: {}, palier: 'pro' });

  // Une seule vente a 29,99 EUR rembourse deja le palier Standard: cote argent
  // la boucle se referme des la premiere vente.
  assert.equal(standard.ventesPourRembourserLePalier, 1);
  // Mais le nombre de clips reste borne par la reserve, quel que soit le CA.
  assert.ok(standard.clipsParMois < 20, 'Standard doit rester une petite reserve');
  assert.ok(pro.clipsParMois > standard.clipsParMois);
});

test('un pack de dix ne tient pas deux fois dans la reserve Standard', () => {
  // Le vrai risque du pack: vendu deux fois dans le mois, il demande plus de
  // credits que le palier n'en donne, et la deuxieme commande attend le mois
  // suivant. C'est ce que le calcul doit rendre visible avant la vente.
  const standard = capaciteMensuelle({ env: {}, palier: 'standard' });
  assert.ok(standard.clipsParMois >= 10, 'un pack doit au moins tenir une fois');
  assert.ok(standard.clipsParMois < 20, 'deux packs ne doivent pas tenir');
});

test('le prix plancher reste tres en dessous des tarifs pratiques', () => {
  const plancher = prixPlancherEur({ env: {} });
  assert.ok(plancher > 0);
  assert.ok(plancher < 10, `plancher ${plancher} EUR: le pack a 10 EUR/clip passerait sous le cout`);
  assert.ok(plancher < 29.99);
});
