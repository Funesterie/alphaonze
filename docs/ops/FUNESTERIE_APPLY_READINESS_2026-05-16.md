# Funesterie Apply Readiness - 2026-05-16

Status: in progress, safe to continue.

## Desktop Control

Validated script:

- `D:\projets\funesterie\scripts\Desktop-Control.ps1`
- test harness: `D:\projets\funesterie\scripts\Test-DesktopControl.ps1`

Checks passed:

- help
- list-windows
- foreground
- cursor
- hotkey dry-run
- mouse dry-run
- scroll dry-run
- alt-tab dry-run
- run-json dry-run
- screenshot dry-run

This gives Codex/Kiro a reusable local UI control surface for browser/app work without ad-hoc PowerShell each time.

## Public Surface Probe

Known healthy:

- `https://funesterie.me/`
- `https://funesterie.me/vivy/`
- `https://funesterie.me/a11/`
- `https://funesterie.me/k44/`
- `https://a11.funesterie.me/`
- `https://a11.funesterie.me/health`
- `https://k44.funesterie.me/`
- `https://k44.funesterie.me/health`
- `https://mcp.funesterie.me/health`

Protected by design:

- `https://a11.funesterie.me/api/a11/pink-ward/status` -> 401 without JWT
- `https://a11.funesterie.me/api/runtime/modules` -> 401 without JWT
- `https://a11.funesterie.me/api/runtime/chopper` -> 401 without JWT
- `https://a11.funesterie.me/api/runtime/mixer` -> 401 without JWT

Public redacted status:

- `https://a11.funesterie.me/api/ekko/status` -> 200, no secrets

## Payments

Stripe:

- checkout and portal defaults now derive from `A11_PUBLIC_BASE_URL` / `PUBLIC_APP_URL` / `FRONTEND_URL`, falling back to `https://a11.funesterie.me`
- checkout now refuses to start without a real `STRIPE_PRICE_ID`
- `isStripeEnabled()` now requires both Stripe secret and price id

PayPal:

- `/api/paypal/config` now derives default webhook URL from the incoming public host or explicit env
- no token or secret is emitted
- prod currently reports `configured:false`; set env before real use

Required env before real payment launch:

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL` optional override
- `STRIPE_CANCEL_URL` optional override
- `STRIPE_PORTAL_RETURN_URL` optional override
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `PAYPAL_RECEIVER_EMAIL`
- `PAYPAL_ENV=sandbox` for tests, then `live`

## Role Routing

Added safe tool:

- `agent_role_route`

Default ownership:

- ChatGPT: orchestration, priority, arbitration, synthesis, dispatch.
- Chopper: repair, diagnostics, patches, tests, configs, workers, queues.
- Qflush: perception/action, vision, bounded mouse/keyboard/gamepad, UI smoke tests.
- A11: memory, graph, corpus, identity, NOSSEN/lore, semantic context.
- Kaen44: client/demo flows, accessibility, prompts, briefs, documents, invoices.
- Vivy: audio, voice, music, lyrics, SFX, composition, Ekko/media identity.
- Codex/Kiro: bounded implementation, verification, codebase navigation.

The tool returns primary agent, ordered fallbacks, confidence, keyword hits and safety policy.

## Next

1. Deploy the payment/default URL patch to prod.
2. Set sandbox payment env and test checkout/webhook.
3. Wire `agent_role_route` into MCP/Nexus dashboards if needed.
4. Keep Google Cloud as the next platform step after OAuth/payment validation.
