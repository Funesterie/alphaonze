'use strict';

const crypto = require('node:crypto');
const express = require('express');
const {
  resolveAccountTier,
} = require('../auth/account-connectors.cjs');
const {
  buildAndStoreSocialPromptContext,
  buildProviderAuthUrl,
  buildSocialAutopromptRedactedStatus,
  cleanText,
  exchangeMetaCode,
  exchangeYoutubeCode,
  ensureSocialSchema,
  formatSocialContextForPrompt,
  getFreshSocialTokens,
  ingestYoutubeAccount,
  listSocialAccounts,
  normalizeKind,
  normalizeProvider,
  purgeSocialContext,
  resolveProviderConfig,
  setSocialAccountPaused,
  splitScopes,
  upsertSocialAccount,
} = require('../social/social-autoprompt.cjs');

const SOCIAL_OAUTH_COOKIE = 'a11_social_oauth_state';
const SOCIAL_ALLOWED_TIERS = new Set(['admin', 'admin_family', 'founder', 'family', 'premium']);

function boolEnv(name, fallback = false, env = process.env) {
  const raw = String(env?.[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function getAdminUserId(req) {
  return cleanText(
    req?.user?.id
    || req?.user?.username
    || req?.user?.email
    || process.env.SOCIAL_CONTEXT_USER_ID
    || process.env.VIVY_STREAM_SOCIAL_CONTEXT_USER_ID
    || 'admin',
    160
  ) || 'admin';
}

function redactedProviderConfig(req, env = process.env) {
  return ['youtube', 'meta'].map((provider) => {
    const config = resolveProviderConfig(provider, { env, req });
    return {
      provider: config.provider,
      configured: config.configured,
      plannedOnly: config.plannedOnly === true,
      scopes: config.scopes || [],
      redirectUri: config.redirectUri || '',
      missing: config.missing || [],
    };
  });
}

function createOauthState({ provider, userId }) {
  const nonce = crypto.randomBytes(18).toString('base64url');
  return Buffer.from(JSON.stringify({
    provider,
    userId,
    nonce,
    issuedAt: Date.now(),
  })).toString('base64url');
}

function parseOauthState(value = '') {
  try {
    const parsed = JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - Number(parsed.issuedAt || 0) > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setOauthCookie(res, state) {
  res.cookie(SOCIAL_OAUTH_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 15 * 60 * 1000,
  });
}

function clearOauthCookie(res) {
  res.clearCookie(SOCIAL_OAUTH_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function readCookie(req, name) {
  const parsed = req.cookies?.[name];
  if (parsed) return String(parsed);
  const header = String(req.headers?.cookie || '');
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rawValue.join('=') || '');
  }
  return '';
}

function hasSocialConnectAccess(req, { isAdminRequest, env = process.env } = {}) {
  if (typeof isAdminRequest === 'function' && isAdminRequest(req)) return true;
  const tier = String(resolveAccountTier(req?.user || {}, env) || '').trim().toLowerCase();
  return SOCIAL_ALLOWED_TIERS.has(tier);
}

function resolveSocialContextUserId(env = process.env) {
  return cleanText(
    env.SOCIAL_CONTEXT_USER_ID
    || env.VIVY_STREAM_SOCIAL_CONTEXT_USER_ID
    || '',
    160
  );
}

function createRequireSocialConnectAccess({
  isAdminRequest,
  verifyJWT,
  env = process.env,
  buildForbiddenBody,
} = {}) {
  function sendForbidden(req, res) {
    const payload = typeof buildForbiddenBody === 'function'
      ? buildForbiddenBody(req, res)
      : {
          ok: false,
          error: 'social_connect_access_required',
          message: 'Accès réservé aux comptes Premium, Famille, Fondateur ou Admin.',
        };

    return res.status(403).json(payload);
  }

  return function requireSocialConnectAccess(req, res, next) {
    if (hasSocialConnectAccess(req, { isAdminRequest, env })) {
      return next();
    }

    if (typeof verifyJWT !== 'function') {
      return sendForbidden(req, res);
    }

    return verifyJWT(req, res, () => {
      if (hasSocialConnectAccess(req, { isAdminRequest, env })) {
        return next();
      }
      return sendForbidden(req, res);
    });
  };
}

async function getYoutubeChannelIdentity(accessToken, fetchFn = globalThis.fetch) {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet,statistics,contentDetails');
  url.searchParams.set('mine', 'true');
  url.searchParams.set('maxResults', '1');
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout?.(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return {};
  const channel = data.items?.[0] || {};
  return {
    accountExternalId: cleanText(channel.id, 180) || 'youtube',
    accountLabel: cleanText(channel.snippet?.title, 200) || 'YouTube',
    metadata: {
      channelTitle: cleanText(channel.snippet?.title, 200),
      channelDescription: cleanText(channel.snippet?.description, 1200),
      channelStatistics: channel.statistics || {},
      channelUrl: channel.id ? `https://www.youtube.com/channel/${channel.id}` : '',
    },
  };
}

function normalizeMetaPageInstagramContext(pages = []) {
  const facebookPages = [];
  const instagramAccounts = [];
  const seenInstagramIds = new Set();
  for (const page of Array.isArray(pages) ? pages : []) {
    const pageId = cleanText(page?.id, 180);
    const pageName = cleanText(page?.name, 200);
    if (pageId || pageName) {
      facebookPages.push({
        id: pageId,
        name: pageName,
      });
    }

    const instagram = page?.instagram_business_account;
    const instagramId = cleanText(instagram?.id, 180);
    const username = cleanText(instagram?.username, 120);
    const name = cleanText(instagram?.name, 200);
    const dedupeKey = instagramId || username;
    if (!dedupeKey || seenInstagramIds.has(dedupeKey)) continue;
    seenInstagramIds.add(dedupeKey);
    instagramAccounts.push({
      id: instagramId,
      username,
      name,
      pageId,
      pageName,
    });
  }
  return {
    facebookPages: facebookPages.slice(0, 20),
    instagramAccounts: instagramAccounts.slice(0, 20),
    instagramDetected: instagramAccounts.length > 0,
  };
}

async function getMetaPageInstagramContext(accessToken, fetchFn = globalThis.fetch) {
  const url = new URL('https://graph.facebook.com/v22.0/me/accounts');
  url.searchParams.set('fields', 'id,name,instagram_business_account{id,username,name}');
  url.searchParams.set('limit', '25');
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout?.(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      facebookPages: [],
      instagramAccounts: [],
      instagramDetected: false,
      instagramLookupError: cleanText(data?.error?.message || data?.error_description || `meta_pages_http_${response.status}`, 240),
    };
  }
  return normalizeMetaPageInstagramContext(data?.data || []);
}

async function getMetaAccountIdentity(accessToken, fetchFn = globalThis.fetch) {
  const url = new URL('https://graph.facebook.com/v22.0/me');
  url.searchParams.set('fields', 'id,name');
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout?.(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error_description || `meta_http_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  let pageInstagramContext = {
    facebookPages: [],
    instagramAccounts: [],
    instagramDetected: false,
  };
  try {
    pageInstagramContext = await getMetaPageInstagramContext(accessToken, fetchFn);
  } catch (error) {
    pageInstagramContext = {
      facebookPages: [],
      instagramAccounts: [],
      instagramDetected: false,
      instagramLookupError: cleanText(error?.message || error, 240),
    };
  }
  return {
    accountExternalId: cleanText(data.id, 180) || 'meta',
    accountLabel: cleanText(data.name, 200) || 'Facebook / Instagram',
    metadata: {
      metaName: cleanText(data.name, 200),
      ...pageInstagramContext,
      connectedAt: new Date().toISOString(),
    },
  };
}

function buildSocialConnectHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Social Autoprompt - Funesterie</title>
  <style>
    :root { color-scheme: dark; --bg:#08060d; --panel:#14101f; --line:#392448; --text:#f7eafd; --muted:#bba7c8; --accent:#78e8ff; --pink:#f06adf; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:linear-gradient(135deg,#08060d,#160c1f 55%,#05070a); color:var(--text); font:15px/1.45 system-ui,Segoe UI,Arial,sans-serif; }
    main { width:min(1120px, calc(100vw - 32px)); margin:0 auto; padding:32px 0 48px; }
    h1 { margin:0 0 8px; font-size:clamp(30px,4vw,52px); letter-spacing:0; }
    h2 { margin:0 0 14px; font-size:18px; }
    p { color:var(--muted); max-width:820px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; margin-top:24px; }
    .card { border:1px solid var(--line); border-radius:8px; background:rgba(20,16,31,.86); padding:18px; box-shadow:0 18px 50px rgba(0,0,0,.22); }
    .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    button, a.button { border:1px solid #685078; background:#21162b; color:var(--text); padding:10px 13px; border-radius:6px; font-weight:700; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; gap:8px; }
    button.primary, a.primary { border-color:var(--accent); color:#071014; background:var(--accent); }
    button.warn { border-color:#f5a4d9; color:#24101d; background:#f5a4d9; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    code, pre { background:#07050a; border:1px solid #2b1c38; border-radius:6px; }
    code { padding:2px 5px; }
    pre { overflow:auto; padding:14px; color:#d8f8ff; min-height:140px; }
    input, select { width:100%; border:1px solid var(--line); background:#09070d; color:var(--text); border-radius:6px; padding:10px; }
    label { display:block; margin:12px 0 6px; color:#d8cae8; font-weight:700; }
    .status { color:var(--accent); font-weight:800; }
    .muted { color:var(--muted); }
    .pill { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:4px 9px; color:#f5d8ff; background:#100b18; margin:2px; font-size:12px; }
  </style>
</head>
<body>
  <main>
    <h1>Social Autoprompt</h1>
    <p>Connexion admin pour nourrir Vivy avec le contexte autorisé de tes comptes. V1 lit YouTube, fabrique des fiches créatives redacted, et n'autorise aucune publication automatique.</p>

    <section class="grid">
      <article class="card">
        <h2>Connexions</h2>
        <div id="providers"></div>
      </article>
      <article class="card">
        <h2>Comptes reliés</h2>
        <div id="accounts" class="muted">Chargement...</div>
      </article>
    </section>

    <section class="card" style="margin-top:16px">
      <h2>Tester un contexte Vivy</h2>
      <div class="grid">
        <label>Sujet<input id="topic" value="La fille qui parlait aux machines"></label>
        <label>Usage<select id="kind"><option>chanson</option><option>clip</option><option>post</option><option>description</option><option>hashtag</option></select></label>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="build">Construire la fiche</button>
        <button id="refresh">Actualiser</button>
      </div>
      <pre id="output"></pre>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]);
    }
    function providerLabel(provider) {
      return provider === 'meta' ? 'Facebook / Instagram' : provider === 'youtube' ? 'YouTube' : provider;
    }
    async function api(path, options = {}) {
      const res = await fetch('/api/admin/social-connect' + path, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.message || data.error || 'HTTP ' + res.status);
      return data;
    }
    function renderProviders(providers = []) {
      $('providers').innerHTML = providers.map((p) => {
        const ready = p.configured && !p.plannedOnly;
        const label = providerLabel(p.provider);
        const missing = p.missing?.length ? '<div class="muted">Manque: ' + escapeHtml(p.missing.join(', ')) + '</div>' : '';
        const hint = p.provider === 'meta'
          ? '<div class="muted">Instagram utilise le même bouton Meta. Il apparaît si le compte Instagram est relié à une page Facebook/professionnelle.</div>'
          : '';
        return '<div style="margin-bottom:16px"><div class="row"><strong>' + escapeHtml(label) + '</strong><span class="pill">' + (ready ? 'prêt' : p.plannedOnly ? 'prévu' : 'à configurer') + '</span></div>' +
          '<div class="muted">' + escapeHtml((p.scopes || []).slice(0, 4).join(' · ')) + '</div>' + hint + missing +
          '<div class="row" style="margin-top:10px"><a class="button ' + (ready ? 'primary' : '') + '" href="/api/admin/social-connect/' + encodeURIComponent(p.provider) + '/start">Connecter</a></div></div>';
      }).join('');
    }
    function renderAccounts(accounts = []) {
      if (!accounts.length) { $('accounts').textContent = 'Aucun compte connecté.'; return; }
      $('accounts').innerHTML = accounts.map((a) => {
        const metadata = a.metadata || {};
        const instagramAccounts = Array.isArray(metadata.instagramAccounts) ? metadata.instagramAccounts : [];
        const facebookPages = Array.isArray(metadata.facebookPages) ? metadata.facebookPages : [];
        const instagramLine = a.provider === 'meta'
          ? instagramAccounts.length
            ? '<div class="muted">Instagram détecté: ' + instagramAccounts.map((ig) => '@' + escapeHtml(ig.username || ig.name || ig.id || 'instagram')).join(', ') + '</div>'
            : '<div class="muted">Connexion Meta OK. Aucun Instagram lié détecté ici: il faut souvent un compte Instagram professionnel relié à une page Facebook, puis reconnecter.</div>'
          : '';
        const pageLine = a.provider === 'meta' && facebookPages.length
          ? '<div class="muted">Pages: ' + facebookPages.map((page) => escapeHtml(page.name || page.id || 'page')).slice(0, 5).join(', ') + '</div>'
          : '';
        const lookupLine = a.provider === 'meta' && metadata.instagramLookupError
          ? '<div class="muted">Lecture Instagram limitée: ' + escapeHtml(metadata.instagramLookupError) + '</div>'
          : '';
        return '<div class="card" style="margin:0 0 10px;padding:12px">' +
          '<div class="row"><strong>' + escapeHtml(a.accountLabel || providerLabel(a.provider)) + '</strong><span class="pill">' + escapeHtml(providerLabel(a.provider)) + '</span><span class="pill">' + escapeHtml(a.paused ? 'pause' : a.status) + '</span></div>' +
          '<div class="muted">Expire: ' + escapeHtml(a.expiresAt || 'inconnu') + ' · dernier ingest: ' + escapeHtml(a.lastIngestAt || 'jamais') + '</div>' +
          instagramLine + pageLine + lookupLine +
          '<div class="row" style="margin-top:10px">' +
          '<button data-action="refresh" data-provider="' + escapeHtml(a.provider) + '">Test refresh</button>' +
          '<button data-action="ingest" data-provider="' + escapeHtml(a.provider) + '">Ingest maintenant</button>' +
          '<button data-action="pause" data-provider="' + escapeHtml(a.provider) + '">' + (a.paused ? 'Reprendre' : 'Pause ingest') + '</button>' +
          '<button class="warn" data-action="purge" data-provider="' + escapeHtml(a.provider) + '">Purger contexte</button>' +
          '</div></div>';
      }).join('');
    }
    async function load() {
      const status = await api('/status');
      renderProviders(status.providers || []);
      renderAccounts(status.accounts || []);
      $('output').textContent = JSON.stringify(status.summary || {}, null, 2);
    }
    document.addEventListener('click', async (event) => {
      const target = event.target.closest('button[data-action]');
      if (!target) return;
      const provider = target.dataset.provider;
      const action = target.dataset.action;
      target.disabled = true;
      try {
        if (action === 'refresh') $('output').textContent = JSON.stringify(await api('/' + provider + '/test-refresh', { method:'POST', body:'{}' }), null, 2);
        if (action === 'ingest') $('output').textContent = JSON.stringify(await api('/' + provider + '/ingest-now', { method:'POST', body:'{}' }), null, 2);
        if (action === 'pause') $('output').textContent = JSON.stringify(await api('/' + provider + '/pause', { method:'POST', body: JSON.stringify({ paused: target.textContent.includes('Pause') }) }), null, 2);
        if (action === 'purge' && confirm('Purger le contexte social local ?')) $('output').textContent = JSON.stringify(await api('/' + provider + '/purge-context', { method:'POST', body:'{}' }), null, 2);
      } catch (e) { $('output').textContent = String(e.message || e); }
      finally { await load().catch(() => {}); target.disabled = false; }
    });
    $('refresh').onclick = () => load().catch((e) => $('output').textContent = String(e.message || e));
    $('build').onclick = async () => {
      try {
        const q = new URLSearchParams({ topic: $('topic').value, kind: $('kind').value, limit: '6' });
        $('output').textContent = JSON.stringify(await api('/context?' + q.toString()), null, 2);
      } catch (e) { $('output').textContent = String(e.message || e); }
    };
    load().catch((e) => $('output').textContent = String(e.message || e));
  </script>
</body>
</html>`;
}

function createSocialAutopromptApiRouter({ verifyJWT, isAdminRequest, db, env = process.env, fetchFn = globalThis.fetch } = {}) {
  const router = express.Router();
  const requireSocialConnect = createRequireSocialConnectAccess({ verifyJWT, isAdminRequest, env });

  router.get('/public-status', async (req, res) => {
    try {
      const status = await buildSocialAutopromptRedactedStatus(db, {
        userId: resolveSocialContextUserId(env),
        env,
        req,
      });
      return res.json(status);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        schema: 'funesterie.social-autoprompt.status.v1',
        error: 'social_status_unavailable',
        message: cleanText(error?.message || error, 240),
      });
    }
  });

  router.use(requireSocialConnect);
  router.use(express.json({ limit: '1mb' }));

  router.get('/status', async (req, res) => {
    const userId = getAdminUserId(req);
    try {
      await ensureSocialSchema(db);
      const accounts = await listSocialAccounts(db, { userId });
      res.json({
        ok: true,
        userId,
        providers: redactedProviderConfig(req, env),
        accounts,
        summary: {
          youtubeConfigured: resolveProviderConfig('youtube', { req, env }).configured,
          metaConfigured: resolveProviderConfig('meta', { req, env }).configured,
          ingestWorkerEnabled: boolEnv('SOCIAL_INGEST_WORKER_ENABLED', false, env),
          publicationEnabled: false,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.get('/:provider/start', (req, res) => {
    const provider = normalizeProvider(req.params.provider);
    if (!['youtube', 'meta'].includes(provider)) {
      return res.status(400).json({ ok: false, error: 'social_provider_unsupported' });
    }
    const state = createOauthState({ provider, userId: getAdminUserId(req) });
    const auth = buildProviderAuthUrl(provider, { state, req, env });
    if (!auth.ok) {
      return res.status(400).json({ ok: false, error: 'social_oauth_not_configured', provider, missing: auth.missing || [] });
    }
    setOauthCookie(res, state);
    return res.redirect(auth.url);
  });

  router.get('/youtube/callback', async (req, res) => {
    const queryState = String(req.query.state || '');
    const cookieState = readCookie(req, SOCIAL_OAUTH_COOKIE);
    const parsedState = parseOauthState(queryState);
    clearOauthCookie(res);
    if (!parsedState || !cookieState || queryState !== cookieState || parsedState.provider !== 'youtube') {
      return res.status(400).send('OAuth YouTube invalide ou expiré.');
    }
    try {
      const tokens = await exchangeYoutubeCode({ code: req.query.code, req, env, fetchFn });
      const identity = await getYoutubeChannelIdentity(tokens.access_token, fetchFn);
      const account = await upsertSocialAccount(db, {
        userId: parsedState.userId || getAdminUserId(req),
        provider: 'youtube',
        accountLabel: identity.accountLabel || 'YouTube',
        accountExternalId: identity.accountExternalId || 'youtube',
        scopes: splitScopes(tokens.scope).length ? splitScopes(tokens.scope) : resolveProviderConfig('youtube', { req, env }).scopes,
        tokens,
        metadata: {
          ...(identity.metadata || {}),
          connectedAt: new Date().toISOString(),
        },
      }, env);
      return res.redirect(`/admin/social-connect?connected=youtube&account=${encodeURIComponent(account?.account_label || 'YouTube')}`);
    } catch (error) {
      return res.status(500).send(`Connexion YouTube échouée: ${String(error?.message || error)}`);
    }
  });

  router.get('/meta/callback', async (req, res) => {
    const queryState = String(req.query.state || '');
    const cookieState = readCookie(req, SOCIAL_OAUTH_COOKIE);
    const parsedState = parseOauthState(queryState);
    clearOauthCookie(res);
    if (!parsedState || !cookieState || queryState !== cookieState || parsedState.provider !== 'meta') {
      return res.status(400).send('OAuth Meta invalide ou expiré.');
    }
    try {
      const tokens = await exchangeMetaCode({ code: req.query.code, req, env, fetchFn });
      const identity = await getMetaAccountIdentity(tokens.access_token, fetchFn);
      const account = await upsertSocialAccount(db, {
        userId: parsedState.userId || getAdminUserId(req),
        provider: 'meta',
        accountLabel: identity.accountLabel || 'Facebook / Instagram',
        accountExternalId: identity.accountExternalId || 'meta',
        scopes: splitScopes(tokens.scope).length ? splitScopes(tokens.scope) : resolveProviderConfig('meta', { req, env }).scopes,
        tokens,
        metadata: identity.metadata || {},
      }, env);
      return res.redirect(`/admin/social-connect?connected=meta&account=${encodeURIComponent(account?.account_label || 'Facebook / Instagram')}`);
    } catch (error) {
      return res.status(500).send(`Connexion Meta échouée: ${String(error?.message || error)}`);
    }
  });

  router.post('/:provider/test-refresh', async (req, res) => {
    const provider = normalizeProvider(req.params.provider);
    if (!['youtube', 'meta'].includes(provider)) return res.status(400).json({ ok: false, error: 'social_provider_unsupported' });
    try {
      const bundle = await getFreshSocialTokens(db, { provider, userId: getAdminUserId(req) }, env, fetchFn);
      if (provider === 'meta' && bundle?.tokens?.accessToken) {
        await getMetaAccountIdentity(bundle.tokens.accessToken, fetchFn);
      }
      return res.json({
        ok: Boolean(bundle?.row && bundle?.tokens?.accessToken),
        provider,
        reconnectRequired: bundle?.row?.reconnect_required === true || bundle?.refresh?.reconnectRequired === true,
        refresh: bundle?.refresh || null,
        account: bundle?.row ? {
          provider: bundle.row.provider,
          accountLabel: bundle.row.account_label,
          expiresAt: bundle.tokens?.expiresAt || bundle.row.expires_at || null,
        } : null,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.post('/:provider/ingest-now', async (req, res) => {
    const provider = normalizeProvider(req.params.provider);
    if (provider !== 'youtube') return res.status(501).json({ ok: false, error: 'provider_ingest_planned_only' });
    try {
      const result = await ingestYoutubeAccount(db, {
        userId: getAdminUserId(req),
        limit: Math.max(1, Math.min(50, Number(req.body?.limit || env.SOCIAL_YOUTUBE_INGEST_LIMIT || 12) || 12)),
        fetchFn,
        env,
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.post('/:provider/pause', async (req, res) => {
    const provider = normalizeProvider(req.params.provider);
    try {
      const account = await setSocialAccountPaused(db, {
        provider,
        userId: getAdminUserId(req),
        paused: req.body?.paused !== false,
      });
      return res.json({ ok: Boolean(account), account });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.post('/:provider/purge-context', async (req, res) => {
    try {
      const result = await purgeSocialContext(db, {
        provider: normalizeProvider(req.params.provider),
        userId: getAdminUserId(req),
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.get('/context', async (req, res) => {
    try {
      const context = await buildAndStoreSocialPromptContext(db, {
        userId: getAdminUserId(req),
        topic: cleanText(req.query.topic, 240),
        kind: normalizeKind(req.query.kind),
        limit: Math.max(1, Math.min(12, Number(req.query.limit || 6) || 6)),
      });
      return res.json({
        ok: true,
        context,
        promptBlock: formatSocialContextForPrompt(context),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  return router;
}

function createSocialAutopromptPageRouter({ verifyJWT, isAdminRequest } = {}) {
  const router = express.Router();
  const requireSocialConnect = createRequireSocialConnectAccess({ verifyJWT, isAdminRequest });
  router.get('/', requireSocialConnect, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(buildSocialConnectHtml());
  });
  return router;
}

module.exports = {
  createSocialAutopromptApiRouter,
  createSocialAutopromptPageRouter,
  createRequireSocialConnectAccess,
  getAdminUserId,
  getMetaAccountIdentity,
  hasSocialConnectAccess,
  normalizeMetaPageInstagramContext,
};
