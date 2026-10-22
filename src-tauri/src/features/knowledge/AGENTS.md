<!-- Parent: ../AGENTS.md -->
# Project resources and GitHub sources

This feature owns revisioned Projects, fixed-kind Environments, exact database
bindings, and GitHub source identities. Graph extraction, graph traversal,
mapping, graph-specific grants, code-index jobs and Local Folder indexing are
excluded by PD-36 in `docs/PRODUCT_UI_SCOPE.md`.

## Boundaries

- `mod.rs::compose(store)` creates the sole `KnowledgeFeature` facade. Concrete
  adapters and ports remain private; tests use `#[cfg(test)] test_support`.
- `domain.rs` owns Project, Environment, source identity and session-scope values.
- `ports.rs` owns hosted DTOs and narrow repository/authority contracts.
- `facade.rs` is the only shared entry point for transports, Analysis Articles
  and Broker callers; they never receive a raw `Store` or HTTP adapter.
- `reconciliation.rs` explicitly reconciles hosted source identity and database
  bindings at Agent entry points. Read entry points do not silently reconcile
  authority. Required hosted checks fail closed; personal database-only use
  remains device-owned.
- `transport.rs`, `transport_projects.rs`, `transport_sources.rs`, and
  `transport_connections.rs` expose native setup, inventory and binding commands.
- `adapters/hosted*.rs` owns bounded hosted requests. Installation tokens remain
  in the control plane; only exact-commit bounded file reads return source text.
- `adapters/sqlite.rs` implements the feature ports. All Knowledge `Store`
  extensions live inside `adapters/sqlite_store/` and are visible only to the
  adapter. `projects.rs`, `scopes.rs`, and `access.rs` own their respective rows;
  `codec.rs` contains shared bounded codecs.

## Authority

An Agent selects resources from one Project. Preserve account, workspace,
Environment revision, source ID and commit, selected database revisions, and
current binding checks. `validate_knowledge_session_scope` checks the current
source and database authority even for a source-only session whose anchor DB is
not selected for execution. Source search/read rechecks hosted authority.
A branch move, revoked source, changed binding or membership must reject an old
session. Never replace these checks with an empty graph or permissive fallback.

## Validation

Run `pnpm test:rust` for Rust changes. Extend the existing store and Broker tests
within the 208-test budget; current source identity and exact-resource isolation
remain protected after graph retirement. Frontend commands live in
`src/features/knowledge/tauriAdapter.ts`.
