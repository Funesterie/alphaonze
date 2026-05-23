# @funeste/logic-reduce-nossen

Private NOSSEN presets for `@nossen/logic-reduce`.

This package is for the Funesterie operator stack. It keeps project-specific
rules, agent vocabulary, and release guardrails out of the public package while
using the same deterministic reducer.

## Scope

- read the session preflight before infra, MCP, auth, deploy, npm, and prod claims
- keep secrets out of code, docs, tickets, and chat output
- patch exact files
- run targeted tests
- keep PR checks green before merge
- separate public `@nossen/*` modules from private `@funeste/*` adapters

## CLI

```powershell
nossen-logic-reduce-private --objective "Prepare publish" --steps "preflight + retry failed token + patch exact package + run tests + publish"
```

No token, key, password, recovery code, or webhook secret belongs in this
package.
