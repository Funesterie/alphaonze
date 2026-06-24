# NOSSEN Coordinated Release Train Design

Date: 2026-06-22
Status: approved for planning
Owner: Codex Desktop, coordinated with Kiro through MCP

## Context

The public `@nossen/all-in-one@0.1.5` snapshot pins `@nossen/morphing@2.0.3`, while the npm registry publishes `2.1.0`. The private `@funeste/morphing-nossen@2.0.0` adapter is further behind because it depends on `@nossen/morphing@2.0.0`.

Both public and private ZEN packages are currently published at `0.1.1`. There is no newer registry version to select, so ZEN must receive a backward-compatible `0.1.2` release before either all-in-one package can consume a newer version.

The current inventory script lists declared dependencies but does not query the registry, validate adapter-to-public dependency alignment, or fail when a release snapshot is stale. The local operator install compensates for old snapshots with overrides, which hides release-train drift instead of preventing it.

## Goals

- Publish one coherent, reproducible public/private NOSSEN release train.
- Upgrade Morphing public and private packages together.
- Improve ZEN for safer large-corpus file handling without changing format v1.
- Detect stale exact pins and broken private/public alignment before publication.
- Keep `@funeste/all-in-one-nossen` as the only top-level NOSSEN dependency on the operator machine.
- Validate every published artifact through dry-pack and clean-install tests.

## Non-goals

- No floating dependency ranges or `latest` tags inside package manifests.
- No ZEN format v2 or change to the existing `NOSSENZ1` binary layout.
- No unrelated refactor of A11, Vivy, Kaen44, MCP services, or active runtime workers.
- No bulk major-version release for modules whose registry version already matches the snapshot.

## Approaches Considered

### Minimal manifest bump

Only update `@nossen/all-in-one` to Morphing `2.1.0`. This is fast but leaves the private adapter stale, leaves ZEN unchanged, and allows the same drift to recur.

### Floating release train

Replace exact versions with semver ranges. This reduces maintenance but makes operator installs non-reproducible and can combine package versions that were never validated together.

### Coordinated exact-version train

Publish leaf packages first, then private adapters, then public and private meta-packages. Add registry-aware validation so the exact snapshot is intentional and repeatable. This is the selected approach.

## Release Targets

| Package | Current | Target | Purpose |
| --- | ---: | ---: | --- |
| `@nossen/zen` | `0.1.1` | `0.1.2` | Backward-compatible safety and large-file helpers |
| `@funeste/zen` | `0.1.1` | `0.1.2` | Consume public ZEN `0.1.2` and expose the safe operator defaults |
| `@nossen/morphing` | `2.1.0` | `2.1.0` | Already published; consume it as the public source of truth |
| `@funeste/morphing-nossen` | `2.0.0` | `2.1.0` | Align the private adapter and exact public dependency |
| `@nossen/all-in-one` | `0.1.5` | `0.1.6` | Snapshot all latest validated public packages |
| `@funeste/all-in-one-nossen` | `0.1.4` | `0.1.5` | Snapshot all latest validated private packages and public meta-package |

If a target version has been claimed before publication, the next free patch version is selected without changing the dependency graph or feature scope.

## ZEN 0.1.2 Design

### Compatibility

Existing synchronous buffer APIs remain available and retain their behavior. Existing encrypted and explicit plaintext-dev format-v1 containers remain readable. The public header continues to expose no corpus names, fragment order, routes, or reconstruction metadata.

### Bounded parsing and decoding

`parseZen` and `decodeZen` gain explicit limits for container bytes, header bytes, compressed payload bytes, and decoded raw bytes. Safe defaults reject malformed headers and decompression bombs before unbounded allocation. Callers can lower limits and can explicitly raise them for trusted large corpus jobs.

Errors use stable codes in addition to human-readable messages so CLIs and automation can distinguish invalid format, size-limit rejection, checksum failure, authentication failure, and unsupported version.

### Large-file helpers

