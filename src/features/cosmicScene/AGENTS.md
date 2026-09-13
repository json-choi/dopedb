<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/cosmicScene

## Purpose

Renders the animated cosmic (galaxy/accretion-disk) background shown only on
the Welcome screen. It is a self-contained WebGL2 effect: a native-provided
"recipe" (seeds/spin/tilt/horizon) drives a full-screen fragment shader, with a
built-in fallback recipe so the effect still renders outside Tauri. This
feature must stay decorative — it owns no application state and is not wired
into any other screen.

## Key Files

| File | Description |
|------|-------------|
| `CosmicBackdrop.tsx` | Default-exported component: fetches the recipe via `cosmicSceneOptions`, waits two animation frames post-paint, then mounts `createCosmicScene` on a canvas. |
| `domain.ts` | `CosmicSceneRecipe` type and `FALLBACK_COSMIC_RECIPE` constant used when native IPC is unavailable. |
| `renderer.ts` | `createCosmicScene` — owns pointer/orbit input, `prefers-reduced-motion` handling, bounded GPU frame scheduling, visibility-based pausing, and resource teardown; returns a `CosmicSceneController` (`setPaused`, `zoomBy`, `reset`, `dispose`). |
| `resources.ts` | `createCosmicResources` — WebGL2 context/program/buffer/shader allocation and palette conversion, isolated from the animation hot path; returns `null` on any allocation failure so the renderer can no-op gracefully. |
| `shaders.ts` | GLSL ES 3.00 vertex/fragment shader source. The fragment shader is documented as "an artistic weak-field approximation, not a scientific Kerr solver." |
| `tauriAdapter.ts` | `cosmicSceneOptions` (`queryOptions`, `staleTime: Infinity`) and `loadCosmicSceneRecipe`, which returns the fallback recipe immediately when `isTauri()` is false. |

## For AI Agents

### Working In This Directory

- Keep this feature's failure modes silent and non-blocking: a missing WebGL2
  context, a failed shader compile, or non-Tauri context must fall back to
  "no animation" or the static fallback recipe, never throw into the Welcome
  screen.
- Respect `prefers-reduced-motion` in any renderer change (`renderer.ts`
  already gates animation on it).

### Testing Requirements

- No test file here; not part of `pnpm test` or the 208-test budget. Verify
  visually via `pnpm dev:app` on the Welcome screen.

### Common Patterns

- GPU/context allocation (`resources.ts`) is kept separate from the
  input/lifecycle loop (`renderer.ts`) specifically so allocation failure
  paths don't complicate the animation loop.

## Dependencies

### Internal

- Rust counterpart: `src-tauri/src/features/cosmic_scene/transport.rs`
  (verified present) serves the `cosmic_scene_recipe` command.

### External

- `@tauri-apps/api/core` (`isTauri`), `@tanstack/react-query` (`queryOptions`).
- Raw WebGL2 (`canvas.getContext("webgl2", ...)`) — no external 3D library.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
