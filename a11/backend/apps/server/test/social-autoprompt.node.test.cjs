'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_YOUTUBE_SCOPES,
  YOUTUBE_PUBLIC_CONTEXT_MIGRATION,
  buildSocialAutopromptRedactedStatus,
  buildProviderAuthUrl,
  buildSocialPromptContextFromItems,
  ensureSocialSchema,
  fetchYoutubePublicFeedVideoIds,
  fetchYoutubePublicVideoItems,
  formatSocialContextForPrompt,
  normalizeProvider,
  resolveProviderConfig,
  runSocialDataMigrations,
} = require('../src/social/social-autoprompt.cjs');
const {
  getMetaAccountIdentity,
  hasSocialConnectAccess,
  normalizeMetaPageInstagramContext,
} = require('../src/routes/social-autoprompt.cjs');

test('YouTube ingest ne garde que les metadonnees minimales des videos publiques de la chaine', async () => {
  const requests = [];
  const fetchFn = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith('/channels')) {
      return { ok: true, json: async () => ({ items: [{
        id: 'UCchannel-own',
        snippet: { title: 'Funesterie' },
      }] }) };
    }
    if (url.hostname === 'www.youtube.com' && url.pathname === '/feeds/videos.xml') {
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name === 'content-type' ? 'application/atom+xml' : null },
        text: async () => `<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
            <yt:channelId>channel-own</yt:channelId>
            ${['pub', 'private', 'unlisted', 'other'].map((videoId) => `<entry><yt:videoId>${videoId}</yt:videoId></entry>`).join('')}
          </feed>`,
      };
    }
    if (url.pathname.endsWith('/videos')) {
      const item = (id, channelId, privacyStatus, title) => ({
        id,
        snippet: { channelId, title, description: `description-${id}`, tags: ['ne-doit-pas-etre-conserve'] },
        statistics: { viewCount: '42', likeCount: '999' },
        status: { privacyStatus },
      });
      return { ok: true, json: async () => ({ items: [
        item('pub', 'UCchannel-own', 'public', 'Titre public'),
        item('private', 'UCchannel-own', 'private', 'Titre prive'),
        item('unlisted', 'UCchannel-own', 'unlisted', 'Titre non repertorie'),
        item('other', 'channel-other', 'public', 'Autre chaine'),
      ] }) };
    }
    throw new Error(`requete YouTube inattendue: ${url.pathname}`);
  };

  const result = await fetchYoutubePublicVideoItems('token-test', { limit: 12, fetchFn });
  assert.equal(result.channelId, 'UCchannel-own');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    externalId: 'pub',
    itemType: 'video',
    title: 'Titre public',
    description: 'description-pub',
    url: 'https://www.youtube.com/watch?v=pub',
    publishedAt: null,
    stats: { viewCount: '42' },
    commentsSummary: '',
    raw: { id: 'pub' },
  });
  assert.equal(requests.some((url) => url.pathname.endsWith('/commentThreads')), false);
  assert.equal(requests.some((url) => url.pathname.endsWith('/playlistItems')), false);
  assert.equal(requests.some((url) => url.pathname.endsWith('/search')), false);
  const feedRequest = requests.find((url) => url.pathname === '/feeds/videos.xml');
  assert.equal(feedRequest.hostname, 'www.youtube.com');
  assert.equal(feedRequest.searchParams.get('channel_id'), 'UCchannel-own');
  const videosRequest = requests.find((url) => url.pathname.endsWith('/videos'));
  assert.equal(videosRequest.searchParams.get('part'), 'snippet,statistics,status');
  assert.match(videosRequest.searchParams.get('fields'), /statistics\(viewCount\)/);
  assert.match(videosRequest.searchParams.get('fields'), /status\(privacyStatus\)/);
  const serialized = JSON.stringify(result.items);
  assert.equal(serialized.includes('ne-doit-pas-etre-conserve'), false);
  assert.equal(serialized.includes('likeCount'), false);
  assert.equal(serialized.includes('Titre prive'), false);
});

