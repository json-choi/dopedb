// Builds one deterministic inventory for every hand-written code surface in the
// repository. Classification is deliberately separate from scoring so generated,
// declarative, test, and product modules can use different review thresholds.
import fs from "node:fs";
import path from "node:path";

const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".ts",
  ".tsx",
]);

const IGNORED_DIRECTORIES = new Set([
  ".agents",
  ".codex",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "graphify-out",
  "node_modules",
  "target",
  "vendor",
]);

function portable(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isIgnoredDirectory(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith(".");
}

function walk(directory, root, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isIgnoredDirectory(entry.name)) walk(absolute, root, files);
      continue;
    }
    if (!entry.isFile() || !CODE_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push({
      absolutePath: absolute,
      relativePath: portable(path.relative(root, absolute)),
    });
  }
}

function sourceLooksGenerated(source) {
  return /(?:^|\n)\s*(?:\/\/|\/\*|#)\s*(?:@generated|code generated|generated file|do not edit)\b/i
    .test(source.slice(0, 2_000));
}

export function classifySource(relativePath, source) {
  const fileName = path.posix.basename(relativePath);
  if (
    fileName.endsWith(".d.ts")
    || /(?:^|\/)(?:gen|generated)(?:\/|$)/.test(relativePath)
    || sourceLooksGenerated(source)
  ) {
    return "generated";
  }
  if (
    /(?:^|\/)(?:fixtures?|snapshots?)(?:\/|$)/.test(relativePath)
    || /\.(?:fixture|snapshot)\.[^.]+$/.test(fileName)
  ) {
    return "declarative";
  }
  if (
    /\.(?:test|spec)\.[^.]+$/.test(fileName)
    || /\.harness\.[^.]+$/.test(fileName)
    || /(?:^|\/)(?:__tests__|tests?)(?:\/|$)/.test(relativePath)
    || /(?:^|\/)[^/]+_tests\.rs$/.test(relativePath)
  ) {
    return "test";
  }
  if (
    /(?:^|\/)(?:migrations?|schemas?|catalogs?)(?:\/|$)/.test(relativePath)
    || /(?:^|\/)(?:schema|catalog|constants|migrations?|artifactPalettes)\.[^.]+$/.test(relativePath)
  ) {
    return "declarative";
  }
  if (
    relativePath.startsWith("scripts/")
    || relativePath.startsWith("tools/")
    || /(?:^|\/)benchmarks?(?:\/|$)/.test(relativePath)
    || relativePath.endsWith(".sh")
  ) {
    return "tooling";
  }
  return "production";
}

export function collectSourceInventory(root) {
  const files = [];
  walk(root, root, files);
  return files
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((file) => {
      const source = fs.readFileSync(file.absolutePath, "utf8").replace(/\r\n?/g, "\n");
      return {
        ...file,
        category: classifySource(file.relativePath, source),
        extension: path.extname(file.relativePath),
        source,
      };
    });
}
