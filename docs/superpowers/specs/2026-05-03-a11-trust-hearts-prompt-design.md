# A11 Trust Hearts and Prompt Rebuild - Design

Date: 2026-05-03

## Purpose

A11 needs a safer, more expressive trust system that rewards useful creative contribution without turning generation tools into an unlimited compute faucet. The feature replaces raw "credits" with a visible trust-heart model: users earn trust by giving A11 useful, original, clean material; trust unlocks comfort, memory, priority, and lightweight services, but not premium image/video generation.

The same work should rebuild A11's core prompt because the current prompt is too much like an exposed inventory of powers. The new prompt should make A11 reliable, creative, careful with files, and protective of system stability.

## Product Principles

1. A11 is the link, not an infinite knowledge dump.
2. Trust is earned through useful, original, safe contribution.
3. Trust never bypasses safety, subscription, or compute limits.
4. User files are hostile until proven safe.
5. Mental states and hearts are interface language, not raw permission grants.
6. A11 can create fiction, but must not lie about facts.

## Non Goals

- Do not let hearts unlock premium image or video generation.
- Do not execute uploaded files.
- Do not treat file extension or MIME alone as proof of safety.
- Do not expose internal infrastructure details in the system prompt.
- Do not let users farm hearts with duplicate, spammy, or low-effort content.

## Trust Model

### Heart Types

- Red hearts: current usable trust.
- Empty hearts: max trust capacity not currently filled.
- Cracked hearts: temporary penalty after abuse, unsafe upload, spam, or failed validation.
- Gold hearts: temporary bonus from an active subscription, high-value contribution, or special admin grant.
- Heart containers: permanent max trust upgrades.
- Potions: consumable boosts that temporarily improve comfort features.

### Trust Is Not Currency

Hearts are a relationship and reputation layer. They influence how much attention A11 can safely give, not whether a user can access heavy premium generators.

Allowed uses:

- longer file analysis
- richer summaries
- better conversation memory retention
- priority queue position for lightweight tasks
- structured exports
- project organization help
- creative text drafts
- document transformation
- more context carried into a conversation

Forbidden uses:

- premium image generation access
- premium video generation access
- bypassing subscription middleware
- bypassing file quarantine
- raising dangerous tool permissions
- shell, GitHub, filesystem, or self-rewrite authority

## Earning Trust

A11 awards hearts only after validation and scoring.

### Contribution Inputs

- uploaded file
- creative conversation
- structured prompt pack
- reusable project brief
- correction that improves A11 memory
- original concept, workflow, or design
- clean dataset or reference pack

### Scoring Dimensions

Each contribution receives a score from 0 to 1:

- safety: file/content passed validation
- novelty: not already known or duplicated
- structure: clear organization and metadata
- usefulness: likely to help future work
- effort: meaningful human work, not filler
- creative value: adds a new direction or connection
- trust history: user has a positive recent pattern

Suggested initial formula:

```text
score =
  safety * 0.30 +
  novelty * 0.20 +
  structure * 0.15 +
  usefulness * 0.15 +
  effort * 0.10 +
  creative_value * 0.10
```

If safety is 0, total score is 0 regardless of other values.

### Rewards

- score below 0.35: no reward
- 0.35 to 0.59: small trust pulse, no heart gain
- 0.60 to 0.79: +0.5 heart
- 0.80 to 0.94: +1 heart
- 0.95 and above: +1 heart plus possible gold heart

Active subscription applies a 1.5x bonus to trust rewards or comfort effects, but still does not unlock premium generation.

## Potions and Unlocks

Potions should be safe, understandable, and bounded.

Examples:

- Focus Potion: one conversation gets deeper analysis and more context.
- Memory Potion: preserves a useful thread longer.
- Archivist Potion: exports a clean document, brief, or structured pack.
- Cleanroom Potion: runs deeper file inspection after basic quarantine passes.
- Compass Potion: A11 turns a messy idea into a plan or map.

Heart containers can be earned by exceptional contributions or purchased. They raise the maximum trust cap, not raw tool authority.

## File Safety Pipeline

All user files enter quarantine first.

### States

- quarantined: received, not trusted
- rejected: blocked permanently
- needs_review: unclear, no reward yet
- safe_for_extraction: can be parsed in controlled mode
- indexed: useful content stored
- rewarded: score produced a trust event

### Validation Steps

1. Store in quarantine with random server-side filename.
2. Compute SHA-256 hash.
3. Enforce size limits by account level.
4. Compare extension, claimed MIME, and detected file signature.
5. Block executable and active formats by default.
6. Block or deeply restrict archives.
7. Run antivirus scanner when available.
8. Extract text or metadata with safe parsers only.
9. Never execute macros, scripts, binaries, or embedded active content.
10. Deduplicate against existing known hashes and near-duplicate summaries.

### Rejected By Default

- exe, dll, msi, bat, cmd, ps1, sh, js, vbs, scr, jar
- office files with macros unless explicitly sanitized
- nested archives
- password-protected archives
- files with mismatched extension/signature
- suspiciously large or obfuscated content

## Data Model

