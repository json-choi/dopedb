#!/usr/bin/env node
// Measures unit-test line coverage of the security-boundary code listed in
// tests/critical-coverage.json and compares each side against its target.
//
//   pnpm coverage:critical                 measure Rust and frontend, report only
//   pnpm coverage:critical -- --enforce    exit 1 when a side is below target
//   pnpm coverage:critical -- --rust       Rust only (needs cargo-llvm-cov)
//   pnpm coverage:critical -- --frontend   frontend only (needs @vitest/coverage-v8)
//   pnpm coverage:critical -- --details    also list uncovered functions per file
//   pnpm coverage:critical -- --reuse      read the last reports instead of re-running
//
// Rust lines inside `#[cfg(test)]` modules and functions listed under
// `rust.integrationOnly` are left out of the totals.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "tests/critical-coverage.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const outputDirectory = path.join(root, "target/critical-coverage");
const rustReport = path.join(outputDirectory, "rust.lcov");
const frontendDirectory = path.join(outputDirectory, "frontend");

const flags = new Set(process.argv.slice(2).filter((argument) => argument !== "--"));
for (const flag of flags) {
  if (!["--enforce", "--rust", "--frontend", "--details", "--reuse"].includes(flag)) {
    fail(`unknown option ${flag}`);
  }
}
const runRust = flags.has("--rust") || !flags.has("--frontend");
const runFrontend = flags.has("--frontend") || !flags.has("--rust");

function fail(message) {
  console.error(`critical coverage: ${message}`);
  process.exit(2);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited with ${result.status}`);
}

function validateManifest() {
  const target = manifest.policy?.target;
  if (!Number.isFinite(target) || target <= 0 || target > 100) {
    fail("policy.target must be a percentage");
  }
  for (const side of ["rust", "frontend"]) {
    const files = manifest[side]?.files;
    if (!Array.isArray(files) || files.length === 0) fail(`${side}.files must list files`);
    if (new Set(files).size !== files.length) fail(`${side}.files has duplicates`);
    for (const file of files) {
      if (!existsSync(path.join(root, file))) fail(`${file} does not exist`);
    }
  }
  for (const [file, functions] of Object.entries(manifest.rust.integrationOnly ?? {})) {
    if (!manifest.rust.files.includes(file)) fail(`integrationOnly ${file} is not a listed file`);
    for (const [name, reason] of Object.entries(functions)) {
      if (typeof reason !== "string" || reason.trim().length < 12) {
        fail(`integrationOnly ${file}::${name} must state why it needs integration coverage`);
      }
    }
  }
}

// Each Rust source line belongs to the innermost `fn` whose braces enclose it,
// and lines inside a `#[cfg(test)]` module belong to no production function.
function braceEnd(lines, startIndex) {
  let depth = 0;
  let opened = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const code = lines[index].replace(/\/\/.*$/u, "").replace(/'(?:\\.|[^'\\])'/gu, "''");
    for (const character of code) {
      if (character === "{") {
        depth += 1;
        opened = true;
      } else if (character === "}") {
        depth -= 1;
        if (opened && depth === 0) return index;
      } else if (character === ";" && !opened) {
        return index;
      }
    }
  }
  return lines.length - 1;
}

function rustStructure(file) {
  const lines = readFileSync(path.join(root, file), "utf8").split("\n");
  const testRanges = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*#\[cfg\(test\)\]\s*$/u.test(lines[index])) continue;
    let next = index + 1;
    while (next < lines.length && /^\s*#\[/u.test(lines[next])) next += 1;
    if (/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/u.test(lines[next] ?? "")) {
      testRanges.push([index + 1, braceEnd(lines, next) + 1]);
    }
  }
  const inTest = (line) => testRanges.some(([start, end]) => line >= start && line <= end);
  const functions = [];
  lines.forEach((text, index) => {
    const match = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(text);
    if (!match || /^\s*\/\//u.test(text) || inTest(index + 1)) return;
    functions.push({ name: match[1], start: index + 1, end: braceEnd(lines, index) + 1 });
  });
  const owner = (line) => {
    let best = null;
    for (const candidate of functions) {
      if (line < candidate.start || line > candidate.end) continue;
      if (!best || candidate.start >= best.start) best = candidate;
    }
    return best?.name ?? null;
  };
  return { inTest, owner };
}

function readLcov(file) {
  const byFile = new Map();
  let current = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("SF:")) {
      current = path.relative(root, line.slice(3)).split(path.sep).join("/");
      byFile.set(current, new Map());
    } else if (line.startsWith("DA:") && current) {
      const [lineNumber, count] = line.slice(3).split(",").map(Number);
      const hits = byFile.get(current);
      hits.set(lineNumber, Math.max(hits.get(lineNumber) ?? 0, count));
    }
  }
  return byFile;
}

