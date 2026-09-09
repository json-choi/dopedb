#!/usr/bin/env node
// Keeps the repository's critical test suite within its explicit fixed budget.

import { readFileSync, readdirSync } from "node:fs";
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
  ".vercel",
  "dist",
  "node_modules",
  "target",
]);
const frontendTestPattern =
  /(?:\.test|\.spec|\.node-test)\.(?:[cm]?[jt]sx?)$/u;
const rustTestPattern =
  /^\s*#\[(?:(?:[A-Za-z_]\w*)::)?test(?:\([^\]]*\))?\]\s*$/gmu;
const hasRustTestPattern =
  /^\s*#\[(?:(?:[A-Za-z_]\w*)::)?test(?:\([^\]]*\))?\]\s*$/mu;
const directFrontendTestPattern = /\b(?:it|test)\s*\(/gu;
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
const expectedFrontendFiles = Object.keys(manifest.frontend).sort();
const expectedRustFiles = Object.keys(manifest.rust).sort();

if (JSON.stringify(actualFrontendFiles) !== JSON.stringify(expectedFrontendFiles)) {
  fail("frontend test files changed; replace an allowlisted file and update its rationale");
}
if (JSON.stringify(actualRustFiles) !== JSON.stringify(expectedRustFiles)) {
  fail("Rust test files changed; replace an allowlisted file and update its rationale");
}

let frontendCount = 0;
for (const [filePath, entry] of Object.entries(manifest.frontend)) {
  validateRationale(filePath, entry);
  const source = readFileSync(path.join(root, filePath), "utf8");
  if (hiddenExpansionPattern.test(source)) {
    fail(`${filePath} uses each/only/skip, which hides the real test budget`);
  }
  const count = source.match(directFrontendTestPattern)?.length ?? 0;
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
