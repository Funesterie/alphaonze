# AlphaOnze Casino Design

## Goal

Add a playable A11 casino surface at `/casino` that feels like an AlphaOnze attraction: immediate play, strong original visuals, image/video invocation prompts, and export/Drive-ready options.

## Product Shape

The casino is a self-contained front-end view inside the existing A11 React app. It keeps the current A11 shell and authentication, adds a menu entry, and supports direct reloads through the existing SPA redirect rule.

The first version is fictional-play only: local credits, local session state, no real-money mechanics, no payment, and no external gambling service. Wins unlock original “A11 mecha/sentai” themed imagery and a replayable montage panel. The direction is inspired by giant robot transformation energy without using Power Rangers, Megazord, or other licensed assets.

## Core Experience

- Slots with credits, stake selection, spin, win tiers, combo names, and recent spin history.
- “Invocation” prompts for original AlphaOnze images and video scenes.
- A local user-photo pool: the user explicitly imports photos, then A11 picks from that granted pool for montage inspiration and poster frames. The app never scans photos without user selection.
- A cinematic montage panel built from CSS/React layers, with replay control and win-reactive copy.
- Gallery/export actions: copy prompt pack, export JSON session, copy Drive manifest.
- Stripe-ready revenue split metadata for paid generation packs: 50% creator, 50% platform before processor fees. This is separate from fictional casino credits.
- Persistence in `localStorage` so the player keeps credits and history between reloads.

## Integration

- Create focused casino logic in `src/lib/casino.ts`.
- Create the UI in `src/components/CasinoHub.tsx`.
- Create styling in `src/components/CasinoHub.css`.
- Import and route from `src/App.tsx` with an `activeView` value of `casino`.
- Use `/casino` on initial load and update `history.pushState` when navigating from the A11 menu.

## Validation

- Add a Node test for casino logic using Node 24 type stripping.
- Run the casino logic test.
- Run the existing web build.
- Start the Vite dev server and inspect `/casino` in a browser when possible.
