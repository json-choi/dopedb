<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/knowledge

## Purpose

Project Knowledge: bounded, deterministic structural code extraction into an
immutable knowledge-graph revision, hosted and Local Folder source
management, grants/scopes, and Agent-scoped reads. Per `CLAUDE.md`, the
Agent can only judge well when it sees the real schema, so introspection
breadth/depth outranks visual features here. Extraction is deliberately
structural only: no provider API, model, prompt, or inferred semantic edge
participates.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Composition boundary; `KnowledgeFeature = facade::KnowledgeFeature<adapters::SqliteKnowledgeRepository, adapters::HostedKnowledgeAuthority>`; `compose(store)`. |
| `facade.rs` | The only shared entry point for local Knowledge persistence and hosted Knowledge authority, keeping both `Store` and workspace HTTP adapters out of transports, Analysis Articles, and the ACP Broker. |
| `domain.rs` | Provider-neutral Project Knowledge values and safety invariants. |
| `ports.rs` | Provider adapters and immutable graph persistence ports. |
| `extractor.rs` | Bounded deterministic code extraction for immutable Knowledge revisions; unsupported files stay visible as skipped input, a parser error rejects the candidate before activation. |
| `extractor_language.rs` | `SupportedLanguage` (TypeScript/Rust) tree-sitter language dispatch used by the extractor. |
| `extractor_tests.rs` | Inline `assert_extractor_contract()` fixture exercising the extractor end to end. |
| `reconciliation.rs` | Explicit reconciliation of hosted Knowledge authority into device-local state; read entry points never reconcile access or mutate grants/Environment bindings on their own — callers invoke this deliberately and get a bounded receipt. |
| `runtime.rs` | Process-local source watcher lifecycle; only Local Folder sources are watched here, GitHub changes arrive via the App webhook and are indexed by the control plane. |
| `runtime_adapter.rs` | Tauri event and OS-keychain adapters for the Knowledge watcher runtime. |
| `source_sync.rs` | Local/hosted Knowledge source synchronization use case shared by transport and watchers. |
| `transport.rs` | Trusted Desktop transport for Project Knowledge source setup; the renderer receives source identity and revision evidence only. |
| `transport_graph.rs` | Knowledge Environment binding command transport. |
| `transport_projects.rs` | Knowledge Project and Environment command transport. |
| `transport_sources.rs` | Knowledge source inventory, sync, and revocation command transport. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | Concrete hosted/local/SQLite adapters, including the `sqlite_store/` aggregate. |

**`adapters/`**

| File | Description |
|------|-------------|
| `mod.rs` | Declares `hosted`, `local`, `sqlite`, `sqlite_store`; re-exports `HostedKnowledgeAuthority`, `SqliteKnowledgeRepository`. |
| `hosted.rs` | Hosted Project Knowledge authority adapter; tokens stay in the OS credential store, source content returns only for an exact workspace/source/revision request. |
| `hosted_projects.rs` | Hosted Knowledge project, grant, mapping, and graph operations. |
| `hosted_sources.rs` | Hosted Knowledge environment binding, GitHub, and source operations. |
| `local.rs` | OS-owned Local Folder source adapter; absolute roots stay in a process-local registry, shared binding/graph values contain only salted-free SHA-256 fingerprints and revision evidence. |
| `sqlite.rs` | SQLite-backed Project Knowledge repository adapter, owned by the application facade so Tauri/Analysis Articles/the Broker never receive a raw global `Store`. |
| `sqlite_store/` | Aggregate-owned SQLite statements extending `Store` only inside this adapter; `sqlite.rs` is the sole production caller exposed to the application. |

**`adapters/sqlite_store/`**

| File | Description |
|------|-------------|
| `mod.rs` | Aggregate-owned SQLite statements for the Project Knowledge adapter (module root, invariant above). |
| `access.rs` | Agent access scope and Project Environment connection bindings. |
| `codec.rs` | Encode/decode for graph build artifacts and environment connection rows; bounds artifact JSON to `MAX_GRAPH_ARTIFACT_JSON_BYTES` (256 MiB). |
| `grants.rs` | Exact Knowledge grant persistence and lookup. |
| `graphs.rs` | Knowledge graph revision staging, activation, and lookup. |
| `mappings.rs` | Knowledge mapping proposal persistence and review state. |
| `projects.rs` | Project and Project Environment persistence. |
| `scopes.rs` | Knowledge source scopes and source snapshots. |

## For AI Agents

### Working In This Directory

- A new extractor language or rule must stay purely structural — no network
  call, model inference, or prompt may participate in `extractor.rs`/
  `extractor_language.rs`.
- Never let a read entry point (transport/application read) mutate grants or
  Environment bindings; only `reconciliation.rs`'s explicit workflow may do
  that, and only when a caller invokes it on purpose.
- Local Folder paths must stay behind `adapters/local.rs` and the native
  command boundary; only fingerprints/revision evidence may leave it.
- Route new SQLite statements through `adapters/sqlite_store/`, not a second
  ad hoc `Store` extension — `adapters/sqlite.rs` is the only production
  caller the application should see.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`), including the
  inline `extractor_tests.rs` contract fixture.

### Common Patterns

- `compose(store: Store) -> KnowledgeFeature` in `mod.rs` composes the
  generic `facade::KnowledgeFeature<Repo, Authority>` over the concrete
  SQLite/hosted adapters, mirroring the parent `AGENTS.md`'s convention.

## Dependencies

### Internal

- Imports `crate::features::workspaces` and `crate::kernel::{access, identity}`.
- Imported by `crate::features::agents` (ACP Knowledge-scope resolution),
  `crate::features::analysis_articles`, and `crate::features::queries`.

### External

- `tree-sitter`, `tree-sitter-typescript`, `tree-sitter-rust`, `sha2`,
  `notify` (Local Folder watcher), `sqlx`, `reqwest` (hosted control plane),
  `dopedb-protocol` (`GraphBuildArtifactV1`, `KnowledgeNodeKind`,
  `KnowledgeSourceProvider`, `KnowledgeSourceVisibility`).
- Frontend adapter: `src/features/knowledge/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
