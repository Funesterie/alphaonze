# A11 Security Hardening Plan

## Goal

Reduce immediate local-network exposure by:

- binding A11 and TTS to `127.0.0.1` by default
- removing weak admin header shorthands
- protecting sensitive write/admin routes with strong admin access

## Scope

1. Add test coverage for admin access decisions and bind-host defaults.
2. Add a reusable admin access guard that accepts either:
   - a configured shared admin token
   - a verified admin JWT user
3. Protect `/api/admin/run` and `/api/a11/memory/write` with that guard.
4. Default A11 and TTS bind hosts to localhost while preserving explicit env overrides.
5. Update example config so future launches stay local-first.

## Verification

- targeted Node tests for the new auth/bind behavior
- targeted existing Node tests covering `admin/run`
- Python unit test for TTS bind resolution