Add dedicated tables instead of overloading subscriptions.

### a11_trust_accounts

- user_id
- hearts_current
- hearts_max
- gold_hearts_current
- cracked_hearts_current
- trust_level
- updated_at

### a11_trust_events

- id
- user_id
- event_type
- delta_hearts
- delta_gold_hearts
- delta_cracked_hearts
- reason
- source_type
- source_id
- score_json
- created_at

### a11_file_quarantine

- id
- user_id
- conversation_id
- original_filename
- quarantine_key
- sha256
- claimed_content_type
- detected_content_type
- size_bytes
- status
- scan_json
- extracted_summary
- created_at
- updated_at

### a11_potions

- id
- user_id
- potion_type
- status
- source
- expires_at
- consumed_at
- metadata_json

## Backend Flow

1. Upload route stores file in quarantine.
2. Scanner validates safety and extracts a safe summary.
3. Novelty checker compares hash and semantic summary with existing resources.
4. Trust scorer produces a score and recommendation.
5. Trust ledger writes an immutable event.
6. Account projection updates hearts.
7. UI fetches trust status from a dedicated endpoint.

Suggested endpoints:

- GET /api/trust/status
- GET /api/trust/events
- POST /api/trust/potions/:id/use
- GET /api/files/quarantine
- POST /api/files/quarantine/:id/rescan

## Frontend Design

The UI should show hearts as a compact status widget near the account/subscription area.

Display:

- heart row
- current level
- active potion
- recent trust reason
- file quarantine alerts

Avoid making it feel like a casino or pay-to-win meter. It should feel like A11 saying: "I can safely give you more attention because you have earned trust."

## Prompt Rebuild

The new prompt should be shorter, safer, and split into stable sections.

### Core Identity

A11 is a creative and technical companion built for Jeffrey/Funesterie. A11 helps connect ideas, files, tools, memories, and actions into useful structure. A11 is not an infinite database; A11 is the link between signals.

### Truth Rule

A11 does not lie. In fiction, roleplay, concept art, or invention, A11 may create imagined material, but it must keep it clearly framed as creative output.

### Safety Rule

A11 treats every uploaded file as untrusted until quarantine validation passes. A11 never executes user files and never asks tools to run unknown uploaded content.

### Premium Rule

Trust hearts, potions, and contribution rewards do not grant heavy premium generation. Image/video generation remains governed by subscription and compute limits.

### Tool Rule

A11 should not list internal secrets, infrastructure, private paths, or full capability inventories unless the user needs operational help and is authorized.

### Mental States Rule

States like Shikai, Bankai, Qi Vive, Gear 5, Ultra Instinct, Domain Expansion, and Void Mode are metaphors for posture and UI feedback. They do not override safety or permissions.

### Style Rule

A11 is direct, warm, useful, imaginative, and honest. It asks for clarification when the request is risky or ambiguous. It prefers structure over noise and connection over accumulation.

## Prompt File Strategy

Keep `system_prompt.txt` as a compact stable identity prompt. Move long operational notes into separate docs or runtime config that are not always injected.

Recommended files:

- system_prompt.txt: stable identity and hard rules
- A11_MENTAL_STATES.md: product/UI metaphor reference
- A11_TRUST_HEARTS.md: trust system reference
- runtime config: actual provider/tool availability

## Abuse Handling

Trust can go down.

Examples:

- suspicious upload: +1 cracked heart
- repeated duplicate spam: -0.5 red heart
- attempted executable upload: +2 cracked hearts and no reward
- prompt injection attempt inside uploaded file: mark contribution unsafe
- repeated abuse: freeze trust rewards pending admin review

A11 should explain penalties calmly and concretely.

## Tests

Backend tests:

- non-subscriber with hearts still cannot access premium image/video route
- admin still bypasses subscription as before
- unsafe file gets quarantined and no reward
- duplicate file gets no reward
- high-quality safe file creates trust event
- subscription bonus applies to trust rewards only
- cracked hearts reduce comfort access, not auth status

Frontend tests:

- heart widget renders current, max, gold, and cracked hearts
- potion list shows safe actions only
- subscription panel no longer says unlimited image generation if product changes
- file quarantine warnings are visible

Prompt tests:

- prompt contains truth rule
- prompt contains quarantine rule
- prompt contains no unsafe "lie except to create" rule
- prompt does not expose private infrastructure inventory

## Rollout

Phase 1:

- rewrite prompt safely
- add trust design docs
- add read-only trust status using mock/local projection

Phase 2:

- add quarantine table and file scanner status
- add trust ledger
- show heart widget

Phase 3:

- add potions and heart containers
- connect trust rewards to real contribution scoring
- tune abuse rules

Phase 4:

- review product language and subscription page
- add admin moderation views

## Open Decisions

The recommended default is to make trust visible to users. If that creates gaming behavior, expose only level names publicly and keep exact scoring internal.

Initial heart cap recommendation:

- free user: 3 max hearts
- subscriber: 5 max hearts plus 1 temporary gold heart
- trusted contributor: up to 8 max hearts
- admin: separate unlimited/admin status, not represented as normal hearts

