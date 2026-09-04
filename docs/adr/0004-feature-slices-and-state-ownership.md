# ADR 0004: Feature slices and single-writer state ownership

## Status

Accepted

## Context

Layer-only folders made a feature flow span screens, IPC, commands, services, and the
store. Large files could grow while rules and state writes were duplicated across those
layers. A folder move alone would not prevent the same drift.

## Decision

- Organize new and migrated code by feature.
- Keep domain, application, and port modules free of Tauri, SQLx, keychain, network, and
  global-state dependencies.
- Wire concrete adapters only at a feature composition boundary.
- Use distinct identity types and composite resource identities; convert raw UUIDs only
  at versioned transport or persistence boundaries.
- Give each mutable state one reducer or runtime owner.
- Keep Rust Tauri commands, renderer command literals, and feature-private wire contracts
  beside the owning feature; central facades may retain only genuinely shared contracts.
- Keep process-backed feature state behind one runtime writer; its Tauri transport,
  frontend command literals, and wire contracts stay feature-owned.
- Keep cross-feature platform dispatchers thin: envelope validation and authentication
  stay in one router, while bounded handlers delegate to feature use cases and share
  only explicit wire projections.
- Express cross-feature authorization through a least-authority read port; producers
  retain a separate write port instead of exposing another feature's store or runtime.
- Split security-sensitive filesystem inspection behind a domain-only port and
  application use case; keep status policy pure and the concrete adapter bounded and
  fail-closed while preserving one public feature facade.
- Keep execution features behind one public facade and application port; Store,
  connection authority, Operation runtime, executor, audit, and history access remain
  private platform-adapter concerns while the central service module only composes them.
- Compose large static catalogues from bounded namespace owners and enforce exact
  language parity, collision freedom, and a fixed compatibility contract in tests.
- Before MVP, reject superseded persisted data and delete its decoder, migration,
  runtime, command, service, fixture, and compatibility facade together.
- Model resumable or concurrent work with explicit state machines.
- Delete the previous runtime path, central wrappers, and compatibility re-exports in the
  same completed feature slice.
- Enforce boundaries, cohesion-aware structure ratchets, state owners, and removed
  symbols in CI. Three hundred lines starts a review; it is not a mechanical split
  command. Large mixed-responsibility modules and tightly coupled tiny-module clusters
  are symmetric navigation risks.

## Consequences

The main feature flow is readable without opening platform code. Adapters can change
without changing policy. The compiler catches several identity mix-ups, and CI catches
new direct writers or resurrected paths. Existing large modules are migrated
incrementally, but cannot grow while waiting. A smaller file count is not automatically
better: modules with one change reason and no independent contract may be recombined
when splitting only adds import hops.
