# A11 Director / Clip Director

Status: draft for user validation  
Scope: Funesterie media generation architecture  
Depends on: `docs/superpowers/specs/chatgpt-strategic-copilot.md`  
Implementation state: spec only, no code changes

## Purpose

A11 Director turns a creative request into a controlled media production plan before image or video generation starts.

The target is not "one prompt to one random video". The target is:

```text
lyrics + photos + references + context
-> semantic extraction
-> web research
-> object cards
-> spatial locks
-> reference board
-> short-clip storyboard
-> generation
-> critique / regeneration
-> async jobs and traceable results
```

The system must prevent the common text-to-video failure where the model sees the right words but places objects in the wrong physical structure. For example: a 50cc supermoto request must not become a big road bike, pocket bike, mud motocross scene, or a motorcycle with a huge radiator replacing the front headlight plate.

## Governance

A11 Director uses the ChatGPT Strategic Copilot governance profile.

ChatGPT may:

- help design scenes and review plans;
- read MCP discussions and repo architecture in read-only mode;
- post validated MCP ACKs, summaries, proposals, or discussion openings.

ChatGPT may not:

- edit code;
- push commits;
- deploy production;
- read secrets;
- operate MCP as a root shell;
- bypass Codex/Kiro execution and verification.

Codex and Kiro remain the implementation and verification workers after user-approved specs and plans.

## Infrastructure Context

The design must respect the current Funesterie infrastructure:

- A11 production runs on Hetzner.
- Heavy image/video runners may run on the local GPU PC.
- Local GPU runners must be reached through a secured bridge or tunnel when production needs them.
- MCP is a coordination bus, not a root console.
- Production secrets stay in the appropriate server or secret store, never in prompts, specs, logs, or MCP message bodies.

The Director can schedule or describe media work, but it must not assume direct production shell access.

## Existing Repo Anchors

The first implementation should reuse current modules instead of inventing a parallel stack.

Known anchors:

- `a11/backend/apps/server/src/video/video-sequence-planner.cjs`
- `a11/backend/apps/server/src/video/video-spatial-strategy.cjs`
- `a11/backend/apps/server/src/video/video-frame-prompter.cjs`
- `a11/backend/apps/server/src/knowledge/image-request-director.cjs`
- `a11/backend/apps/server/src/knowledge/image-hint-web-context.cjs`
- `a11/backend/apps/server/src/knowledge/image-reference-pack.cjs`
- `a11/backend/apps/server/src/knowledge/image-reference-composite.cjs`

Recent base state to preserve:

- The LLM is the primary intent decider for image/video routing.
- Video fast-path should not steal image-reference video requests.
- Video sequence planning has a heuristic fallback when the LLM planner fails.
- Reference image generation can use Replicate FLUX.1-Kontext-Pro when an HTTP `init_image_url` is available.

## MVP V1

MVP V1 must be branchable quickly on the current video planner.

V1 goal:

- add a Director planning stage before `video-sequence-planner`;
- produce structured context for the existing planner;
- avoid changing the public video route contract;
- keep fallback behavior safe if research or LLM planning fails.

V1 input:

- user prompt or lyrics;
- optional uploaded photos or reference image URLs;
- optional existing image/vision summaries;
- optional target clip duration and style.

V1 output:

- normalized creative brief;
- extracted important terms;
- a small set of research queries;
- object cards for important domain terms;
- spatial locks and forbidden placements;
- storyboard beats for short clips;
- verification checklist.

V1 should not attempt full automatic multi-clip production yet. It should make the current single-request video path more coherent and prepare the future async pipeline.

## Full Target Pipeline

### 1. Inputs

Accepted creative inputs:

- lyrics;
- plain prompt;
- photos of objects, people, vehicles, places, or style references;
- existing A11/Vivy memory facts;
- user constraints such as "street 50cc supermotard, not cross mud bike".

Inputs must be normalized into a production brief that separates:

