# NOSSEN Coordinated Release Train Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and install a reproducible NOSSEN train that adds ZEN `0.1.2`, consumes Morphing `2.1.0`, replaces internal NOSSEN ranges with validated exact pins, aligns private adapters, and keeps the operator machine on one top-level private all-in-one package.

**Architecture:** Work in an isolated main-repository worktree and leave the dirty nested Dragon, Qflush, Morphing, and Freeland repositories untouched. New ZEN code is implemented from tracked sources; manifest-only public patches and private adapters are reproducibly staged from authenticated npm artifacts, validated against a release-train config, and published in dependency order. A Node validation core powers tests and registry checks, while the existing PowerShell inventory command remains the operator entry point.

**Tech Stack:** Node.js 20+ CommonJS, `node:test`, Node streams/crypto/zlib, PowerShell 7, npm registry, exact semver manifests, Git worktrees, MCP status reporting.

---

## Scope Resolution

The registry audit covers 37 `@nossen/*` packages plus `a11-coder`. The published `@nossen/all-in-one@0.1.5` omits ZEN and pins Morphing `2.0.3`. Five public packages contain floating internal NOSSEN ranges. Thirty-five private adapters pin older public packages.

This plan resolves the train without editing dirty nested repositories:

- implement and publish tracked ZEN sources;
- rebase five manifest-only public patches from their current npm artifacts;
- regenerate thirty-five three-file private adapters from their current private npm artifacts;
- publish both meta-packages only after strict graph validation;
- leave unrelated module code and active runtimes unchanged.

## Target Versions

| Package | Target |
| --- | ---: |
| `@nossen/zen` | `0.1.2` |
| `@funeste/zen` | `0.1.2` |
| `@nossen/dragon-upstream` | `2.0.2` |
| `@nossen/dragon` | `2.0.2` |
| `@nossen/freeland-bros` | `2.0.4` |
| `@nossen/qflush` | `2.0.2` |
| `@nossen/qflush-runner` | `2.0.2` |
| `@funeste/*-nossen` stale adapters | match their target public dependency |
| `@nossen/all-in-one` | `0.1.6` |
| `@funeste/all-in-one-nossen` | `0.1.5` |

### Task 1: Create an isolated release worktree and capture the baseline

**Files:**
- Read: `docs/superpowers/specs/2026-06-22-nossen-release-train-design.md`
- Read: `packages/npm-meta/nossen-all-in-one/package.json`
- Read: `packages/npm-meta/funeste-all-in-one-nossen/package.json`

- [ ] **Step 1: Create the release worktree**

Run from `D:\projets\funesterie` using the required `superpowers:using-git-worktrees` skill:

```powershell
git worktree add D:\projets\funesterie-worktrees\nossen-release-train-20260622 -b codex/nossen-release-train-20260622 HEAD
```

Expected: a clean worktree on `codex/nossen-release-train-20260622` containing the approved design and implementation-plan commits.

- [ ] **Step 2: Verify nested dirty repositories stay outside the change set**

```powershell
$roots = @('morphing', 'freeland-bros', 'qflush', 'dragon')
$roots | ForEach-Object {
  git -C "D:\projets\funesterie\runtime\modules\$_" status --short --branch
}
```

Expected: existing dirty output is recorded but no command modifies or resets it.

- [ ] **Step 3: Run baseline tests**

```powershell
npm --prefix packages/nossen/zen test
npm --prefix packages/funeste/zen test
npm run nossen:all-in-one:inventory:json
```

Expected: ZEN tests pass; inventory reports the two current manifests without registry validation.

- [ ] **Step 4: Commit no files**

This task establishes isolation only. `git status --short` must remain empty.

### Task 2: Add a tested release-train validation core

**Files:**
- Create: `scripts/npm/lib/nossen-release-train.cjs`
- Create: `test/nossen-release-train.node.test.cjs`
- Modify: `scripts/npm/Get-NossenAllInOneInventory.ps1`

- [ ] **Step 1: Write failing tests for exact pins, index parity, and adapter alignment**

Add these cases to `test/nossen-release-train.node.test.cjs`:

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAdapterTargets,
  compareIndexToManifest,
  findNonExactInternalDependencies,
  findRegistryDrift,
  isExactVersion
} = require('../scripts/npm/lib/nossen-release-train.cjs');

test('isExactVersion accepts reproducible versions only', () => {
  assert.equal(isExactVersion('2.1.0'), true);
  assert.equal(isExactVersion('0.1.2-beta.1'), true);
  assert.equal(isExactVersion('^2.1.0'), false);
  assert.equal(isExactVersion('latest'), false);
});

test('findNonExactInternalDependencies reports only NOSSEN ranges', () => {
  assert.deepEqual(findNonExactInternalDependencies({
    name: '@nossen/example',
    dependencies: {
      '@nossen/morphing': '^2.0.3',
      express: '^5.2.1'
    }
  }), [{ package: '@nossen/example', dependency: '@nossen/morphing', declared: '^2.0.3' }]);
});

test('compareIndexToManifest catches omitted ZEN entries', () => {
  assert.deepEqual(compareIndexToManifest(
    { '@nossen/morphing': '2.1.0', '@nossen/zen': '0.1.2' },
    ['@nossen/morphing']
  ), { missingFromIndex: ['@nossen/zen'], extraInIndex: [] });
});

test('findRegistryDrift compares exact declared versions', () => {
  assert.deepEqual(findRegistryDrift(
    { '@nossen/morphing': '2.0.3' },
    { '@nossen/morphing': '2.1.0' }
  ), [{ name: '@nossen/morphing', declared: '2.0.3', latest: '2.1.0' }]);
});

