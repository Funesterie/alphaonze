'use strict';

/**
 * La sonnette doit renseigner sans jamais coûter cher, ni mentir.
 *
 * Idée de Djeff le 09/08/2026: « ça sert à rien d'attendre 25 sec si le model est pas
 * dispo ». Mesuré en prod le même jour: cinq fournisseurs coupés à 8 s chacun, tout le
 * budget dépensé à découvrir des indisponibilités.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance:
 *   1. on n'écarte JAMAIS un fournisseur de la liste, on ne fait que le reculer;
 *   2. une clef refusée ou un débit limité se voit tout de suite, sans jeton dépensé;
 *   3. le cache évite de sonner à chaque message;
 *   4. une sonnette qui casse ne casse pas la génération.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sonnerUn,
  sonnerTous,
  ordonnerParDisponibilite,
  resumerSonnerie,
} = require('../src/llm/provider-doorbell.cjs');

function bundle(provider, model = 'm', baseURL = null) {
  return { provider, model, baseURL: baseURL || `https://${provider}.exemple/v1`, apiKey: 'clef' };
}

function faussetFetch(parHote) {
  return async (url) => {
    for (const [fragment, reponse] of Object.entries(parHote)) {
      if (String(url).includes(fragment)) {
        if (reponse instanceof Error) throw reponse;
        return { ok: reponse.status >= 200 && reponse.status < 300, status: reponse.status };
      }
    }
    return { ok: true, status: 200 };
  };
}

test('une clef refusée se voit immédiatement, sans dépenser un jeton', async () => {
  const verdict = await sonnerUn(bundle('deepseek'), {
    fetchImpl: faussetFetch({ deepseek: { status: 401 } }),
  });
  assert.equal(verdict.disponible, false);
  assert.equal(verdict.motif, 'clef_refusee_401');
});

test('un débit limité est distingué d une panne', async () => {
  // 429 n'est pas une panne: le service existe, il ne nous prend pas maintenant.
  // Le distinguer permet de le retenter plus tôt qu'une clef morte.
  const verdict = await sonnerUn(bundle('groq'), {
    fetchImpl: faussetFetch({ groq: { status: 429 } }),
  });
  assert.equal(verdict.disponible, false);
  assert.equal(verdict.motif, 'debit_limite');
});

test('un service muet est constaté sans faire échouer la sonnette', async () => {
  const silence = new Error('aborted');
  silence.name = 'AbortError';
  const verdict = await sonnerUn(bundle('lent'), {
    fetchImpl: faussetFetch({ lent: silence }),
    timeoutMs: 50,
  });
  assert.equal(verdict.disponible, false);
  assert.equal(verdict.motif, 'silence');
});

test('les indisponibles reculent mais ne disparaissent jamais', async () => {
  // Le point le plus important. Une passerelle peut refuser /models et accepter une
  // génération. Supprimer un fournisseur sur la foi de la sonnette nous laisserait
  // parfois sans personne — pire que d'essayer un douteux en dernier.
  const liste = [bundle('mort'), bundle('vivant'), bundle('limite')];
  const verdicts = await sonnerTous(liste, {
    fetchImpl: faussetFetch({
      mort: { status: 401 },
      vivant: { status: 200 },
      limite: { status: 429 },
    }),
  });

  const ordonnee = ordonnerParDisponibilite(liste, verdicts);
  assert.equal(ordonnee.length, 3, 'aucun fournisseur ne doit disparaitre');
  assert.equal(ordonnee[0].provider, 'vivant', 'celui qui repond passe devant');
  assert.deepEqual(
    ordonnee.map((b) => b.provider).sort(),
    ['limite', 'mort', 'vivant'],
    'la liste garde exactement les memes membres'
  );
});

test('à disponibilité égale, l ordre de priorité d origine est conservé', async () => {
  // Tri stable: la sonnette départage les inconnus, elle ne réinvente pas la
  // hiérarchie de qualité déjà choisie ailleurs.
  const liste = [bundle('premier'), bundle('second'), bundle('troisieme')];
  const verdicts = await sonnerTous(liste, { fetchImpl: faussetFetch({}) });
  const ordonnee = ordonnerParDisponibilite(liste, verdicts);
  assert.deepEqual(ordonnee.map((b) => b.provider), ['premier', 'second', 'troisieme']);
});

test('le local n est pas sonné: il est chez nous', async () => {
  let sonneries = 0;
  const compter = async () => { sonneries += 1; return { ok: true, status: 200 }; };
  const verdicts = await sonnerTous([bundle('ollama')], { fetchImpl: compter });
  assert.equal(sonneries, 0, 'aucune requete reseau pour le moteur local');
  const seul = [...verdicts.values()][0];
  assert.equal(seul.disponible, true);
  assert.equal(seul.motif, 'local_non_sonne');
});

test('le cache évite de sonner à chaque message', async () => {
  let sonneries = 0;
  const compter = async () => { sonneries += 1; return { ok: true, status: 200 }; };
  const liste = [bundle('cache-test', 'm', 'https://cache-test-unique.exemple/v1')];

  await sonnerTous(liste, { fetchImpl: compter });
  await sonnerTous(liste, { fetchImpl: compter });
  assert.equal(sonneries, 1, 'la seconde sonnerie doit venir du cache');

  const verdicts = await sonnerTous(liste, { fetchImpl: compter });
  assert.equal([...verdicts.values()][0].depuisCache, true);
});

test('le résumé de sonnerie n expose jamais une clef', async () => {
  const liste = [bundle('alpha'), bundle('beta')];
  const verdicts = await sonnerTous(liste, {
    fetchImpl: faussetFetch({ alpha: { status: 200 }, beta: { status: 401 } }),
    ignorerCache: true,
  });
  const resume = resumerSonnerie(liste, verdicts);
  assert.match(resume, /alpha=ok/);
  assert.match(resume, /beta=clef_refusee_401/);
  assert.ok(!resume.includes('clef'.repeat(1) + '='), 'pas de valeur de clef');
  assert.ok(!/Bearer/i.test(resume));
});
