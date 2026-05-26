# NOSSEN Private Package Context

This note is the private operator view for the public `@nossen` package line.
It keeps project-specific vocabulary out of public package metadata while
preserving the deployment intent for the NOSSEN/Funesterie stack.

## Public Package Posture

Public package READMEs and npm metadata should describe reusable tooling:

- `@nossen/qflush`: portable local automation orchestrator.
- `@nossen/dragon-contracts`: typed control-plane contracts.
- `@nossen/dragon-upstream`: upstream service bridge helpers.
- `@nossen/dragon`: local agent and service control-plane daemon.

Avoid public metadata that assumes an A11 workspace, personal operator context,
or a private infrastructure topology.

## Private Operator Mapping

Inside the NOSSEN stack:

- QFlush remains the local operator CLI for A11/Funesterie workspaces.
- Dragon remains the control-plane lane for local agents, semantic tools,
  upstream probes, and coordinated services.
- The Google Artifact Registry mirror can carry the same package names for
  private rollout checks before public npm publication.
- Support and donation links stay public, but private credentials, recovery
  codes, deployment secrets, and webhook credentials stay in the secret store.

## Release Rule

For each package release, verify both views:

- Public view: generic README, no private A11 assumptions, no personal details,
  no secrets.
- Private view: NOSSEN/A11 deployment notes and runtime topology remain
  discoverable for operators.
