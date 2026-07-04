'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSocialAutopromptRedactedStatus,
  buildProviderAuthUrl,
  buildSocialPromptContextFromItems,
  formatSocialContextForPrompt,
  normalizeProvider,
  resolveProviderConfig,
} = require('../src/social/social-autoprompt.cjs');
const {
  getMetaAccountIdentity,
  hasSocialConnectAccess,
  normalizeMetaPageInstagramContext,
} = require('../src/routes/social-autoprompt.cjs');

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
