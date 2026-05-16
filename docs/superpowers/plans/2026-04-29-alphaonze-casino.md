# AlphaOnze Casino Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable AlphaOnze casino view at `/casino` inside the existing A11 web app.

**Architecture:** Keep casino game math in a small pure TypeScript module, then render the experience through a focused React component. Route it from the existing `App.tsx` shell so direct `/casino` loads and menu navigation both work.

**Tech Stack:** React 18, Vite, TypeScript, CSS, Node 24 built-in test runner with `--experimental-strip-types`.

---

## Files

- Create: `a11/frontend/apps/web/src/lib/casino.ts` for symbols, spin resolution, user photo selection, 50/50 Stripe-ready revenue metadata, persistence helpers, prompt/manifest builders.
- Create: `a11/frontend/apps/web/src/lib/casino.node.test.ts` for deterministic logic tests.
- Create: `a11/frontend/apps/web/src/components/CasinoHub.tsx` for the playable casino UI.
- Create: `a11/frontend/apps/web/src/components/CasinoHub.css` for casino visual design and responsive layout.
- Modify: `a11/frontend/apps/web/src/App.tsx` to import the component, add `casino` view state, show menu entry, and sync `/casino`.

## Tasks

### Task 1: Casino Logic

- [ ] Create `src/lib/casino.ts` with exported symbols, `resolveSpin`, `createSeededRng`, `applySpinResult`, `pickPhotoForMontage`, `buildRevenueSplit`, `buildInvocationPack`, and `buildDriveManifest`.
- [ ] Create `src/lib/casino.node.test.ts` that verifies jackpot scoring, credit debit/credit, deterministic RNG, photo-pool selection, 50/50 split metadata, and Drive manifest shape.
- [ ] Run `node --experimental-strip-types --test src/lib/casino.node.test.ts` and confirm it fails before implementation, then passes after implementation.

### Task 2: Casino UI

- [ ] Create `src/components/CasinoHub.tsx` using the logic module.
- [ ] Support stake buttons, spin, replay montage, user photo import, selected-photo montage, session reset, JSON export, prompt copy, and Drive manifest copy.
- [ ] Persist credits/history/gallery in `localStorage`.

### Task 3: Visual System

- [ ] Create `src/components/CasinoHub.css` with a distinctive AlphaOnze casino look, responsive layout, slot reels, cinematic montage, and gallery panels.
- [ ] Keep colors varied and avoid relying on licensed character names or imagery.

### Task 4: A11 Integration

- [ ] Import `CasinoHub` in `App.tsx`.
- [ ] Extend `activeView` to include `casino`.
- [ ] Initialize `casino` when `window.location.pathname` includes `/casino`.
- [ ] Add a menu button that pushes `/casino` and closes overlays.
- [ ] Add a return action that pushes `/` and shows chat.

### Task 5: Verification

- [ ] Run `node --experimental-strip-types --test src/lib/casino.node.test.ts`.
- [ ] Run `npm run build`.
- [ ] Start the dev server and inspect `/casino`.
