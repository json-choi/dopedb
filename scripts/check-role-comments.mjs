// Enforces the CLAUDE.md rule that a TS/TSX screen, component, or lib file over 45
// lines opens with a role comment before its imports. This is a format gate only: it
// proves a header exists, never that the header describes the file truthfully, and
// the accuracy of a responsibility description stays a code-review judgement.
//
// The Rust rule is deliberately different and is not checked here. Every Rust module
// carries a `//!` header regardless of length, so it has no threshold to measure and
// no exemption list; see AGENTS.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

/** More than this many lines and the file must explain its own responsibility. */
export const ROLE_COMMENT_LINE_THRESHOLD = 45;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * Why a file is outside the rule. Each reason is a deliberate exemption, not an
 * unreviewed gap:
 * - `short`: at or under the threshold, where the whole file is the explanation.
 * - `test`: a spec or contract harness; its intent lives in its case names.
 * - `declaration`: an ambient `.d.ts`, which declares types and owns no behaviour.
 * - `generated`: written by a generator, so a hand-written header would be erased.
 */
const EXEMPTION_REASONS = new Set(["short", "test", "declaration", "generated"]);

const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "coverage"]);

// A directive prologue must stay the first statement, so a role comment is allowed
// to follow it rather than being forced above it.
const DIRECTIVE_PROLOGUE = /^["']use [a-z][a-z ]*["'];?$/;

const GENERATED_MARKER =
  /(?:^|\n)\s*(?:\/\/|\/\*|#)\s*(?:@generated|code generated|generated file|do not edit)\b/i;

function portable(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isTestPath(relativePath) {
  const fileName = path.posix.basename(relativePath);
  return (
    /\.(?:test|spec)\.[^.]+$/.test(fileName)
    || /\.harness\.[^.]+$/.test(fileName)
    || /(?:^|\/)__tests__(?:\/|$)/.test(relativePath)
  );
}

function isGeneratedPath(relativePath, source) {
  return (
    /(?:^|\/)(?:gen|generated)(?:\/|$)/.test(relativePath)
    || GENERATED_MARKER.test(source.slice(0, 2_000))
  );
}

function lineCount(source) {
  const lines = source.split("\n");
  return source.endsWith("\n") ? Math.max(0, lines.length - 1) : lines.length;
}

/** The first line that has to carry the header, after blanks and any directive. */
function firstMeaningfulLine(source) {
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (DIRECTIVE_PROLOGUE.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}

function hasRoleComment(source) {
  const first = firstMeaningfulLine(source);
  return first.startsWith("//") || first.startsWith("/*");
}

function exemptionFor(record) {
  if (isTestPath(record.relativePath)) return "test";
  if (record.relativePath.endsWith(".d.ts")) return "declaration";
  if (isGeneratedPath(record.relativePath, record.source)) return "generated";
  if (lineCount(record.source) <= ROLE_COMMENT_LINE_THRESHOLD) return "short";
  return null;
}

/**
 * Sorts every record into exactly one of missing, compliant, or exempt. Exemptions
 * are decided before the header is read so an exempt file is never reported either
 * way, and the three groups always add up to the input.
 */
export function analyzeRoleComments(records) {
  const missing = [];
  const compliant = [];
  const exempt = [];
  for (const record of records) {
    const exemption = exemptionFor(record);
    if (exemption) {
      exempt.push({ path: record.relativePath, reason: exemption });
      continue;
    }
    const entry = { path: record.relativePath, loc: lineCount(record.source) };
    if (hasRoleComment(record.source)) compliant.push(entry);
    else missing.push(entry);
  }
  const byReason = {};
  for (const reason of EXEMPTION_REASONS) {
    byReason[reason] = exempt.filter((entry) => entry.reason === reason).length;
  }
  return {
    missing: missing.sort((left, right) => left.path.localeCompare(right.path)),
    compliant,
    exempt,
    summary: {
      files: records.length,
      checked: missing.length + compliant.length,
      missing: missing.length,
      exempt: exempt.length,
      exemptByReason: byReason,
    },
  };
}

export function collectRoleCommentSources(directory) {
  const records = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
          walk(absolute);
        }
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      records.push({
        relativePath: portable(path.relative(root, absolute)),
        source: fs.readFileSync(absolute, "utf8").replace(/\r\n?/g, "\n"),
      });
    }
  };
  walk(directory);
  return records.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

const longBody = Array.from({ length: 60 }, (_, index) => `export const v${index} = ${index};`)
  .join("\n");

// Exercised on every invocation so a change to the exemption list cannot quietly
// stop reporting a missing header. Each case names what it proves.
function runSelfCheck() {
  const fixtures = [
    { relativePath: "src/a/Missing.tsx", source: `import x from "y";\n${longBody}\n` },
    { relativePath: "src/a/Commented.tsx", source: `// Owns one thing.\nimport x from "y";\n${longBody}\n` },
    { relativePath: "src/a/BlockCommented.ts", source: `/* Owns one thing. */\nimport x from "y";\n${longBody}\n` },
    { relativePath: "src/a/Directive.tsx", source: `"use client";\n\n// Owns one thing.\nimport x from "y";\n${longBody}\n` },
    { relativePath: "src/a/DirectiveMissing.tsx", source: `"use client";\n\nimport x from "y";\n${longBody}\n` },
    { relativePath: "src/a/Short.ts", source: "export const a = 1;\n" },
    { relativePath: "src/a/thing.test.ts", source: `import x from "y";\n${longBody}\n` },
    { relativePath: "src/a/thing.harness.ts", source: `import x from "y";\n${longBody}\n` },
    { relativePath: "src/a/__tests__/thing.ts", source: `import x from "y";\n${longBody}\n` },
    { relativePath: "src/a/env.d.ts", source: `declare const x: string;\n${longBody}\n` },
    { relativePath: "src/ipc/generated/wire.ts", source: `import x from "y";\n${longBody}\n` },
    { relativePath: "src/a/marked.ts", source: `// @generated by a tool\nimport x from "y";\n${longBody}\n` },
  ];
  const analysis = analyzeRoleComments(fixtures);

  const missingPaths = analysis.missing.map((entry) => entry.path);
  const expectedMissing = ["src/a/DirectiveMissing.tsx", "src/a/Missing.tsx"];
  if (missingPaths.join("|") !== expectedMissing.join("|")) {
    throw new Error(
      `role-comment self-check: expected ${expectedMissing.join(", ")} to be missing, got ${missingPaths.join(", ") || "none"}`,
    );
  }

  const compliantPaths = analysis.compliant.map((entry) => entry.path).sort();
  const expectedCompliant = [
    "src/a/BlockCommented.ts",
    "src/a/Commented.tsx",
    "src/a/Directive.tsx",
  ];
  if (compliantPaths.join("|") !== expectedCompliant.join("|")) {
    throw new Error(
      `role-comment self-check: expected ${expectedCompliant.join(", ")} to pass, got ${compliantPaths.join(", ") || "none"}`,
    );
  }

  const exemptByPath = new Map(analysis.exempt.map((entry) => [entry.path, entry.reason]));
  const expectedExempt = {
    "src/a/Short.ts": "short",
    "src/a/thing.test.ts": "test",
    "src/a/thing.harness.ts": "test",
    "src/a/__tests__/thing.ts": "test",
    "src/a/env.d.ts": "declaration",
    "src/ipc/generated/wire.ts": "generated",
    "src/a/marked.ts": "generated",
  };
  for (const [filePath, reason] of Object.entries(expectedExempt)) {
    if (exemptByPath.get(filePath) !== reason) {
      throw new Error(
        `role-comment self-check: expected ${filePath} exempt as "${reason}", got "${exemptByPath.get(filePath) ?? "not exempt"}"`,
      );
    }
  }
  if (analysis.exempt.length !== Object.keys(expectedExempt).length) {
    throw new Error("role-comment self-check: an unexpected file was exempted");
  }
}

function printAudit(analysis) {
  const byArea = new Map();
  for (const entry of analysis.compliant.concat(analysis.missing)) {
    const segments = entry.path.split("/");
    const area = segments.length > 2 ? segments.slice(0, 2).join("/") : segments[0];
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
  }
  console.log("Role comments by source area:");
  for (const [area, count] of [...byArea].sort()) {
    console.log(`  ${area}: ${count} file${count === 1 ? "" : "s"} in scope`);
  }
}

runSelfCheck();

const analysis = analyzeRoleComments(collectRoleCommentSources(path.join(root, "src")));

if (args.has("--json")) {
  console.log(JSON.stringify(analysis, null, 2));
  process.exit(0);
}
if (args.has("--audit")) {
  printAudit(analysis);
}

const { summary } = analysis;
if (analysis.missing.length > 0) {
  console.error(
    `Role comments missing on ${analysis.missing.length} file(s) over ${ROLE_COMMENT_LINE_THRESHOLD} lines.`,
  );
  console.error(
    "Add a short comment above the imports describing what state the file owns, what crosses its boundary, and what it refuses to do.",
  );
  for (const entry of analysis.missing) {
    console.error(`  - ${entry.path} (${entry.loc} lines)`);
  }
  process.exit(1);
}
console.log(
  `Role comments: ${summary.checked}/${summary.checked} files over ${ROLE_COMMENT_LINE_THRESHOLD} lines carry a header`
  + ` · ${summary.exempt} exempt (${Object.entries(summary.exemptByReason).map(([reason, count]) => `${reason} ${count}`).join(", ")})`,
);