test('YouTube social OAuth utilise exactement les deux scopes media et un client dedie', () => {
  assert.deepEqual(DEFAULT_YOUTUBE_SCOPES, [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
  ]);

  const generalOnly = resolveProviderConfig('youtube', { env: {
    GOOGLE_CLIENT_ID: 'login-client',
    GOOGLE_CLIENT_SECRET: 'login-secret',
    A11_GOOGLE_CLIENT_ID: 'a11-login-client',
    A11_GOOGLE_CLIENT_SECRET: 'a11-login-secret',
  } });
  assert.equal(generalOnly.configured, false);
  assert.equal(generalOnly.clientId, '');
  assert.equal(generalOnly.clientSecret, '');

  const dedicated = resolveProviderConfig('youtube', { env: {
    YOUTUBE_CLIENT_ID: 'youtube-client',
    YOUTUBE_CLIENT_SECRET: 'youtube-secret',
    SOCIAL_YOUTUBE_SCOPES: 'openid email profile https://www.googleapis.com/auth/youtube.readonly',
  } });
  assert.equal(dedicated.configured, true);
  assert.deepEqual(dedicated.scopes, DEFAULT_YOUTUBE_SCOPES);
  const auth = buildProviderAuthUrl('youtube', { env: {
    SOCIAL_YOUTUBE_CLIENT_ID: 'youtube-client',
    SOCIAL_YOUTUBE_CLIENT_SECRET: 'youtube-secret',
  }, state: 'scope-test' });
  const authUrl = new URL(auth.url);
  assert.deepEqual(authUrl.searchParams.get('scope').split(' '), DEFAULT_YOUTUBE_SCOPES);
  assert.equal(authUrl.searchParams.get('include_granted_scopes'), 'false');

  const source = fs.readFileSync(path.join(__dirname, '../src/social/social-autoprompt.cjs'), 'utf8');
  assert.doesNotMatch(source, /include_granted_scopes['"],\s*['"]true['"]/);
});

test('le flux public YouTube refuse une redirection hors youtube.com et borne la reponse', async () => {
  const redirected = async () => ({
    ok: false,
    status: 302,
    headers: { get: (name) => name === 'location' ? 'https://attacker.example/videos.xml?channel_id=channel-own' : null },
  });
  await assert.rejects(
    () => fetchYoutubePublicFeedVideoIds('channel-own', { fetchFn: redirected }),
    /youtube_public_feed_url_denied/
  );

  const oversized = async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === 'content-length' ? '4096' : 'application/atom+xml' },
    text: async () => '<feed/>',
  });
  await assert.rejects(
    () => fetchYoutubePublicFeedVideoIds('channel-own', { fetchFn: oversized, maxBytes: 1024 }),
    /youtube_public_feed_too_large/
  );
});