- subject identity;
- environment;
- actions;
- props and mechanical parts;
- style and mood;
- required continuity;
- user-forbidden outcomes.

### 2. Semantic Extraction

The Director extracts terms and relationships before generation.

Examples:

- `OKO` near `powerjet`, `AM6`, `50cc`, `2-temps` means carburetor context.
- `Metrakit` near `pot`, `passage bas`, `AM6` means a low-passage 2-stroke exhaust context.
- `radiateur` near `50cc supermotard` means side radiators behind shrouds, not a frontal car-style radiator.
- `plaque phare` means the normal front headlight or number plate area of a 50cc supermoto.

The output is a list of candidate entities with confidence, domain, visual role, spatial role, and ambiguity.

### 3. Web Research

The Director searches only when context is missing or confidence is low.

Research query examples:

- `OKO carburetor AM6 50cc powerjet`
- `OKO carburetor 2 stroke moped`
- `Metrakit low passage exhaust AM6 50cc`
- `Beta RR 50 AM6 carburetor location`
- `Derbi Senda 50 radiator side shrouds`

Research output must be compact:

- source title or domain;
- short visual fact;
- image reference candidate if available;
- confidence;
- safety status.

The system should prefer multiple small, grounded facts over long web summaries.

### 4. Object Cards

Each important term becomes an object card.

Required fields:

- `term`
- `domain`
- `resolved_meaning`
- `confidence`
- `visual_role`
- `spatial_role`
- `must_show`
- `forbidden`
- `queries_used`
- `source_facts`
- `clip_use`

Example object card:

```json
{
  "term": "OKO powerjet",
  "domain": "50cc 2-stroke mechanics",
  "resolved_meaning": "small carburetor near the engine intake",
  "confidence": 0.82,
  "visual_role": "macro mechanical detail before acceleration",
  "spatial_role": "side of engine, near intake and fuel hose",
  "must_show": [
    "small metallic carburetor body",
    "fuel hose",
    "engine intake side"
  ],
  "forbidden": [
    "large front object",
    "futuristic reactor",
    "electric motorcycle part"
  ],
  "queries_used": [
    "OKO carburetor AM6 50cc powerjet"
  ],
  "source_facts": [
    "OKO is treated as a carburetor context in 50cc 2-stroke tuning"
  ],
  "clip_use": "close-up on bass hit before throttle rise"
}
```

### 5. Spatial Lock

The spatial lock is the key guardrail. It describes where parts belong.

For the 50cc mechanical case:

- front view: headlight plate or number plate remains visible;
- front fender is high and slim;
- radiators are side radiators behind the side shrouds;
- carburetor is a small part near the engine intake;
- engine is a compact 2-stroke center-low assembly;
- low-passage Metrakit-style exhaust runs under or low along the frame;
- wheels and frame stay slim 50cc supermoto proportions.

Forbidden:

- big roadster;
- superbike;
- naked big motorcycle;
- pocket bike;
- scooter;
- muddy motocross bike if the user asked street/supermotard;
- huge front radiator;
- radiator replacing the headlight plate;
- sci-fi engine;
- electric motorcycle.

The spatial lock must be usable both as model prompt context and as verifier criteria.

### 6. Reference Board

Before video generation, the Director should build a reference board.

V1 can store it as structured metadata and optional composite image. Full target can generate a visual board with:

- side view of the vehicle type;
- front view showing headlight plate placement;
- engine/carburetor close-up;
- low-passage exhaust reference;
- side radiator/shroud reference;
- environment/style references.

Each reference must carry a role. A car radiator image must never be allowed to satisfy a motorcycle side radiator role.

### 7. Storyboard And Short Clips

The Director should split long ideas into short clip units.

Example clip plan:

