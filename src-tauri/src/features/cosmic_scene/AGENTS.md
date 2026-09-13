<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/cosmic_scene

## Purpose

Deterministic, allocation-free recipe for the decorative Welcome-screen
cosmos. Rust owns the stable scene seed while the WebView GPU owns pixel
rendering; sending full frames or particle arrays over IPC would multiply
memory and copy cost, so the wire payload deliberately stays a handful of
scalar values. This is a purely cosmetic feature with no domain/ports split.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Deterministic, allocation-free recipe generator for the scene seed. |
| `transport.rs` | Constant-size, read-only scene configuration command for the Welcome artwork. |

## For AI Agents

### Working In This Directory

- Do not widen the IPC payload to carry frames, particle arrays, or any
  per-frame data — only the small scalar seed/config crosses the boundary.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

## Dependencies

### Internal

- No cross-feature or kernel imports observed.

### External

- None beyond `serde` for the scene config DTO.
- Frontend adapter: `src/features/cosmicScene/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
