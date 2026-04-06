# Changelog

## v3.0.3 — Release (2025-11-18)

Highlights:

- Rome Tag v1: shared module `src/rome/rome-tag.ts` and canonical tag algorithm (type|path → FNV-1a 24-bit)
- Pourparler UI: compute & persist Rome tags from VS Code webview
- VS Code extension: persist canonical records to `.qflush/rome-index.json`
- Linter: `tools/rome-lint.js` enforces `// ROME-TAG: 0xXXXXXX` with `--fix`
- Daemon: `GET /npz/rome-index` endpoint and index loader cache
- Tests: reliable integration tests for checksums and rome-index
- Docs: Rome index diagram, README and publishing guidance

Checksums

- funeste38-qflush-3.0.3.tgz — SHA256: AAB940267E13C613EB30564613EE40FBA31729DCF2BE01AE897C03C33DD079F8

Migration notes:
- The Rome tag algorithm is stable (v1) and computed from `type|path`. Existing tags inserted by the linter or extension will match.
- To adopt in CI, add `npm run lint:rome` as a workflow step to ensure tags remain consistent.

Security & CI:
- The release pipeline can publish to npm using `NPM_TOKEN` stored in repository secrets.