test('la migration YouTube globale est atomique, multi-utilisateur et idempotente', async () => {
  const queries = [];
  const migrationRuns = [];
  let migrationApplied = false;
  const db = {
    async query(sql, params) {
      const statement = String(sql);
      queries.push({ sql: statement, params });
      if (/WITH claimed_migration AS/i.test(statement)) {
        const applied = !migrationApplied;
        migrationApplied = true;
        migrationRuns.push(applied);
        return { rows: [{
          applied,
          deleted_youtube_items: applied ? 7 : 0,
          deleted_youtube_snapshots: applied ? 3 : 0,
          deleted_prompt_context: applied ? 5 : 0,
        }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  await ensureSocialSchema(db);
  await ensureSocialSchema(db);

  const migrationTableQueries = queries.filter((entry) => /CREATE TABLE IF NOT EXISTS social_data_migrations/i.test(entry.sql));
  const migrationQueries = queries.filter((entry) => /WITH claimed_migration AS/i.test(entry.sql));
  assert.equal(migrationTableQueries.length, 2);
  assert.equal(migrationQueries.length, 2);
  assert.deepEqual(migrationRuns, [true, false]);
  assert.deepEqual(migrationQueries.map((entry) => entry.params), [
    [YOUTUBE_PUBLIC_CONTEXT_MIGRATION],
    [YOUTUBE_PUBLIC_CONTEXT_MIGRATION],
  ]);

  const migrationSql = migrationQueries[0].sql;
  assert.match(migrationSql, /INSERT INTO social_data_migrations[\s\S]*ON CONFLICT \(migration_key\) DO NOTHING[\s\S]*RETURNING migration_key/i);
  assert.match(migrationSql, /DELETE FROM social_items\s+WHERE provider = 'youtube'\s+AND EXISTS \(SELECT 1 FROM claimed_migration\)/i);
  assert.match(migrationSql, /DELETE FROM social_context_snapshots\s+WHERE provider = 'youtube'\s+AND EXISTS \(SELECT 1 FROM claimed_migration\)/i);
  assert.match(migrationSql, /DELETE FROM social_prompt_context\s+WHERE EXISTS \(SELECT 1 FROM claimed_migration\)/i);
  assert.doesNotMatch(migrationSql, /user_id\s*=/i);
  assert.equal((migrationSql.match(/DELETE FROM /gi) || []).length, 3);

  const ensureSource = ensureSocialSchema.toString();
  assert.match(ensureSource, /await runSocialDataMigrations\(db\)/);
  assert.doesNotMatch(runSocialDataMigrations.toString(), /accessToken|reconnect_required|paused|fetchFn/);
});

test('la page de confidentialite decrit les deux perimetres YouTube et leurs verrous', () => {
  const privacy = fs.readFileSync(path.join(__dirname, '../../../../frontend/apps/web/public/privacy/index.html'), 'utf8');
  assert.match(privacy, /youtube\.readonly/);
  assert.match(privacy, /youtube\.upload/);
  assert.match(privacy, /confirmation explicite/i);
  assert.match(privacy, /statut privé par défaut/i);
  assert.match(privacy, /ne\s+modifie ni ne supprime/i);
  assert.doesNotMatch(privacy, /Aucune\s+autorisation\s+d'envoi\s+de\s+vidéo\s+n'est\s+demandée/i);
});

test('social prompt context builds redacted creative guidance from recent items', () => {
  const context = buildSocialPromptContextFromItems([
    {
      id: 1,
      provider: 'youtube',
      item_type: 'video',
      title: 'La fille qui parlait aux machines',
      description: 'Une fille comprend les néons, les moteurs et les vieux robots. Toute la ville finit par danser avec elle. #Vivy',
      comments_summary: 'Le refrain est lumineux ! | On veut plus de machines qui répondent en rythme.',
      url: 'https://youtube.example/video',
      published_at: '2026-07-01T00:00:00.000Z',
    },
  ], {
    topic: 'machines',
    kind: 'chanson',
    limit: 4,
  });

  assert.equal(context.kind, 'chanson');
  assert.match(context.dominantTone, /machine|créatif|électro|techno|lumineux/i);
  assert.ok(context.strongPhrases.some((entry) => /machines|néons|refrain/i.test(entry)));
  assert.ok(context.creativeAngles.length > 0);
  assert.ok(context.clipIdeas.some((entry) => /Clip|faux textes/i.test(entry)));
  assert.ok(context.songPromptSeeds.some((entry) => /machines/i.test(entry)));
  assert.ok(context.hashtags.includes('#Vivy'));
  assert.ok(context.avoid.some((entry) => /privées|tokens|statistiques|anciens titres/i.test(entry)));
});

test('formatted social prompt block is clearly private and non chantable', () => {
  const context = buildSocialPromptContextFromItems([
    {
      title: 'Victoire en néons',
      description: 'Le public aime les phrases courtes et les refrains qui se retiennent.',
      comments_summary: 'Banger lumineux !',
    },
  ], { topic: 'victoire', kind: 'chanson' });
  const prompt = formatSocialContextForPrompt(context);
  assert.match(prompt, /privé, non chantable/);
  assert.match(prompt, /Ne récite jamais ce bloc/);
  assert.equal(prompt.includes('access_token'), false);
});

test('provider normalization handles planned social providers', () => {
  assert.equal(normalizeProvider('YouTube'), 'youtube');
  assert.equal(normalizeProvider('Instagram'), 'meta');
  assert.equal(normalizeProvider('Amazon Music'), 'amazon_music');
});

test('Meta OAuth is active when application credentials are configured', () => {
  const env = {
    SOCIAL_META_APP_ID: 'meta-app-id',
    SOCIAL_META_APP_SECRET: 'meta-app-secret',
    SOCIAL_META_REDIRECT_URI: 'https://funesterie.me/api/admin/social-connect/meta/callback',
  };
  const config = resolveProviderConfig('instagram', { env });
  const auth = buildProviderAuthUrl('meta', { env, state: 'state-test' });

  assert.equal(config.configured, true);
  assert.equal(config.plannedOnly, undefined);
  assert.equal(auth.ok, true);
  assert.equal(auth.plannedOnly, undefined);
  assert.match(auth.url, /facebook\.com\/v22\.0\/dialog\/oauth/);
  assert.match(auth.url, /instagram_basic/);
});

test('Meta identity stores linked Instagram business accounts when available', async () => {
  const requests = [];
  const fetchFn = async (url) => {
    const href = String(url);
    requests.push(href);
    if (href.includes('/me?')) {
      return {
        ok: true,
        json: async () => ({ id: 'meta-user-1', name: 'Cellauro Jeffrey' }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'page-1',
            name: 'Funesterie',
            instagram_business_account: {
              id: 'ig-1',
              username: 'vivy_funesterie',
              name: 'Vivy Funesterie',
            },
          },
        ],
      }),
    };
  };

  const identity = await getMetaAccountIdentity('meta-token', fetchFn);

  assert.equal(identity.accountExternalId, 'meta-user-1');
  assert.equal(identity.accountLabel, 'Cellauro Jeffrey');
  assert.equal(identity.metadata.instagramDetected, true);
  assert.equal(identity.metadata.instagramAccounts[0].username, 'vivy_funesterie');
  assert.equal(identity.metadata.facebookPages[0].name, 'Funesterie');
  assert.equal(requests.length, 2);
});

test('Meta Instagram context deduplicates linked pages', () => {
  const context = normalizeMetaPageInstagramContext([
    {
      id: 'page-1',
      name: 'Page A',
      instagram_business_account: { id: 'ig-1', username: 'vivy' },
    },
    {
      id: 'page-2',
      name: 'Page B',
      instagram_business_account: { id: 'ig-1', username: 'vivy' },
    },
  ]);

  assert.equal(context.facebookPages.length, 2);
  assert.equal(context.instagramAccounts.length, 1);
  assert.equal(context.instagramDetected, true);
});

test('Social Connect is available for paid family/founder accounts without admin token', () => {
  assert.equal(hasSocialConnectAccess({
    user: { id: 'premium-1', accountTier: 'premium' },
  }, { isAdminRequest: () => false, env: {} }), true);

  assert.equal(hasSocialConnectAccess({
    user: { id: 'family-1', accountTier: 'famille' },
  }, { isAdminRequest: () => false, env: {} }), true);

  assert.equal(hasSocialConnectAccess({
    user: { id: 'founder-1', accountTier: 'fondateur' },
  }, { isAdminRequest: () => false, env: {} }), true);

  assert.equal(hasSocialConnectAccess({
    user: { id: 'basic-1', accountTier: 'basic' },
  }, { isAdminRequest: () => false, env: {} }), false);
});

test('redacted Social Autoprompt status reports routing without leaking private account data', async () => {
  const fakeDb = {
    async query(sql) {
      if (/SELECT id, user_id, provider, account_label/i.test(sql)) {
        return {
          rows: [
            {
              id: 1,
              user_id: 'admin',
              provider: 'youtube',
              account_label: 'private-channel@example.test',
              account_external_id: 'yt-private-id',
              scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
              token_hash: 'secret-token-hash',
              expires_at: '2026-08-01T00:00:00.000Z',
              last_refresh_at: '2026-07-03T10:00:00.000Z',
              last_ingest_at: '2026-07-03T11:00:00.000Z',
              status: 'connected',
              reconnect_required: false,
              paused: false,
              metadata_json: { ownerEmail: 'private@example.test' },
            },
            {
              id: 2,
              user_id: 'admin',
              provider: 'meta',
              account_label: 'Private Facebook Name',
              account_external_id: 'meta-private-id',
              scopes: ['public_profile', 'pages_show_list', 'instagram_basic'],
              token_hash: 'meta-secret-token-hash',
              expires_at: '2026-09-01T00:00:00.000Z',
              last_refresh_at: '2026-07-03T10:00:00.000Z',
              last_ingest_at: null,
              status: 'connected',
              reconnect_required: false,
              paused: false,
              metadata_json: {
                facebookPages: [{ id: 'page-private-id', name: 'Funesterie' }],
                instagramAccounts: [{ id: 'ig-private-id', username: 'vivy_funesterie', pageId: 'page-private-id' }],
              },
            },
          ],
        };
      }
      if (/FROM social_items/i.test(sql) && /GROUP BY provider/i.test(sql)) {
        return { rows: [{ provider: 'youtube', count: 7 }] };
      }
      if (/FROM social_prompt_context/i.test(sql)) {
        return { rows: [{ count: 2 }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const status = await buildSocialAutopromptRedactedStatus(fakeDb, {
    userId: 'admin',
    env: {
      SOCIAL_YOUTUBE_CLIENT_ID: 'youtube-client',
      SOCIAL_YOUTUBE_CLIENT_SECRET: 'youtube-secret',
      SOCIAL_META_APP_ID: 'meta-app',
      SOCIAL_META_APP_SECRET: 'meta-secret',
    },
  });
  const serialized = JSON.stringify(status);

  assert.equal(status.ok, true);
  assert.equal(status.youtubeConnected, true);
  assert.equal(status.youtubeOAuthConnected, true);
  assert.equal(status.youtubeReconnectRequired, false);
  assert.equal(status.youtubeCachedContextAvailable, true);
  assert.equal(status.youtubeIngestOk, true);
  assert.equal(status.youtubeItemsCount, 7);
  assert.equal(status.metaConfigured, true);
  assert.equal(status.metaConnected, true);
  assert.equal(status.metaPageSelected, true);
  assert.equal(status.socialPromptContextAvailable, true);
  assert.equal(status.primaryCreativeSource, 'youtube');
  assert.equal(serialized.includes('private@example.test'), false);
  assert.equal(serialized.includes('secret-token-hash'), false);
  assert.equal(serialized.includes('yt-private-id'), false);
});

test('redacted status separates cached context from live OAuth when reconnect is required', async () => {
  const fakeDb = {
    async query(sql) {
      if (/SELECT id, user_id, provider, account_label/i.test(sql)) {
        return {
          rows: [
            {
              id: 1,
              user_id: 'admin',
              provider: 'youtube',
              account_label: 'channel',
              account_external_id: 'yt-id',
              scopes: [],
              token_hash: 'hash',
              expires_at: '2026-08-01T00:00:00.000Z',
              last_refresh_at: '2026-07-03T10:00:00.000Z',
              last_ingest_at: '2026-07-04T09:18:00.000Z',
              status: 'reconnect_required',
              reconnect_required: true,
              paused: false,
              metadata_json: {},
            },
          ],
        };
      }
      if (/FROM social_items/i.test(sql) && /GROUP BY provider/i.test(sql)) {
        return { rows: [{ provider: 'youtube', count: 14 }] };
      }
      if (/FROM social_prompt_context/i.test(sql)) {
        return { rows: [{ count: 3 }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const status = await buildSocialAutopromptRedactedStatus(fakeDb, {
    userId: 'admin',
    env: {
      SOCIAL_YOUTUBE_CLIENT_ID: 'youtube-client',
      SOCIAL_YOUTUBE_CLIENT_SECRET: 'youtube-secret',
    },
  });

  assert.equal(status.youtubeOAuthConnected, false);
  assert.equal(status.youtubeConnected, false);
  assert.equal(status.youtubeReconnectRequired, true);
  assert.equal(status.youtubeCachedContextAvailable, true);
  assert.equal(status.youtubeIngestOk, false);
  assert.equal(status.youtubeItemsCount, 14);
  assert.equal(status.socialPromptContextAvailable, true);
  assert.ok(status.limitations.includes('youtube_reconnect_required_cached_context_only'));
  assert.ok(status.limitations.includes('youtube_context_served_from_cache_no_live_ingest'));
});

test('disconnectSocialAccount clears sealed tokens and marks the account disconnected', async () => {
  const { disconnectSocialAccount } = require('../src/social/social-autoprompt.cjs');
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/UPDATE social_accounts/i.test(sql)) {
        return {
          rows: [{
            id: 7,
            user_id: 'admin',
            provider: 'youtube',
            account_label: 'chaine',
            account_external_id: 'yt-id',
            scopes: [],
            token_hash: null,
            expires_at: null,
            last_refresh_at: null,
            last_ingest_at: '2026-07-04T10:34:00.000Z',
            status: 'disconnected',
            reconnect_required: false,
            paused: false,
            metadata_json: {},
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const account = await disconnectSocialAccount(fakeDb, { provider: 'youtube', userId: 'admin' });
  const updateQuery = queries.find((entry) => /UPDATE social_accounts/i.test(entry.sql));
  assert.ok(updateQuery, 'update query missing');
  assert.match(updateQuery.sql, /token_sealed = NULL/i);
  assert.match(updateQuery.sql, /token_hash = NULL/i);
  assert.match(updateQuery.sql, /status = 'disconnected'/i);
  assert.deepEqual(updateQuery.params, ['youtube', 'admin']);
  assert.equal(account.status, 'disconnected');
  assert.equal(account.hasToken, false);

  const missing = await disconnectSocialAccount({ async query() { return { rows: [] }; } }, { provider: 'meta' });
  assert.equal(missing, null);
});
