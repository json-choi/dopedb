// Builds user-facing release notes from append-only, reviewed fragments. The
// prepared mode deliberately preserves the pre-MVP generic release body while
// keeping the format, validator, preview, and workflow integration executable.

import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, ".release-notes", "config.json");
const SCHEMA_PATH = path.join(ROOT, ".release-notes", "fragment.schema.json");
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const AREA = /^[a-z][a-z0-9-]{1,31}$/;
const CONVENTIONAL_PREFIX = /^(?:feat|fix|test|refactor|build|ci|docs|chore|perf)(?:\([^)]*\))?:/i;
const TYPES = new Set(["feature", "improvement", "fix", "security", "breaking"]);
const AUDIENCES = new Set(["user", "admin", "developer", "internal"]);
const CONFIG_KEYS = new Set([
  "schemaVersion",
  "mode",
  "repository",
  "defaultLocale",
  "fragmentsDirectory",
  "examplesDirectory",
  "maxHighlights",
]);
const FRAGMENT_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "type",
  "area",
  "audience",
  "title",
  "summary",
  "details",
  "issues",
  "highlight",
]);
const SECTION_ORDER = [
  ["breaking", "업데이트 전 알아둘 점"],
  ["feature", "새로 할 수 있는 일"],
  ["improvement", "더 편해진 점"],
  ["fix", "해결된 문제"],
  ["security", "관리자·보안"],
];
const PREPARED_RELEASE_BODY = [
  "Download the macOS or Windows installer from the assets below.",
  "",
  "The Tauri updater uses `latest.json` from this release to detect and install signed updates.",
  "",
].join("\n");

function fail(label, reason) {
  throw new Error(label + ": " + reason);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(label, "must contain a JSON object");
  }
  return value;
}

function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(label, "contains unknown fields: " + unknown.join(", "));
}

function assertSingleLine(value, label, minLength, maxLength) {
  if (typeof value !== "string" || value !== value.trim() || /[\r\n]/.test(value)) {
    fail(label, "must be one trimmed line");
  }
  if (value.length < minLength || value.length > maxLength) {
    fail(label, `must be ${minLength}-${maxLength} characters`);
  }
  if (/[<>]/.test(value)) fail(label, "must not contain raw HTML delimiters");
  return value;
}

function assertRelativeReleaseDirectory(value, label) {
  const directory = assertSingleLine(value, label, 3, 100);
  if (path.isAbsolute(directory) || directory.includes("\\") || directory.split("/").includes("..")) {
    fail(label, "must be a repository-relative directory without traversal");
  }
  if (!directory.startsWith(".release-notes/")) {
    fail(label, "must stay inside .release-notes");
  }
  return directory.replace(/\/$/, "");
}

function validateConfig(value, label = ".release-notes/config.json") {
  const config = assertObject(value, label);
  assertKnownKeys(config, CONFIG_KEYS, label);
  if (config.schemaVersion !== 1) fail(label, "schemaVersion must be 1");
  if (config.mode !== "prepared" && config.mode !== "active") {
    fail(label, "mode must be prepared or active");
  }
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(config.repository ?? "")) {
    fail(label, "repository must be an owner/name pair");
  }
  if (config.defaultLocale !== "ko") fail(label, "only the ko release-note contract is supported");
  config.fragmentsDirectory = assertRelativeReleaseDirectory(config.fragmentsDirectory, label + " fragmentsDirectory");
  config.examplesDirectory = assertRelativeReleaseDirectory(config.examplesDirectory, label + " examplesDirectory");
  if (!Number.isInteger(config.maxHighlights) || config.maxHighlights < 1 || config.maxHighlights > 5) {
    fail(label, "maxHighlights must be an integer from 1 to 5");
  }
  return config;
}

export function validateFragment(value, label) {
  const fragment = assertObject(value, label);
  assertKnownKeys(fragment, FRAGMENT_KEYS, label);
  if (fragment.$schema !== undefined && fragment.$schema !== "../fragment.schema.json") {
    fail(label, "$schema must point to ../fragment.schema.json");
  }
  if (fragment.schemaVersion !== 1) fail(label, "schemaVersion must be 1");
  if (!TYPES.has(fragment.type)) fail(label, "type is not supported");
  if (typeof fragment.area !== "string" || !AREA.test(fragment.area)) {
    fail(label, "area must be a lowercase slug between 2 and 32 characters");
  }
  if (!AUDIENCES.has(fragment.audience)) fail(label, "audience is not supported");
  fragment.title = assertSingleLine(fragment.title, label + " title", 8, 80);
  fragment.summary = assertSingleLine(fragment.summary, label + " summary", 20, 240);
  if (CONVENTIONAL_PREFIX.test(fragment.title)) {
    fail(label, "title must describe user impact instead of a commit type");
  }
  if (!Array.isArray(fragment.details) || fragment.details.length > 4) {
    fail(label, "details must be an array with at most four entries");
  }
  fragment.details = fragment.details.map((detail, index) =>
    assertSingleLine(detail, `${label} details[${index}]`, 10, 240),
  );
  if (!Array.isArray(fragment.issues)) fail(label, "issues must be an array");
  const issueSet = new Set();
  for (const issue of fragment.issues) {
    if (!Number.isInteger(issue) || issue < 1 || issue > 999999) {
      fail(label, "issues must contain positive GitHub issue numbers");
    }
    if (issueSet.has(issue)) fail(label, "issues must not contain duplicates");
    issueSet.add(issue);
  }
  if (typeof fragment.highlight !== "boolean") fail(label, "highlight must be boolean");
  if (fragment.audience === "internal" && fragment.highlight) {
    fail(label, "internal changes cannot be release highlights");
  }
  return fragment;
}

