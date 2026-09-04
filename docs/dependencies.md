# Dependency and toolchain policy

DopeDB uses the newest stable direct dependencies that satisfy its production
runtime and supply-chain policies. A registry's `latest` tag alone is not
enough to make a release eligible.

## JavaScript toolchain

- CI and production builds use Node.js 24, the current Active LTS line. Node.js
  26 remains on the Current line until October 2026, so it is not a production
  upgrade target yet.
- Every JavaScript project pins the same pnpm version in `packageManager`, and
  GitHub Actions uses that exact version.
- TypeScript 7 performs application type-checking. Both Next.js applications
  enable `experimental.useTypeScriptCli` so Next invokes the TypeScript 7 CLI
  instead of trying to load its removed programmatic compiler API.
- pnpm project settings live in each project's `pnpm-workspace.yaml`. pnpm 11
  no longer reads dependency-resolution and build-policy settings from the
  `pnpm` field in `package.json`.
- Dependency releases must be at least 1,440 minutes old. Strict mode is
  enabled and there are no age-policy exclusions.
- Dependency build scripts are denied unless explicitly listed in
  `allowBuilds`. The root permits `esbuild` and explicitly denies `core-js`;
  Workspace Cloud permits `esbuild`.

Node.js recommends Active or Maintenance LTS releases for production:
<https://nodejs.org/en/about/previous-releases>. pnpm's project settings and
build-policy migration are documented at <https://pnpm.io/settings>.

## Rust toolchain

CI uses the latest stable Rust toolchain, while package manifests declare the
minimum supported Rust version. `cargo update --dry-run --verbose` must show no
eligible lockfile update before a dependency refresh is complete.

Direct dependency major-version searches may report prereleases. They are not
stable upgrade targets:

- `dashmap` 7 is release-candidate only; 6.2 is the latest stable line.
- `libc` 1 is alpha only; 0.2 is the latest stable line.
- `zip` 9 is prerelease only; 8 is the latest stable line.

## Audit record

The 2026-09-05 review kept pnpm 11.25.0 aligned across every JavaScript project
and CI workflow. The desktop, Workspace Cloud, site, analytics Worker, scheduler
Worker, and official ACP adapter pins have no update eligible under the
1,440-minute policy. Claude ACP 0.74.0 and Codex ACP 1.9.0 were intentionally
held because they were less than 24 hours old. Notable reviewed upgrades include
ESLint 10, Vite 8.2, Next.js 16.3, Better Auth 1.7, and the current eligible
Claude and Codex ACP adapters.

Better Auth 1.7 changes account identity storage. Because this repository is
still on its resettable pre-MVP baseline, the schema now declares the required
`issuer` and explicitly preserves provider-scoped identity with
`identityStrategy: "provider-id"`. No remote database migration is performed by
dependency refreshes.

Cargo refreshed 148 compatible packages, including the current Tauri plugins,
MongoDB driver, keyring, RustCrypto AEAD stack, XLSX writer, and tree-sitter.
The obsolete `rkyv` 0.7 dependency path was removed. All checked-in GitHub
Actions remain pinned to the commit behind their latest eligible stable tag.
OSV exceptions are explicit and expire on 2026-12-04: Linux-only GTK3 entries
that are not compiled for the shipped macOS or verified Windows targets, plus
unmaintained-only `unic-*` entries currently required by Tauri's `urlpattern`
build dependency. Any other OSV finding fails CI.

The following registry releases were intentionally held because they were less
than 24 hours old when the lockfiles were regenerated:

- `@codemirror/view` 6.43.11
- `@types/react-dom` 19.2.7
- `postcss` 8.5.28
- `lucide-react` 1.40.0
- `wrangler` 4.129.0
- Vitest 5.0.0
- Rust 1.98.1 through the `dtolnay/rust-toolchain` stable action

A future audited refresh can select them after they satisfy the minimum release
age and their applicable migration checks pass; no policy bypass is required.