New asynchronous file helpers encode and decode through temporary files and Node streams. They preserve the v1 layout by staging the body, calculating hashes and authentication metadata, then atomically assembling the final container. Decode writes to a temporary output, enforces the raw-byte limit while streaming, verifies authentication and checksums, and renames only after success.

Temporary files are removed on failure. Existing output files are not replaced until the new result is fully validated. Buffer-returning APIs are not silently switched to streams.

### Inspection and verification

`inspectZen` validates magic, header bounds, required public fields, declared algorithms, and body length without exposing encrypted manifest data. `verifyZen` performs authenticated decode and checksum validation without requiring the caller to materialize parsed JSON.

The CLI gains a `verify` command, bounded-size flags, JSON output for automation, and safe nonzero exit codes. `inspect` remains secret-safe and never prints a supplied key or decoded private manifest.

### Private wrapper

`@funeste/zen@0.1.2` consumes public ZEN `0.1.2`, forwards safe limits and async helpers, and retains the existing MCP, A11, Neo4j, Qflush, Kaen44, Vivy, and container-runtime defaults. Key resolution remains environment-or-explicit-value only; keys never enter manifests, logs, or command output.

## Morphing Private Adapter

The missing tracked private adapter source is restored under `packages/funeste/morphing-nossen` from the authenticated published artifact and the installed operator copy, then reduced to the minimum wrapper surface needed by the current package contract.

Version `2.1.0` depends exactly on `@nossen/morphing@2.1.0`. Tests prove that the public exports used by the adapter are available and that private presets do not mutate public values. No public Morphing republish is needed because `2.1.0` is already the registry latest.

## Registry-aware Inventory

`Get-NossenAllInOneInventory.ps1` is extended with explicit modes:

- local inventory without network access;
- registry audit for declared-versus-latest drift;
- strict release validation that fails on registry errors, stale pins, missing packages, duplicate list entries, manifest/index disagreement, or private adapter dependency mismatch;
- JSON output with stable fields for CI and MCP summaries.

The audit treats the package being prepared for publication as an allowed next version while still requiring every dependency to exist at its declared exact version.

## Release Flow

1. Test and dry-pack public ZEN `0.1.2`.
2. Publish public ZEN and verify the registry artifact anonymously.
3. Test, dry-pack, and publish private ZEN `0.1.2`.
4. Restore, test, dry-pack, and publish private Morphing `2.1.0`.
5. Regenerate and validate `@nossen/all-in-one@0.1.6`, then publish and anonymously install it.
6. Regenerate and validate `@funeste/all-in-one-nossen@0.1.5`, then publish and install it with authenticated access.
7. Update `D:\agent-bus\nossen-all-in-one` so the private all-in-one remains the only top-level NOSSEN dependency.
8. Remove obsolete local overrides only when `npm ls` proves the resolved graph already contains the intended versions.

Publication stops immediately if a dependency cannot be installed, a test fails, a package tarball contains unexpected files, or registry metadata differs from the validated manifest.

## Testing

- Unit tests for ZEN bounds, error codes, inspection, verification, atomic cleanup, wrong keys, tampering, and v1 compatibility.
- File-stream round trips with generated fixtures large enough to exercise streaming without committing binary fixtures.
- Public/private wrapper tests for manifest defaults and key non-disclosure.
- Morphing adapter smoke tests against public `2.1.0` exports.
- Manifest/index consistency tests for both meta-packages.
- `npm pack --dry-run` for every package changed.
- Clean temporary installs for public anonymous access and private authenticated access.
- `npm ls --all` and runtime `require`/`import` smoke tests after updating the operator install.

## Coordination and Rollback

Progress and release results are recorded in the MCP discussion `discussion-2026-06-22T171823011Z-nossen-all-in-one-refresh-zen-morphing-et-train-`. No secrets or registry tokens are posted.

Published npm versions are immutable. Rollback therefore means publishing a corrected patch and repointing the all-in-one snapshots; it never means overwriting or unpublishing a validated historical version. Local installation changes are applied only after registry verification, leaving the previous lockfile available until the final install succeeds.
