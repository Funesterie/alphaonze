# NOSSEN Package Scope Policy - 2026-05-25

## Decision

Use two npm scopes with strict responsibilities:

- `@nossen/*` is public, installable and suitable for external users.
- `@funeste/*` is private, internal and reserved for Funesterie/NOSSEN operators.

## Public Scope: `@nossen`

`@nossen` packages are the public runtime/toolkit layer. They should be safe to
install without a token and documented as standalone packages.

Use `@nossen` for:

- public CLIs and libraries;
- reusable orchestration primitives;
- SDK-like modules;
- demos and examples that do not require private infrastructure;
- package pages meant to be readable by outsiders.

Requirements before publishing:

- package access must be public;
- README must explain purpose, install, quick start, runtime fit and safety model;
- package must not contain secrets, local tokens, private endpoints or hidden
  internal-only assumptions;
- internal dependencies should prefer public `@nossen/*` packages unless a private
  feature is truly required.

## Private Scope: `@funeste`

`@funeste` packages are the private operator layer. They may depend on internal
processes, private presets, private automation flows and Funesterie-specific
workflows.

Use `@funeste` for:

- internal NOSSEN presets;
- operator wrappers around public modules;
- private orchestration recipes;
- packages that expose internal naming, workflows or business logic;
- adapters intended only for authenticated Funesterie machines.

Requirements before publishing:

- package access must remain private/restricted;
- installation requires an npm token with access to the `funeste` organization or
  selected packages;
- do not use `@funeste` dependencies inside public `@nossen` packages unless the
  public package is intentionally impossible to use without private access.

## Local npm Configuration

Both scopes are served from npmjs:

```ini
@nossen:registry=https://registry.npmjs.org/
@funeste:registry=https://registry.npmjs.org/
```

The local machine may also keep GitHub Packages scopes such as `@funesterie` and
`@funeste38`, but they are separate from this npmjs policy.

## Current Validation

- `@nossen` currently has 36 scoped public packages.
- `@funeste` currently has 37 scoped private packages.
- The `funeste` org list also contains `a11-coder`, a public legacy unscoped
  package.
- `@nossen/all-in-one@0.1.0` is the public meta-package for the public train.
- `@funeste/all-in-one-nossen@0.1.0` is the private operator meta-package and
  depends on `@nossen/all-in-one`.
- Anonymous install smoke passed for all 36 `@nossen/*` packages plus
  `a11-coder`.
- Authenticated install smoke passed for all 37 `@funeste/*` packages.
- Anonymous access to all 37 `@funeste/*` packages was denied.
- Full npm access audit found zero public/private mismatches.

## Operator Rule

When adding a new package:

1. If it is safe and useful for the outside world, publish under `@nossen`.
2. If it contains internal operator logic, private recipes or privileged glue,
   publish under `@funeste`.
3. Never move a package from private to public without a secret scan and README
   review.
