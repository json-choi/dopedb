<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/commands

## Purpose

Remaining cross-feature `#[tauri::command]` adapters that do not belong to any
single feature vertical's own `transport.rs`. Every command returns an
`AppResult` (see `../error.rs`) that serializes to `{ kind, message }` for the
frontend. Safety invariants for writes/DDL/privilege changes are enforced in
the service/operation path this module calls into (`../safety`,
`../operations`), with the executor's own gates and the target database's
read-only session as defense in depth — this module must not re-implement or
weaken those checks.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | CLI install/status commands, Skill install/repair/self-test commands, document/script proposal and execution commands, safety and PostgreSQL monitoring get/set commands, audit and query-history page/entry reads, operation approve/reject, and `pick_file`. Listed individually in `../lib.rs`'s `invoke_handler`. |

## For AI Agents

### Working In This Directory

- A command belongs here only when it genuinely spans more than one feature's
  service boundary. A command scoped to one feature belongs in that feature's
  own `features/<feature>/transport.rs` instead (see `../features/AGENTS.md`).
- Keep the IPC field names/shapes in sync with the frontend adapter that calls
  each command, per the repository's `tauriAdapter.ts` ↔ `transport.rs`
  pairing convention.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block here today.

## Dependencies

### Internal

- Calls into `../safety`, `../operations`, `../store`, `../skills`, and
  `../cli_install`/`../cli_environment` depending on the command.

### External

- `tauri` (command/state extraction), `uuid`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
