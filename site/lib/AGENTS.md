<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# site/lib

## Purpose
DOM-free site logic shared across routes and client components: the site
analytics closed vocabulary and the Three.js galaxy hero renderer, split into
controls/scene/shaders/renderer modules.

## Key Files
| File | Description |
|------|-------------|
| `analytics.ts` | Owns the site analytics closed vocabulary: fixed `sources` (`header`, `hero`, `download_section`, `platform_grid`) and `targets` (`latest_release`, `windows_x64_installer`, `macos_arm64_dmg`, `macos_x64_dmg`). `siteAnalyticsPoint` validates an unknown value into that vocabulary; no URL, query string, identifier, referrer, free text, or request header is ever retained. |
| `galaxyControls.ts` | Owns pointer capture and hero-exploration shortcuts (drag, zoom clamp) while leaving ordinary page scrolling native. |
| `galaxyRenderer.ts` | Creates the single viewport-sized Three.js scene that follows native section scroll across a fixed `chapters` sequence (`top`, `product`, `flow`, `trust`, `download`); owns explicit GPU lifecycle (create/dispose). |
| `galaxyScene.ts` | Builds the bounded GPU scene and semantic color palette; buffers are generated once, not per frame. |
| `galaxyShaders.ts` | Procedural GLSL shaders for starlight and dust extinction; explicitly no photographic textures or postprocessing. |

## For AI Agents

### Working In This Directory
- `analytics.ts`'s `sources`/`targets` lists are the entire allowed vocabulary; adding a new trackable event/link means extending both this list and the corresponding call site in `site/app/`, never sending an arbitrary string.
- Never add PII, URLs, or free text to an analytics point here; `siteAnalyticsPoint` is the enforcement point for that boundary.
- Galaxy scene buffers must stay build-once; do not reintroduce a per-frame allocation for star/dust geometry.

### Testing Requirements
- No dedicated unit tests; exercised through `pnpm site:build` and manual verification of the landing page.

### Common Patterns
- Modules that own a mutable runtime resource (renderer, controls) return an explicit object with lifecycle methods (e.g. dispose/cleanup) rather than relying on garbage collection.

## Dependencies

### Internal
- Consumed by `../app/GalaxyHero.tsx` (galaxy modules) and `../app/SitePageEffects.tsx` / `../app/TrackedLink.tsx` / `../app/api/site-events/route.ts` (`analytics.ts`).

### External
- Three.js (`MathUtils`, `PerspectiveCamera`, `Scene`, `WebGLRenderer`, buffer/geometry/material classes).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