test('buildAdapterTargets aligns wrappers with planned public targets', () => {
  assert.deepEqual(buildAdapterTargets([
    {
      privatePackage: '@funeste/morphing-nossen',
      publicPackage: '@nossen/morphing',
      currentPrivateVersion: '2.0.0'
    }
  ], { '@nossen/morphing': '2.1.0' }), [{
    privatePackage: '@funeste/morphing-nossen',
    publicPackage: '@nossen/morphing',
    sourcePrivateVersion: '2.0.0',
    targetPrivateVersion: '2.1.0',
    targetPublicVersion: '2.1.0'
  }]);
});
```

- [ ] **Step 2: Run the tests and verify failure**

```powershell
node --test test/nossen-release-train.node.test.cjs
```

Expected: FAIL with `MODULE_NOT_FOUND` for `scripts/npm/lib/nossen-release-train.cjs`.

- [ ] **Step 3: Implement the pure validation functions**

Create `scripts/npm/lib/nossen-release-train.cjs`:

```js
'use strict';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isInternalPackage(name) {
  return name.startsWith('@nossen/') || name.startsWith('@funeste/');
}

function isExactVersion(value) {
  return EXACT_VERSION.test(String(value || ''));
}

function findNonExactInternalDependencies(manifest) {
  return Object.entries(manifest.dependencies || {})
    .filter(([name, version]) => isInternalPackage(name) && !isExactVersion(version))
    .map(([dependency, declared]) => ({ package: manifest.name, dependency, declared }))
    .sort((a, b) => a.dependency.localeCompare(b.dependency));
}

function compareIndexToManifest(dependencies, packages) {
  const declared = new Set(Object.keys(dependencies || {}));
  const indexed = new Set(packages || []);
  return {
    missingFromIndex: [...declared].filter((name) => !indexed.has(name)).sort(),
    extraInIndex: [...indexed].filter((name) => !declared.has(name)).sort()
  };
}

