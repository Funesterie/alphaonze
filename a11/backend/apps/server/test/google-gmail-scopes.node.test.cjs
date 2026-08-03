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

// --- client dedie a la persona -------------------------------------------

const config = source.match(/function getGoogleOAuthConfig\([\s\S]*?\n  \}/)?.[0] || '';

test('un client dedie sert la boite de la persona, sans toucher au client du site', () => {
  // GOOGLE_CLIENT_ID connecte les UTILISATEURS de funesterie.me et gagne l'ordre de
  // precedence. L'ecraser par celui de la persona casserait toutes les connexions ;
  // poser le sien sous un nom moins prioritaire ne servirait a rien.
  assert.ok(config, 'le bloc de configuration doit etre trouve');
  assert.match(source, /VIVY_GOOGLE_CLIENT_ID/);
  assert.match(source, /VIVY_GOOGLE_CLIENT_SECRET/);
  assert.match(config, /isGmailScopeProfile\(profilEffectif\)/);
});

test('le client persona n est consulte que pour les profils courrier', () => {
  const iGarde = config.indexOf('isGmailScopeProfile');
  const iDefaut = config.indexOf('firstEnv(process.env, GOOGLE_CLIENT_ID_NAMES)');
  assert.ok(iGarde > -1 && iDefaut > iGarde, 'le chemin par defaut doit rester apres la garde');
});

test('configure a moitie, on refuse plutot que de retomber sur le client du site', () => {
  // Traiter une demande de boite mail avec le client de connexion enverrait
  // l'utilisateur consentir a des perimetres que ce client n'a pas declares, et
  // Google refuserait avec un message incomprehensible.
  assert.match(config, /if \(personaId \|\| personaSecret\)/);
  const partiel = config.slice(config.indexOf('if (personaId || personaSecret)'));
  assert.match(partiel.slice(0, 240), /clientId: ''/, 'moitie configure doit rendre une config vide');
});

test('le retour OAuth reprend le profil depuis le state, pas depuis la requete', () => {
  // Google ne renvoie que le code et le state sur le callback : sans cela, l'aller
  // partait sur le client de la persona et le retour tentait d'echanger le code
  // avec celui du site. Google refusait, et l'utilisateur voyait « La connexion
  // externe a echoue » sans le moindre indice de la cause. Vu le 03/08.
  assert.match(config, /function getGoogleOAuthConfig\(req, \{ profil = '' \} = \{\}\)/);
  assert.match(config, /profil \|\| ''\)\.trim\(\) \|\| resolveGoogleOAuthScopeProfile\(req\)/);
  assert.match(
    source,
    /getGoogleOAuthConfig\(req, \{\s*profil: statePayload\?\.oauthScopeProfile,\s*\}\)/,
    'le callback doit passer le profil du state'
  );
});

test('le state emis transporte bien le profil', () => {
  // Sinon le callback n'aurait rien a reprendre.
  assert.match(source, /oauthScopeProfile,\s*\n\s*oauthScopes:/);
});
