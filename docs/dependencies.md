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

The 2026-07-28 refresh aligned pnpm 11.17.0, TypeScript 7.0.2, Next.js
16.2.12, Better Auth and its Drizzle adapter 1.6.25, lucide-react 1.27.0,
current compatible Rust patches, and current GitHub Actions majors.

Two npm releases were intentionally kept at their immediately preceding
versions because they were less than 24 hours old when the lockfiles were
regenerated:

- `@codemirror/view` 6.43.7
- `@types/node` 26.1.2

Their declared ranges remain compatible. A future audited lockfile refresh can
select them after they satisfy the minimum release age; no bypass is required.