function findRegistryDrift(declared, latest) {
  return Object.entries(declared || {})
    .filter(([name, version]) => latest[name] && latest[name] !== version)
    .map(([name, version]) => ({ name, declared: version, latest: latest[name] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildAdapterTargets(adapters, publicTargets) {
  return adapters.map((adapter) => {
    const target = publicTargets[adapter.publicPackage];
    if (!target) throw new Error(`Missing public target for ${adapter.publicPackage}`);
    return {
      privatePackage: adapter.privatePackage,
      publicPackage: adapter.publicPackage,
      sourcePrivateVersion: adapter.currentPrivateVersion,
      targetPrivateVersion: target,
      targetPublicVersion: target
    };
  }).sort((a, b) => a.privatePackage.localeCompare(b.privatePackage));
}

module.exports = {
  buildAdapterTargets,
  compareIndexToManifest,
  findNonExactInternalDependencies,
  findRegistryDrift,
  isExactVersion
};
```

- [ ] **Step 4: Run the tests**

```powershell
node --test test/nossen-release-train.node.test.cjs
```

Expected: 5 tests pass.

- [ ] **Step 5: Extend the PowerShell operator entry point**

Add parameters to `Get-NossenAllInOneInventory.ps1`:

```powershell
[string]$Plan = "",
[switch]$Registry,
[switch]$Strict,
[switch]$Json
```

For each dependency, call `npm view <name> version dependencies --json` only when `-Registry` is supplied. Emit stable fields `latest`, `outdated`, `nonExactInternalDependencies`, `registryOk`, and `errors`. When `-Plan` is supplied, load its `publicTargets`, `publicRebases`, and `metaTargets`; those exact planned-but-unpublished targets replace registry latest only for release validation. When `-Strict` is supplied, exit `1` if any registry lookup fails, any declared dependency is absent from both registry and plan, any exact pin differs from the planned target, or index/manifest parity fails.

Use argument arrays rather than command strings:

```powershell
$raw = & npm.cmd view $dependencyName version dependencies --json 2>$null
if ($LASTEXITCODE -ne 0) {
  $errors += "registry lookup failed: $dependencyName"
}
```

- [ ] **Step 6: Add a strict-mode integration assertion**

```powershell
$json = pwsh -NoProfile -File scripts/npm/Get-NossenAllInOneInventory.ps1 -Registry -Json | ConvertFrom-Json
if (-not $json) { throw 'Inventory returned no JSON' }
```

Expected before manifest updates: the JSON identifies Morphing drift, published ZEN omission, and internal range warnings.

- [ ] **Step 7: Commit**

```powershell
git add scripts/npm/lib/nossen-release-train.cjs scripts/npm/Get-NossenAllInOneInventory.ps1 test/nossen-release-train.node.test.cjs
git commit -m "feat(npm): add strict NOSSEN release-train audit"
```

### Task 3: Add stable ZEN errors and bounded parsing

**Files:**
- Create: `packages/nossen/zen/src/errors.cjs`
- Create: `packages/nossen/zen/src/limits.cjs`
- Modify: `packages/nossen/zen/src/index.cjs`
- Modify: `packages/nossen/zen/test/zen.test.cjs`

- [ ] **Step 1: Write failing limit and error-code tests**

Append to `packages/nossen/zen/test/zen.test.cjs`:

```js
test('parseZen enforces container and header limits with stable codes', () => {
  const archive = encodeZen('bounded', { key: 'limit-key' });
  assert.throws(
    () => parseZen(archive, { maxContainerBytes: archive.length - 1 }),
    (error) => error.code === 'ZEN_ERR_LIMIT' && error.limit === 'maxContainerBytes'
  );
  assert.throws(
    () => parseZen(archive, { maxHeaderBytes: 8 }),
    (error) => error.code === 'ZEN_ERR_LIMIT' && error.limit === 'maxHeaderBytes'
  );
});

test('decodeZen bounds decompressed output', () => {
  const archive = encodeZen('x'.repeat(1024 * 1024), { key: 'raw-limit-key' });
  assert.throws(
    () => decodeZen(archive, { key: 'raw-limit-key', maxRawBytes: 1024 }),
    (error) => error.code === 'ZEN_ERR_LIMIT' && error.limit === 'maxRawBytes'
  );
});
```

- [ ] **Step 2: Run the tests and verify failure**

```powershell
npm --prefix packages/nossen/zen test
```

Expected: FAIL because `parseZen` ignores limits and errors have no codes.

- [ ] **Step 3: Create error and limit modules**

Create `packages/nossen/zen/src/errors.cjs`:

```js
'use strict';

class ZenError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ZenError';
    this.code = code;
    Object.assign(this, details);
  }
}

function zenError(code, message, details) {
  return new ZenError(code, message, details);
}

module.exports = { ZenError, zenError };
```

Create `packages/nossen/zen/src/limits.cjs`:

```js
'use strict';

const DEFAULT_ZEN_LIMITS = Object.freeze({
  maxContainerBytes: 8 * 1024 * 1024 * 1024,
  maxHeaderBytes: 1024 * 1024,
  maxPayloadBytes: 8 * 1024 * 1024 * 1024,
  maxRawBytes: 16 * 1024 * 1024 * 1024
});

function resolveZenLimits(options = {}) {
  const limits = {};
  for (const [name, fallback] of Object.entries(DEFAULT_ZEN_LIMITS)) {
    const value = options[name] === undefined ? fallback : Number(options[name]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
    limits[name] = value;
  }
  return limits;
}

module.exports = { DEFAULT_ZEN_LIMITS, resolveZenLimits };
```

- [ ] **Step 4: Enforce limits in `parseZen` and `decodeZen`**

Change `parseZen(input, options = {})`, resolve limits before reading files, reject oversized stat values before `readFileSync`, reject header and payload lengths before slicing, and use:

```js
throw zenError('ZEN_ERR_LIMIT', `ZEN exceeded ${limit}`, { limit, actual, maximum });
```

Pass `maxOutputLength: limits.maxRawBytes` to Brotli decompression and convert `ERR_BUFFER_TOO_LARGE` into `ZEN_ERR_LIMIT`. Convert format, version, authentication, and checksum failures into `ZEN_ERR_FORMAT`, `ZEN_ERR_VERSION`, `ZEN_ERR_AUTH`, and `ZEN_ERR_CHECKSUM` respectively. Add `materialize: false`; in that mode `decodeZen` verifies authentication and checksums but skips UTF-8 conversion, JSON parsing, and payload fields in its return value.

- [ ] **Step 5: Run tests**

```powershell
npm --prefix packages/nossen/zen test
```

Expected: all existing compatibility tests and the new limit tests pass.

- [ ] **Step 6: Commit**

```powershell
git add packages/nossen/zen/src packages/nossen/zen/test/zen.test.cjs
git commit -m "feat(zen): add bounded parsing and stable errors"
```

### Task 4: Add secret-safe inspection and verification

**Files:**
- Modify: `packages/nossen/zen/src/index.cjs`
- Modify: `packages/nossen/zen/test/zen.test.cjs`

- [ ] **Step 1: Write failing inspection and verification tests**

```js
test('inspectZen returns public structure only', () => {
  const archive = encodeZenContainer({ privateValue: 'hidden' }, {
    key: 'inspect-key',
    manifest: { corpus: 'private-corpus' }
  });
  const inspection = inspectZen(archive);
  assert.equal(inspection.valid, true);
  assert.equal(inspection.header.format, 'zen');
  assert.equal(inspection.bodyBytes > 0, true);
  assert.equal(JSON.stringify(inspection).includes('private-corpus'), false);
});

test('verifyZen authenticates and checksums without returning private payload', () => {
  const archive = encodeZen('verified', { key: 'verify-key' });
  assert.deepEqual(verifyZen(archive, { key: 'verify-key' }), {
    valid: true,
    format: 'zen',
    version: 1,
    mode: 'encrypted_multiload'
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
npm --prefix packages/nossen/zen test
```

Expected: FAIL because `inspectZen` and `verifyZen` are not exported.

- [ ] **Step 3: Implement the APIs**

```js
function inspectZen(input, options = {}) {
  const { header, body } = parseZen(input, options);
  validatePublicHeader(header);
  return {
    valid: true,
    header: { ...header },
    bodyBytes: body.length,
    encrypted: header.cipher !== 'none'
  };
}

function verifyZen(input, options = {}) {
  const decoded = decodeZen(input, { ...options, materialize: false });
  return {
    valid: true,
    format: decoded.header.format,
    version: decoded.header.version,
    mode: decoded.header.mode
  };
}
```

`validatePublicHeader` must require `format`, `version`, `mode`, `codec`, `cipher`, `rawSha256`, and `payloadSha256`; encrypted headers additionally require valid base64 `salt`, `iv`, and `tag` fields. It must never return decoded `json`, `text`, `container`, manifest, or key material.

- [ ] **Step 4: Run tests and commit**

```powershell
npm --prefix packages/nossen/zen test
git add packages/nossen/zen/src/index.cjs packages/nossen/zen/test/zen.test.cjs
git commit -m "feat(zen): add safe inspect and verify APIs"
```

Expected: all tests pass.

### Task 5: Add reusable streaming safety primitives

**Files:**
- Create: `packages/nossen/zen/src/stream-utils.cjs`
- Create: `packages/nossen/zen/test/stream-utils.test.cjs`

- [ ] **Step 1: Write failing primitive tests**

```js
'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const test = require('node:test');
const {
  ByteLimitTransform,
  HashTap
} = require('../src/stream-utils.cjs');

test('ByteLimitTransform rejects output beyond its limit', async () => {
  await assert.rejects(
    pipeline(
      Readable.from([Buffer.alloc(8), Buffer.alloc(8)]),
      new ByteLimitTransform(12, 'maxRawBytes'),
      async function* consume(source) { for await (const chunk of source) yield chunk; }
    ),
    (error) => error.code === 'ZEN_ERR_LIMIT'
  );
});

test('HashTap counts and hashes bytes without changing them', async () => {
  const tap = new HashTap('sha256');
  const chunks = [];
  tap.on('data', (chunk) => chunks.push(chunk));
  await pipeline(Readable.from([Buffer.from('abc')]), tap);
  assert.equal(Buffer.concat(chunks).toString('utf8'), 'abc');
  assert.equal(tap.bytes, 3);
  assert.equal(tap.digest('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
node --test packages/nossen/zen/test/stream-utils.test.cjs
```

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the primitives**

Create `packages/nossen/zen/src/stream-utils.cjs` with `Transform` subclasses. `ByteLimitTransform` increments `bytes`, raises `ZEN_ERR_LIMIT` before forwarding an over-limit chunk, and attaches `limit`, `actual`, and `maximum`. `HashTap` updates one crypto hash, counts bytes, forwards chunks unchanged, and permits exactly one final `digest()` call.

Also export:

```js
function tempSibling(target, label) {
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  return `${target}.${label}-${suffix}`;
}

async function removeIfPresent(filePath) {
  await fs.promises.rm(filePath, { force: true });
}
```

- [ ] **Step 4: Run tests and commit**

```powershell
node --test packages/nossen/zen/test/stream-utils.test.cjs
git add packages/nossen/zen/src/stream-utils.cjs packages/nossen/zen/test/stream-utils.test.cjs
git commit -m "feat(zen): add streaming safety primitives"
```

### Task 6: Add atomic async ZEN file encoding and decoding

**Files:**
- Create: `packages/nossen/zen/src/file-streams.cjs`
- Modify: `packages/nossen/zen/src/index.cjs`
- Create: `packages/nossen/zen/test/file-streams.test.cjs`

- [ ] **Step 1: Write failing async round-trip and cleanup tests**

Create an 8 MiB generated fixture in the OS temp directory. Test `encodeZenFileAsync` and `decodeZenFileAsync` with a key, assert byte-for-byte output equality, assert `inspectZen` sees format v1, and assert no `*.zen-body-*`, `*.zen-output-*`, or `*.zen-raw-*` sibling files remain.

Add a wrong-key test that pre-creates the destination with `keep-me`, calls `decodeZenFileAsync`, expects `ZEN_ERR_AUTH`, and verifies the destination still contains `keep-me`.

- [ ] **Step 2: Run tests and verify failure**

```powershell
node --test packages/nossen/zen/test/file-streams.test.cjs
```

Expected: FAIL because async file APIs are absent.

- [ ] **Step 3: Implement `encodeZenFileAsync`**

In `file-streams.cjs`, implement a two-stage format-v1 writer:

1. `stat` and reject input above `maxRawBytes`.
2. Stream input through `HashTap(raw)`, Brotli, `HashTap(payload)`, and optional AES-256-GCM into a temporary body file.
3. Build the same public header fields as the synchronous encoder after the stream finishes and the GCM tag is available.
4. Write `NOSSENZ1`, header length, header JSON, and the staged body into a temporary output file.
5. Atomically replace the requested output only after stream completion.
6. Remove temporary files in `finally`.

The exported signature is:

```js
async function encodeZenFileAsync(inputPath, outputPath, options = {})
```

The helper must reject missing output paths, refuse plaintext unless `allowPlaintext === true`, preserve the existing scrypt/AES-GCM defaults, and return the output path.

- [ ] **Step 4: Implement `decodeZenFileAsync`**

Read only the fixed prefix and bounded public header first. Stream the body byte range through optional AES-GCM decipher, `HashTap(payload)`, Brotli decompression, `HashTap(raw)`, and `ByteLimitTransform(maxRawBytes)` into a temporary output. Verify GCM authentication, payload hash, and raw hash before atomically replacing the output.

The exported signature is:

```js
async function decodeZenFileAsync(inputPath, outputPath, options = {})
```

Return `{ header, outputPath, rawBytes }` without returning raw content.

Also export `verifyZenFileAsync(inputPath, options = {})`. It runs the same authenticated streaming pipeline into a discard sink, validates both hashes and the raw-byte limit, and returns only `{ valid, format, version, mode, rawBytes }`.

- [ ] **Step 5: Export and test the APIs**

```powershell
node --test packages/nossen/zen/test/*.test.cjs
```

Expected: all synchronous, limit, inspection, primitive, and async file tests pass.

- [ ] **Step 6: Commit**

```powershell
git add packages/nossen/zen/src packages/nossen/zen/test
git commit -m "feat(zen): stream large files atomically"
```

### Task 7: Upgrade public and private ZEN CLIs to `0.1.2`

**Files:**
- Modify: `packages/nossen/zen/bin/nossen-zen.cjs`
- Modify: `packages/nossen/zen/package.json`
- Modify: `packages/nossen/zen/README.md`
- Modify: `packages/funeste/zen/src/index.cjs`
- Modify: `packages/funeste/zen/bin/funeste-zen.cjs`
- Modify: `packages/funeste/zen/package.json`
- Modify: `packages/funeste/zen/README.md`
- Modify: `packages/funeste/zen/test/funeste-zen.test.cjs`

- [ ] **Step 1: Add failing CLI and wrapper tests**

Test that both CLIs support `verify --in <archive> --key-env <name> --json`, call `verifyZenFileAsync`, never include the key or decoded manifest in output, and return exit `1` for a wrong key. Test that `@funeste/zen` depends exactly on `@nossen/zen@0.1.2` and forwards the async public file helpers with the same limit options.

- [ ] **Step 2: Run tests and verify failure**

```powershell
npm --prefix packages/nossen/zen test
npm --prefix packages/funeste/zen test
```

Expected: CLI verify and `0.1.2` dependency assertions fail.

- [ ] **Step 3: Implement CLI flags and async dispatch**

Both CLIs parse positive integer flags `--max-container-bytes`, `--max-header-bytes`, `--max-payload-bytes`, and `--max-raw-bytes`. File `encode` and `decode` commands call async helpers; `inspect` emits public inspection; `verify` emits the verification result. `--json` writes machine JSON; default output remains concise text.

Convert `main` to `async function main()` and terminate through:

```js
main().catch((error) => {
  process.stderr.write(`${error.code || 'ZEN_ERR'}: ${error.message}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Bump exact package versions**

Set public ZEN to `0.1.2`. Set private ZEN to `0.1.2` and its public dependency to exactly `0.1.2`. Do not change format version `ZEN_VERSION = 1`.

- [ ] **Step 5: Document limits, streaming, inspection, and verification**

Add CLI examples that use environment variable names only. Do not show token or key values. State that sync buffer APIs are for bounded payloads and async file APIs are for large files.

- [ ] **Step 6: Test, dry-pack, and commit**

```powershell
npm --prefix packages/nossen/zen test
npm --prefix packages/funeste/zen test
npm --prefix packages/nossen/zen pack --dry-run
npm --prefix packages/funeste/zen pack --dry-run
git add packages/nossen/zen packages/funeste/zen
git commit -m "feat(zen): release safe large-file APIs"
```

Expected: tests pass; tarball lists only declared files; no fixture archives are packed.

### Task 8: Add reproducible npm artifact staging

**Files:**
- Create: `packages/npm-release-train/2026-06-22.json`
- Create: `scripts/npm/stage-nossen-release.cjs`
- Create: `test/nossen-release-staging.node.test.cjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write a failing staging-config test**

The test loads the config and asserts these exact public rebase targets:

```js
const expected = {
  '@nossen/dragon-upstream': '2.0.2',
  '@nossen/dragon': '2.0.2',
  '@nossen/freeland-bros': '2.0.4',
  '@nossen/qflush': '2.0.2',
  '@nossen/qflush-runner': '2.0.2'
};
```

It also asserts ZEN `0.1.2`, Morphing `2.1.0`, and both meta-package targets.

- [ ] **Step 2: Create the release config**

`packages/npm-release-train/2026-06-22.json` contains:

```json
{
  "schema": "nossen.release-train.v1",
  "id": "2026-06-22",
  "stageRoot": ".codex-tmp/npm-release-train-20260622",
  "publicTargets": {
    "@nossen/zen": "0.1.2",
    "@nossen/morphing": "2.1.0",
    "@nossen/dragon-contracts": "2.0.1",
    "@nossen/dragon-upstream": "2.0.2",
    "@nossen/dragon": "2.0.2",
    "@nossen/freeland": "2.0.2",
    "@nossen/freeland-bros": "2.0.4",
    "@nossen/qflush": "2.0.2",
    "@nossen/qflush-runner": "2.0.2"
  },
  "publicRebases": {
    "@nossen/dragon-upstream": {
      "source": "2.0.1",
      "target": "2.0.2",
      "dependencies": { "@nossen/dragon-contracts": "2.0.1" }
    },
    "@nossen/dragon": {
      "source": "2.0.1",
      "target": "2.0.2",
      "dependencies": {
        "@nossen/dragon-contracts": "2.0.1",
        "@nossen/dragon-upstream": "2.0.2"
      }
    },
    "@nossen/freeland-bros": {
      "source": "2.0.3",
      "target": "2.0.4",
      "dependencies": {
        "@nossen/freeland": "2.0.2",
        "@nossen/morphing": "2.1.0"
      }
    },
    "@nossen/qflush": {
      "source": "2.0.1",
      "target": "2.0.2",
      "dependencies": {
        "@nossen/allmight": "2.0.1",
        "@nossen/bat": "2.0.2",
        "@nossen/envaptex": "2.0.1",
        "@nossen/freeland": "2.0.2",
        "@nossen/nezlephant": "2.0.2",
        "@nossen/rome": "2.0.3",
        "@nossen/spyder": "2.0.2"
      }
    },
    "@nossen/qflush-runner": {
      "source": "2.0.1",
      "target": "2.0.2",
      "dependencies": { "@nossen/qflush": "2.0.2" }
    }
  },
  "metaTargets": {
    "@nossen/all-in-one": "0.1.6",
    "@funeste/all-in-one-nossen": "0.1.5"
  }
}
```

- [ ] **Step 3: Implement safe staging**

`stage-nossen-release.cjs` runs `npm pack <package>@<source> --json --pack-destination <temp>` using `spawnSync` argument arrays, extracts into the configured stage root, rejects symlinks and files outside `package/`, and accepts only files declared by the source tarball.

For a public rebase it changes only `package.json` version and the configured internal dependencies. It records SHA-256 hashes of every other staged file before and after editing and fails if any non-manifest file changes.

Supported commands:

```text
node scripts/npm/stage-nossen-release.cjs audit --config <path>
node scripts/npm/stage-nossen-release.cjs stage-public --config <path>
node scripts/npm/stage-nossen-release.cjs stage-private --config <path>
node scripts/npm/stage-nossen-release.cjs validate --config <path>
```

- [ ] **Step 4: Ignore generated staging only**

Add `.codex-tmp/npm-release-train-*` to `.gitignore`. Keep config, scripts, tests, and tracked custom packages visible to Git.

- [ ] **Step 5: Test and commit**

```powershell
node --test test/nossen-release-staging.node.test.cjs
git add packages/npm-release-train/2026-06-22.json scripts/npm/stage-nossen-release.cjs test/nossen-release-staging.node.test.cjs .gitignore
git commit -m "feat(npm): stage reproducible NOSSEN patch artifacts"
```

### Task 9: Stage and validate the five public exact-pin patches

**Files:**
- Generated only: `.codex-tmp/npm-release-train-20260622/public/*`
- Read: `packages/npm-release-train/2026-06-22.json`

- [ ] **Step 1: Confirm target versions are free**

```powershell
$targets = @(
  '@nossen/dragon-upstream@2.0.2',
  '@nossen/dragon@2.0.2',
  '@nossen/freeland-bros@2.0.4',
  '@nossen/qflush@2.0.2',
  '@nossen/qflush-runner@2.0.2'
)
$targets | ForEach-Object {
  npm view $_ version --json 2>$null
  if ($LASTEXITCODE -eq 0) { throw "Version already exists: $_" }
}
```

Expected: every lookup returns nonzero because the target version is not published yet.

- [ ] **Step 2: Stage from registry artifacts**

```powershell
node scripts/npm/stage-nossen-release.cjs stage-public --config packages/npm-release-train/2026-06-22.json
```

Expected: five staged packages; only their package manifests differ from source artifacts.

- [ ] **Step 3: Run each source package's packed tests or smoke entry**

Run dry-pack for each staged directory and install all five directories together into a disposable project with lifecycle scripts disabled:

```powershell
$stage = '.codex-tmp/npm-release-train-20260622/public'
Get-ChildItem $stage -Directory | ForEach-Object {
  npm --prefix $_.FullName pack --dry-run
  if ($LASTEXITCODE -ne 0) { throw "dry-pack failed: $($_.Name)" }
}
$smoke = Join-Path $env:TEMP ('nossen-public-rebase-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $smoke | Out-Null
npm --prefix $smoke init -y | Out-Null
npm --prefix $smoke install --ignore-scripts (Get-ChildItem $stage -Directory | Select-Object -ExpandProperty FullName)
npm --prefix $smoke ls --all
Remove-Item -LiteralPath $smoke -Recurse -Force
```

Expected: five dry-packs pass and the clean dependency graph has no invalid or missing nodes. No dirty nested repository is used.

- [ ] **Step 4: Validate exact internal pins**

```powershell
node scripts/npm/stage-nossen-release.cjs validate --config packages/npm-release-train/2026-06-22.json
```

Expected: zero floating `@nossen/*` dependencies in the five staged package manifests.

### Task 10: Regenerate and test all stale private adapters

**Files:**
- Create: `packages/funeste/adapters/adapter-train.json`
- Create: `packages/funeste/adapters/README.md`
- Create: `packages/funeste/adapters/<adapter>/package.json` for stale adapters
- Create: `packages/funeste/adapters/<adapter>/index.js` for stale adapters
- Create: `packages/funeste/adapters/<adapter>/README.md` for stale adapters
- Create: `packages/funeste/morphing-nossen/package.json`
- Create: `packages/funeste/morphing-nossen/index.js`
- Create: `packages/funeste/morphing-nossen/README.md`
- Create: `test/funeste-adapter-train.node.test.cjs`

- [ ] **Step 1: Write a failing adapter-train test**

The test loads every private dependency from `packages/npm-meta/funeste-all-in-one-nossen/package.json`, excludes custom tracked packages `@funeste/zen` and `@funeste/logic-reduce-nossen`, and requires each remaining package to exist under `packages/funeste/adapters`. The Morphing adapter is resolved from `packages/funeste/morphing-nossen` instead, matching the approved design. Each adapter must satisfy:

```js
assert.equal(manifest.version, targetPublicVersion);
assert.equal(manifest.dependencies[publicPackage], targetPublicVersion);
assert.equal(manifest.publishConfig.access, 'restricted');
assert.equal(indexSource.includes('npm_'), false);
assert.equal(readmeSource.includes('npm_'), false);
```

It imports the adapter and checks `loadPublicPackage()` or the package-specific exported wrapper against a clean install of its exact public dependency.

- [ ] **Step 2: Generate the adapter target map from registry metadata**

`stage-private` reads the current private all-in-one dependency list, queries each private adapter's current manifest, finds its single `@nossen/*` dependency, resolves the target through the release config plus registry latest versions, and writes `adapter-train.json` with explicit source and target versions.

The target version equals the target public dependency. Packages already aligned (`@funeste/katana-nossen` and `@funeste/logic-reduce-nossen`) are not republished. `@funeste/zen` is handled from tracked custom source.

- [ ] **Step 3: Materialize adapters safely**

For each stale adapter, extract its authenticated npm artifact, require exactly `package.json`, `index.js`, and `README.md`, update the private version and exact public dependency, and update only quoted `version` or `publicVersion` literals in `index.js`. Write Morphing to `packages/funeste/morphing-nossen`; write all other generated adapters under `packages/funeste/adapters`. Reject symlinks, extra executable files, environment files, or credential-like text.

- [ ] **Step 4: Run adapter tests**

```powershell
node --test test/funeste-adapter-train.node.test.cjs
```

Expected: all generated private adapters align with planned public versions and load their public packages.

- [ ] **Step 5: Dry-pack every adapter**

```powershell
$adapterDirs = @(
  Get-ChildItem packages/funeste/adapters -Directory
  Get-Item packages/funeste/morphing-nossen
)
$adapterDirs | ForEach-Object {
  npm --prefix $_.FullName pack --dry-run
  if ($LASTEXITCODE -ne 0) { throw "dry-pack failed: $($_.Name)" }
}
```

Expected: each tarball contains exactly three declared files.

- [ ] **Step 6: Commit**

```powershell
git add packages/funeste/adapters packages/funeste/morphing-nossen test/funeste-adapter-train.node.test.cjs
git commit -m "feat(funeste): align private NOSSEN adapter train"
```

### Task 11: Regenerate both all-in-one snapshots

**Files:**
- Modify: `packages/npm-meta/nossen-all-in-one/package.json`
- Modify: `packages/npm-meta/nossen-all-in-one/index.cjs`
- Modify: `packages/npm-meta/nossen-all-in-one/README.md`
- Modify: `packages/npm-meta/funeste-all-in-one-nossen/package.json`
- Modify: `packages/npm-meta/funeste-all-in-one-nossen/index.cjs`
- Modify: `packages/npm-meta/funeste-all-in-one-nossen/README.md`
- Modify: `test/nossen-release-train.node.test.cjs`

- [ ] **Step 1: Add failing snapshot assertions**

Assert the public dependency count is 37 (`36 @nossen/*` plus `a11-coder`), `@nossen/zen@0.1.2` is present in manifest and index, Morphing is `2.1.0`, the five public patch versions match the config, and manifest/index sets are identical. Counting `@nossen/all-in-one` itself gives the 38 visible public packages from the scope audit.

Assert private manifest/index sets are identical, private ZEN is `0.1.2`, each generated adapter uses the target version from `adapter-train.json`, and the public meta dependency is `@nossen/all-in-one@0.1.6`.

- [ ] **Step 2: Run tests and verify failure**

```powershell
node --test test/nossen-release-train.node.test.cjs
```

Expected: failures for current meta versions, omitted public ZEN index entry, old Morphing, and old private adapter versions.

- [ ] **Step 3: Update public meta-package**

Set version `0.1.6`; pin all 37 dependencies exactly; add `@nossen/zen` to `index.cjs`; set `generatedAt` to `2026-06-22`; document that the snapshot is registry-audited and contains ZEN.

- [ ] **Step 4: Update private meta-package**

Set version `0.1.5`; consume generated adapter targets, `@funeste/zen@0.1.2`, `@funeste/logic-reduce-nossen@2.0.2`, and `@nossen/all-in-one@0.1.6`; update index and generated date.

- [ ] **Step 5: Test, strict-audit, dry-pack, and commit**

```powershell
node --test test/nossen-release-train.node.test.cjs test/funeste-adapter-train.node.test.cjs
pwsh -NoProfile -File scripts/npm/Get-NossenAllInOneInventory.ps1 -Registry -Strict -Json -Plan packages/npm-release-train/2026-06-22.json
npm --prefix packages/npm-meta/nossen-all-in-one pack --dry-run
npm --prefix packages/npm-meta/funeste-all-in-one-nossen pack --dry-run
git add packages/npm-meta test/nossen-release-train.node.test.cjs
git commit -m "feat(nossen): regenerate coordinated all-in-one snapshots"
```

Expected: strict audit passes against planned unpublished targets and every tarball contains only declared files.

### Task 12: Run the complete pre-publication gate

**Files:**
- Read: all changed files
- Generated only: `.codex-tmp/npm-release-train-20260622/*`

- [ ] **Step 1: Run all focused tests**

```powershell
node --test test/nossen-release-train.node.test.cjs
node --test test/nossen-release-staging.node.test.cjs
node --test test/funeste-adapter-train.node.test.cjs
npm --prefix packages/nossen/zen test
npm --prefix packages/funeste/zen test
```

Expected: zero failures.

- [ ] **Step 2: Run dry-packs and inspect file lists**

Dry-pack public ZEN, private ZEN, five staged public patches, every generated private adapter, and both meta-packages. Reject unexpected `.env`, key, token, log, test archive, or temp files.

- [ ] **Step 3: Perform clean public and private installs**

Create disposable directories outside the repository. Install the staged/public tarballs anonymously in the public directory. Install private tarballs through `Invoke-NpmWithPublishToken.ps1` in the private directory. Run `npm ls --all` and import/require smoke tests.

- [ ] **Step 4: Verify Git boundaries**

```powershell
git status --short
git diff --check
```

Expected: only intentional tracked changes; no modifications inside `D:\projets\funesterie\runtime\modules\{dragon,qflush,morphing,freeland-bros}`.

### Task 13: Publish in dependency order with registry verification

**Files:**
- Read: `scripts/npm/Invoke-NpmWithPublishToken.ps1`
- Read: `packages/npm-release-train/2026-06-22.json`

- [ ] **Step 1: Re-check target availability and authenticated identity**

Use the secret-safe wrapper to run `npm whoami`; record only success, not credentials. Re-run target-version availability checks immediately before each publication group.

- [ ] **Step 2: Publish public ZEN**

```powershell
pwsh -NoProfile -File scripts/npm/Invoke-NpmWithPublishToken.ps1 `
  -WorkDir packages/nossen/zen publish --access public
```

Verify `npm view @nossen/zen@0.1.2 version dist.integrity --json` and anonymously install it.

- [ ] **Step 3: Publish the public exact-pin patches**

Publish in this order: Dragon Upstream, Dragon, Freeland Bros, Qflush, Qflush Runner. After each publish, verify exact dependency metadata with `npm view <package>@<version> dependencies --json` before continuing.

```powershell
$ordered = @('dragon-upstream', 'dragon', 'freeland-bros', 'qflush', 'qflush-runner')
foreach ($name in $ordered) {
  $dir = Join-Path '.codex-tmp/npm-release-train-20260622/public' $name
  pwsh -NoProfile -File scripts/npm/Invoke-NpmWithPublishToken.ps1 -WorkDir $dir publish --access public
  if ($LASTEXITCODE -ne 0) { throw "publish failed: $name" }
}
```

- [ ] **Step 4: Publish private ZEN and generated adapters**

Publish `@funeste/zen@0.1.2`, then every generated adapter whose target version is not already present. Use `--access restricted`. After each publish, verify its exact `@nossen/*` dependency.

```powershell
pwsh -NoProfile -File scripts/npm/Invoke-NpmWithPublishToken.ps1 -WorkDir packages/funeste/zen publish --access restricted
$adapterDirs = @(
  Get-ChildItem packages/funeste/adapters -Directory
  Get-Item packages/funeste/morphing-nossen
)
foreach ($dir in $adapterDirs) {
  pwsh -NoProfile -File scripts/npm/Invoke-NpmWithPublishToken.ps1 -WorkDir $dir.FullName publish --access restricted
  if ($LASTEXITCODE -ne 0) { throw "publish failed: $($dir.Name)" }
}
```

- [ ] **Step 5: Publish the public meta-package**

Publish `@nossen/all-in-one@0.1.6 --access public`, verify the registry dependency count is 37, and anonymously install it.

- [ ] **Step 6: Publish the private meta-package**

Publish `@funeste/all-in-one-nossen@0.1.5 --access restricted`, verify its dependency graph, and install it through the authenticated wrapper in a clean directory.

- [ ] **Step 7: Stop on any mismatch**

Do not continue to the next package when publish exits nonzero, a version already exists with different metadata, integrity lookup fails, dependency pins differ, anonymous public install fails, or private authenticated install fails. Correct with a new patch version; never unpublish or overwrite.

### Task 14: Update the operator install and finish the release

**Files:**
- Modify outside Git: `D:\agent-bus\nossen-all-in-one\package.json`
- Modify outside Git: `D:\agent-bus\nossen-all-in-one\package-lock.json`
- Modify: `docs/ops/NOSSEN_ALL_IN_ONE_PACKAGES_2026-05-25.md`
- Modify: `D:\projets\funesterie\a11\runtime\codex-session-state-current.md`
- Modify: `D:\projets\funesterie\a11\runtime\codex-session-state-2026-06-22.md`

- [ ] **Step 1: Back up the local operator manifests**

Copy only `package.json` and `package-lock.json` to a dated directory under `D:\agent-bus\nossen-all-in-one\backups`. Do not copy `node_modules` or secret configuration.

- [ ] **Step 2: Install the private meta-package as the only top-level dependency**

Set the exact dependency to `@funeste/all-in-one-nossen@0.1.5`. Remove obsolete overrides only after registry metadata proves the private/public adapters now pin the intended versions. Run authenticated `npm install`.

- [ ] **Step 3: Verify the resolved graph**

```powershell
npm --prefix D:\agent-bus\nossen-all-in-one ls --all
npm --prefix D:\agent-bus\nossen-all-in-one pkg get dependencies overrides
```

Expected: one top-level NOSSEN dependency, no overrides, Morphing `2.1.0`, both ZEN packages `0.1.2`, and no invalid/missing/peer errors.

- [ ] **Step 4: Run runtime smoke tests**

Require the private all-in-one and ZEN packages; dynamically import public Morphing; inspect package counts; encode/verify/decode a temporary encrypted ZEN fixture; remove the fixture afterward.

- [ ] **Step 5: Update docs and MCP**

Record exact published versions, registry verification, clean-install results, and operator graph in the ops document. Post progress and final status to `discussion-2026-06-22T171823011Z-nossen-all-in-one-refresh-zen-morphing-et-train-` without secrets.

- [ ] **Step 6: Commit and push the release branch**

```powershell
git add docs packages scripts test .gitignore
git commit -m "docs(nossen): record coordinated npm release"
git push -u origin codex/nossen-release-train-20260622
```

- [ ] **Step 7: Refresh secret-safe session state**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\Djeff\.codex\skills\funesterie-autostart\scripts\Update-CodexSessionState.ps1
```

Append a concise release note to current and dated state files with versions, branch, commit, MCP discussion, tests, and registry status. Never include npm tokens, `.npmrc` contents, or credential paths beyond the already documented secret-safe wrapper location.

## Final Acceptance Criteria

- ZEN format v1 compatibility tests pass and new bounded/streaming APIs are published as `0.1.2`.
- Public all-in-one contains exactly 37 dependencies, including ZEN, with Morphing `2.1.0`; counting the meta-package itself gives 38 visible public packages.
- The five formerly floating public packages publish exact internal NOSSEN pins.
- Every stale private adapter depends exactly on the planned public target.
- Both all-in-one packages install cleanly from the registry.
- The operator machine has exactly one top-level NOSSEN dependency and no compensating overrides.
- Dirty nested repositories and active Funesterie runtimes remain untouched.
