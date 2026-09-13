<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/jobs

## Purpose

Durable, resumable import/export Job Engine. Native file dialogs mint opaque
file capabilities (never renderer-supplied paths), immutable plans are bound
to an exact durable Operation and canonical-hash pinned before execution, and
a bounded worker persists progress/checkpoints so interruption becomes an
explicit pause rather than an ambiguous retry.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Feature root; `JobsFeature` facade (subscribe to `JobChangedEvent`, recover interrupted jobs, register input/output capabilities, inspect input, create/list/detail/start/pause/cancel, artifact path); `compose(store, connections, catalog, operation)` wires `JobRepository` (ledger), `RuntimeJobAuthority`, `LocalJobFiles`, `JobCatalogAdapter`, `OperationRuntime`, `JobWorker`, `SystemJobGenerator` into `JobUseCases`. |
| `domain.rs` | Serializable Job Engine contracts; plans contain opaque file-capability ids, never renderer-supplied paths, and are canonical-hash pinned before execution. |
| `ports.rs` | Platform contracts required by Job application use cases; the application layer owns validation/mutation ordering while connection pins, SQLite, native files, catalog refreshes, Operation persistence, clocks, and database execution stay behind these ports. |
| `state_machine.rs` | Pure durable Job Engine transition policy (`JobTransition`). |
| `validation.rs` | Pure job-plan validation against one immutable catalog snapshot. |
| `transport.rs` | Tauri transport for the durable Job Engine. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | Concrete local adapters: authority, catalog refresh, filesystem capabilities, generator, ledger (SQLite), and worker execution. |
| `application/` | Durable, scope-aware Job application use cases split by concern (execution, files, planning, recovery). |

**`adapters/`**

| File | Description |
|------|-------------|
| `mod.rs` | Concrete local adapters for Job application ports (module root). |
| `authority.rs` | Scope-pinned connection authority adapter (`RuntimeJobAuthority`) for Job use cases and workers. |
| `catalog.rs` | Catalog refresh adapter (`JobCatalogAdapter`) used by Job planning and execution. |
| `filesystem.rs` | Private input snapshots and renderer-safe output capabilities (`LocalJobFiles`). |
| `generator.rs` | System identity and clock adapter (`SystemJobGenerator`) for Job use cases. |
| `operation.rs` | Durable Operation runtime adapter for Job use cases. |
| `format/` | Local bounded file format adapter — see below. |
| `ledger/` | SQLite projection and append-only ledger adapter — see below. |
| `worker/` | Bounded local worker adapter — see below. |

**`adapters/format/`** — CSV/TSV/NDJSON and SQL are streamed; JSON arrays and XLSX use bounded document models. Writer state, value encoding, import readers, inspection, and file hardening are separate internal responsibilities.

| File | Description |
|------|-------------|
| `mod.rs` | Module root and the streaming/bounded-model split described above. |
| `export.rs` | `TextWriter`/`ExportSink` streaming writer implementation for CSV/TSV/NDJSON export. |
| `import.rs` | `ImportSource` reader implementation for bounded import. |
| `inspection.rs` | `inspect_source`/`bounded_preview`/`audit_sql_source` — bounded preview and audit of an import file before job planning. |
| `io.rs` | Low-level bounded file I/O shared by import/export: gzip decoding, calamine XLSX cell access, SHA-256 hashing. |
| `values.rs` | Engine-specific SQL identifier/value quoting (`quote_identifier`, `quoted_value`) used when generating import statements. |

**`adapters/ledger/`** — SQLite projection and append-only ledger for durable jobs.

| File | Description |
|------|-------------|
| `mod.rs` | Module root; `JobRepository`. |
| `capabilities.rs` | File-capability row persistence (`JobFileCapability`/`JobFileDirection`). |
| `events.rs` | `append_event` — append-only ledger event writer inside a SQLite transaction. |
| `mapping.rs` | Row-to-domain mapping helpers (`row_to_job`, `row_to_artifact`, `row_to_record`, numeric/UUID parsing). |
| `records.rs` | Job/artifact record CRUD (`get_scoped`/`get_unscoped`) backed by the ledger events. |
| `recovery.rs` | `recover_interrupted` — reloads jobs left mid-execution across a restart. |
| `transitions.rs` | State-transition persistence: applies a `JobTransition`, appends its ledger event, and updates checkpoints. |

**`adapters/worker/`** — the entrypoint owns execution ordering while export, import, resume validation, SQL generation, and artifact publication remain isolated implementation modules.

| File | Description |
|------|-------------|
| `mod.rs` | Module root; `JobWorker` entrypoint owning execution ordering. |
| `export.rs` | `JobWorker` export-path execution. |
| `import.rs` | `JobWorker` import-path execution. |
| `files.rs` | `replace_file` — atomic output-file publication. |
| `resume.rs` | `JobWorker` resume-from-checkpoint execution. |
| `statements.rs` | `build_insert` and related SQL statement generation for import. |
| `validation.rs` | `verify_operation` — checks a claimed durable Operation matches the Job record before executing. |

**`application/`**

| File | Description |
|------|-------------|
| `mod.rs` | `JobDependencies`, `JobUseCases` — durable, scope-aware Job application use cases (module root). |
| `execution.rs` | Start/pause/cancel and execution-path use cases. |
| `files.rs` | Register input/output capability and inspect-input use cases. |
| `planning.rs` | Create/plan and list/detail use cases. |
| `recovery.rs` | Recover-interrupted use case wiring to `adapters/ledger/recovery.rs`. |

## For AI Agents

### Working In This Directory

- A Job plan must only ever reference an opaque `JobFileCapabilityId`
  minted by `adapters/filesystem.rs`; never accept a raw renderer-supplied
  path into a plan or the ledger.
- A plan is canonical-hash pinned (see `domain.rs`) before execution — do not
  let `adapters/worker/` mutate a plan's shape after that point; validate
  changes in `validation.rs` before planning instead.
- Progress/checkpoints must be durable (`adapters/ledger/transitions.rs`) so
  an interrupted job resumes as an explicit pause, never an ambiguous retry;
  any new worker step must persist a checkpoint before it can be considered
  complete.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

### Common Patterns

- `type ComposedJobApplication = JobUseCases<JobRepository, RuntimeJobAuthority, LocalJobFiles, JobCatalogAdapter, OperationRuntime, JobWorker, SystemJobGenerator>;`
  in `mod.rs` is the generic-over-every-port composition pattern; add a new
  capability as a new generic port parameter rather than a concrete
  dependency inside `application/`.

## Dependencies

### Internal

- Imports `crate::features::catalog` (`CatalogFeature`, wrapped by
  `adapters::catalog::JobCatalogAdapter`) and `crate::kernel::identity`.
- Imported by `crate::features::queries` (Agent/Terminal-originated import
  jobs) and `crate::features::scripts` is not a dependent, but both sit
  behind `crate::operations::OperationRuntime`.

### External

- `csv`, `calamine` (XLSX read), `rust_xlsxwriter` (XLSX write), `zip`,
  `flate2`, `sha2` (via `hex`/`getrandom` for ids), `sqlx`, `tokio::sync::broadcast`.
- Frontend adapter: `src/features/jobs/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
