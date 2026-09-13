<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/skills

## Purpose

Offline, version-matched Skill bundle and owner-local installation manager
for the `dopedb-cli` Skill. Manifests are embedded into the binary at compile
time (`include_str!` from `../resources/skills/*.json` — see
`../../resources/AGENTS.md`) rather than fetched at runtime, so install/repair
works without network access and is always matched to the exact app version
that shipped it. Covers `inventory/` inline.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | `SkillManager`: the public entry point (`new`, per-home construction) with size/depth ceilings (`MAX_FILE_BYTES` 256 KiB, `MAX_INVENTORY_BYTES` 1 MiB, `MAX_INVENTORY_FILES` 32, `MAX_INVENTORY_DEPTH` 4) and the self-test receipt shape (`SkillSelfTestReceipt`: app version, release revision, guide bytes). |
| `bundle.rs` | Loads and validates the three embedded manifests (`current-manifest.json`, `snapshot-registry.json`, `release-mapping.json`) — `validate_current_manifest` checks schema version, skill name/source path, that `app_version` matches `env!("CARGO_PKG_VERSION")`, a non-zero release revision, a valid package digest, and that recomputing the canonical hash over the manifest's files matches the recorded `package_digest`. |
| `installer.rs` | Applies install/repair/remove mutations to the on-disk Skill copy under the user's home directory, backing up prior state (`SkillBackup`) before mutating. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `inventory/` | Bounded, fail-closed inspection of the installed Skill copy on disk, split into pure domain rules and a filesystem adapter. |

`inventory/mod.rs` re-exports `inventory()`, splitting the module into status
policy and filesystem inspection. `inventory/domain.rs` holds pure inventory
status, managed-marker, snapshot, and fingerprint rules (no I/O).
`inventory/filesystem.rs` is the actual bounded, fail-closed filesystem
adapter that inspects the installed copy (respecting `mod.rs`'s
`MAX_INVENTORY_*` ceilings). `inventory/ports.rs` defines the inventory
filesystem port purely in terms of domain values and path inputs, so
`inventory/application.rs` can compose the domain rules against that port
without depending on a concrete filesystem type. `inventory/status.rs` is the
pure policy mapping inventory domain results to the public `SkillStatusResult`.

## For AI Agents

### Working In This Directory

- A change to the shipped `dopedb-cli` Skill content must update
  `../resources/skills/current-manifest.json` (and, for a new release,
  `release-mapping.json`/`snapshot-registry.json`) to keep `bundle.rs`'s
  digest/hash validation passing — do not just edit installed files on disk
  without also updating the embedded manifest they are validated against.
- Keep filesystem inspection inside `inventory/`'s bounded ceilings
  (`MAX_INVENTORY_BYTES`/`FILES`/`DEPTH`) rather than adding an unbounded scan
  — a large or adversarial on-disk Skill directory must not turn inspection
  into an unbounded foreground operation.
- `inventory/domain.rs` must stay I/O-free; put any new filesystem access in
  `inventory/filesystem.rs` behind the `ports.rs` port.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`) covers this module.
  One file here has a `#[cfg(test)]` block (`bundle.rs`'s embedded-manifest
  validation); it is not separately budget-tracked in
  `tests/critical-test-budget.json`.

## Dependencies

### Internal

- Embeds `../resources/skills/*.json`; exposed to the frontend via
  `../commands` (`skill_status`, `install_skill`, `repair_skill`,
  `remove_skill`, `skill_self_test`) and to `state.rs`'s `AppState`.

### External

- `dopedb-protocol` (Skill wire DTOs), `serde`/`serde_json`, `sha2`
  (digest verification), `unicode-normalization`, `uuid`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
