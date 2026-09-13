<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# dopedb-protocol/src

## Purpose
Every DTO, command spec, and version constant that makes up the DopeDB wire
contract, split one concern per file: transport framing, request/response
envelopes, and one file (plus a `*_command.rs` companion) per product domain
(catalog, connections, operations, knowledge, Analysis Articles, skills, ACP
plugins, external agents, control plane). See `../AGENTS.md` for the
public-contract rule that governs every file here.

## Key Files
| File | Description |
|------|-------------|
| `lib.rs` | Crate root; states the "no database/credential-store/Tauri/network dependency" constraint and re-exports the public surface. |
| `frame.rs` | Length-prefixed JSON framing and centralized structural size limits (e.g. `MAX_REQUEST_BYTES`/`MAX_RESPONSE_BYTES`, referenced by `dopedb-cli`'s `client.rs`). |
| `request.rs` | Versioned request envelope and command-name vocabulary for the local broker. |
| `response.rs` | Validated broker response envelope. |
| `command.rs` | Typed command payload trait(s) shared by the Desktop broker and CLI; an active dispatcher must decode through one of these closed command specs before reaching an application service. |
| `error.rs` | Stable broker `ErrorCode`s and redacted error envelopes (consumed by `dopedb-cli/src/exit_code.rs`). |
| `version.rs` | Protocol and command-schema version negotiation (`PROTOCOL_MIN`/`PROTOCOL_MAX`, `COMMAND_SCHEMA_VERSION`). |
| `discovery.rs` | Public, secret-free runtime discovery metadata (how the CLI finds a running Desktop runtime). |
| `catalog.rs` | Catalog V2 DTOs shared by introspection, CLI, ERD, DDL, and table editing. |
| `catalog_command.rs` | Typed catalog, schema, and relation command payloads. |
| `connection.rs` | Secret-free connection selectors and command payloads. |
| `operation.rs` | Stable operation lifecycle vocabulary shared with CLI status responses. |
| `operation_command.rs` | Redacted operation lifecycle command payloads. |
| `query_command.rs` | Typed read-plan, read-run, SQL-proposal, and cancellation payloads. |
| `document_command.rs` | Typed MongoDB read contracts for the Terminal-scoped local broker. |
| `schema_diff.rs` | Read-only structural comparison of canonical catalogs (relation kind, column type/nullability/PK, index, foreign key); explicitly excludes database name, native ID, row estimate, and capture time from identity. |
| `ddl.rs` | Dialect-neutral schema-change IR shared by the desktop UI and runtime; the UI never assembles executable DDL directly, only this IR, which is validated against an exact Catalog V2 fingerprint before the ordinary Operation approval path. |
| `knowledge.rs` | Provider-neutral Project Knowledge wire contracts; deliberately cannot carry a local folder path, repository token, source file body, provider credential, or unprovenanced inferred fact. |
| `knowledge_command.rs` | Session-scoped Project Knowledge commands, authorized against the immutable graph revision set pinned at ACP session launch (arguments never carry a workspace/project/environment/source/grant selector). |
| `analysis_article.rs` | Credential-free contracts for current Analysis Articles: sanitized HTML plus exactly one bounded read-only query. |
| `analysis_article_command.rs` | Exact Agent/Broker commands for the Analysis Article domain. |
| `analysis_article_sql.rs` | Small lexical safety check shared by the Rust Analysis Article boundary; database execution still applies the engine-aware Desktop read-only gate separately. |
| `analysis_article_validation.rs` | Cross-runtime validation for the current one-query Analysis Article DTO. |
| `external_agent.rs` | Secret-free project configuration and approval-bound external Agent sessions (backs `dopedb agent start`). |
| `skill_command.rs` | Versioned Skill bundle, inventory, and mutation command payloads. |
| `acp_plugin.rs` | Closed first-party ACP adapter plugin and signed catalog contracts; the Desktop accepts only the two IDs defined here, and a catalog entry can select a version of one of those plugins but never introduce another executable identity or provider. |
| `control_plane.rs` | Versioned, credential-bearing Workspace control-plane wire contracts (HTTPS payloads shared by Workspace Cloud and Desktop); contains no transport/storage/authority behavior, and parsed secret fields own zeroizing strings. |

## For AI Agents

### Working In This Directory
- Follow the existing one-domain-per-file split (`X.rs` for DTOs, `X_command.rs` for its `CommandSpec`s) when adding a new domain rather than growing an existing file.
- `acp_plugin.rs` is a closed allowlist by design — do not make plugin identity data-driven or accept a third provider without an explicit product decision (see root `AGENTS.md` ACP boundary).
- `knowledge.rs`/`knowledge_command.rs` and `external_agent.rs` intentionally omit fields (paths, tokens, selectors) that would let a session escape its pinned grant; do not add such a field to satisfy a convenience use case.

### Testing Requirements
- Exercised by `cargo test --package dopedb-protocol --test golden` (see `../tests/AGENTS.md`). There are no unit tests inside `src/` itself; new wire-shape coverage belongs in the golden suite plus a fixture.

### Common Patterns
- Every module opens with a `//!` doc comment stating its one-sentence purpose and any hard constraint (e.g. `knowledge.rs`'s "cannot carry a local folder path..."); keep that convention for new files (root `CLAUDE.md` requires `//!` module docs).

## Dependencies

### Internal
- None — this is the leaf of the workspace dependency graph.

### External
- `serde`/`serde_json`, `chrono`, `uuid`, `sha2`, `thiserror`, `zeroize`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
