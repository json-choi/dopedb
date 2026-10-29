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
- `zip` 9 is stable, but `calamine` and `rust_xlsxwriter` still require zip 8,
  so the direct dependency stays on 8. `tauri-plugin-updater` needs zip 4 only
  for its default `zip` feature, which DopeDB disables.

## Audit record

### Security patch refresh — 2026-10-21

The recursive CI scan reported newly published Vite, HTML sanitization, and
TLS certificate advisories. Desktop now resolves Vite 8.3.4; Workspace Cloud
resolves sanitize-html 2.18.1 and Vite 8.2.4; the scheduler resolves Vite
8.2.4. The two independent Worker projects apply a scoped Vite override so
their indirect Vitest dependency cannot retain an affected 8.x release.
The 1,440-minute release-age and build-script policies remain in force.

Mermaid 12.2.0 accepts the patched KaTeX 0.18 line, so Desktop updates Mermaid
and removes the temporary [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)
exception. Diagram rendering keeps strict security and disables HTML labels.
KaTeX 0.18.11 was withdrawn for accidental breaking changes; an exact-version
override selects the compatible, patched 0.18.10 instead of crossing into 0.19.

Cargo updates only the affected compatible TLS dependencies:
`rustls-webpki` 0.103.16, `webpki-roots` 1.0.10, and `webpki-root-certs`
1.0.10. These address [RUSTSEC-2026-0382](https://rustsec.org/advisories/RUSTSEC-2026-0382.html),
[RUSTSEC-2026-0381](https://rustsec.org/advisories/RUSTSEC-2026-0381.html), and
[RUSTSEC-2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383.html).
No vulnerability suppression or CI gate is relaxed by this refresh.

The 2026-09-05 review kept pnpm 11.25.0 aligned across every JavaScript project
and CI workflow. The desktop, Workspace Cloud, site, scheduler
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
build dependency. The `zip` extraction advisories RUSTSEC-2026-0367, -0368, and
-0369 expire on 2026-11-17: the fix exists only in zip 9, which the XLSX crates
do not accept yet. DopeDB never calls `extract()`, and the root `clippy.toml`
rejects the extract APIs. The Tauri updater's default `zip` feature, the only
caller, is disabled because DopeDB ships macOS `.app.tar.gz` and Windows NSIS
`.exe` updates, not `.zip` packages. Keep it disabled while the exceptions,
which are scoped by advisory ID, remain. The `zvariant`, `zbus_names`, and
`zvariant_derive` advisories RUSTSEC-2026-0370, -0371, and -0372 have no fixed
release yet; they expire on 2026-12-04 because those crates arrive only through
the Linux-only `zbus` D-Bus stack of `keyring` and the Tauri opener and
single-instance plugins. `ammonia` is pinned to 4.2.4 for RUSTSEC-2026-0373. The zip header
parser-differential advisory GHSA-m665-v7pm-7grj also expires on 2026-11-17
with the other zip entries: its fix is zip 9.0.5, and DopeDB reads archives only
through `ZipArchive` (XLSX entries in memory, and the size- and SHA-256-pinned
BigQuery SDK archive on Windows), never through a second streaming reader. The
`block-buffer` 0.10.4 advisory GHSA-qwgh-2vcv-g2f7 expires on 2026-11-30: the
fix exists only in 0.12.1, which the digest 0.10 hashes used by sqlx, minisign
and Tauri cannot take, and the bug needs a panicking compress callback that
those hashes never have. Workspace Cloud keeps `better-auth` 1.7.4 until an
explicit identity migration: 1.7.7 and later reject the provider-scoped
`account.issuer` column the baseline keeps for `identityStrategy: "provider-id"`.
Its advisories GHSA-965c-763c-88jm (Magic Link), GHSA-r4xp-prcw-77qf (OAuth
Proxy), and GHSA-44jh-23m7-hpcf (PostgreSQL rate limiting) expire on 2026-11-30;
none of those plugins or that database is in use. These exceptions live in
`workspace-cloud/osv-scanner.toml`, because OSV-Scanner reads the config beside
each lockfile.
Any other OSV finding fails CI.

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

### Vitest isolation check — 2026-09-16 (#242)

The root resolves Vitest 5.0.0 / Vite 8.2.2; Workspace Cloud independently
resolves Vitest 4.1.11 / Vite 8.2.0. Both frozen installs passed with pnpm
11.25.0 and Node 24.19.0 without a manifest or lockfile change. Root smoke
passed 42 tests, and Workspace Cloud contracts passed 10 tests, including its
isolated Miniflare D1 storage suite. The Workspace Cloud production build passed.

The installed packages' Node/Vite peer ranges accept this environment. The
[official Vitest 5 migration guide](https://vitest.dev/guide/migration/)
requires Node 22.12+ and Vite 6.4+, and changes mock clearing and inline-project
inheritance. These projects invoke separate installed runners/configurations;
the cloud harness does not inherit the root runner's defaults. A version-number
difference alone is not an incompatibility. No dependency upgrade is justified
by this reproduction; future upgrades still need their own migration review.