async function readJson(filePath, label = path.relative(ROOT, filePath)) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    fail(label, `cannot be read (${error.code ?? "unknown error"})`);
  }
  try {
    return JSON.parse(source);
  } catch {
    fail(label, "is not valid JSON");
  }
}

async function loadConfig() {
  return validateConfig(await readJson(CONFIG_PATH));
}

async function jsonFiles(directory, { allowGitkeep = false } = {}) {
  const absolute = path.join(ROOT, directory);
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail(path.relative(ROOT, entryPath), "symlinks are not allowed");
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) fail(path.relative(ROOT, entryPath), "must be a regular file");
      if (allowGitkeep && entry.name === ".gitkeep") continue;
      if (!entry.name.endsWith(".json")) fail(path.relative(ROOT, entryPath), "must use the .json extension");
      files.push(entryPath);
    }
  }
  await visit(absolute);
  return files;
}

async function validateSchema() {
  const schema = assertObject(await readJson(SCHEMA_PATH), ".release-notes/fragment.schema.json");
  if (schema.title !== "DopeDB release-note fragment") {
    fail(".release-notes/fragment.schema.json", "has an unexpected title");
  }
  if (schema.properties?.schemaVersion?.const !== 1) {
    fail(".release-notes/fragment.schema.json", "must describe schemaVersion 1");
  }
}

async function loadWorkingTreeFragments(directory, options) {
  const files = await jsonFiles(directory, options);
  return Promise.all(
    files.map(async (filePath) => ({
      file: path.relative(ROOT, filePath),
      fragment: validateFragment(await readJson(filePath), path.relative(ROOT, filePath)),
    })),
  );
}

async function runCheck() {
  const config = await loadConfig();
  await validateSchema();
  const examples = await loadWorkingTreeFragments(config.examplesDirectory);
  const fragments = await loadWorkingTreeFragments(config.fragmentsDirectory, { allowGitkeep: true });
  if (examples.length === 0) fail(config.examplesDirectory, "must contain at least one validated example");
  process.stdout.write(
    `release notes: ${config.mode} mode, ${examples.length} example(s), ${fragments.length} production fragment(s)\n`,
  );
}