function measureRust() {
  if (!flags.has("--reuse")) {
    const probe = spawnSync("cargo", ["llvm-cov", "--version"], { cwd: root });
    if (probe.status !== 0) {
      fail("cargo-llvm-cov is missing: run `cargo install cargo-llvm-cov --locked` and `rustup component add llvm-tools-preview`");
    }
    mkdirSync(outputDirectory, { recursive: true });
    run("cargo", ["llvm-cov", "--package", "dopedb", "--lib", "--lcov", "--output-path", rustReport]);
  }
  if (!existsSync(rustReport)) fail("no Rust report; run without --reuse first");
  const report = readLcov(rustReport);
  const excluded = manifest.rust.integrationOnly ?? {};
  return manifest.rust.files.map((file) => {
    const hits = report.get(file);
    if (!hits) return { file, covered: 0, total: 0, missing: true, uncovered: new Map() };
    const { inTest, owner } = rustStructure(file);
    const skip = new Set(Object.keys(excluded[file] ?? {}));
    let covered = 0;
    let total = 0;
    const uncovered = new Map();
    for (const [line, count] of hits) {
      if (inTest(line)) continue;
      const name = owner(line);
      if (name && skip.has(name)) continue;
      total += 1;
      if (count > 0) covered += 1;
      else uncovered.set(name ?? "<module>", (uncovered.get(name ?? "<module>") ?? 0) + 1);
    }
    return { file, covered, total, uncovered };
  });
}

function measureFrontend() {
  if (!flags.has("--reuse")) {
    if (!existsSync(path.join(root, "node_modules/@vitest/coverage-v8"))) {
      fail("@vitest/coverage-v8 is missing: run `pnpm install`");
    }
    run(path.join(root, "node_modules/.bin/vitest"), [
      "run",
      "--coverage.enabled",
      "--coverage.provider=v8",
      "--coverage.reporter=json-summary",
      `--coverage.reportsDirectory=${frontendDirectory}`,
      ...manifest.frontend.files.map((file) => `--coverage.include=${file}`),
    ]);
  }
  const summaryPath = path.join(frontendDirectory, "coverage-summary.json");
  if (!existsSync(summaryPath)) fail("no frontend report; run without --reuse first");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const byFile = new Map(
    Object.entries(summary)
      .filter(([file]) => file !== "total")
      .map(([file, value]) => [path.relative(root, file).split(path.sep).join("/"), value]),
  );
  return manifest.frontend.files.map((file) => {
    const value = byFile.get(file);
    if (!value) return { file, covered: 0, total: 0, missing: true, uncovered: new Map() };
    return { file, covered: value.lines.covered, total: value.lines.total, uncovered: new Map() };
  });
}

function percent(covered, total) {
  return total === 0 ? 100 : (100 * covered) / total;
}

function report(side, rows) {
  const target = manifest.policy.target;
  console.log(`\n${side}`);
  for (const row of [...rows].sort((a, b) => percent(a.covered, a.total) - percent(b.covered, b.total))) {
    const value = row.missing ? "  n/a" : `${percent(row.covered, row.total).toFixed(0).padStart(4)}%`;
    console.log(`${value} ${`${row.covered}/${row.total}`.padStart(9)}  ${row.file}${row.missing ? "  (not instrumented)" : ""}`);
    if (flags.has("--details") && row.uncovered.size > 0) {
      const names = [...row.uncovered].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}(${count})`);
      console.log(`                 uncovered: ${names.join(" ")}`);
    }
  }
  const covered = rows.reduce((sum, row) => sum + row.covered, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const value = percent(covered, total);
  console.log(`${value.toFixed(1)}% total (${covered}/${total} lines, target ${target}%)`);
  return value >= target && rows.every((row) => !row.missing);
}

validateManifest();
const results = [];
if (runRust) results.push(report("Rust", measureRust()));
if (runFrontend) results.push(report("Frontend", measureFrontend()));
if (flags.has("--enforce") && results.some((passed) => !passed)) {
  console.error("\ncritical coverage: below target");
  process.exit(1);
}
