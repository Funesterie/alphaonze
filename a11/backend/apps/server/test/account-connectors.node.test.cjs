'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAccountConnectorState,
  buildConnectorAwareSystemPrompt,
  buildConnectorStateContext,
  isConnectorCapabilitiesQuestion,
  resolveOAuthProviderConfig,
} = require('../src/auth/account-connectors.cjs');

test('detecte les questions outils et connecteurs autorisees', () => {
  assert.equal(isConnectorCapabilitiesQuestion('Quels outils tu as de dispo ?'), true);
  assert.equal(isConnectorCapabilitiesQuestion('Google Drive est lie ?'), true);
  assert.equal(isConnectorCapabilitiesQuestion('as-tu acces au MCP ?'), false);
  assert.equal(isConnectorCapabilitiesQuestion('comment ca va aujourd hui'), false);
});

test('resout la configuration Microsoft avec les alias serveur', () => {
  const config = resolveOAuthProviderConfig('microsoft', {
    env: {
      A11_MICROSOFT_OAUTH_CLIENT_ID: 'client-id',
      A11_MICROSOFT_OAUTH_CLIENT_SECRET: 'client-secret',
      A11_MICROSOFT_CALLBACK_URL: 'https://funesterie.me/api/auth/microsoft/callback',
    },
  });

  assert.equal(config.configured, true);
  assert.equal(config.hasClientId, true);
  assert.equal(config.hasClientSecret, true);
  assert.equal(config.hasCallbackUrl, true);
});

test('construit un etat Basic avec Google Drive autorise par scopes', () => {
  const state = buildAccountConnectorState({
    env: {
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_CALLBACK_URL: 'https://funesterie.me/api/auth/google/callback',
      MICROSOFT_CLIENT_ID: 'ms-id',
      MICROSOFT_CLIENT_SECRET: 'ms-secret',
      MICROSOFT_REDIRECT_URI: 'https://funesterie.me/api/auth/microsoft/callback',
    },
    user: {
      id: 'u1',
      username: 'Jeffrey',
      email: 'jeffrey@example.test',
      provider: 'google',
      oauthScopes: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/drive.file',
      ],
    },
  });

  assert.equal(state.tier, 'basic');
  assert.equal(state.quota.label, '1 Go');
  assert.equal(state.connectors.google.linked, true);
  assert.equal(state.connectors.google.filesAccess, 'authorized');
  assert.equal(state.connectors.microsoft.linked, false);
});

test('construit un etat avec Google et Microsoft lies en meme temps', () => {
  const state = buildAccountConnectorState({
    env: {
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_CALLBACK_URL: 'https://funesterie.me/api/auth/google/callback',
      MICROSOFT_CLIENT_ID: 'ms-id',
      MICROSOFT_CLIENT_SECRET: 'ms-secret',
      MICROSOFT_REDIRECT_URI: 'https://funesterie.me/api/auth/microsoft/callback',
    },
    user: {
      id: 'u1',
      username: 'Jeffrey',
      email: 'jeffrey@example.test',
      provider: 'microsoft',
      oauthConnectors: {
        google: {
          linked: true,
          account: 'jeffrey@gmail.example',
          oauthScopes: ['openid', 'https://www.googleapis.com/auth/drive.file'],
        },
        microsoft: {
          linked: true,
          account: 'jeffrey@funesterie.example',
          oauthScopes: ['openid', 'Files.Read'],
        },
      },
    },
  });

  assert.equal(state.connectors.google.linked, true);
  assert.equal(state.connectors.google.account, 'jeffrey@gmail.example');
  assert.equal(state.connectors.google.filesAccess, 'authorized');
  assert.equal(state.connectors.microsoft.linked, true);
  assert.equal(state.connectors.microsoft.account, 'jeffrey@funesterie.example');
  assert.equal(state.connectors.microsoft.filesAccess, 'authorized');
});

test('construit un etat Fondateur avec connecteurs avances annonces mais bornes a la session', () => {
  const state = buildAccountConnectorState({
    env: {},
    user: {
      id: 'founder-1',
      email: 'founder@example.test',
      accountTier: 'fondateur',
    },
  });

  assert.equal(state.tier, 'founder');
  assert.equal(state.quota.label, '30 Go');
  assert.equal(state.connectors.github.minimumTier, 'founder');
  assert.equal(state.connectors.youtube.minimumTier, 'founder');
  assert.match(buildConnectorStateContext(state), /sans suppression ni acces cross-compte/);
});

test('injecte le bloc connecteurs une seule fois dans le prompt systeme', () => {
  const state = buildAccountConnectorState({ user: { id: 'u1' }, env: {} });
  const prompt = buildConnectorAwareSystemPrompt('Je suis Kaen44.', state);
  const twice = buildConnectorAwareSystemPrompt(prompt, state);

  assert.match(prompt, /Contexte connecteurs Funesterie/);
  assert.match(prompt, /pas une reponse toute faite/);
  assert.equal(twice, prompt);
  assert.doesNotMatch(buildConnectorStateContext(state), /Basic: chat K44/);
});
