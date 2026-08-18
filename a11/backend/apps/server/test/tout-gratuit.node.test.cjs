'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  estActif,
  palierOffert,
  quotaClipsParMois,
  identiteComptable,
  creerCompteurClipsGratuits,
} = require('../src/auth/tout-gratuit.cjs');

test('le commutateur est ferme par defaut et ne s ouvre que sur une valeur explicite', () => {
  assert.equal(estActif({}), false);
  assert.equal(estActif({ A11_TOUT_GRATUIT: '0' }), false);
  assert.equal(estActif({ A11_TOUT_GRATUIT: 'non' }), false);
  assert.equal(estActif({ A11_TOUT_GRATUIT: '1' }), true);
  assert.equal(estActif({ A11_TOUT_GRATUIT: 'true' }), true);
});

test('le palier offert est premium, jamais admin_family', () => {
  // admin_family n'est pas « premium en mieux »: la meme liste sert de controle
  // d'acces administrateur. L'offrir a tous donnerait l'administration du
  // serveur au premier venu.
  assert.equal(palierOffert(), 'premium');
  assert.notEqual(palierOffert(), 'admin_family');
});

test('sans compte, pas de clip gratuit -- et le refus est nomme', () => {
  // LE piege: un quota « par personne » dont la cle retombe sur 'anon' devient
  // un compteur unique partage. On refuse plutot que de compter dans le vide.
  const compteur = creerCompteurClipsGratuits({ env: {} });
  const etat = compteur.etat(null);
  assert.equal(etat.autorise, false);
  assert.equal(etat.raison, 'compte_requis');
  assert.equal(identiteComptable(null), '');
  assert.equal(identiteComptable({}), '');
});

test('deux anonymes ne partagent pas un compteur, ils sont refuses tous les deux', () => {
  const compteur = creerCompteurClipsGratuits({ env: {} });
  compteur.consommer(null);
  compteur.consommer(null);
  assert.equal(compteur.etat({ id: 'u1' }).restants, 1, 'un vrai compte ne doit pas payer pour les anonymes');
});

test('le quota est par personne, pas global', () => {
  const compteur = creerCompteurClipsGratuits({ env: {} });
  assert.equal(compteur.consommer({ id: 'u1' }).restants, 0);
  assert.equal(compteur.etat({ id: 'u1' }).autorise, false);
  // u2 n'a rien consomme: son quota est intact.
  assert.equal(compteur.etat({ id: 'u2' }).autorise, true);
  assert.equal(compteur.etat({ id: 'u2' }).restants, 1);
});

test('le compteur se remet a zero au changement de mois', () => {
  let jour = new Date('2026-08-31T12:00:00Z');
  const compteur = creerCompteurClipsGratuits({ env: {}, maintenant: () => jour });
  compteur.consommer({ id: 'u1' });
  assert.equal(compteur.etat({ id: 'u1' }).autorise, false);
  jour = new Date('2026-09-01T00:05:00Z');
  assert.equal(compteur.etat({ id: 'u1' }).autorise, true, 'nouveau mois, nouveau quota');
});

test('le quota mensuel se regle sans toucher au code', () => {
  assert.equal(quotaClipsParMois({}), 1);
  assert.equal(quotaClipsParMois({ A11_GRATUIT_CLIPS_PAR_MOIS: '3' }), 3);
  const compteur = creerCompteurClipsGratuits({ env: { A11_GRATUIT_CLIPS_PAR_MOIS: '2' } });
  compteur.consommer({ id: 'u1' });
  assert.equal(compteur.etat({ id: 'u1' }).restants, 1);
});

test('un quota a zero ferme la porte proprement', () => {
  const compteur = creerCompteurClipsGratuits({ env: { A11_GRATUIT_CLIPS_PAR_MOIS: '0' } });
  const etat = compteur.etat({ id: 'u1' });
  assert.equal(etat.autorise, false);
  assert.equal(etat.raison, 'quota_mensuel_epuise');
});

test('l email sert d identite quand l id manque, mais rien d autre', () => {
  assert.equal(identiteComptable({ email: 'A@B.fr' }), 'e:a@b.fr');
  // Ni IP ni empreinte: ce ne sont pas des personnes, et compter dessus punit
  // les foyers partages sans genant celui qui contourne.
  assert.equal(identiteComptable({ ip: '203.0.113.7' }), '');
});

// ── Cablage sur les portes payantes ──────────────────────────────────────────

const { createSharinganClipsGuard } = require('../src/clips/sharingan-clips-guard.cjs');

function reqFactice(overrides = {}) {
  return { headers: {}, cookies: {}, ip: '203.0.113.7', ...overrides };
}

function resFactice() {
  const res = { statusCode: null, redirectedTo: null, fichierEnvoye: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = () => res;
  res.redirect = (_c, url) => { res.redirectedTo = url; return res; };
  res.sendFile = () => { res.fichierEnvoye = true; return res; };
  return res;
}

test('en mode gratuit, le paywall clips laisse passer le hotlink externe', () => {
  const precedent = process.env.A11_TOUT_GRATUIT;
  process.env.A11_TOUT_GRATUIT = '1';
  try {
    const guard = createSharinganClipsGuard({ landingUrl: 'https://funesterie.me/' });
    let passe = false;
    guard(
      reqFactice({ headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://ailleurs.tld/' } }),
      resFactice(),
      () => { passe = true; }
    );
    assert.equal(passe, true, 'plus de caisse derriere la porte, plus de raison de la fermer');
  } finally {
    if (precedent === undefined) delete process.env.A11_TOUT_GRATUIT;
    else process.env.A11_TOUT_GRATUIT = precedent;
  }
});

test('gratuit ne veut pas dire qu on offre la bande passante a yt-dlp', () => {
  const precedent = process.env.A11_TOUT_GRATUIT;
  process.env.A11_TOUT_GRATUIT = '1';
  try {
    const guard = createSharinganClipsGuard({ landingUrl: 'https://funesterie.me/' });
    const res = resFactice();
    let passe = false;
    guard(reqFactice({ headers: { 'user-agent': 'yt-dlp/2024.03.10' } }), res, () => { passe = true; });
    assert.equal(passe, false, 'un aspirateur ne doit pas passer, meme en gratuit');
    assert.equal(res.fichierEnvoye, true, 'il recoit le troll');
  } finally {
    if (precedent === undefined) delete process.env.A11_TOUT_GRATUIT;
    else process.env.A11_TOUT_GRATUIT = precedent;
  }
});
