# Google OAuth routing for A11, Kaen44 and Vivy

Date: 2026-05-11

## Important distinction

Do not reuse the Cloudflare Access OAuth client for the application login.

Cloudflare Access callback URLs look like:

```txt
https://<team>.cloudflareaccess.com/cdn-cgi/access/callback
```

A11 / Kaen44 application login callback URLs look like:

```txt
https://<app-domain>/api/auth/google/callback
```

If these are mixed, Google returns `redirect_uri_mismatch`.

## Application web OAuth clients

Create or keep one Google OAuth web client per public app surface.

### A11

Authorized JavaScript origins:

```txt
https://a11.funesterie.me
```

Authorized redirect URIs:

```txt
https://a11.funesterie.me/api/auth/google/callback
```

Only add the `a11.funesterie.me` origin/callback if that hostname is
actually routed to the A11 backend. As of this check, the live OAuth start
endpoint that works is `a11.funesterie.me`.

Server profile:

```env
PUBLIC_APP_URL=https://a11.funesterie.me
API_URL=https://a11.funesterie.me
GOOGLE_CALLBACK_URL=https://a11.funesterie.me/api/auth/google/callback
A11_SESSION_COOKIE_SAMESITE=lax
```

### Kaen44

Authorized JavaScript origins:

```txt
https://funesterie.me
https://k44.funesterie.me
https://kaen44.funesterie.me
```

Authorized redirect URIs:

```txt
https://k44.funesterie.me/api/auth/google/callback
https://kaen44.funesterie.me/api/auth/google/callback
```

Server profile:

```env
PUBLIC_APP_URL=https://k44.funesterie.me
API_URL=https://k44.funesterie.me
GOOGLE_CALLBACK_URL=https://k44.funesterie.me/api/auth/google/callback
A11_SESSION_COOKIE_SAMESITE=lax
```

`funesterie.me` can stay the public landing / privacy / terms surface. `k44.funesterie.me` should be the canonical app login surface so the OAuth callback remains unambiguous.

### Vivy / YouTube

Vivy does not need the A11/Kaen44 login client unless she is signing into the same web app.

For YouTube automation, use a separate OAuth client and the YouTube scopes only when needed. Keep its token file out of Git and out of the shared bus.

Suggested redirect type:

```txt
Desktop app OAuth for local setup scripts
```

or, for a server flow:

```txt
https://vivy.funesterie.me/api/auth/youtube/callback
```

only after a dedicated Vivy service exists.

Current local media OAuth setup:

```txt
Project: vivy-496507
Client type: Desktop app
Client name: Vivy Media Desktop
Client secret: D:\projets\funesterie\secrets\google\vivy\client_secret_vivy_media_desktop.json
Token: D:\projets\funesterie\secrets\google\vivy\token_vivy_media.json
Setup script: D:\projets\funesterie\scripts\vivy-media-oauth.py
Scopes:
- https://www.googleapis.com/auth/drive.file
- https://www.googleapis.com/auth/youtube.upload
```

Do not move these media scopes back to the `alphaonze` consent app. `alphaonze` should stay on the basic login scopes only:

```txt
openid
userinfo.email
userinfo.profile
```

## Quick mismatch check

Open the start endpoint without following redirects and inspect the Google `redirect_uri` query parameter:

```powershell
$r = Invoke-WebRequest -Uri "https://k44.funesterie.me/api/auth/google/start" -MaximumRedirection 0 -ErrorAction SilentlyContinue
([uri]$r.Headers.Location).Query
```

The `redirect_uri` shown there must exist exactly in the matching Google OAuth client.
