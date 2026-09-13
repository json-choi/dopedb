#!/usr/bin/env node
// Keeps the repository's critical test suite within its explicit fixed budget,
// and separately accounts for the `*.harness.*` contract suites that run under
// their own vitest configs outside that budget.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "tests/critical-test-budget.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const hardCap = Object.freeze({
  total: 208,
  frontend: 80,
  frontendFiles: 16,
  rust: 128,
  rustFiles: 26,
});
const ignoredDirectories = new Set([
  ".git",
  ".agents",
  ".codex",
  ".next",
  ".open-next",
  ".wrangler",
  "dist",
  "node_modules",
  "target",
]);
const frontendTestPattern =
  /(?:\.test|\.spec|\.node-test)\.(?:[cm]?[jt]sx?)$/u;
// Contract harnesses are executed by dedicated vitest configs rather than the
// suffix-discovered frontend suite, so they are tracked separately and never
// folded into the 208/80/128 caps without an explicit repository-owner request.
const harnessFilePattern = /\.harness\.(?:[cm]?[jt]sx?)$/u;
const rustTestPattern =
  /^\s*#\[(?:(?:[A-Za-z_]\w*)::)?test(?:\([^\]]*\))?\]\s*$/gmu;
const hasRustTestPattern =
  /^\s*#\[(?:(?:[A-Za-z_]\w*)::)?test(?:\([^\]]*\))?\]\s*$/mu;
// One definition for every JS/TS suite, frontend and harness alike. The
// lookbehind drops member calls such as `/^[0-9a-f]{64}$/.test(value)` and
// `pattern.test(x)`, which are assertions rather than declared test cases;
// counting them would inflate a file's count and invite "correcting" the
// manifest to a wrong number. Safe to share despite the `g` flag because
// `String.prototype.match` with a global regex ignores `lastIndex`.
const directTestCasePattern = /(?<![.\w$])(?:it|test)\s*\(/gu;
const hiddenExpansionPattern =
  /\b(?:describe|it|test)\s*\.\s*(?:each|only|skip)\b/u;

function fail(message) {
  throw new Error(`critical test budget: ${message}`);
}

function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath, files);
    else files.push(entryPath);
  }
  return files;
}

function validatePolicy() {
  if (manifest.schemaVersion !== 1) fail("unsupported manifest schema");
  const expected = {
    totalCap: hardCap.total,
    frontendCap: hardCap.frontend,
    frontendFileCap: hardCap.frontendFiles,
    rustCap: hardCap.rust,
    rustFileCap: hardCap.rustFiles,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (manifest.policy?.[key] !== value) {
      fail(`${key} must remain ${value}; an explicit user decision is required to change it`);
    }
  }
}

function describeSetDrift(actual, expected) {
  const added = actual.filter((filePath) => !expected.includes(filePath));
  const removed = expected.filter((filePath) => !actual.includes(filePath));
  const parts = [];
  if (added.length) parts.push(`unlisted: ${added.join(", ")}`);
  if (removed.length) parts.push(`missing from disk: ${removed.join(", ")}`);
  return parts.join("; ");
}

