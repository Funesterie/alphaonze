'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildProviderAuthUrl,
  exchangeSoundCloudCode,
  fetchSocialRssXml,
  parseSocialRssItems,
  resolveProviderConfig,
  uploadSoundCloudTrack,
} = require('../src/social/social-autoprompt.cjs');

const env = {
  SOCIAL_TOKEN_ENC_KEY: 'test-social-token-key',
  SOCIAL_SOUNDCLOUD_CLIENT_ID: 'soundcloud-client',
  SOCIAL_SOUNDCLOUD_CLIENT_SECRET: 'soundcloud-secret',
  SOCIAL_SOUNDCLOUD_REDIRECT_URI: 'https://funesterie.me/api/admin/social-connect/soundcloud/callback',
};

test('SoundCloud provider config and auth URL use OAuth PKCE without exposing tokens', () => {
  const config = resolveProviderConfig('soundcloud', { env });
  assert.equal(config.configured, true);
  assert.equal(config.provider, 'soundcloud');
  assert.equal(config.redirectUri, env.SOCIAL_SOUNDCLOUD_REDIRECT_URI);
  assert.equal(config.envTokenConfigured, false);

  const auth = buildProviderAuthUrl('soundcloud', {
    env,
    state: 'state-123',
    codeChallenge: 'challenge-abc',
  });
  const url = new URL(auth.url);
  assert.equal(auth.ok, true);
  assert.equal(url.origin, 'https://secure.soundcloud.com');
  assert.equal(url.pathname, '/authorize');
  assert.equal(url.searchParams.get('client_id'), 'soundcloud-client');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.equal(auth.url.includes('soundcloud-secret'), false);
});

test('SoundCloud authorization code exchange posts to the official token host', async () => {
  let request = null;
  const fetchFn = async (url, options = {}) => {
    request = { url: String(url), options };
    return {
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: '',
      }),
    };
  };

  const tokens = await exchangeSoundCloudCode({
    env,
    code: 'code-xyz',
    codeVerifier: 'verifier-123',
    fetchFn,
  });

  assert.equal(tokens.access_token, 'access-token');
  assert.equal(request.url, 'https://secure.soundcloud.com/oauth/token');
  assert.equal(request.options.method, 'POST');
  const body = request.options.body;
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code_verifier'), 'verifier-123');
  assert.equal(body.get('code'), 'code-xyz');
});

test('SoundCloud upload sends OAuth header and multipart track payload', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-soundcloud-upload-'));
  const audioPath = path.join(tmp, 'track.flac');
  fs.writeFileSync(audioPath, Buffer.from('fLaC-test-audio'));
  let request = null;
  const fetchFn = async (url, options = {}) => {
    request = { url: String(url), options };
    return {
      ok: true,
      json: async () => ({
        id: 123,
        title: 'Vivy relique publique',
        permalink_url: 'https://soundcloud.com/funesterie/vivy-relique-publique',
        sharing: 'private',
      }),
    };
  };

  const result = await uploadSoundCloudTrack({
    accessToken: 'access-token',
    audioPath,
    title: 'Vivy relique publique',
    description: 'Projection publique standard.',
    tagList: 'Funesterie Vivy',
  }, fetchFn);

  assert.equal(result.ok, true);
  assert.equal(request.url, 'https://api.soundcloud.com/tracks');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, 'OAuth access-token');
  assert.equal(typeof request.options.body.get, 'function');
  assert.equal(request.options.body.get('track[title]'), 'Vivy relique publique');
  assert.equal(request.options.body.get('track[sharing]'), 'private');
});

test('SoundCloud RSS parser extracts audio items without requiring OAuth', () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>Funesterie SoundCloud</title>
      <link>https://soundcloud.com/funesterie</link>
      <item>
        <title><![CDATA[Vivy - Relique publique]]></title>
        <link>https://soundcloud.com/funesterie/relique-publique</link>
        <guid isPermaLink="false">soundcloud:tracks:123</guid>
        <pubDate>Wed, 08 Jul 2026 12:00:00 GMT</pubDate>
        <description><![CDATA[Projection publique FLAC.]]></description>
        <enclosure url="https://api.soundcloud.com/tracks/123/stream" type="audio/mpeg" />
      </item>
    </channel>
  </rss>`;

  const parsed = parseSocialRssItems(rss, { limit: 5 });
  assert.equal(parsed.channel.title, 'Funesterie SoundCloud');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].externalId, 'soundcloud:tracks:123');
  assert.equal(parsed.items[0].itemType, 'audio');
  assert.equal(parsed.items[0].title, 'Vivy - Relique publique');
  assert.equal(parsed.items[0].raw.enclosure.urlPresent, true);
});

test('SoundCloud RSS fetch rejects redirects outside the allowed RSS hosts', async () => {
  const fetchFn = async () => ({
    status: 301,
    ok: false,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'location'
          ? 'https://www.youtube.com/watch?v=6bqpbj_czhQ'
          : '';
      },
    },
    text: async () => '',
  });

  await assert.rejects(
    () => fetchSocialRssXml('https://feeds.soundcloud.com/users/soundcloud:users:94427536/sounds.rss', { fetchFn }),
    /social_rss_host_denied:www\.youtube\.com/
  );
});