- garage prep, 5 seconds;
- macro engine and carburetor, 4 seconds;
- start and smoke, 4 seconds;
- wet parking burn circle, 5 seconds;
- rider and distant police lights, 4 seconds;
- anatomical electric tension, 3 seconds;
- neon straight wheelie, 6 seconds;
- stylized crash without injury or blood, 5 seconds;
- final tunnel wheelie, 6 seconds.

Each clip has:

- scene goal;
- required objects;
- spatial locks;
- camera suggestions;
- negative constraints;
- verifier checklist;
- regeneration policy.

### 8. Generation

Generation must consume the Director output rather than a single raw prompt.

For V1:

- enrich the existing planner input;
- attach spatial locks to visual context;
- attach object cards as compact facts;
- attach reference image metadata where available;
- keep heuristic fallback.

For full target:

- schedule generation through async jobs;
- generate clip units separately;
- preserve identity and vehicle locks across clips;
- stitch or package outputs after verification.

### 9. Critique And Regeneration

The verifier must inspect outputs and decide pass/fail.

For the 50cc case, required checks:

- vehicle looks like adult-size European 50cc supermoto or moped, not a big motorcycle;
- headlight plate or front mask is not replaced by a radiator;
- radiators are side-mounted or not incorrectly emphasized;
- carburetor/motor details are plausible when shown;
- low-passage exhaust is plausible when shown;
- no scooter, pocket bike, superbike, or roadster;
- scene matches the requested street/stunt/night style;
- no injury or blood when crash is stylized.

If verification fails, the system should regenerate with a tightened prompt and a clear reason. If repeated regeneration fails, it should return the best artifact plus a visible failure report instead of pretending success.

### 10. Async Jobs

The full system should run heavy work as jobs:

- research job;
- reference board job;
- storyboard job;
- generation job per clip;
- verification job per clip;
- regeneration job when needed;
- packaging job.

Each job payload must be declarative and bounded. It must not contain shell commands, secrets, or destructive instructions.

MCP records progress, ownership, and results. It does not act as a root console.

## Mandatory Test Case

The first acceptance scenario is the 50cc mechanical clip.

Input requirements:

- 50cc mecanoboite supermotard, Beta/AM6 style;
- OKO carburetor and powerjet;
- Metrakit low-passage exhaust;
- lateral radiators;
- front headlight plate;
- street stunt / wet parking / neon night style.

Must pass:

- extracted entities include OKO, powerjet, AM6, Metrakit, radiators, headlight plate;
- OKO resolves to carburetor context;
- Metrakit resolves to low-passage 2-stroke exhaust context when paired with `pot passage bas`;
- spatial lock states that radiators are lateral and never replace the headlight plate;
- forbidden list includes big road bike, superbike, pocket bike, scooter, and front radiator replacement;
- storyboard includes garage, macro mechanics, burn, rider tension, neon wheelie, stylized crash without injury/blood, and final neon run;
- verifier rejects a huge front radiator or big motorcycle result.

## Failure Modes

Expected failures and safe behavior:

- Web research unavailable: continue with local semantic locks and mark lower confidence.
- Reference image unavailable: continue with textual object cards and verifier constraints.
- LLM planner fails: use heuristic video fallback.
- Generator ignores locks: verifier rejects and requests regeneration.
- Repeated bad generations: stop and return a failure report with reasons.
- User prompt conflicts with safety or infra constraints: ask for clarification or refuse the unsafe part.

## Acceptance Criteria

This design is ready for implementation planning when:

- ChatGPT governance is defined separately and referenced.
- MVP V1 can be implemented as a pre-planner layer without breaking the public video route.
- The full target pipeline includes research, object cards, spatial locks, reference board, storyboard, generation, verification, regeneration, and async jobs.
- The 50cc test case is explicit and testable.
- Hetzner production, local GPU runners, secure bridge/tunnel, and MCP boundaries are documented.
- No code implementation is included in this spec.

## Out Of Scope

This spec does not choose a final video provider, implement a web crawler, change deployment secrets, build a UI, or implement the async job system. Those actions require a separate implementation plan after user validation.
