<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# site/lib

## Purpose
DOM-free site logic shared across routes and client components: the
Three.js galaxy hero renderer, split into
controls/scene/shaders/renderer modules.

## Key Files
| File | Description |
|------|-------------|
| `galaxyControls.ts` | Owns pointer capture and hero-exploration shortcuts (drag, zoom clamp) while leaving ordinary page scrolling native. |
| `galaxyRenderer.ts` | Creates the single viewport-sized Three.js scene that follows native section scroll across a fixed `chapters` sequence (`top`, `product`, `flow`, `trust`, `download`); owns explicit GPU lifecycle (create/dispose). |
| `galaxyScene.ts` | Builds the bounded GPU scene and semantic color palette; buffers are generated once, not per frame. |
| `galaxyShaders.ts` | Procedural GLSL shaders for starlight and dust extinction; explicitly no photographic textures or postprocessing. |

## For AI Agents

### Working In This Directory
- Galaxy scene buffers must stay build-once; do not reintroduce a per-frame allocation for star/dust geometry.

### Testing Requirements
- No dedicated unit tests; exercised through `pnpm site:build` and manual verification of the landing page.

### Common Patterns
- Modules that own a mutable runtime resource (renderer, controls) return an explicit object with lifecycle methods (e.g. dispose/cleanup) rather than relying on garbage collection.

## Dependencies

### Internal
- Consumed by `../app/GalaxyHero.tsx` (galaxy modules).

### External
- Three.js (`MathUtils`, `PerspectiveCamera`, `Scene`, `WebGLRenderer`, buffer/geometry/material classes).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