function moduleSpecifier(fromFile, toFile) {
  const relativePath = path
    .relative(path.dirname(path.join(root, fromFile)), path.join(root, toFile))
    .split(path.sep)
    .join("/")
    .replace(/\.(?:[cm]?[jt]sx?)$/u, "");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function validateRationale(filePath, entry) {
  if (!Number.isInteger(entry?.tests) || entry.tests < 1) {
    fail(`${filePath} must declare a positive integer test count`);
  }
  if (typeof entry.protects !== "string" || entry.protects.trim().length < 12) {
    fail(`${filePath} must explain the critical behavior it protects`);
  }
}

validatePolicy();
const files = walk(root);
const actualFrontendFiles = files
  .filter((filePath) => frontendTestPattern.test(filePath))
  .map(relative)
  .sort();
const actualRustFiles = files
  .filter((filePath) => filePath.endsWith(".rs"))
  .filter((filePath) => hasRustTestPattern.test(readFileSync(filePath, "utf8")))
  .map(relative)
  .sort();
const actualHarnessFiles = files
  .filter((filePath) => harnessFilePattern.test(filePath))
  .map(relative)
  .sort();
const expectedFrontendFiles = Object.keys(manifest.frontend).sort();
const expectedRustFiles = Object.keys(manifest.rust).sort();
const expectedHarnessFiles = Object.keys(manifest.harness ?? {}).sort();

if (JSON.stringify(actualFrontendFiles) !== JSON.stringify(expectedFrontendFiles)) {
  fail("frontend test files changed; replace an allowlisted file and update its rationale");
}
if (JSON.stringify(actualRustFiles) !== JSON.stringify(expectedRustFiles)) {
  fail("Rust test files changed; replace an allowlisted file and update its rationale");
}
if (!manifest.harness || typeof manifest.harness !== "object") {
  fail("manifest must declare a harness section for the *.harness.* contract suites");
}
if (JSON.stringify(actualHarnessFiles) !== JSON.stringify(expectedHarnessFiles)) {
  fail(
    "harness files changed; list every *.harness.* file in the manifest harness section " +
      `with its role and rationale (${describeSetDrift(actualHarnessFiles, expectedHarnessFiles)})`,
  );
}

let frontendCount = 0;
for (const [filePath, entry] of Object.entries(manifest.frontend)) {
  validateRationale(filePath, entry);
  const source = readFileSync(path.join(root, filePath), "utf8");
  if (hiddenExpansionPattern.test(source)) {
    fail(`${filePath} uses each/only/skip, which hides the real test budget`);
  }
  const count = source.match(directTestCasePattern)?.length ?? 0;
  if (count !== entry.tests) {
    fail(`${filePath} declares ${count} tests but the manifest allows ${entry.tests}`);
  }
  frontendCount += count;
}

let rustCount = 0;
for (const [filePath, entry] of Object.entries(manifest.rust)) {
  validateRationale(filePath, entry);
  const source = readFileSync(path.join(root, filePath), "utf8");
  if (/^\s*#\[ignore(?:\([^\]]*\))?\]\s*$/gmu.test(source)) {
    fail(`${filePath} contains an ignored test`);
  }
  const count = source.match(rustTestPattern)?.length ?? 0;
  if (count !== entry.tests) {
    fail(`${filePath} declares ${count} tests but the manifest allows ${entry.tests}`);
  }
  rustCount += count;
}

let harnessCount = 0;
let harnessDeclared = 0;
let harnessEntryPoints = 0;
let harnessHelpers = 0;
for (const [filePath, entry] of Object.entries(manifest.harness)) {
  if (entry?.role !== "entry-point" && entry?.role !== "helper") {
    fail(`${filePath} must declare role "entry-point" or "helper"`);
  }
  if (typeof entry.protects !== "string" || entry.protects.trim().length < 12) {
    fail(`${filePath} must explain the critical behavior it protects`);
  }
  const source = readFileSync(path.join(root, filePath), "utf8");
  if (hiddenExpansionPattern.test(source)) {
    fail(`${filePath} uses each/only/skip, which hides the real harness count`);
  }
  const count = source.match(directTestCasePattern)?.length ?? 0;
  if (!Number.isInteger(entry.tests) || entry.tests !== count) {
    fail(`${filePath} runs ${count} harness cases but the manifest declares ${entry.tests}`);
  }
  if (entry.role === "helper") {
    if (count !== 0) {
      fail(`${filePath} declares role helper but runs ${count} cases; list it as an entry point`);
    }
    const importer = entry.importedBy;
    if (!Object.hasOwn(manifest.harness, importer)) {
      fail(`${filePath} must name a listed harness file as importedBy`);
    }
    const specifier = moduleSpecifier(importer, filePath);
    if (!readFileSync(path.join(root, importer), "utf8").includes(`"${specifier}"`)) {
      fail(`${filePath} is not imported by ${importer}; it is unreachable dead harness code`);
    }
    harnessHelpers += 1;
    continue;
  }
  if (count < 1) {
    fail(`${filePath} declares role entry-point but runs no cases`);
  }
  const runner = entry.runner;
  if (typeof runner !== "string" || !existsSync(path.join(root, runner))) {
    fail(`${filePath} must name the existing vitest config that runs it`);
  }
  const included = path
    .relative(path.dirname(path.join(root, runner)), path.join(root, filePath))
    .split(path.sep)
    .join("/");
  if (!readFileSync(path.join(root, runner), "utf8").includes(`"${included}"`)) {
    fail(`${runner} no longer includes ${filePath}; the harness would stop running silently`);
  }
  harnessEntryPoints += 1;
  harnessCount += count;
  harnessDeclared += entry.tests;
}

if (actualFrontendFiles.length > hardCap.frontendFiles) {
  fail(`frontend file count ${actualFrontendFiles.length} exceeds ${hardCap.frontendFiles}`);
}
if (actualRustFiles.length > hardCap.rustFiles) {
  fail(`Rust file count ${actualRustFiles.length} exceeds ${hardCap.rustFiles}`);
}
if (frontendCount > hardCap.frontend) {
  fail(`frontend count ${frontendCount} exceeds ${hardCap.frontend}`);
}
if (rustCount > hardCap.rust) {
  fail(`Rust count ${rustCount} exceeds ${hardCap.rust}`);
}
if (frontendCount + rustCount > hardCap.total) {
  fail(`total count ${frontendCount + rustCount} exceeds ${hardCap.total}`);
}

console.log(
  `critical test budget ok: frontend ${frontendCount}/${hardCap.frontend}, ` +
    `Rust ${rustCount}/${hardCap.rust}, total ${frontendCount + rustCount}/${hardCap.total}`,
);
console.log(
  `harness ${harnessCount}/${harnessDeclared} (budget 외 계약 검증, 208에 포함되지 않음): ` +
    `${harnessEntryPoints} entry points, ${harnessHelpers} helper modules`,
);
