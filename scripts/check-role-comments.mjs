// Format-only gate for the TS/TSX role-comment rule in CLAUDE.md: a source file longer than
// ROLE_COMMENT_LINE_THRESHOLD lines must open with a comment before its imports.
//
// This script checks presence, never quality. Any leading comment passes. Whether the comment
// actually states the file's state ownership, input/output, and responsibility boundary is a
// code-review judgement and is deliberately not automated: a scanner that guessed at wording
// would reward boilerplate like "this file contains the X component", which the rule exists to
// prevent. Reviewers own that call.
//
// Rust follows a different rule (`//!` module docs at the top of every module, with no line
// threshold) and is not scanned here.
//
// The exemption set below is the only thing that can hide a missing comment, so it is frozen
// against EXPECTED_EXEMPTION_IDS and guarded by the self-checks at the end of this file.

import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export const ROLE_COMMENT_LINE_THRESHOLD = 45;

// Roots are scanned separately because they are at different stages. `src` is complete and
// must stay at zero; the others carry a documented backlog that may shrink but never grow.
// Lowering a cap after clearing files is the expected way to edit this table.
const ROOTS = [
  { path: "src", missingCap: 0 },
  { path: "workspace-cloud", missingCap: 90 },
  { path: "site", missingCap: 3 },
];

// Every reason a file may skip the rule. `skip` drops the file from the rule entirely;
// `prologue` keeps the file under the rule but lets a directive such as "use client" precede
// the comment, because a directive prologue must stay the first statement in the module.
const EXEMPTIONS = [
  {
    id: "size",
    kind: "skip",
    reason: `at most ${ROLE_COMMENT_LINE_THRESHOLD} lines`,
  },
  {
    id: "declaration",
    kind: "skip",
    reason: "*.d.ts ambient declarations",
  },
  {
    id: "test",
    kind: "skip",
    reason: "*.test.* / *.spec.* / *.harness.* / __tests__/",
  },
  {
    id: "generated",
    kind: "skip",
    reason: "gen/ or generated/ path segment, or an @generated marker",
  },
  {
    id: "directive",
    kind: "prologue",
    reason: '"use client" and similar directives may precede the comment',
  },
];

// Frozen so that widening the exemption set is a deliberate two-place edit reviewed together
// with docs/CODE_STRUCTURE.md, instead of a quiet way to make this check pass.
const EXPECTED_EXEMPTION_IDS = "size,declaration,test,generated,directive";

// A raised threshold or a broad new skip would shrink how much of the tree the rule reaches
// without ever reporting a failure. Require the rule to still cover most hand-written source.
const MIN_ENFORCED_COVERAGE = 0.6;

// Generated output already carries its own provenance header, so no file should currently need
// this exemption. A rising count means hand-written files are being marked as generated.
const MAX_GENERATED_RELIANCE = 6;

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const TEST_FILE = /\.(test|spec|harness)\.[cm]?[jt]sx?$/;
const DIRECTIVE_STATEMENT = /^(["'])[^"'\n]*\1\s*;?\s*$/;
const GENERATED_MARKER = /@generated\b/;

function lineCount(source) {
  if (source.length === 0) return 0;
  const breaks = source.split("\n").length - 1;
  return source.endsWith("\n") ? breaks : breaks + 1;
}

function segments(file) {
  return file.split("/");
}

function skipExemption(file, source) {
  if (file.endsWith(".d.ts")) return "declaration";
  const parts = segments(file);
  if (TEST_FILE.test(parts.at(-1) ?? "")) return "test";
  if (parts.includes("__tests__")) return "test";
  if (parts.slice(0, -1).some((part) => part === "gen" || part === "generated")) {
    return "generated";
  }
  if (GENERATED_MARKER.test(source.split("\n").slice(0, 5).join("\n"))) {
    return "generated";
  }
  if (lineCount(source) <= ROLE_COMMENT_LINE_THRESHOLD) return "size";
  return null;
}

// Returns whether a leading comment exists and whether a directive prologue came first.
function leadingComment(source) {
  let sawDirective = false;
  for (const raw of source.replace(/^﻿/, "").split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith("//") || line.startsWith("/*")) {
      return { hasComment: true, afterDirective: sawDirective };
    }
    if (DIRECTIVE_STATEMENT.test(line)) {
      sawDirective = true;
      continue;
    }
    return { hasComment: false, afterDirective: sawDirective };
  }
  return { hasComment: false, afterDirective: sawDirective };
}

// The single decision for one file, shared by the repository scan and the self-test.
export function inspectRoleComment(file, source) {
  const exempt = skipExemption(file, source);
  if (exempt) return { file, status: "exempt", exemption: exempt };
  const { hasComment, afterDirective } = leadingComment(source);
  if (!hasComment) return { file, status: "missing", lines: lineCount(source) };
  return {
    file,
    status: "present",
    exemption: afterDirective ? "directive" : null,
  };
}

async function sourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return SOURCE_EXTENSIONS.includes(extname(entry.name)) ? [path] : [];
    }),
  );
  return nested.flat();
}