function escapeMarkdown(value) {
  return value.replace(/([\\`*_[\]<>#])/g, "\\$1");
}

function issueReferences(fragment, repository) {
  if (fragment.issues.length === 0) return "";
  const links = fragment.issues.map(
    (issue) => `[#${issue}](https://github.com/${repository}/issues/${issue})`,
  );
  return " (" + links.join(", ") + ")";
}

function fragmentLines(fragment, repository) {
  const lines = [
    `- **${escapeMarkdown(fragment.title)}** — ${escapeMarkdown(fragment.summary)}${issueReferences(fragment, repository)}`,
  ];
  for (const detail of fragment.details) lines.push(`  - ${escapeMarkdown(detail)}`);
  return lines;
}

function sortedFragments(entries) {
  return [...entries].sort((left, right) => {
    if (left.fragment.highlight !== right.fragment.highlight) return left.fragment.highlight ? -1 : 1;
    const title = left.fragment.title.localeCompare(right.fragment.title, "ko");
    return title !== 0 ? title : left.file.localeCompare(right.file);
  });
}

export function renderReleaseNotes({ config, entries, version, tag, from }) {
  const publicEntries = sortedFragments(entries.filter(({ fragment }) => fragment.audience !== "internal"));
  const internalEntries = sortedFragments(entries.filter(({ fragment }) => fragment.audience === "internal"));
  const highlights = publicEntries.filter(({ fragment }) => fragment.highlight);
  if (publicEntries.length === 0) fail("release notes", "active mode requires at least one user-facing fragment");
  if (highlights.length === 0) fail("release notes", "active mode requires at least one highlighted fragment");
  if (highlights.length > config.maxHighlights) {
    fail("release notes", `contains ${highlights.length} highlights; maximum is ${config.maxHighlights}`);
  }

  const lines = ["## 이번 버전 한눈에 보기", ""];
  for (const entry of highlights) lines.push(...fragmentLines(entry.fragment, config.repository));

  for (const [type, title] of SECTION_ORDER) {
    const section = publicEntries.filter(({ fragment }) => fragment.type === type && !fragment.highlight);
    if (section.length === 0) continue;
    lines.push("", `## ${title}`, "");
    for (const entry of section) lines.push(...fragmentLines(entry.fragment, config.repository));
  }

  if (internalEntries.length > 0) {
    lines.push("", "<details>", "<summary>내부 개선 및 개발자 정보</summary>", "");
    for (const entry of internalEntries) lines.push(...fragmentLines(entry.fragment, config.repository));
    lines.push("", "</details>");
  }

  lines.push(
    "",
    "## 다운로드 및 업데이트",
    "",
    "아래 자산에서 macOS 또는 Windows 설치 파일을 내려받을 수 있습니다.",
    "Tauri 자동 업데이트는 이 릴리스의 서명된 `latest.json`을 사용합니다.",
    "",
    "## 전체 기술 변경 내역",
    "",
    `[${escapeMarkdown(from)} 이후의 전체 변경 보기](https://github.com/${config.repository}/compare/${encodeURIComponent(from)}...${encodeURIComponent(tag)})`,
    "",
  );
  const rendered = lines.join("\n");
  if (Buffer.byteLength(rendered, "utf8") > 64 * 1024) fail("release notes", "rendered body exceeds 64 KiB");
  if (!STABLE_VERSION.test(version)) fail("release notes", "version must be a stable X.Y.Z string");
  return rendered;
}

async function git(args, options = {}) {
  try {
    return await execFile("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const message = String(error.stderr || error.message || "git command failed").trim();
    fail("git " + args[0], message);
  }
}

async function activeRangeEntries(config, from, to) {
  if (!from || !to) fail("release notes", "active mode requires --from and --to refs");
  await git(["rev-parse", "--verify", `${from}^{commit}`]);
  await git(["rev-parse", "--verify", `${to}^{commit}`]);
  try {
    await execFile("git", ["merge-base", "--is-ancestor", from, to], { cwd: ROOT });
  } catch {
    fail("release notes", `${from} must be an ancestor of ${to}`);
  }

  const immutable = await git([
    "diff",
    "--name-only",
    "-z",
    "--diff-filter=MDRT",
    `${from}..${to}`,
    "--",
    config.fragmentsDirectory,
  ]);
  const changedExisting = immutable.stdout.split("\0").filter(Boolean);
  if (changedExisting.length > 0) {
    fail("release notes", "published-range fragments are append-only: " + changedExisting.join(", "));
  }

  const added = await git([
    "diff",
    "--name-only",
    "-z",
    "--diff-filter=A",
    `${from}..${to}`,
    "--",
    config.fragmentsDirectory,
  ]);
  const files = added.stdout.split("\0").filter(Boolean).sort();
  if (files.length === 0) fail("release notes", "active release range contains no new fragments");

  const prefix = config.fragmentsDirectory + "/";
  return Promise.all(
    files.map(async (file) => {
      if (!file.startsWith(prefix) || !/^[a-z0-9][a-z0-9._/-]*\.json$/.test(file.slice(prefix.length))) {
        fail(file, "must be a lowercase JSON fragment path");
      }
      const shown = await git(["show", `${to}:${file}`]);
      let value;
      try {
        value = JSON.parse(shown.stdout);
      } catch {
        fail(file, "is not valid JSON at the release ref");
      }
      return { file, fragment: validateFragment(value, file) };
    }),
  );
}

function parseArguments(argv) {
  const command = argv[0] ?? "check";
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail("arguments", "unexpected value " + key);
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      fail("arguments", key + " requires a value");
    }
    const name = key.slice(2);
    if (!["version", "tag", "from", "to", "output"].includes(name)) {
      fail("arguments", "unknown option " + key);
    }
    if (options[name] !== undefined) fail("arguments", key + " was provided more than once");
    options[name] = argv[index + 1];
    index += 1;
  }
  return { command, options };
}

function assertReleaseIdentity(version, tag) {
  if (!STABLE_VERSION.test(version ?? "")) fail("--version", "must be a stable X.Y.Z string");
  if (tag !== `app-v${version}`) fail("--tag", "must exactly match app-v<version>");
}

async function emit(rendered, output) {
  if (!output) {
    process.stdout.write(rendered);
    return;
  }
  const destination = path.resolve(ROOT, output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, rendered, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`release notes written to ${destination}\n`);
}

async function runPreview(config) {
  const entries = await loadWorkingTreeFragments(config.examplesDirectory);
  const rendered = renderReleaseNotes({
    config,
    entries,
    version: "0.0.0",
    tag: "app-v0.0.0",
    from: "app-v0.0.0-base",
  });
  await emit(rendered);
}

async function runRender(config, options) {
  assertReleaseIdentity(options.version, options.tag);
  if (config.mode === "prepared") {
    await emit(PREPARED_RELEASE_BODY, options.output);
    return;
  }
  const entries = await activeRangeEntries(config, options.from, options.to);
  const rendered = renderReleaseNotes({
    config,
    entries,
    version: options.version,
    tag: options.tag,
    from: options.from,
  });
  await emit(rendered, options.output);
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command !== "render" && Object.keys(options).length > 0) {
    fail("arguments", command + " does not accept options");
  }
  if (command === "check") return runCheck();
  const config = await loadConfig();
  if (command === "mode") {
    process.stdout.write(config.mode + "\n");
    return;
  }
  if (command === "preview") return runPreview(config);
  if (command === "render") return runRender(config, options);
  fail("arguments", "command must be check, mode, preview, or render");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
