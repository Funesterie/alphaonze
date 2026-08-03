'use strict';

// Perimetres Gmail de la persona Vivy. Test sur la SOURCE : resolveGoogleOAuthScope
// vit dans la fabrique de routes et n'est pas exportable sans monter tout un routeur.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/routes/auth.cjs'), 'utf8');
const bloc = source.match(/function resolveGoogleOAuthScope\(req\) \{[\s\S]*?\n  \}/)?.[0] || '';

test('le bloc de resolution des perimetres Google est trouve', () => {
  assert.ok(bloc, 'sans ce bloc, les tests suivants ne verifient rien');
});

test('la lecture seule est le defaut Gmail', () => {
  // Vivy peut lire et resumer sans qu un mail puisse partir.
  assert.match(bloc, /'gmail', 'mail', 'google-mail', 'gmail-lecture'/);
  assert.match(bloc, /gmail\.readonly/);
});

test('l ecriture est un profil distinct, ferme par defaut', () => {
  // Meme garde que pour Drive : demander l ecriture sans l avoir ouverte ne doit
  // pas accorder l envoi en silence.
  assert.match(bloc, /GOOGLE_OAUTH_ALLOW_GMAIL_COMPOSE/);
  assert.match(bloc, /if \(!allowCompose\)/);
  const apresGarde = bloc.slice(bloc.indexOf('if (!allowCompose)'));
  const replii = apresGarde.slice(0, apresGarde.indexOf('return resolveOAuthScope', apresGarde.indexOf('return resolveOAuthScope') + 10));
  assert.match(replii, /gmail\.readonly/, 'le repli doit etre la lecture seule, pas l ecriture');
});

test('gmail.compose n est atteignable qu apres ouverture explicite', () => {
  // On vise le PERIMETRE (l URL complete), pas le mot : « gmail.compose » apparait
  // d'abord dans le commentaire qui explique la limite de Google.
  const iGarde = bloc.indexOf('GOOGLE_OAUTH_ALLOW_GMAIL_COMPOSE');
  const iPerimetre = bloc.indexOf('auth/gmail.compose');
  assert.ok(iGarde > -1, 'la garde doit exister');
  assert.ok(iPerimetre > iGarde, 'la garde doit preceder le perimetre d ecriture');
});

test('la limite de Google est ecrite dans le code, pas seulement sue', () => {
  // Il n existe AUCUN perimetre Google qui autorise les brouillons sans l envoi.
  // Un lecteur qui ne le sait pas croira que gmail.compose est inoffensif.
  assert.match(bloc, /AUCUN perimetre/);
  assert.match(bloc, /sans autoriser l'envoi/);
});

test('la connexion simple reste sans acces au courrier', () => {
  const defaut = bloc.slice(bloc.lastIndexOf('return resolveOAuthScope'));
  assert.match(defaut, /'openid email profile'/);
  assert.doesNotMatch(defaut, /gmail/, 'se connecter ne doit jamais ouvrir la boite mail');
});