async function inspectRoot(root) {
  const cwd = repositoryRoot;
  const files = await sourceFiles(join(cwd, root.path));
  const results = await Promise.all(
    files.map(async (path) => {
      const file = relative(cwd, path).split(sep).join("/");
      return inspectRoleComment(file, await readFile(path, "utf8"));
    }),
  );
  results.sort((a, b) => a.file.localeCompare(b.file));
  const exemptions = new Map(EXEMPTIONS.map(({ id }) => [id, 0]));
  for (const result of results) {
    if (!result.exemption) continue;
    exemptions.set(result.exemption, (exemptions.get(result.exemption) ?? 0) + 1);
  }
  const structural = results.filter(
    (result) => result.exemption !== "declaration" && result.exemption !== "test",
  );
  const required = results.filter((result) => result.status !== "exempt");
  return {
    root,
    results,
    exemptions,
    missing: results.filter((result) => result.status === "missing"),
    coverage: structural.length === 0 ? 1 : required.length / structural.length,
  };
}

function selfTest() {
  const long = (body) => `${body}\n${"const filler = 1;\n".repeat(60)}`;
  const cases = [
    ["detects a missing comment", "src/a.ts", long('import x from "y";'), "missing", null],
    ["accepts a line comment", "src/b.ts", long("// Owns the draft."), "present", null],
    ["accepts a block comment", "src/c.ts", long("/** Owns the draft. */"), "present", null],
    ["accepts any leading comment without judging it", "src/d.ts", long("// x"), "present", null],
    ["exempts a short file", "src/e.ts", 'import x from "y";\n', "exempt", "size"],
    ["exempts a 45-line file", "src/f.ts", `${"const a = 1;\n".repeat(45)}`, "exempt", "size"],
    ["requires a 46-line file", "src/g.ts", `${"const a = 1;\n".repeat(46)}`, "missing", null],
    ["exempts an ambient declaration", "src/h.d.ts", long("declare const a: 1;"), "exempt", "declaration"],
    ["exempts a unit test", "src/i.test.ts", long('import x from "y";'), "exempt", "test"],
    ["exempts a spec", "src/j.spec.tsx", long('import x from "y";'), "exempt", "test"],
    ["exempts a contract harness", "src/k.harness.ts", long('import x from "y";'), "exempt", "test"],
    ["exempts a __tests__ file", "src/__tests__/l.ts", long('import x from "y";'), "exempt", "test"],
    ["exempts a generated directory", "src/ipc/generated/m.ts", long('import x from "y";'), "exempt", "generated"],
    ["exempts an @generated marker", "src/n.ts", long("/* @generated */\nimport x from 'y';"), "exempt", "generated"],
    ['accepts a comment after "use client"', "src/o.tsx", long('"use client";\n\n// Owns the panel.'), "present", "directive"],
    ['rejects "use client" with no comment', "src/p.tsx", long('"use client";\n\nimport x from "y";'), "missing", null],
  ];
  const failures = [];
  for (const [name, file, source, status, exemption] of cases) {
    const result = inspectRoleComment(file, source);
    const actual = result.exemption ?? null;
    if (result.status !== status || actual !== exemption) {
      failures.push(
        `${name}: expected ${status}/${exemption}, got ${result.status}/${actual}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error("Role-comment self-test failed:\n");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Role-comment self-test ok: ${cases.length} cases`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const diagnostics = [];

const actualExemptionIds = EXEMPTIONS.map(({ id }) => id).join(",");
if (actualExemptionIds !== EXPECTED_EXEMPTION_IDS) {
  diagnostics.push(
    `exemption set changed (${actualExemptionIds}); update EXPECTED_EXEMPTION_IDS and docs/CODE_STRUCTURE.md in the same change`,
  );
}

const roots = await Promise.all(ROOTS.map(inspectRoot));

for (const { root, missing } of roots) {
  if (missing.length > root.missingCap) {
    diagnostics.push(
      `${root.path}: ${missing.length} file(s) over ${ROLE_COMMENT_LINE_THRESHOLD} lines open without a comment, cap is ${root.missingCap}`,
    );
    for (const result of missing.slice(0, 20)) {
      diagnostics.push(`  ${result.file} (${result.lines} lines)`);
    }
    if (missing.length > 20) {
      diagnostics.push(`  … ${missing.length - 20} more`);
    }
  } else if (missing.length < root.missingCap) {
    diagnostics.push(
      `${root.path}: only ${missing.length} file(s) missing a comment, so lower its cap from ${root.missingCap}`,
    );
  }
}

const enforced = roots.find(({ root }) => root.missingCap === 0);
if (enforced && enforced.coverage < MIN_ENFORCED_COVERAGE) {
  diagnostics.push(
    `${enforced.root.path}: the rule now reaches only ${(enforced.coverage * 100).toFixed(1)}% of its hand-written files (floor ${(MIN_ENFORCED_COVERAGE * 100).toFixed(0)}%); a raised threshold or a broad exemption is hiding files`,
  );
}

const generatedReliance = roots.reduce(
  (total, { exemptions }) => total + (exemptions.get("generated") ?? 0),
  0,
);
if (generatedReliance > MAX_GENERATED_RELIANCE) {
  diagnostics.push(
    `${generatedReliance} file(s) skip the rule as generated, over the ${MAX_GENERATED_RELIANCE} allowed; confirm each one is really emitted by a generator`,
  );
}

if (diagnostics.length > 0) {
  console.error("Role comment format check failed:\n");
  for (const diagnostic of diagnostics) console.error(`- ${diagnostic}`);
  console.error(
    `\nAdd a short comment before the imports describing what the file owns. Presence is checked here; accuracy is reviewed in code review.`,
  );
  process.exit(1);
}

const scanned = roots.reduce((total, { results }) => total + results.length, 0);
const required = roots.reduce(
  (total, { results }) =>
    total + results.filter((result) => result.status !== "exempt").length,
  0,
);
const backlog = roots.reduce((total, { missing }) => total + missing.length, 0);
console.log(
  `Role comment format ok: ${required}/${scanned} TS/TSX files under the rule, ${backlog} documented backlog file(s)`,
);
for (const { root, missing, exemptions, coverage } of roots) {
  const detail = EXEMPTIONS.map(({ id }) => `${id} ${exemptions.get(id) ?? 0}`).join(", ");
  console.log(
    `  ${root.path}: missing ${missing.length}/${root.missingCap} · coverage ${(coverage * 100).toFixed(1)}% · ${detail}`,
  );
}
