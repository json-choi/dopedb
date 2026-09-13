<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/driver

## Purpose

Driver registry and runtime dispatch. Decides which protocol driver is
compatible with and preferred for a given connection target; concrete
adapters (in `../connection`, `../mongo`, `../bigquery`) own the actual
connection mechanics. Downloadable driver packs share the same metadata
contract as bundled drivers — this module does not pretend Rust crates can be
hot-loaded the way JDBC jars can.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | The driver registry: metadata contract for bundled and downloadable drivers, and compatibility/preference resolution. |

## For AI Agents

### Working In This Directory

- A new engine or driver pack must fit the existing metadata contract here
  rather than inventing a parallel registration path; the frontend's driver
  list (`list_drivers`/`install_driver` in `../features/connections`) reads
  through this registry.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block here today.

## Dependencies

### Internal

- Consumed by `../features/connections` (driver listing/installation) and by
  `../connection` when resolving which adapter handles a given connection.

### External

- None beyond the standard library.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
